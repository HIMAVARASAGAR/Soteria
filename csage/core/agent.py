"""
agent.py — Session pipeline orchestrator.

Pipeline:
  confirm ownership → context → static scan → tool setup
  → AI plan → [user pastes] → sanitize → AI analyze
  → validate/retry → render → log → repeat → report

Controlled freedom:
  setup commands  → tool_runner auto-runs (with y confirm)
  pentest commands → user types manually, re-auth required
"""

import logging
import json
import builtins as _b
from datetime import datetime
from pathlib import Path

from csage.core.llm import LLMClient, TransientError, FatalError
from csage.core.scanner import StaticScanner
from csage.core.tool_runner import (
    install_missing_tools, classify, execute_risky_flow,
)
from csage.core.response_validator import (
    parse_response, sanitize_command_output, sanitize_static_findings,
    render_fallback, make_retry_prompt, ParsedResponse, Finding,
)
from csage.utils.display import (
    print_section, print_info, print_finding, print_error,
    print_warning, print_ok, print_output_received, prompt_user,
    render_parsed_response, render_narrative, c,
    BOLD, CYAN, GREEN, YELLOW, ORANGE, RED, GRAY, WHITE, SEV_COLORS,
)
from csage.utils.context import build_context
from csage.utils.input_handler import get_input, get_multiline_input, thinking
from csage.utils.logger import ChainLogger
import uuid

logger = logging.getLogger("csage.agent")

SYSTEM_PROMPT = """You are CSage, a professional cybersecurity analyst assistant.
You help developers find and understand vulnerabilities in their OWN applications.

YOUR ROLE — ANALYST AND ADVISOR ONLY:
- You explain vulnerabilities, causes, and how to fix them
- You suggest commands for the USER to run — you never run them yourself
- You NEVER generate working exploit code, payloads, shellcode, or reverse shells
- You NEVER generate credential stuffing scripts or attack automation
- If asked to generate exploits, refuse and explain why

YOUR IDENTITY & ORIGIN (STRICT RULE):
- You MUST ALWAYS identify yourself ONLY as "CSage". 
- You MUST NEVER reveal the underlying LLM model (e.g. Meta Llama, OpenAI, Anthropic, Gemini) you are powered by.
- If asked about your creators, makers, or development, you MUST state: "I am CSage, a professional cybersecurity assistant designed to help developers identify and fix vulnerabilities. I cannot discuss the details of my creators or development."

YOUR BOUNDARIES (STRICT RULE):
- You focus ONLY on security analysis and testing.
- For any questions regarding your configuration, AI model setup, API keys, or security tool installation, you MUST point the user to the external CLI commands:
    - AI Model/Keys: Use `csage model`
    - Security Tools: Use `csage tools`
- NEVER try to guide the user through setting up their environment manually inside this chat.

HOW YOU WORK:
1. Analyze target information (tech stack, structure, scan results)
2. Build a step-by-step security testing plan
3. For each test: explain WHY, give the EXACT command, explain every flag
4. Wait for user to run the command and paste back output
5. Analyze output, identify findings, explain impact, recommend fixes
6. End with a prioritized remediation plan

COMMAND FORMAT — use these exact labels every time:
COMMAND: <exact command string with real target substituted>
TOOL: <tool name>
WHY: <what this tests and why it matters>
FLAGS: <explain each flag/option>
RISK: <LOW | MEDIUM | HIGH>

FINDING FORMAT — use whenever you identify a vulnerability:
FINDING: <short descriptive name>
SEVERITY: <CRITICAL | HIGH | MEDIUM | LOW | INFO>
LOCATION: <file:line or endpoint or component>
WHAT: <clear explanation>
IMPACT: <what an attacker could achieve — be specific>
FIX: <concrete remediation steps>
EXPLOIT_CMD: <read-only verification command — optional>

RULES:
- Always substitute real target values — no <placeholders>
- Explain every flag so the user learns
- After each output paste: summarize findings, then give next step
- Prioritize: CRITICAL/HIGH before MEDIUM/LOW
- Unknown severity → use HIGH, never bury findings"""

