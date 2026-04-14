"""
cli.py — CSage command-line interface.

Entry point: csage (defined in pyproject.toml)

Subcommands:
  csage              → scan (default)
  csage scan         → start scan session
  csage config       → manage settings
  csage model        → manage AI model
  csage logs         → view and verify logs
  csage packages     → manage security tools
  csage cleanup      → clean temp/session data
  csage ai-test      → test AI endpoints
  csage version      → show version
  csage reset        → wipe all config
  csage terms        → view terms of use
"""

import os
import sys
import json
import time
import random
import logging
import urllib.request
import urllib.error
import subprocess
import shutil
import os
import getpass
import argparse
import logging
import builtins as _b
from pathlib import Path


CONFIG_DIR = Path.home() / ".csage"
LOG_FILE   = CONFIG_DIR / "csage.log"


def setup_logging(verbose: bool, debug: bool):
    from csage.utils.migration import migrate_if_needed
    migrate_if_needed()
    
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    level = logging.DEBUG if debug else (logging.INFO if verbose else logging.WARNING)
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        handlers=[
            logging.FileHandler(LOG_FILE),
            *([] if not debug else [logging.StreamHandler(sys.stderr)]),
        ],
    )


# ── First run gate ────────────────────────────────────────────────────────────

def first_run_gate(is_explicit_setup: bool = False):
    """
    On first run: show terms → require acceptance → create account.
    Model setup is handled separately unless is_explicit_setup is True.
    """
    from csage.utils.display import c, CYAN, GREEN, ORANGE, BOLD, GRAY, print_error
    from csage.utils.auth import (
        is_first_run, setup_account, terms_accepted, record_terms_acceptance,
        _load_auth,
    )
    from csage.utils.input_handler import show_terms_with_gate
    from csage.core.model_picker import run_picker, load_config
    from csage import CURRENT_TERMS_VERSION

    # 1. Terms acceptance (Always required before any action)
    if not terms_accepted():
        _b.print(c("\n  Before using CSage, you must review and accept the Terms of Use.", ORANGE))

        license_path = Path(__file__).parent.parent / "LICENSE.md"
        if not license_path.exists():
            license_path = Path(__file__).parent.parent.parent / "LICENSE.md"

        terms_text = license_path.read_text() if license_path.exists() else (
            "Terms of Use — see LICENSE.md in the CSage repository."
        )

        accepted, time_on_screen = show_terms_with_gate(terms_text)
        if not accepted:
            _b.print(c("  Terms not accepted. Exiting.", ORANGE))
            sys.exit(0)

        record_terms_acceptance(time_on_screen)
        _b.print()

    # 2. Account creation (Always required)
    if is_first_run():
        if not setup_account():
            _b.print(c("  Account setup failed. Exiting.", ORANGE))
            sys.exit(1)
        _b.print()

    # 3. Model config
    # If explicit 'model' cmd, we skip the immediate check here because 
    # cmd_model will trigger the picker itself.
    if is_explicit_setup:
        run_picker(force=True)
    elif not load_config():
        # Only exit if we are NOT running the model setup command already
        import argparse
        # We need to peek at the sys.argv since args isn't available in main's global scope yet
        is_model_cmd = "model" in sys.argv
        if not is_model_cmd:
            _b.print(c("\n  ⚠ AI Model not configured.", ORANGE))
            _b.print(c("  Run 'csage model' to set up your API keys.", GRAY))
            sys.exit(1)

    # 4. Tool installation (Informational)
    auth = _load_auth()
    if is_explicit_setup and auth and not auth.get("tools_setup_done"):
        from csage.core.tool_runner import install_missing_tools, TOOL_INSTALL
        from csage.utils.auth import mark_tools_setup_done
        
        _b.print(c("\n  Final Step: Checking required security tools...", CYAN))
        install_missing_tools(list(TOOL_INSTALL.keys()), ask=True)
        mark_tools_setup_done()


# ── Login gate ────────────────────────────────────────────────────────────────

def login_gate() -> bool:
    from csage.utils.auth import login, is_authenticated
    if is_authenticated():
        return True
    return login()


