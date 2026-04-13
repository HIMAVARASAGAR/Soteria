"""
tool_runner.py — Controlled execution engine.

HARD RULE:
  Setup/install commands  → runs automatically after user confirms
  Pentest commands        → NEVER auto-run, shown to user only

shlex.split() replaces shell=True everywhere.
ValueError from unclosed quotes is caught and handled gracefully —
never falls back to shell=True, never fails silently.
"""

import subprocess
import shlex
import shutil
import sys
import logging
import platform
from dataclasses import dataclass, field

logger = logging.getLogger("codesage.runner")

# ── Safe install prefixes (first token must be one of these) ──────────────────
SAFE_INSTALL_PREFIXES = {
    "apt", "apt-get", "brew", "pip", "pip3", "winget",
    "npm", "gem", "cargo", "go", "dnf", "yum",
    "pacman", "zypper", "snap", "flatpak",
    "ollama", "python", "python3",
}

# Sub-command allowlist for ambiguous tools
SAFE_SUBCOMMANDS = {
    "ollama":  {"pull", "list", "serve"},
    "pip":     {"install", "list", "show"},
    "pip3":    {"install", "list", "show"},
    "python":  {"-m"},
    "python3": {"-m"},
    "apt":     {"install", "update", "list"},
    "apt-get": {"install", "update"},
    "brew":    {"install", "update", "list"},
    "winget":  {"install", "search", "list"},
    "npm":     {"install", "list"},
}

# These tokens in the first position = pentest tool = never auto-run
PENTEST_TOOLS = {
    "nmap", "nikto", "sqlmap", "gobuster", "wfuzz", "hydra",
    "metasploit", "msfconsole", "msfvenom", "beef",
    "zap.sh", "zaproxy", "openvas", "nessus",
    "masscan", "rustscan", "dirb", "dirbuster",
    "ffuf", "feroxbuster", "hashcat", "john",
    "medusa", "patator", "aircrack", "reaver",
    "wifite", "nc", "netcat", "ncat",
    "curl", "wget", "ssh", "scp", "sftp",
    "tcpdump", "wireshark", "tshark", "openssl",
    "sslyze", "whatweb", "wapiti", "semgrep",
}

# Shell operators always block regardless of context
SHELL_OPERATORS = ("|", ">", ">>", "&&", "||", ";", "`", "$(", ")")

# Destructive tokens
DESTRUCTIVE = {"rm ", "rmdir", "dd ", "mkfs", "format", "shred"}

# Manual download links for Zero-Assumption fallback
MANUAL_TOOL_LINKS = {
    "nmap":     "https://nmap.org/download.html",
    "nikto":    "https://github.com/sullo/nikto",
    "sqlmap":   "https://sqlmap.org/",
    "gobuster": "https://github.com/OJ/gobuster",
    "ffuf":     "https://github.com/ffuf/ffuf",
    "curl":     "https://curl.se/download.html",
    "openssl":  "https://www.openssl.org/source/",
    "wfuzz":    "https://github.com/xmendez/wfuzz",
    "semgrep":  "https://semgrep.dev/docs/install/",
    "sslyze":   "https://github.com/nabla-c0d3/sslyze",
    "hydra":    "https://github.com/vanhauser-thc/thc-hydra",
    "wapiti":   "https://wapiti-scanner.github.io/",
}


@dataclass
class RunResult:
    command:   str
    allowed:   bool
    ran:       bool    = False
    success:   bool    = False
    stdout:    str     = ""
    stderr:    str     = ""
    error:     str     = ""
    reason:    str     = ""
    tokenized: list    = field(default_factory=list)


# ── Classifier ────────────────────────────────────────────────────────────────