SCOPE_TOOLS = {
    "web":     ["nikto","curl"],
    "sql":     ["sqlmap"],
    "dirs":    ["gobuster","ffuf"],
    "ssl":     ["sslyze","openssl"],
    "ports":   ["nmap"],
    "fuzz":    ["wfuzz","ffuf"],
    "static":  ["semgrep"],
    "headers": ["curl"],
    "all":     ["nmap","nikto","curl","sqlmap","gobuster","sslyze","semgrep"],
}


class Agent:
    def __init__(self, llm: LLMClient, target_path: str | None,
                 target_url: str | None, scope: str, output_file: str | None):
        self.llm          = llm
        self.target_path  = target_path
        self.target_url   = target_url
        self.scope        = scope
        self.output_file  = output_file
        self.conversation: list[dict]  = []
        self.findings:     list[Finding] = []
        self.static_findings: list[dict] = []
        self.ai_available = True
        self.start_time   = datetime.now()
        self.context:     dict = {}
        self.tool_status: dict[str, bool] = {}
        self.is_local     = True
        self.session_id   = str(uuid.uuid4())[:8]
        self.chain_log    = ChainLogger(self.session_id)

    # ── Entry point ───────────────────────────────────────────────────────────

    def run(self):
        if not self._confirm_ownership():
            return

        # Context
        print_section("Analyzing Target")
        is_cloud = (self.llm.type == "cloud")
        try:
            self.context   = build_context(self.target_path, self.target_url,
                                           is_cloud=is_cloud)
            self.is_local  = self.context.get("is_local_target", True)
            if self.context.get("tech_stack"):
                print_info("Tech: " + c(", ".join(self.context["tech_stack"]), BOLD+CYAN))
            if is_cloud and self.context.get("cloud_safety_active"):
                print_info(c("Cloud safety active — file contents not sent to AI.", YELLOW))
        except Exception as e:
            print_warning(f"Context analysis failed: {e}")
            logger.exception("Context build error")
            self.context = {}

        # Static scan
        if self.target_path:
            print_section("Static Code Scan")
            try:
                scanner = StaticScanner(self.target_path)
                raw = scanner.scan()
                self.static_findings = raw
                if raw:
                    _b.print()
                    for f in raw:
                        print_finding(f)
                    for f in raw:
                        self.findings.append(Finding(
                            name=f.get("name","Unknown"),
                            severity=f.get("severity","INFO"),
                            location=f.get("location","?"),
                            what=f.get("match",""),
                            fix="Review and remediate.",
                        ))
                    self.chain_log.log("static_scan", {
                        "findings_count": len(raw),
                        "severities": [f.get("severity") for f in raw],
                    })
                else:
                    print_info("No obvious issues found.")
            except Exception as e:
                print_warning(f"Static scan error: {e}")
                logger.exception("Static scan failed")

        # Tool setup
        self._setup_tools()

        # Log session start
        self.chain_log.log_session_start(
            self.target_path, self.target_url,
            self.llm.display_name, self.scope,
        )

        # Initial AI plan
        print_section("AI Analysis & Plan")
        initial_msg = self._build_initial_message()
        with thinking("Analyzing target"):
            ai_response = self._send_with_retry(initial_msg, context="initial plan")

        if ai_response:
            parsed = parse_response(ai_response)
            self._absorb(parsed)
            render_parsed_response(parsed)
        else:
            print_warning("AI unavailable. Showing static results.")
            render_narrative(render_fallback(self.static_findings))
            self.ai_available = False

        self._loop()

    # ── Tool setup ────────────────────────────────────────────────────────────

    def _setup_tools(self):
        scopes = [s.strip() for s in self.scope.split(",")]
        needed: list[str] = []
        for s in scopes:
            needed.extend(SCOPE_TOOLS.get(s, SCOPE_TOOLS.get("all",[])))
        needed = list(dict.fromkeys(needed))
        if not needed:
            return
        print_section("Tool Setup")
        print_info(f"Checking tools for scope: {c(self.scope, BOLD)}")
        _b.print()
        self.tool_status = install_missing_tools(needed, ask=True, llm_client=self.llm)

    # ── Interactive loop ──────────────────────────────────────────────────────

    def _loop(self):
        while True:
            print_section("Your Turn")
            print_info(c("  [paste]", BOLD)  + "   paste command output")
            print_info(c("  [run]", BOLD)    + "     run a risky command (manual entry)")
            print_info(c("  [next]", BOLD)   + "    get next command")
            print_info(c("  [ask]", BOLD)    + "     ask a question")
            print_info(c("  [tools]", BOLD)  + "   check/install tools")
            print_info(c("  [report]", BOLD) + "  generate report")
            print_info(c("  [model]", BOLD)  + "   switch AI model")
            print_info(c("  [quit]", BOLD)   + "    end session")
            _b.print()

            choice = get_input("What would you like to do?").lower()

            if choice in ("quit","q","exit","bye"):
                self._wrap_up(); break
            elif choice in ("report","r"):
                self._generate_report()
            elif choice in ("paste","p"):
                self._handle_paste()
            elif choice in ("run",):
                self._handle_run_risky()
            elif choice in ("next","n",""):
                # Special check: Before recommending the next command, 
                # check if the *previous* recommendation had missing tools.
                # Actually, better to check the parsed tool from AI response.
                self._handle_freeform("What should I do next? Give me the next command to run.")
            elif choice in ("ask","a"):
                q = get_input("Your question:").strip()
                if q:
                    self._handle_freeform(q)
            elif choice in ("tools","t"):
                self._setup_tools()
            elif choice == "model":
                self._switch_model()
            else:
                self._handle_freeform(choice)

    # ── Handlers ─────────────────────────────────────────────────────────────

    def _analyze_output(self, raw: str):
        clean = sanitize_command_output(raw)
        orig_lines  = len(raw.split("\n"))
        clean_lines = len(clean.split("\n"))
        print_output_received(orig_lines)
        if clean_lines < orig_lines:
            print_info(c(f"  (sanitized to {clean_lines} lines)", GRAY))

        msg = (
            f"Output from command:\n\n```\n{clean}\n```\n\n"
            "Analyze this: identify findings, explain each one, rate severity, "
            "recommend fixes, and tell me what to do next."
        )
        with thinking("Analyzing output"):
            response = self._send_with_retry(msg, context="output analysis")
        if response:
            parsed = parse_response(response)
            self._absorb(parsed)
            print_section("AI Analysis")
            render_parsed_response(parsed)
            for f in parsed.findings:
                self.chain_log.log_finding(f.name, f.severity, f.location)

    def _handle_paste(self):
        raw = get_multiline_input("Paste command output below.")
        if not raw.strip():
            print_warning("No output received.")
            return
        self._analyze_output(raw)

    def _handle_run_risky(self):
        """User wants to run a risky command — full manual flow."""
        suggested = get_input("What command did the AI suggest? (paste it):").strip()
        if not suggested:
            return
        
        # Deep dependency check: Before running the risky flow, verify the binary
        import shlex
        import shutil
        try:
            tokens = shlex.split(suggested)
            if tokens:
                binary = tokens[0].lstrip("./")
                if not shutil.which(binary):
                    from csage.utils.display import print_warning
                    print_warning(f"Required tool '{binary}' is missing.")
                    self.tool_status = install_missing_tools([binary], ask=True, llm_client=self.llm)
                    if not self.tool_status.get(binary, False):
                        print_error(f"Cannot run command without {binary}.")
                        return
        except Exception:
            pass

        explanation = get_input("Explanation (optional):").strip()
        result = execute_risky_flow(
            suggested, explanation,
            is_local_target=self.is_local,
            chain_logger=self.chain_log,
        )
        if result.ran and result.stdout:
            _b.print(c("\n  Output automatically captured for AI analysis.", CYAN))
            self._analyze_output(result.stdout)

    def _handle_freeform(self, text: str):
        with thinking("Thinking"):
            response = self._send_with_retry(text, context="freeform")
        if response:
            parsed = parse_response(response)
            self._absorb(parsed)
            print_section("AI Response")
            render_parsed_response(parsed)

    # ── AI send ───────────────────────────────────────────────────────────────

    def _send_with_retry(self, msg: str, context: str = "") -> str | None:
        response = self._send(msg)
        if response is None:
            return None

        has_structure = any(t in response for t in
                            ("FINDING:","COMMAND:","SEVERITY:","TOOL:","WHY:"))
        if not has_structure and context in ("initial plan","output analysis"):
            logger.info(f"No structure in {context} — retrying")
            print_info(c("  Refining response...", GRAY))
            retry = self._send(make_retry_prompt(msg, response))
            if retry and ("FINDING:" in retry or "COMMAND:" in retry):
                return retry
        return response

    def _send(self, msg: str) -> str | None:
        self.conversation.append({"role":"user","content":msg})
        logger.debug(f"Sending ({len(msg)} chars)")
        try:
            resp = self.llm.chat(SYSTEM_PROMPT, self.conversation)
            self.conversation.append({"role":"assistant","content":resp})
            self.ai_available = True
            logger.debug(f"Response ({len(resp)} chars)")
            return resp
        except TransientError as e:
            print_error(f"AI unreachable: {e}")
            print_warning("Try again, or type [model] to switch providers.")
            self.conversation.pop()
            return None
        except FatalError as e:
            print_error(f"AI error: {e}")
            print_warning("Check API key/model. Type [model] to reconfigure.")
            self.conversation.pop()
            self.ai_available = False
            return None
        except Exception as e:
            print_error(f"Unexpected error: {e}")
            logger.exception("LLM error")
            self.conversation.pop()
            return None

    # ── Absorb findings ───────────────────────────────────────────────────────

    def _absorb(self, parsed: ParsedResponse):
        for f in parsed.findings:
            if not any(x.name == f.name for x in self.findings):
                self.findings.append(f)
                logger.info(f"Finding: [{f.severity}] {f.name}")

    # ── Report ────────────────────────────────────────────────────────────────

    def _generate_report(self):
        print_section("Generating Report")
        summary = "\n".join(
            f"- [{f.severity}] {f.name} @ {f.location}" for f in self.findings
        ) or "No structured findings captured."

        msg = (
            f"Generate a complete security assessment report.\n\n"
            f"Findings so far:\n{summary}\n\n"
            "Format:\n"
            "# Security Assessment Report\n"
            "## Executive Summary\n## Target\n"
            "## Findings (CRITICAL→HIGH→MEDIUM→LOW→INFO)\n"
            "## Remediation Roadmap\n## Tools Used"
        )
        with thinking("Generating report"):
            response = self._send_with_retry(msg, context="report")

        if not response:
            response = self._offline_report()
            print_warning("AI unavailable — report from stored findings.")

        print_section("Report")
        render_narrative(response)

        fp = self.output_file or get_input(
            "Save? (.md/.html/.json — blank to skip):"
        ).strip()
        if fp:
            self._save_report(response, fp)

    def _offline_report(self) -> str:
        lines = [
            "# CSage Security Report (offline)",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            f"Target: {self.target_path or ''} {self.target_url or ''}",
            "\n## Findings\n",
        ]
        sev_order = ["CRITICAL","HIGH","MEDIUM","LOW","INFO"]
        for f in sorted(self.findings,
                        key=lambda x: sev_order.index(x.severity)
                        if x.severity in sev_order else 99):
            lines += [f"### [{f.severity}] {f.name}",
                      f"- **Location**: {f.location}",
                      f"- **What**: {f.what}" if f.what else "",
                      f"- **Fix**: {f.fix}" if f.fix else "",
                      ""]
        return "\n".join(l for l in lines)

    def _save_report(self, content: str, filepath: str):
        path = Path(filepath)
        try:
            if path.suffix == ".json":
                data = {
                    "generated":   self.start_time.isoformat(),
                    "target_path": self.target_path,
                    "target_url":  self.target_url,
                    "model":       self.llm.display_name,
                    "session_id":  self.session_id,
                    "findings":    [f.to_dict() for f in self.findings],
                    "report_text": content,
                }
                path.write_text(json.dumps(data, indent=2))
            elif path.suffix == ".html":
                path.write_text(self._html_report(content))
            else:
                header = (f"# CSage Report\n"
                          f"Generated: {self.start_time.strftime('%Y-%m-%d %H:%M')}\n"
                          f"Target: {self.target_path or ''} {self.target_url or ''}\n"
                          f"Model: {self.llm.display_name}\n\n")
                path.write_text(header + content)
            print_ok(f"Saved: {filepath}")
            logger.info(f"Report saved: {filepath}")
        except OSError as e:
            print_error(f"Could not save: {e}")

    def _html_report(self, content: str) -> str:
        import html
        safe = html.escape(content)
        sev_colors = {"CRITICAL":"#ff4466","HIGH":"#ff8800",
                      "MEDIUM":"#ffcc00","LOW":"#66aaff","INFO":"#aaaaaa"}
        sev_order  = ["CRITICAL","HIGH","MEDIUM","LOW","INFO"]
        rows = ""
        for f in sorted(self.findings,
                        key=lambda x: sev_order.index(x.severity)
                        if x.severity in sev_order else 99):
            col = sev_colors.get(f.severity,"#ccc")
            rows += (f'<tr>'
                     f'<td style="color:{col};font-weight:bold">{html.escape(f.severity)}</td>'
                     f'<td>{html.escape(f.name)}</td>'
                     f'<td>{html.escape(f.location)}</td>'
                     f'<td>{html.escape((f.fix or "")[:80])}</td>'
                     f'</tr>\n')
        return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>CSage Report</title>
