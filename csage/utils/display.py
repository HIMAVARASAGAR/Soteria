"""
display.py — Terminal rendering.

RULE: Renders strictly from ParsedResponse dataclass objects.
Zero string re-parsing here — that was the audit finding.
All finding/command display goes through typed objects.
"""

import sys
import builtins as _b

# Palette — Refined "Pro" Aesthetic
RESET    = "\033[0m"
BOLD     = "\033[1m"
DIM      = "\033[2m"
ITALIC   = "\033[3m"

RED      = "\033[91m"
ORANGE   = "\033[33m"
YELLOW   = "\033[93m"
GREEN    = "\033[92m"
BLUE     = "\033[94m"
CYAN     = "\033[96m"
MAGENTA  = "\033[95m" # Brand: CSage Violet
VIOLET   = "\033[38;5;135m"
WHITE    = "\033[97m"
GRAY     = "\033[90m"

WIDTH    = 80

SEV_COLORS = {
    "CRITICAL": RED+BOLD, 
    "HIGH":     ORANGE+BOLD,
    "MEDIUM":   YELLOW, 
    "LOW":      BLUE, 
    "INFO":     CYAN,
}

def c(text, color=""):
    return f"{color}{text}{RESET}" if (color and sys.stdout.isatty()) else str(text)

def banner():
    from csage import __version__
    _b.print(c("\n  ● ", VIOLET) + c(f"CSage v{__version__}", BOLD+WHITE) + c(" — The AI Security Navigator", GRAY))
    _b.print(c("  " + "━"*45, GRAY))
    _b.print(c("  Use strictly for authorized security testing only.", GRAY+ITALIC))
    _b.print()

def print_section(title):
    _b.print()
    _b.print(c(f"  ━━━ {title.upper()} " + "━"*(60 - len(title)), VIOLET))
    _b.print()

def print_info(msg):    _b.print(c("    • ", GRAY) + str(msg))
def print_error(msg):   _b.print(c(f"    ✗ {msg}", RED), file=sys.stderr)
def print_warning(msg): _b.print(c(f"    ⚠ {msg}", YELLOW))
def print_ok(msg):      _b.print(c(f"    ✓ {msg}", GREEN))

def print_output_received(n):
    _b.print(c(f"    ✓ Received {n} lines. Analyzing...", GREEN))

def prompt_user(msg):
    try:
        return input(c(f"  ▶ {msg} ", BOLD+VIOLET))
    except (EOFError, KeyboardInterrupt):
        return "quit"

def print_finding(f: dict):
    """Render a finding dict (from static scanner or Finding.to_dict())."""
    sev   = f.get("severity", "INFO")
    color = SEV_COLORS.get(sev, WHITE)
    _b.print(c(f"    ✦ [{sev}]", color) + f"  {f.get('name', f.get('what', '?'))}")
    _b.print(c("      ", GRAY) + c(f"@ {f.get('location','?')}", DIM))

def render_finding(finding) -> None:
    from csage.core.response_validator import Finding
    if not isinstance(finding, Finding):
        print_finding(finding if isinstance(finding, dict) else vars(finding))
        return

    color = SEV_COLORS.get(finding.severity, WHITE)
    _b.print(c(f"  ✦ ", color) + c(finding.name, BOLD+WHITE))
    _b.print(c("    Severity : ", GRAY) + c(finding.severity, color))
    _b.print(c("    Location : ", GRAY) + finding.location)
    
    if finding.impact:
        _b.print(c("    Impact   : ", YELLOW) + finding.impact)
    if finding.fix:
        _b.print(c("    Remedy   : ", GREEN) + finding.fix)
    if finding.exploit_cmd:
        _b.print(c("    Verify   : ", ORANGE) + c(f"$ {finding.exploit_cmd}", BOLD))
    _b.print()

def render_command(cmd) -> None:
    from csage.core.response_validator import SuggestedCommand
    risk_color = {"LOW": GREEN, "MEDIUM": YELLOW, "HIGH": ORANGE}.get(
        getattr(cmd, "risk", "MEDIUM"), WHITE
    )
    
    _b.print(c("  ┌" + "─"*65, VIOLET))
    _b.print(c("  │  ID      : ", VIOLET) + c(f"Command Recommendation", BOLD+WHITE))
    _b.print(c("  │  EXEC    : ", VIOLET) + c(f"$ {cmd.command}", BOLD+WHITE))
    _b.print(c("  │  TOOL    : ", VIOLET) + cmd.tool)
    _b.print(c("  │  RISK    : ", VIOLET) + c(cmd.risk, risk_color))
    _b.print(c("  └" + "─"*65, VIOLET))
    _b.print(c("     " + cmd.why, GRAY))
    _b.print()

def render_narrative(text: str) -> None:
    from csage.utils.input_handler import strip_markdown
    clean = strip_markdown(text)
    for line in clean.split("\n"):
        if not line.strip(): 
            _b.print()
            continue
        _b.print(c("    ", GRAY) + line)

def render_parsed_response(parsed) -> None:
    if parsed.narrative:
        render_narrative(parsed.narrative)
        _b.print()

    if parsed.commands:
        for cmd in parsed.commands:
            render_command(cmd)

    if parsed.findings:
        for finding in parsed.findings:
            render_finding(finding)

    if parsed.parse_warnings:
        for w in parsed.parse_warnings:
            print_warning(f"Parser: {w}")

def thinking(msg="Consulting AI"):
    import contextlib
    @contextlib.contextmanager
    def _thinking():
        _b.print(c(f"  ⌛ {msg}...", GRAY), end="\r", flush=True)
        yield
        _b.print(" " * (len(msg) + 10), end="\r", flush=True)
    return _thinking()

def print_ai(text: str) -> None:
    render_narrative(text)