# ── Subcommand handlers ───────────────────────────────────────────────────────

def cmd_scan(args):
    from csage.utils.display import banner, print_error, c, GRAY, ORANGE
    from csage.core.agent import Agent

    banner()

    if not login_gate():
        sys.exit(1)

    if args.target and not Path(args.target).exists():
        print_error(f"Path '{args.target}' does not exist.")
        sys.exit(1)

    # In scan mode, we expect model to already be configured.
    from csage.core.model_picker import load_config
    from csage.core.llm import LLMClient
    
    config = load_config()
    if not config:
        _b.print(c("\n  ⚠ CSage is not configured.", ORANGE))
        _b.print(c("  Please run 'csage model' first.", GRAY))
        sys.exit(1)

    llm = LLMClient(config)
    agent = Agent(
        llm=llm,
        target_path=args.target,
        target_url=args.url,
        scope=getattr(args, "scope", "all"),
        output_file=getattr(args, "output", None),
    )
    try:
        agent.run()
    except KeyboardInterrupt:
        _b.print(c("\n\n  Session interrupted.", ""))
        if getattr(args, "output", None) and agent.findings:
            agent._generate_report()
        sys.exit(0)
    except Exception as e:
        from csage.utils.display import print_error
        print_error(f"Fatal: {e}")
        logging.exception("Fatal crash")
        _b.print(c(f"\n  Full log: {LOG_FILE}", GRAY))
        sys.exit(1)


def cmd_config(args):
    from csage.utils.display import print_section, print_info, c, BOLD, GREEN, GRAY
    from csage.utils.auth import login, require_reauth, change_password, get_username
    import json

    if not login_gate():
        sys.exit(1)

    sub = getattr(args, "config_cmd", "show")

    if sub == "show":
        print_section("Config")
        cfg_file = CONFIG_DIR / "config.json"
        env_file = CONFIG_DIR / ".env"
        if cfg_file.exists():
            cfg = json.loads(cfg_file.read_text())
            print_info(f"Provider : {cfg.get('provider','?')}")
            print_info(f"Model    : {cfg.get('model','?')}")
            print_info(f"Type     : {cfg.get('type','?')}")
        else:
            print_info("No model configured. Run: csage model")
        print_info(f"Config dir: {CONFIG_DIR}")

    elif sub == "keys":
        print_section("Stored API Keys")
        env_file = CONFIG_DIR / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if "=" in line and not line.startswith("#"):
                    key_name, _, val = line.partition("=")
                    masked = val[:4] + "..." + val[-4:] if len(val) > 8 else "****"
                    print_info(f"{key_name} = {masked}")
        else:
            print_info("No API keys stored.")

    elif sub == "keys-set":
        provider = getattr(args, "provider", "")
        if not provider:
            print_info("Usage: csage config keys-set <provider>")
            return
        from csage.utils.display import c, BOLD, CYAN, print_ok
        key = getpass(c(f"  ▶ New API key for {provider}: ", BOLD+CYAN))
        if key.strip():
            from csage.core.model_picker import _save_api_key
            _save_api_key(provider, key.strip())
            print_ok(f"Key updated for: {provider}")

    elif sub == "keys-remove":
        provider = getattr(args, "provider", "")
        if not provider:
            print_info("Usage: csage config keys-remove <provider>")
            return
        if not require_reauth(f"remove API key for {provider}"):
            return
        env_file = CONFIG_DIR / ".env"
        if env_file.exists():
            lines = [l for l in env_file.read_text().splitlines()
                     if not l.upper().startswith(provider.upper()+"_API_KEY")]
            env_file.write_text("\n".join(lines) + "\n")
            print_info(f"Key removed for: {provider}")

    elif sub == "password":
        change_password()