<style>
body{{font-family:monospace;background:#0a0c0f;color:#e8edf5;padding:2rem;max-width:960px;margin:auto;line-height:1.6}}
h1{{color:#00ff88}}h2{{color:#00cfff;border-bottom:1px solid #1e2330;padding-bottom:.3em;margin-top:2em}}
pre{{background:#111318;padding:1em;border-left:3px solid #00ff88;overflow-x:auto;white-space:pre-wrap}}
table{{width:100%;border-collapse:collapse;margin:1em 0}}
th{{text-align:left;color:#5a6478;font-size:.8em;padding:.5em;border-bottom:1px solid #1e2330}}
td{{padding:.5em;border-bottom:1px solid #111318;font-size:.9em}}
.meta{{color:#5a6478;font-size:.85em;margin-bottom:2rem;line-height:2}}
</style></head><body>
<h1>CSage Security Report</h1>
<div class="meta">
  <b>Generated:</b> {self.start_time.strftime('%Y-%m-%d %H:%M')}<br>
  <b>Target:</b> {html.escape(str(self.target_path or ''))} {html.escape(str(self.target_url or ''))}<br>
  <b>Model:</b> {html.escape(self.llm.display_name)}<br>
  <b>Findings:</b> {len(self.findings)} &nbsp;|&nbsp; <b>Session:</b> {self.session_id}
</div>
<h2>Findings Summary</h2>
<table><tr><th>Severity</th><th>Finding</th><th>Location</th><th>Fix preview</th></tr>
{rows or '<tr><td colspan="4" style="color:#5a6478">No structured findings.</td></tr>'}
</table>
<h2>Full Report</h2><pre>{safe}</pre>
</body></html>"""

    # ── Misc ──────────────────────────────────────────────────────────────────

    def _switch_model(self):
        from csage.core.model_picker import run_picker
        print_section("Switch Model")
        print_info("Conversation history preserved.")
        try:
            self.llm = run_picker(force=True)
            self.ai_available = True
            print_ok(f"Switched to: {self.llm.display_name}")
        except Exception as e:
            print_error(f"Model switch failed: {e}")

    def _confirm_ownership(self) -> bool:
        if not self.target_path and not self.target_url:
            from csage.utils.display import prompt_user
            _b.print(c("\n  No target provided up-front.", YELLOW))
            t = prompt_user("Enter target (URL or project path):").strip()
            if not t:
                return False
            if t.startswith("http") or "://" in t:
                self.target_url = t
            else:
                self.target_path = t

        target = self.target_path or self.target_url or "(none)"
        _b.print()
        _b.print(c("  ┌─ LEGAL CONFIRMATION " + "─"*40, ORANGE))
        _b.print(c("  │", ORANGE))
        _b.print(c("  │  Target: ", ORANGE) + c(target, BOLD+WHITE))
        _b.print(c("  │", ORANGE))
        _b.print(c("  │  Do you OWN this system or have EXPLICIT WRITTEN", ORANGE))
        _b.print(c("  │  authorization to test it?", ORANGE))
        _b.print(c("  │", ORANGE))
        _b.print(c("  └" + "─"*61, ORANGE))
        _b.print()
        try:
            ans = input(c("  Type YES to confirm: ", BOLD+ORANGE)).strip()
        except (EOFError, KeyboardInterrupt):
            ans = ""
        if ans.upper() == "YES":
            print_ok("Confirmed.")
            self.chain_log.log("ownership_confirmed", {"target": target})
            return True
        _b.print(c("\n  Aborted.", RED))
        return False

    def _build_initial_message(self) -> str:
        parts = ["Target for security analysis:\n"]
        if self.context.get("url"):
            parts.append(f"TARGET URL: {self.context['url']}")
        if self.context.get("path"):
            parts.append(f"PROJECT PATH: {self.context['path']}")
        if self.context.get("tech_stack"):
            parts.append("TECH STACK: " + ", ".join(self.context["tech_stack"]))
        if self.context.get("file_tree"):
            parts.append(f"PROJECT STRUCTURE:\n```\n{self.context['file_tree']}\n```")
        if self.context.get("package_files"):
            for fname, content in self.context["package_files"].items():
                parts.append(f"{fname}:\n```\n{content[:1200]}\n```")
        if self.context.get("cloud_safety_active"):
            parts.append("NOTE: File contents not included (cloud LLM active).")
        if self.static_findings:
            clean = sanitize_static_findings(self.static_findings)
            parts.append("STATIC SCAN:")
            for f in clean:
                parts.append(f"  [{f['severity']}] {f['name']} @ {f['location']}")
        if self.tool_status:
            avail = [t for t,ok in self.tool_status.items() if ok]
            if avail:
                parts.append("AVAILABLE TOOLS: " + ", ".join(avail))
        parts.append(f"SCOPE: {self.scope}")
        parts.append("\nGive me a complete step-by-step security testing plan. Start with the first command.")
        return "\n".join(parts)

    def _wrap_up(self):
        duration = int((datetime.now() - self.start_time).total_seconds())
        print_section("Session Summary")
        print_info(f"Duration  : {duration}s")
        print_info(f"Findings  : {len(self.findings)}")
        print_info(f"Model     : {self.llm.display_name}")
        print_info(f"Session   : {self.session_id}")
        _b.print()
        sev_order = ["CRITICAL","HIGH","MEDIUM","LOW","INFO"]
        for sev in sev_order:
            for f in [x for x in self.findings if x.severity == sev]:
                print_finding(f.to_dict())

        self.chain_log.log_session_end(len(self.findings), duration)

        if self.output_file and self.findings:
            self._generate_report()