def classify(command: str) -> tuple[bool, str]:
    """
    Returns (is_safe_to_auto_run, reason).
    Safe = install/setup only. Everything else = user must run manually.
    """
    cmd = command.strip()
    if not cmd:
        return False, "Empty command"

    # Shell operators — always block
    for op in SHELL_OPERATORS:
        if op in cmd:
            return False, f"Contains shell operator '{op}' — run manually"

    # Destructive patterns
    cmd_lower = cmd.lower()
    for d in DESTRUCTIVE:
        if d in cmd_lower:
            return False, f"Contains destructive token '{d.strip()}'"

    # Tokenize safely first
    ok, tokens, err = safe_tokenize(cmd)
    if not ok or not tokens:
        return False, f"Cannot parse command: {err}"

    first = tokens[0].lower().lstrip("./")

    # Pentest tools as first token = never auto-run
    if first in PENTEST_TOOLS:
        return False, f"'{first}' is a security testing tool — run manually"

    # Must be a known setup prefix
    if first not in SAFE_INSTALL_PREFIXES:
        # Check forbidden pentest tools anywhere in command
        for tool in PENTEST_TOOLS:
            if tool in cmd_lower:
                return False, f"Contains restricted tool: '{tool}'"
        return False, f"'{first}' is not a setup/install command — run manually"

    # Subcommand check
    if first in SAFE_SUBCOMMANDS and len(tokens) > 1:
        sub = tokens[1].lower()
        if sub not in SAFE_SUBCOMMANDS[first]:
            return False, f"'{first} {sub}' is not an allowed setup subcommand"

    return True, "Setup/install command — safe to run automatically"


def safe_tokenize(command: str) -> tuple[bool, list, str | None]:
    """
    Safely tokenize a command string using shlex.split().

    Returns (success, tokens, error_message).

    Decision log: shlex.split() can raise ValueError on:
      - Unclosed quotes: curl -H "Authorization: Bearer sk-..." (nested quotes)
      - Heredoc-style strings
      - Unicode quote characters that look like " but aren't

    We NEVER fall back to shell=True on failure.
    Instead we surface the error clearly so the user can fix it.
    """
    try:
        tokens = shlex.split(command)
        return True, tokens, None
    except ValueError as e:
        error_msg = str(e)
        logger.warning(f"shlex.split failed for command: {command!r} — {error_msg}")
        return False, [], f"Quoting error: {error_msg}. Check for unmatched quotes in the command."


def _get_installer_binary(command: str) -> str:
    """Extract core installer name from command, e.g. 'sudo apt-get' -> 'apt-get'."""
    tokens = command.strip().split()
    if not tokens:
        return ""
    if tokens[0] == "sudo" and len(tokens) > 1:
        return tokens[1]
    return tokens[0]


# ── Executor ──────────────────────────────────────────────────────────────────