def cmd_model(args):
    from csage.core.model_picker import run_picker, load_config, reset_config
    from csage.utils.display import print_section, print_info

    if not login_gate():
        sys.exit(1)

    sub = getattr(args, "model_cmd", "show")

    if sub in ("", "show", "set"):
        first_run_gate(is_explicit_setup=True)
    elif sub == "reset":
        reset_config()
        print_info("Model config cleared.")
        first_run_gate(is_explicit_setup=True)
    elif sub == "list":
        cfg = load_config()
        if cfg:
            print_section("Current Model")
            print_info(f"Provider : {cfg.get('provider')}")
            print_info(f"Model    : {cfg.get('model')}")
            print_info(f"Type     : {cfg.get('type')}")
        else:
            print_info("No model configured.")
    elif sub == "stop":
        cfg = load_config()
        if not cfg or cfg.get("type") != "local":
            print_info("No local model currently configured.")
            return
        from csage.core.llm import stop_local_server
        print_info(f"Attempting to stop {cfg.get('provider')} server...")
        ok, msg = stop_local_server(cfg.get("provider"), cfg.get("base_url", ""))
        if ok:
            from csage.utils.display import print_ok
            print_ok(msg)
        else:
            from csage.utils.display import print_error
            print_error(msg)
    elif sub == "test":
        cfg = load_config()
        if not cfg:
            print_info("No model configured.")
            return
        from csage.core.llm import LLMClient
        client = LLMClient(cfg)
        ok, msg = client.ping()
        from csage.utils.display import print_ok, print_error
        if ok:
            print_ok(msg)
        else:
            print_error(msg)


def cmd_logs(args):
    from csage.utils.logger import verify_log, list_sessions
    from csage.utils.display import print_section, print_info, print_ok, print_error, c, GREEN, RED

    if not login_gate():
        sys.exit(1)

    sub = getattr(args, "log_cmd", "list")
    if sub == "show" or (args.command == "logs" and getattr(args, "session", None) and not getattr(args, "verify", False)):
        session_id = getattr(args, "session", None)
        if not session_id:
            print_info("Usage: csage logs show <session_id>")
            return
        
        from csage.utils.display import c, GREEN, CYAN, RED, YELLOW, print_section, print_info, print_error
        from csage.utils.logger import LOG_DIR
        log_file = LOG_DIR / f"{session_id}.jsonl"
        if not log_file.exists():
            print_error(f"Log not found: {session_id}")
            return
        
        print_section(f"Session Log: {session_id}")
        for line in log_file.read_text().splitlines():
            if not line.strip(): continue
            entry = json.loads(line)
            ts    = entry.get("timestamp", "?")[11:19]
            etype = entry.get("type", "info").upper()
            
            if etype == "SESSION_START":
                print_info(f"[{ts}] {c('STARTED', GREEN)} target={entry.get('target_url') or entry.get('target_path')}")
            elif etype == "COMMAND":
                mark = c("✓", GREEN) if entry.get("ran") else c("!", YELLOW)
                print_info(f"[{ts}] {mark} {c('CMD', CYAN)} {entry.get('command')}")
            elif etype == "FINDING":
                print_info(f"[{ts}] {c('FINDING', RED)} {entry.get('name')} ({entry.get('severity')})")
            elif etype == "SESSION_END":
                print_info(f"[{ts}] {c('ENDED', GREEN)} findings={entry.get('findings_count')} duration={entry.get('duration_seconds')}s")
            else:
                print_info(f"[{ts}] {etype} {str(entry)}")

    elif getattr(args, "verify", False):
        session_id = getattr(args, "session", None)
        if not session_id:
            # Verify all sessions
            sessions = list_sessions()
            if not sessions:
                print_info("No logs found.")
                return
            print_section("Verifying All Logs")
            all_ok = True
            for s in sessions:
                ok, msg = verify_log(s["session_id"])
                if ok:
                    print_ok(f"{s['session_id']}: {msg}")
                else:
                    print_error(f"{s['session_id']}: {msg}")
                    all_ok = False
            _b.print()
            if all_ok:
                print_ok("All logs verified — integrity intact.")
            else:
                print_error("Some logs failed verification — possible tampering.")
        else:
            ok, msg = verify_log(session_id)
            if ok:
                print_ok(msg)
            else:
                print_error(msg)
    else:
        sessions = list_sessions()
        if not sessions:
            print_info("No sessions logged yet.")
            return
        print_section("Recent Sessions")
        for s in sessions[:10]:
            print_info(f"{s['session_id']}  {s['started'][:16]}  {s['entries']} entries")


