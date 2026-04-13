"""
cli.py — CodeSage command-line interface.

Entry point: codesage (defined in pyproject.toml)

Subcommands:
  codesage              → scan (default)
  codesage scan         → start scan session
  codesage config       → manage settings
  codesage model        → manage AI model
  codesage logs         → view and verify logs
  codesage packages     → manage security tools
  codesage cleanup      → clean temp/session data
  codesage ai-test      → test AI endpoints
  codesage version      → show version
  codesage reset        → wipe all config
  codesage terms        → view terms of use
"""

import sys
import argparse
import logging
import builtins as _b
from pathlib import Path


CONFIG_DIR = Path.home() / ".codesage"
LOG_FILE   = CONFIG_DIR / "codesage.log"


def setup_logging(verbose: bool, debug: bool):
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

def first_run_gate():
    """
    On first run: show terms → require acceptance → create account → pick model.
    All three gates must pass. No shortcuts.
    """
    from codesage.utils.display import c, CYAN, GREEN, ORANGE, BOLD, GRAY
    from codesage.utils.auth import (
        is_first_run, setup_account, terms_accepted, record_terms_acceptance,
        _load_auth,
    )
    from codesage.utils.input_handler import show_terms_with_gate
    from codesage.core.model_picker import run_picker, load_config
    from codesage import CURRENT_TERMS_VERSION

    license_path = Path(__file__).parent.parent / "LICENSE.md"
    if not license_path.exists():
        license_path = Path(__file__).parent.parent.parent / "LICENSE.md"

    # Terms acceptance
    if not terms_accepted():
        _b.print(c("\n  Before using CodeSage, you must review and accept the Terms of Use.", ORANGE))

        terms_text = license_path.read_text() if license_path.exists() else (
            "Terms of Use — see LICENSE.md in the CodeSage repository."
        )

        accepted, time_on_screen = show_terms_with_gate(terms_text)
        if not accepted:
            _b.print(c("  Terms not accepted. Exiting.", ORANGE))
            sys.exit(0)

        record_terms_acceptance(time_on_screen)
        _b.print()

    # Account creation (first run only)
    if is_first_run():
        if not setup_account():
            _b.print(c("  Account setup failed. Exiting.", ORANGE))
            sys.exit(1)
        _b.print()

    # Model config
    if not load_config():
        _b.print(c("  Let's set up your AI model.", CYAN))
        run_picker()

    # Tool installation gate (defaultly installed intent)
    auth = _load_auth()
    if auth and not auth.get("tools_setup_done"):
        from codesage.core.tool_runner import install_missing_tools, TOOL_INSTALL
        from codesage.utils.auth import mark_tools_setup_done
        
        _b.print(c("\n  Final Step: Checking required security tools...", CYAN))
        _b.print(c("  CodeSage works best when nmap, sqlmap, etc. are installed.", GRAY))
        
        install_missing_tools(list(TOOL_INSTALL.keys()), ask=True)
        mark_tools_setup_done()


# ── Login gate ────────────────────────────────────────────────────────────────

def login_gate() -> bool:
    from codesage.utils.auth import login, is_authenticated
    if is_authenticated():
        return True
    return login()


# ── Subcommand handlers ───────────────────────────────────────────────────────

def cmd_scan(args):
    from codesage.utils.display import banner, print_error, c, GRAY
    from codesage.core.model_picker import run_picker
    from codesage.core.agent import Agent

    banner()

    if not login_gate():
        sys.exit(1)

    if args.target and not Path(args.target).exists():
        print_error(f"Path '{args.target}' does not exist.")
        sys.exit(1)

    if not args.target and not args.url:
        print_error("Provide --target and/or --url.")
        sys.exit(1)

    llm = run_picker(force=getattr(args, "reset_model", False))
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
        from codesage.utils.display import print_error
        print_error(f"Fatal: {e}")
        logging.exception("Fatal crash")
        _b.print(c(f"\n  Full log: {LOG_FILE}", GRAY))
        sys.exit(1)


def cmd_config(args):
    from codesage.utils.display import print_section, print_info, c, BOLD, GREEN, GRAY
    from codesage.utils.auth import login, require_reauth, change_password, get_username
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
            print_info("No model configured. Run: codesage model")
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

    elif sub == "keys-remove":
        provider = getattr(args, "provider", "")
        if not provider:
            print_info("Usage: codesage config keys-remove <provider>")
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
    from codesage.core.model_picker import run_picker, load_config, reset_config
    from codesage.utils.display import print_section, print_info

    if not login_gate():
        sys.exit(1)

    sub = getattr(args, "model_cmd", "show")

    if sub in ("", "show", "set"):
        run_picker(force=True)
    elif sub == "reset":
        reset_config()
        print_info("Model config cleared.")
        run_picker(force=True)
    elif sub == "list":
        cfg = load_config()
        if cfg:
            print_section("Current Model")
            print_info(f"Provider : {cfg.get('provider')}")
            print_info(f"Model    : {cfg.get('model')}")
            print_info(f"Type     : {cfg.get('type')}")
        else:
            print_info("No model configured.")
    elif sub == "test":
        cfg = load_config()
        if not cfg:
            print_info("No model configured.")
            return
        from codesage.core.llm import LLMClient
        client = LLMClient(cfg)
        ok, msg = client.ping()
        from codesage.utils.display import print_ok, print_error
        if ok:
            print_ok(msg)
        else:
            print_error(msg)


