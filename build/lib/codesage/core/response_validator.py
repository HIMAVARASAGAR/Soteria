"""
response_validator.py — Parse and validate AI responses.

AI is asked to use a structured label format (not JSON — label format
works better across all model sizes including small local models like Gemma 4B).

Handles:
  - Extracting FINDING blocks with all required fields
  - Extracting COMMAND blocks
  - Retry prompt generation when output is malformed
  - Fallback to static findings when AI fails completely
  - Input sanitization before sending to AI
"""

import re
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("cybersage.validator")

SEVERITIES = {"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"}
RISKS      = {"LOW", "MEDIUM", "HIGH"}

REQUIRED_FINDING_FIELDS = {"name", "severity", "location", "what", "fix"}
REQUIRED_COMMAND_FIELDS  = {"command", "tool", "why"}


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class Finding:
    name: str
    severity: str
    location: str
    what: str
    impact: str = ""
    fix: str = ""
    exploit_cmd: str = ""   # for user to run themselves — NOT auto-executed
    confidence: str = "medium"

    def is_valid(self) -> tuple[bool, str]:
        missing = []
        for f in REQUIRED_FINDING_FIELDS:
            if not getattr(self, f, "").strip():
                missing.append(f)
        if self.severity not in SEVERITIES:
            return False, f"Invalid severity '{self.severity}'"
        if missing:
            return False, f"Missing fields: {', '.join(missing)}"
        return True, "ok"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "severity": self.severity,
            "location": self.location,
            "what": self.what,
            "impact": self.impact,
            "fix": self.fix,
            "exploit_cmd": self.exploit_cmd,
            "confidence": self.confidence,
        }


@dataclass
class SuggestedCommand:
    command: str
    tool: str
    why: str
    flags: str = ""
    risk: str = "MEDIUM"

    def is_valid(self) -> tuple[bool, str]:
        missing = [f for f in REQUIRED_COMMAND_FIELDS if not getattr(self, f, "").strip()]
        if missing:
            return False, f"Missing fields: {', '.join(missing)}"
        if self.risk not in RISKS:
            self.risk = "MEDIUM"
        return True, "ok"


@dataclass
class ParsedResponse:
    findings: list[Finding] = field(default_factory=list)
    commands: list[SuggestedCommand] = field(default_factory=list)
    narrative: str = ""       # everything that isn't a structured block
    parse_warnings: list[str] = field(default_factory=list)
    valid: bool = True


# ── Parser ────────────────────────────────────────────────────────────────────

def parse_response(text: str) -> ParsedResponse:
    """
    Parse AI response text into structured findings + commands.
    Tolerant of minor formatting deviations — uses regex not exact splits.
    """
    result = ParsedResponse()
    remaining = text

    # ── Extract FINDING blocks ────────────────────────────────────────────────
    finding_pattern = re.compile(
        r'FINDING:\s*(.+?)(?=FINDING:|COMMAND:|$)',
        re.DOTALL | re.IGNORECASE
    )
    for match in finding_pattern.finditer(text):
        block = match.group(1).strip()
        lines = block.split("\n")
        name = lines[0].strip()
        if not name:
            continue

        f = Finding(
            name=name,
            severity=_extract_field(block, "SEVERITY", "INFO"),
            location=_extract_field(block, "LOCATION", "unknown"),
            what=_extract_field(block, "WHAT", ""),
            impact=_extract_field(block, "IMPACT", ""),
            fix=_extract_field(block, "FIX", ""),
            exploit_cmd=_extract_field(block, "EXPLOIT_CMD", ""),
        )

        # Normalise severity
        f.severity = f.severity.upper()
        if f.severity not in SEVERITIES:
            f.severity = _fuzzy_severity(f.severity)
            result.parse_warnings.append(
                f"Normalised severity for '{f.name}' to '{f.severity}'"
            )

        valid, reason = f.is_valid()
        if valid:
            result.findings.append(f)
        else:
            result.parse_warnings.append(f"Skipped finding '{name}': {reason}")
            logger.warning(f"Invalid finding block: {reason} — {name!r}")

        remaining = remaining.replace(match.group(0), "", 1)

    # ── Extract COMMAND blocks ────────────────────────────────────────────────
    cmd_pattern = re.compile(
        r'COMMAND:\s*(.+?)(?=COMMAND:|FINDING:|$)',
        re.DOTALL | re.IGNORECASE
    )
    for match in cmd_pattern.finditer(text):
        block = match.group(1).strip()
        lines = block.split("\n")
        command_str = lines[0].strip()
        if not command_str:
            continue

        cmd = SuggestedCommand(
            command=command_str,
            tool=_extract_field(block, "TOOL", "unknown"),
            why=_extract_field(block, "WHY", ""),
            flags=_extract_field(block, "FLAGS", ""),
            risk=_extract_field(block, "RISK", "MEDIUM").upper(),
        )

        valid, reason = cmd.is_valid()
        if valid:
            result.commands.append(cmd)
        else:
            result.parse_warnings.append(f"Skipped command: {reason}")

    # ── Narrative = everything left (explanation text) ────────────────────────
    # Strip out the structured blocks to get clean prose
    cleaned = re.sub(
        r'(FINDING|COMMAND|TOOL|WHY|FLAGS|RISK|SEVERITY|LOCATION|WHAT|IMPACT|FIX|EXPLOIT_CMD):\s*[^\n]*\n?',
        '', text, flags=re.IGNORECASE
    )
    result.narrative = cleaned.strip()

    if result.parse_warnings:
        logger.info(f"Parse warnings: {result.parse_warnings}")

    return result