def cmd_packages(args):
    from csage.core.tool_runner import check_tools, install_missing_tools, TOOL_INSTALL
    from csage.utils.display import print_section, print_info, c, GREEN, ORANGE

    if not login_gate():
        sys.exit(1)

    sub  = getattr(args, "pkg_cmd", "list")
    pkgs = getattr(args, "packages", [])

    if sub == "list":
        print_section("Security Tools")
        statuses = check_tools(list(TOOL_INSTALL.keys()))
        for s in statuses:
            mark = c("✓", GREEN) if s["available"] else c("✗", ORANGE)
            path = c(f"  ({s['path']})", "\033[90m") if s["available"] else ""
            print_info(f"{mark}  {s['name']}{path}")

    elif sub == "install":
        if not pkgs:
            print_info("Usage: csage tools install <tool> [tool2 ...]")
            return
        install_missing_tools(pkgs, ask=False)

    elif sub == "add":
        if not pkgs:
            print_info("Usage: csage tools add <tool> [install_command]")
            return
        tool_name = pkgs[0]
        install_cmd = " ".join(pkgs[1:])
        
        from csage.core.tool_registry import registry
        from csage.utils.shell import get_shell_info
        shell = get_shell_info()
        os_key = 'win' if shell['os'] == 'windows' else ('mac' if shell['os'] == 'mac' else 'linux')
        if shell['is_wsl']: os_key = 'linux'

        if not install_cmd:
            from csage.core.model_picker import load_config
            from csage.core.llm import LLMClient
            cfg = load_config()
            if cfg:
                from csage.utils.display import thinking
                from csage.core.tool_runner import get_ai_install_command
                with thinking(f"AI is generating an install command for {tool_name}"):
                    ai_cmd = get_ai_install_command(tool_name, LLMClient(cfg))
                
                if ai_cmd:
                    from csage.utils.display import CYAN
                    print_info(f"AI suggested: {c(ai_cmd, CYAN)}")
                    install_cmd = ai_cmd
                else:
                    from csage.utils.display import print_error
                    print_error("AI could not generate a command. Please provide one manually.")
                    return
            else:
                from csage.utils.display import print_error
                print_error("No install command provided and AI not configured.")
                return
        
        registry.add_tool(tool_name, {os_key: install_cmd})
        from csage.utils.display import print_ok
        print_ok(f"Added tool: {tool_name} (Command: {install_cmd})")

    elif sub == "remove":
        if not pkgs:
            print_info("Usage: csage tools remove <tool>")
            return
        tool_name = pkgs[0]
        from csage.core.tool_registry import registry
        registry.remove_tool(tool_name)
        from csage.utils.display import print_ok
        print_ok(f"Removed tool {tool_name} from registry.")


def cmd_cleanup(args):
    from csage.utils.auth import require_reauth
    from csage.utils.display import print_ok, print_info

    if not login_gate():
        sys.exit(1)

    all_flag = getattr(args, "all", False)

    if all_flag:
        if not require_reauth("cleanup --all (deletes logs)"):
            return

    import shutil, glob
    # Temp files
    for pattern in ["*.tmp", "*.temp"]:
        for f in (CONFIG_DIR).glob(pattern):
            f.unlink()

    if all_flag:
        log_dir = CONFIG_DIR / "logs"
        if log_dir.exists():
            shutil.rmtree(log_dir)
            log_dir.mkdir()
            print_ok("Logs cleared.")

    print_ok("Cleanup complete. Packages were NOT removed.")


def cmd_version(args):
    from csage import __version__, CURRENT_TERMS_VERSION
    from csage.utils.auth import terms_accepted
    _b.print(f"\n  CSage v{__version__}")
    _b.print(f"  Terms version: {CURRENT_TERMS_VERSION}")
    accepted = terms_accepted()
    _b.print(f"  Terms accepted: {'yes' if accepted else 'no'}")
    _b.print(f"  Config dir: {CONFIG_DIR}")
    _b.print()