def cmd_logs(args):
    from codesage.utils.logger import verify_log, list_sessions
    from codesage.utils.display import print_section, print_info, print_ok, print_error, c, GREEN, RED

    if not login_gate():
        sys.exit(1)

    if getattr(args, "verify", False):
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
    from codesage.core.tool_runner import check_tools, install_missing_tools, TOOL_INSTALL
    from codesage.utils.display import print_section, print_info, c, GREEN, ORANGE

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
            print_info("Usage: codesage packages install <tool> [tool2 ...]")
            return
        install_missing_tools(pkgs, ask=False)

    elif sub == "remove":
        from codesage.utils.auth import require_reauth
        if not pkgs:
            print_info("Usage: codesage packages remove <tool>")
            return
        if not require_reauth(f"remove packages: {', '.join(pkgs)}"):
            return
        print_info("Package removal must be done manually via your system package manager.")
        print_info("This prevents accidental tool deletion.")


def cmd_cleanup(args):
    from codesage.utils.auth import require_reauth
    from codesage.utils.display import print_ok, print_info

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
    from codesage import __version__, CURRENT_TERMS_VERSION
    from codesage.utils.auth import terms_accepted
    _b.print(f"\n  CodeSage v{__version__}")
    _b.print(f"  Terms version: {CURRENT_TERMS_VERSION}")
    accepted = terms_accepted()
    _b.print(f"  Terms accepted: {'yes' if accepted else 'no'}")
    _b.print(f"  Config dir: {CONFIG_DIR}")
    _b.print()


def cmd_reset(args):
    from codesage.utils.auth import require_reauth
    from codesage.utils.display import c, RED, ORANGE, GREEN

    if not login_gate():
        sys.exit(1)

    _b.print(c("\n  ⚠  RESET — This will wipe all CodeSage configuration.", RED+"\033[1m"))
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
    _b.print(c("  ✓ All config wiped. Run 'codesage' to start fresh.", GREEN))


def cmd_terms(args):
    from codesage.utils.display import c, CYAN
    license_path = Path(__file__).parent.parent / "LICENSE.md"
    if not license_path.exists():
        license_path = Path(__file__).parent.parent.parent / "LICENSE.md"

    if license_path.exists():
        _b.print()
        for line in license_path.read_text().split("\n"):
            _b.print("  " + line)
    else:
        _b.print(c("\n  LICENSE.md not found. See the CodeSage GitHub repository.", CYAN))

    version_flag = getattr(args, "version", False)
    if version_flag:
        from codesage.utils.auth import _load_auth
        auth = _load_auth()
        if auth and auth.get("terms_accepted"):
            _b.print(f"\n  Accepted version : {auth.get('terms_version')}")
            _b.print(f"  Accepted at      : {auth.get('terms_accepted_at')}")
            _b.print(f"  Time on screen   : {auth.get('time_on_screen_s')}s")
            _b.print(f"  Machine hash     : {auth.get('machine_id_hash')}")
        else:
            _b.print("\n  Terms not yet accepted.")


def cmd_aitest(args):
    from codesage.utils.display import print_section, print_info, c, CYAN, YELLOW

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
        prog="codesage",
        description="CodeSage — AI-assisted security testing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--debug",         action="store_true")

    sub = parser.add_subparsers(dest="command")

    # scan
    scan_p = sub.add_parser("scan", help="Start a scan session")
    scan_p.add_argument("--target", "-t", help="Local project path")
    scan_p.add_argument("--url",    "-u", help="Target URL")
    scan_p.add_argument("--scope",  "-s", default="all")
    scan_p.add_argument("--output", "-o", help="Report output file")
    scan_p.add_argument("--reset-model", action="store_true")

    # config
    cfg_p = sub.add_parser("config", help="Manage settings")
    cfg_p.add_argument("config_cmd", nargs="?", default="show",
                       choices=["show","keys","keys-remove","password","set"])
    cfg_p.add_argument("provider", nargs="?")

    # model
    mdl_p = sub.add_parser("model", help="Manage AI model")
    mdl_p.add_argument("model_cmd", nargs="?", default="show",
                       choices=["show","set","reset","list","test"])

    # logs
    log_p = sub.add_parser("logs", help="View and verify logs")
    log_p.add_argument("--verify", action="store_true")
    log_p.add_argument("--session")

    # packages
    pkg_p = sub.add_parser("packages", aliases=["tools"], help="Manage security tools")
    pkg_p.add_argument("pkg_cmd", nargs="?", default="list",
                       choices=["list","install","remove"])
    pkg_p.add_argument("packages", nargs="*")

    # cleanup
    cln_p = sub.add_parser("cleanup", help="Clean temp/session data")
    cln_p.add_argument("--all", action="store_true")

    # version
    sub.add_parser("version", help="Show version info")

    # reset
    sub.add_parser("reset", help="Wipe all configuration")

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
    elif cmd == "reset":
        cmd_reset(args)
    elif cmd == "terms":
        cmd_terms(args)
    elif cmd == "ai-test":
        cmd_aitest(args)
    else:
        # No subcommand — treat as scan if targets given, else show help
        if getattr(args, "target", None) or getattr(args, "url", None):
            from codesage.utils.display import banner
            banner()
            if not login_gate():
                sys.exit(1)
            from codesage.core.model_picker import run_picker
            from codesage.core.agent import Agent
            llm = run_picker(force=getattr(args, "reset_model", False))
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
