"""
display.py — Terminal rendering.

RULE: Renders strictly from ParsedResponse dataclass objects.
Zero string re-parsing here — that was the audit finding.
All finding/command display goes through typed objects.
"""

import sys
import builtins as _b

RESET  = "\033[0m"; BOLD = "\033[1m"; DIM = "\033[2m"
RED    = "\033[91m"; ORANGE = "\033[33m"; YELLOW = "\033[93m"
GREEN  = "\033[92m"; BLUE = "\033[94m"; CYAN = "\033[96m"
WHITE  = "\033[97m"; GRAY = "\033[90m"
WIDTH  = 80

SEV_COLORS = {
    "CRITICAL": RED+BOLD, "HIGH": ORANGE+BOLD,
    "MEDIUM": YELLOW, "LOW": BLUE, "INFO": CYAN,
}

def c(text, color=""):
    return f"{color}{text}{RESET}" if (color and sys.stdout.isatty()) else str(text)

def banner():
    _b.print("\n".join([
        "",
        c("  ╔══════════════════════════════════════════╗", CYAN),
        c("  ║  ", CYAN) + c("Vexa", BOLD+GREEN) + c(" — AI Security Assistant     ║", CYAN),
        c("  ║  ", CYAN) + c("For YOUR own systems only              ║", GRAY),
        c("  ╚══════════════════════════════════════════╝", CYAN),
        "",
        c("  [!] Only test systems you own or are authorized to test.", ORANGE),
        "",
    ]))

def print_section(title):
    bar = "─" * max(1, WIDTH - len(title) - 4)
    _b.print()
    _b.print(c(f"┌── {title} {bar}", CYAN))

def print_info(msg):    _b.print(c("│  ", GRAY) + str(msg))
def print_error(msg):   _b.print(c(f"  [ERROR] {msg}", RED), file=sys.stderr)
def print_warning(msg): _b.print(c(f"  [WARN]  {msg}", YELLOW))
def print_ok(msg):      _b.print(c(f"  [OK]    {msg}", GREEN))

def print_output_received(n):
    _b.print(c(f"  ✓ Received {n} lines. Analyzing...", GREEN))
    _b.print()

def prompt_user(msg):
    try:
        return input(c(f"\n  ▶ {msg} ", BOLD+CYAN))
    except (EOFError, KeyboardInterrupt):
        return "quit"

def print_finding(f: dict):
    """Render a finding dict (from static scanner or Finding.to_dict())."""
    sev   = f.get("severity", "INFO")
    color = SEV_COLORS.get(sev, WHITE)
    _b.print(c(f"│  [{sev}]", color) + f"  {f.get('name', f.get('what', '?'))}")
    _b.print(c("│     ", GRAY) + c(f"@ {f.get('location','?')}", DIM))
    match = f.get("match") or f.get("fix","")
    if match:
        _b.print(c("│     ", GRAY) + c(f"  {str(match)[:100]}", GRAY))


def render_finding(finding) -> None:
    """
    Render a Finding dataclass object.
    This is the ONLY place findings are rendered — no re-parsing elsewhere.
    """
    from vexa.core.response_validator import Finding
    if not isinstance(finding, Finding):
        print_finding(finding if isinstance(finding, dict) else vars(finding))
        return

    color = SEV_COLORS.get(finding.severity, WHITE)
    _b.print()
    _b.print(c(f"  ▶ [{finding.severity}] ", color) + c(finding.name, BOLD))
    _b.print(c("    LOCATION : ", GRAY) + finding.location)
    if finding.what:
        _b.print(c("    WHAT     : ", GRAY) + finding.what)
    if finding.impact:
        _b.print(c("    IMPACT   : ", YELLOW) + finding.impact)
    if finding.fix:
        _b.print(c("    FIX      : ", GREEN) + finding.fix)
    if finding.exploit_cmd:
        _b.print(c("    VERIFY   : ", ORANGE) + c(f"$ {finding.exploit_cmd}", BOLD))
    if finding.confidence and finding.confidence != "medium":
        _b.print(c(f"    CONFIDENCE: ", GRAY) + finding.confidence)


def render_command(cmd) -> None:
    """
    Render a SuggestedCommand dataclass object.
    Displayed clearly — never auto-executed.
    """
    from vexa.core.response_validator import SuggestedCommand
    risk_color = {"LOW": GREEN, "MEDIUM": YELLOW, "HIGH": ORANGE}.get(
        getattr(cmd, "risk", "MEDIUM"), WHITE
    )
    _b.print()
    _b.print(c("  ┌─ RUN THIS COMMAND " + "─"*41, GREEN))
    _b.print(c("  │  $ ", GREEN) + c(cmd.command, BOLD+WHITE))
    _b.print(c("  └" + "─"*61, GREEN))
    _b.print(c("  TOOL   : ", CYAN) + cmd.tool)
    _b.print(c("  WHY    : ", CYAN) + cmd.why)
    if cmd.flags:
        _b.print(c("  FLAGS  : ", CYAN) + cmd.flags)
    _b.print(c("  RISK   : ", CYAN) + c(cmd.risk, risk_color))
    _b.print()


def render_narrative(text: str) -> None:
    """Render plain text narrative from AI — strip markdown to clean terminal text."""
    from vexa.utils.input_handler import strip_markdown
    clean = strip_markdown(text)
    for line in clean.split("\n"):
        _b.print(line)


def render_parsed_response(parsed) -> None:
    """
    Master render function — takes a ParsedResponse and renders everything.
    This is the ONLY entry point for displaying AI responses.
    No string parsing happens here — only rendering typed objects.
    """
    # Narrative first
    if parsed.narrative:
        render_narrative(parsed.narrative)

    # Commands
    for cmd in parsed.commands:
        render_command(cmd)

    # Findings
    for finding in parsed.findings:
        render_finding(finding)

    # Parse warnings (shown subtly)
    if parsed.parse_warnings:
        _b.print()
        for w in parsed.parse_warnings:
            print_warning(f"Parser: {w}")

def print_ai(text: str) -> None:
    """
    Legacy entry point — used for narrative-only AI text
    (e.g. error messages, fallback text).
    For structured responses use render_parsed_response().
    """
    render_narrative(text)