def cmd_factory_reset(args):
    from csage.utils.auth import require_reauth
    from csage.utils.display import c, RED, ORANGE, GREEN

    if not login_gate():
        sys.exit(1)

    _b.print(c("\n  ⚠  RESET — This will wipe all CSage configuration.", RED+"\033[1m"))
    _b.print(c("  This includes: model config, API keys, user account, logs.", ORANGE))
    _b.print(c("  This cannot be undone.", RED))
    _b.print()

    if not require_reauth("full reset — wipe all config"):
        return

    try:
        confirm = input(c("  Type RESET to confirm: ", "\033[1m"+ORANGE)).strip()
    except (EOFError, KeyboardInterrupt):
        confirm = ""

    if confirm != "RESET":
        _b.print(c("  Cancelled.", "\033[90m"))
        return

    import shutil
    if CONFIG_DIR.exists():
        shutil.rmtree(CONFIG_DIR)
    _b.print(c("  ✓ All config wiped. Run 'csage' to start fresh.", GREEN))


def cmd_terms(args):
    from csage.utils.display import c, CYAN
    license_path = Path(__file__).parent.parent / "LICENSE.md"
    if not license_path.exists():
        license_path = Path(__file__).parent.parent.parent / "LICENSE.md"

    if license_path.exists():
        _b.print()
        for line in license_path.read_text().split("\n"):
            _b.print("  " + line)
    else:
        _b.print(c("\n  LICENSE.md not found. See the CSage GitHub repository.", CYAN))

    version_flag = getattr(args, "version", False)
    if version_flag:
        from csage.utils.auth import _load_auth
        auth = _load_auth()
        if auth and auth.get("terms_accepted"):
            _b.print(f"\n  Accepted version : {auth.get('terms_version')}")
            _b.print(f"  Accepted at      : {auth.get('terms_accepted_at')}")
            _b.print(f"  Time on screen   : {auth.get('time_on_screen_s')}s")
            _b.print(f"  Machine hash     : {auth.get('machine_id_hash')}")
        else:
            _b.print("\n  Terms not yet accepted.")


def cmd_aitest(args):
    from csage.utils.display import print_section, print_info, c, CYAN, YELLOW

    if not login_gate():
        sys.exit(1)

    print_section("AI Security Test")
    print_info("Testing AI endpoints for prompt injection and leakage.")
    print_info(c("  (Full ai-test module — coming in next release)", YELLOW))
    # Placeholder — full module in next build
    _b.print()


# ── Main entry point ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="csage",
        description="CSage — AI-assisted security testing",
        usage="csage [-h] [-t TARGET] [-u URL] [options] [subcommand] ...",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Usage Examples:
  Direct Scan (URL):    csage --url http://127.0.0.1:8080
  Direct Scan (Path):   csage --target ./vulnerable-app
  Guided Scan:          csage scan --url http://127.0.0.1:8080
  
  Setup AI Model:       csage model
  Manage Tools:         csage tools
  View Sessions:        csage logs
  