def _extract_field(block: str, field_name: str, default: str = "") -> str:
    """Pull a labelled field value from a text block. Case-insensitive."""
    pattern = re.compile(rf'^{field_name}:\s*(.+)', re.IGNORECASE | re.MULTILINE)
    m = pattern.search(block)
    return m.group(1).strip() if m else default


def _fuzzy_severity(raw: str) -> str:
    """Map non-standard severity strings to our canonical set."""
    r = raw.upper()
    if any(w in r for w in ("CRIT", "FATAL", "URGENT")):
        return "CRITICAL"
    if any(w in r for w in ("HIGH", "MAJOR", "SERIOUS")):
        return "HIGH"
    if any(w in r for w in ("MED", "MODERATE", "WARN")):
        return "MEDIUM"
    if any(w in r for w in ("LOW", "MINOR", "SMALL")):
        return "LOW"
    return "INFO"


# ── Input sanitizer ───────────────────────────────────────────────────────────

MAX_PASTE_CHARS = 8_000    # ~2000 tokens — safe for small models
MAX_PASTE_LINES = 150


def sanitize_command_output(raw: str) -> str:
    """
    Clean up pasted command output before sending to AI:
    - Remove ANSI escape codes
    - Cap size (keep head + tail if too big)
    - Strip blank lines runs
    - Remove control characters
    """
    # Strip ANSI
    ansi = re.compile(r'\x1b\[[0-9;]*[mGKHF]')
    text = ansi.sub('', raw)

    # Strip other control chars (keep newlines and tabs)
    text = re.sub(r'[^\x09\x0a\x20-\x7e]', '', text)

    # Collapse runs of 3+ blank lines into 1
    text = re.sub(r'\n{3,}', '\n\n', text)

    lines = text.split('\n')

    if len(lines) > MAX_PASTE_LINES or len(text) > MAX_PASTE_CHARS:
        head_lines = lines[:60]
        tail_lines = lines[-40:]
        omitted = len(lines) - 100
        text = (
            "\n".join(head_lines)
            + f"\n\n... [{omitted} lines omitted — output truncated for model context] ...\n\n"
            + "\n".join(tail_lines)
        )

    return text.strip()


def sanitize_static_findings(findings: list[dict]) -> list[dict]:
    """Return clean, minimal dicts — drop noisy raw match strings."""
    clean = []
    for f in findings:
        clean.append({
            "severity": f.get("severity", "INFO"),
            "name":     f.get("name", "Unknown"),
            "location": f.get("location", "?"),
        })
    return clean


# ── Retry prompt ─────────────────────────────────────────────────────────────

def make_retry_prompt(original_question: str, bad_response: str) -> str:
    """Generate a correction prompt when the first response had no structured output."""
    return (
        f"Your previous response didn't include any structured FINDING or COMMAND blocks.\n\n"
        f"Please re-answer the following question, this time making sure to use the "
        f"exact FINDING: and COMMAND: label format as specified.\n\n"
        f"Question: {original_question}\n\n"
        f"Previous response (for context):\n{bad_response[:500]}..."
    )


# ── Fallback renderer ─────────────────────────────────────────────────────────

def render_fallback(static_findings: list[dict]) -> str:
    """
    When AI is completely unavailable, render static scan results
    as a readable report so the session is still useful.
    """
    if not static_findings:
        return "Static scan found no issues. AI analysis unavailable."

    lines = ["Static scan results (AI analysis unavailable):\n"]
    by_sev: dict[str, list] = {}
    for f in static_findings:
        sev = f.get("severity", "INFO")
        by_sev.setdefault(sev, []).append(f)

    for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"):
        if sev not in by_sev:
            continue
        lines.append(f"\n[{sev}]")
        for f in by_sev[sev]:
            lines.append(f"  • {f.get('name','?')} @ {f.get('location','?')}")

    lines.append(
        "\n\nRecommendation: Fix HIGH/CRITICAL items first. "
        "Re-run with working AI connectivity for full analysis."
    )
    return "\n".join(lines)