def run_setup_command(command: str, show_output: bool = True) -> RunResult:
    """
    Run a setup/install command safely.
    Uses shlex.split() + shell=False always.
    Refuses and returns RunResult(allowed=False) if classify() blocks it.
    """
    from codesage.utils.display import c, GREEN, ORANGE, CYAN, GRAY, BOLD

    result = RunResult(command=command, allowed=False)

    # Safety check
    safe, reason = classify(command)
    if not safe:
        result.reason = reason
        logger.warning(f"Blocked: {command!r} — {reason}")
        return result

    # Tokenize
    ok, tokens, err = safe_tokenize(command)
    if not ok:
        result.reason = err or "Tokenization failed"
        result.error  = result.reason
        import builtins
        builtins.print(c(f"\n  ✗ Cannot run command — {result.reason}", ORANGE))
        builtins.print(c(f"  Raw command: {command}", GRAY))
        builtins.print(c("  Please check the quoting and try again manually.", GRAY))
        return result

    result.allowed   = True
    result.tokenized = tokens
    logger.info(f"Running setup: {tokens}")

    if show_output:
        import builtins
        builtins.print(c(f"\n  ⚙  Running: ", CYAN) + c(f"$ {command}", BOLD))
        builtins.print(c("  " + "─"*60, GRAY))

    try:
        proc = subprocess.Popen(
            tokens,
            shell=False,        # NEVER shell=True
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        output_lines: list[str] = []
        if show_output and proc.stdout:
            import builtins
            for line in proc.stdout:
                line = line.rstrip()
                output_lines.append(line)
                builtins.print(c("  │ ", GRAY) + line)
        elif proc.stdout:
            output_lines = [l.rstrip() for l in proc.stdout.readlines()]

        proc.wait()
        result.ran     = True
        result.stdout  = "\n".join(output_lines)
        result.success = (proc.returncode == 0)

        if show_output:
            import builtins
            if result.success:
                builtins.print(c(f"  ✓ Done (exit 0)", GREEN))
            else:
                builtins.print(c(f"  ✗ Failed (exit {proc.returncode})", ORANGE))
        import builtins
        builtins.print()

        logger.info(f"Exit={proc.returncode}: {command}")

    except FileNotFoundError:
        result.error = f"Command not found: {tokens[0]}"
        result.ran   = True
        import builtins
        builtins.print(c(f"  ✗ {result.error}", ORANGE))
    except Exception as e:
        result.error = str(e)
        result.ran   = True
        import builtins
        builtins.print(c(f"  ✗ Unexpected error: {e}", ORANGE))
        logger.exception(f"Error running: {command}")

    return result


# ── Risky command flow (user types manually) ──────────────────────────────────

def execute_risky_flow(suggested_command: str, explanation: str,
                       is_local_target: bool, chain_logger=None) -> RunResult:
    """
    For RISKY (pentest) commands:
    1. Show the AI's suggestion
    2. User types the command themselves
    3. Validate what they typed (no shell operators, no destructive)
    4. Re-auth required
    5. Run exactly what they typed — no modification

    Decision log: Command executed = exactly what user typed.
    AI never modifies commands before execution.
    """
    from codesage.utils.display import c, BOLD, CYAN, GREEN, ORANGE, RED, GRAY, YELLOW
    from codesage.utils.auth import require_reauth
    import builtins

    builtins.print()
    builtins.print(c("  ┌─ RISKY COMMAND — Manual execution required " + "─"*17, ORANGE))
    builtins.print(c("  │", ORANGE))
    builtins.print(c("  │  AI suggestion:", ORANGE))
    builtins.print(c("  │  $ ", ORANGE) + c(suggested_command, BOLD+GRAY))
    builtins.print(c("  │", ORANGE))
    if explanation:
        builtins.print(c("  │  " + explanation, GRAY))
        builtins.print(c("  │", ORANGE))

    if not is_local_target:
        builtins.print(c("  │  ⚠  EXTERNAL TARGET DETECTED", RED+BOLD))
        builtins.print(c("  │  Ensure you have written authorization before proceeding.", RED))
        builtins.print(c("  │", ORANGE))

    builtins.print(c("  └" + "─"*61, ORANGE))
    builtins.print()
    builtins.print(c("  Type the command you want to run (or leave blank to skip):", CYAN))
    builtins.print(c("  What you type is exactly what will run — no modifications.", GRAY))
    builtins.print()

    try:
        user_cmd = input(c("  ▶ $ ", BOLD+CYAN)).strip()
    except (EOFError, KeyboardInterrupt):
        user_cmd = ""

    if not user_cmd:
        builtins.print(c("  Skipped.", GRAY))
        return RunResult(command="", allowed=False, reason="User skipped")

    # Validate what the user typed
    ok, tokens, err = safe_tokenize(user_cmd)
    if not ok:
        builtins.print(c(f"\n  ✗ Command has a quoting issue: {err}", ORANGE))
        builtins.print(c("  Please fix the quotes and try again.", GRAY))
        result = RunResult(command=user_cmd, allowed=False, reason=err or "Tokenization failed")
        if chain_logger:
            chain_logger.log_command(user_cmd, "risky", False, ran=False)
        return result

    # Block shell operators even in manual commands
    for op in SHELL_OPERATORS:
        if op in user_cmd:
            builtins.print(c(f"  ✗ Cannot run: contains shell operator '{op}'", RED))
            builtins.print(c("  Shell chaining is not allowed for safety.", GRAY))
            result = RunResult(command=user_cmd, allowed=False,
                               reason=f"Shell operator '{op}' not allowed")
            if chain_logger:
                chain_logger.log_command(user_cmd, "risky", False, ran=False)
            return result

    # Re-authentication required for risky commands
    if not require_reauth(f"execute: {user_cmd[:60]}"):
        builtins.print(c("  Command cancelled — authentication failed.", RED))
        result = RunResult(command=user_cmd, allowed=False, reason="Auth failed")
        if chain_logger:
            chain_logger.log_command(user_cmd, "risky", False, ran=False)
        return result

    # Final confirmation
    builtins.print()
    builtins.print(c(f"  About to run exactly: ", BOLD) + c(f"$ {user_cmd}", BOLD+CYAN))
    try:
        confirm = input(c("  Proceed? [y/n] ", BOLD+ORANGE)).strip().lower()
    except (EOFError, KeyboardInterrupt):
        confirm = "n"

    if confirm not in ("y", "yes"):
        builtins.print(c("  Cancelled.", GRAY))
        result = RunResult(command=user_cmd, allowed=True, reason="User cancelled")
        if chain_logger:
            chain_logger.log_command(user_cmd, "risky", False, ran=False)
        return result

    # Execute — exactly what user typed
    result = RunResult(command=user_cmd, allowed=True)
    builtins.print()
    builtins.print(c("  Running:", CYAN) + c(f" $ {user_cmd}", BOLD))
    builtins.print(c("  " + "─"*60, GRAY))

    try:
        proc = subprocess.Popen(
            tokens,
            shell=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        output_lines: list[str] = []
        if proc.stdout:
            for line in proc.stdout:
                line = line.rstrip()
                output_lines.append(line)
                builtins.print(c("  │ ", GRAY) + line)

        proc.wait()
        result.ran     = True
        result.stdout  = "\n".join(output_lines)
        result.success = (proc.returncode == 0)

        if result.success:
            builtins.print(c(f"\n  ✓ Done (exit 0)", GREEN))
        else:
            builtins.print(c(f"\n  ✗ Exit code: {proc.returncode}", ORANGE))

    except FileNotFoundError:
        result.error   = f"Tool not found: {tokens[0]}"
        result.ran     = True
        builtins.print(c(f"  ✗ {result.error}", ORANGE))
        builtins.print(c(f"  Install it first: codesage packages install {tokens[0]}", GRAY))
    except Exception as e:
        result.error = str(e)
        result.ran   = True
        builtins.print(c(f"  ✗ Error: {e}", ORANGE))
        logger.exception(f"Error running risky command: {user_cmd}")

    builtins.print()

    if chain_logger:
        chain_logger.log_command(
            user_cmd, "risky",
            confirmed=True,
            ran=result.ran,
            success=result.success,
        )

    return result


# ── Tool availability ─────────────────────────────────────────────────────────

TOOL_INSTALL = {
    "nmap":     {"linux": "sudo apt-get install -y nmap",     "mac": "brew install nmap",    "win": "winget install nmap"},
    "nikto":    {"linux": "sudo apt-get install -y nikto",    "mac": "brew install nikto",   "win": "python -c \"print('Nikto has no native Windows installer. Use WSL or download manually.')\""},
    "sqlmap":   {"linux": "sudo apt-get install -y sqlmap",   "mac": "brew install sqlmap",  "win": "pip3 install sqlmap"},
    "gobuster": {"linux": "sudo apt-get install -y gobuster", "mac": "brew install gobuster","win": "go install github.com/OJ/gobuster/v3@latest"},
    "ffuf":     {"linux": "sudo apt-get install -y ffuf",     "mac": "brew install ffuf",    "win": "go install github.com/ffuf/ffuf@latest"},
    "curl":     {"linux": "sudo apt-get install -y curl",     "mac": "brew install curl",    "win": "winget install curl"},
    "openssl":  {"linux": "sudo apt-get install -y openssl",  "mac": "brew install openssl", "win": "winget install openssl"},
    "wfuzz":    {"linux": "pip3 install wfuzz",               "mac": "pip3 install wfuzz",   "win": "pip3 install wfuzz"},
    "semgrep":  {"linux": "pip3 install semgrep",             "mac": "pip3 install semgrep", "win": "pip3 install semgrep"},
    "sslyze":   {"linux": "pip3 install sslyze",              "mac": "pip3 install sslyze",  "win": "pip3 install sslyze"},
    "hydra":    {"linux": "sudo apt-get install -y hydra",    "mac": "brew install hydra",   "win": "python -c \"print('Hydra has no native Windows installer. Use WSL or download manually.')\""},
    "wapiti":   {"linux": "pip3 install wapiti3",             "mac": "pip3 install wapiti3", "win": "pip3 install wapiti3"},
}


def check_tools(names: list[str]) -> list[dict]:
    sys_name = platform.system()
    if sys_name == "Darwin":
        os_type = "mac"
    elif sys_name == "Windows":
        os_type = "win"
    else:
        os_type = "linux"
    results = []
    for name in names:
        info = TOOL_INSTALL.get(name, {})
        install_cmd = info.get(os_type, "")
        
        path = shutil.which(name) or ""
        
        # Check if the package manager itself exists
        mgr_bin = _get_installer_binary(install_cmd)
        mgr_present = bool(shutil.which(mgr_bin)) if mgr_bin else True
        if install_cmd.startswith("python"): mgr_present = True # always assume python can run python scripts
            
        results.append({
            "name":            name,
            "available":       bool(path),
            "path":            path,
            "install_cmd":     install_cmd or f"# No installer for {name}",
            "manager_binary":  mgr_bin,
            "manager_present": mgr_present,
            "manual_link":     MANUAL_TOOL_LINKS.get(name, "https://google.com/search?q="+name+"+security+tool"),
        })
    return results


def install_missing_tools(names: list[str], ask: bool = True) -> dict[str, bool]:
    from codesage.utils.display import c, GREEN, ORANGE, CYAN, GRAY, BOLD, YELLOW
    import builtins

    statuses  = check_tools(names)
    available = [s for s in statuses if s["available"]]
    missing   = [s for s in statuses if not s["available"]]

    if available:
        builtins.print(c("\n  Already installed:", BOLD))
        for s in available:
            builtins.print(c(f"  ✓ {s['name']}", GREEN) + c(f"  ({s['path']})", GRAY))

    results = {s["name"]: s["available"] for s in statuses}

    if not missing:
        return results

    builtins.print(c(f"\n  Missing ({len(missing)}):", BOLD))
    for s in missing:
        builtins.print(c(f"  ✗ {s['name']}", ORANGE) + c(f"  → {s['install_cmd']}", GRAY))

    if ask:
        builtins.print()
        try:
            ans = input(c("  Install missing tools now? [Y/n] ", BOLD+CYAN)).strip().lower()
        except (EOFError, KeyboardInterrupt):
            ans = "n"
        if ans not in ("", "y", "yes"):
            builtins.print(c("  Skipping. Some scan steps may not work.", YELLOW))
            return results

    builtins.print()
    for s in missing:
        builtins.print(c(f"\n  Checking requirements for {s['name']}...", CYAN))
        
        if s["manager_present"] and s["install_cmd"] and not s["install_cmd"].startswith("python"):
            result = run_setup_command(s["install_cmd"])
            results[s["name"]] = result.success
            if not result.success:
                builtins.print(c(f"  Automated install failed.", ORANGE))
                builtins.print(c(f"  Manual install required: {s['manual_link']}", GRAY))
        else:
            # Manager missing or tool has no installer (like nikto on win)
            reason = f"Package manager '{s['manager_binary']}' not found." if s["manager_binary"] else "No native installer available for this OS."
            builtins.print(c(f"  ✗ {reason}", ORANGE))
            builtins.print(c(f"  Download manually: ", BOLD) + c(s['manual_link'], GREEN))
            results[s['name']] = False

    return results