For detailed help on a subcommand: csage <subcommand> --help
""",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Show verbose output")
    parser.add_argument("--debug",         action="store_true", help="Show debug level logs (v. detailed)")

    sub = parser.add_subparsers(dest="command", metavar="subcommand")

    # scan
    scan_p = sub.add_parser("scan", help="Start a guided scan session")
    scan_p.add_argument("--target", "-t", help="Local project path")
    scan_p.add_argument("--url",    "-u", help="Target URL")
    scan_p.add_argument("--scope",  "-s", default="all")
    scan_p.add_argument("--output", "-o", help="Report output file")
    scan_p.add_argument("--reset-model", action="store_true")

    # config
    cfg_p = sub.add_parser("config", help="Manage account and settings")
    cfg_p.add_argument("config_cmd", nargs="?", default="show",
                       choices=["show","keys","keys-set","keys-remove","password","set"])
    cfg_p.add_argument("provider", nargs="?")

    # model
    mdl_p = sub.add_parser("model", help="Configure AI providers and keys")
    mdl_p.add_argument("model_cmd", nargs="?", default="show",
                       choices=["show","set","reset","list","test","stop"])

    # logs
    log_p = sub.add_parser("logs", help="View and integrity-check session logs")
    log_p.add_argument("log_cmd", nargs="?", default="list", choices=["list", "show", "verify"])
    log_p.add_argument("session", nargs="?")
    log_p.add_argument("--verify", action="store_true")

    # packages
    pkg_p = sub.add_parser("packages", aliases=["tools"], help="Check/Install security tool binaries")
    pkg_p.add_argument("pkg_cmd", nargs="?", default="list", 
                       choices=["list", "install", "add", "remove"])
    pkg_p.add_argument("packages", nargs="*")

    # cleanup
    cln_p = sub.add_parser("cleanup", help="Remove temporary and session files")
    cln_p.add_argument("--all", action="store_true")

    # version
    sub.add_parser("version", help="Show version and terms info")

    # factory-reset
    sub.add_parser("factory-reset", aliases=["reset"], help="Wipe ALL configuration (Danger Zone)")

    # terms
    trm_p = sub.add_parser("terms", help="View terms of use")
    trm_p.add_argument("--version", action="store_true")

    # ai-test
    ait_p = sub.add_parser("ai-test", help="Test AI endpoints")
    ait_p.add_argument("--url",    "-u")
    ait_p.add_argument("--target", "-t")

    # Default: if no subcommand, run scan with --target/--url flags
    parser.add_argument("--target", "-t", help=argparse.SUPPRESS)
    parser.add_argument("--url",    "-u", help=argparse.SUPPRESS)
    parser.add_argument("--scope",  "-s", default="all", help=argparse.SUPPRESS)
    parser.add_argument("--output", "-o", help=argparse.SUPPRESS)
    parser.add_argument("--reset-model", action="store_true", help=argparse.SUPPRESS)

    args = parser.parse_args()
    setup_logging(args.verbose, args.debug)

    # First-run gate (terms + account + model)
    if args.command not in ("terms", "version"):
        try:
            first_run_gate()
        except KeyboardInterrupt:
            _b.print("\n  Cancelled.")
            sys.exit(0)

    # Route to subcommand
    cmd = args.command

    if cmd == "scan":
        cmd_scan(args)
    elif cmd == "config":
        cmd_config(args)
    elif cmd == "model":
        cmd_model(args)
    elif cmd == "logs":
        cmd_logs(args)
    elif cmd in ("packages", "tools"):
        cmd_packages(args)
    elif cmd == "cleanup":
        cmd_cleanup(args)
    elif cmd == "version":
        cmd_version(args)
    elif cmd == "factory-reset" or cmd == "reset":
        cmd_factory_reset(args)
    elif cmd == "terms":
        cmd_terms(args)
    elif cmd == "ai-test":
        cmd_aitest(args)
    else:
        # No subcommand — treat as scan if targets given, else show help
        if getattr(args, "target", None) or getattr(args, "url", None):
            from csage.utils.display import banner, c, ORANGE, GRAY
            banner()
            if not login_gate():
                sys.exit(1)
            
            from csage.core.model_picker import load_config
            from csage.core.llm import LLMClient
            from csage.core.agent import Agent
            
            config = load_config()
            if not config:
                _b.print(c("\n  ⚠ AI Model not configured.", ORANGE))
                _b.print(c("  Run 'csage model' to set up your API keys.", GRAY))
                sys.exit(1)
                
            llm = LLMClient(config)
            agent = Agent(
                llm=llm,
                target_path=getattr(args,"target",None),
                target_url=getattr(args,"url",None),
                scope=getattr(args,"scope","all"),
                output_file=getattr(args,"output",None),
            )
            try:
                agent.run()
            except KeyboardInterrupt:
                sys.exit(0)
        else:
            parser.print_help()
