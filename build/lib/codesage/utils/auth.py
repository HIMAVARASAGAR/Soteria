"""
auth.py — User authentication and command authorization.

- bcrypt password hashing (never plaintext)
- In-memory session tokens (never written to disk)
- Three-tier command authorization (low / medium / high)
- Failed attempt tracking with lockout
- Terms acceptance recording
"""

import json
import secrets
import hashlib
import logging
import getpass
import uuid
from datetime import datetime
from pathlib import Path

import bcrypt

from codesage import CURRENT_TERMS_VERSION

logger = logging.getLogger("codesage.auth")

CONFIG_DIR = Path.home() / ".codesage"
AUTH_FILE  = CONFIG_DIR / "auth.json"

MAX_ATTEMPTS  = 3
SESSION_TOKEN: str | None = None  # in-memory only, never written


# ── Authorization levels ──────────────────────────────────────────────────────

LOW_COMMANDS = {
    "version", "terms", "logs", "model list", "config show",
    "packages list", "help",
}

MEDIUM_COMMANDS = {
    "scan", "config", "model", "ai-test",
}

HIGH_COMMANDS = {
    "reset", "config keys remove", "packages remove",
    "cleanup --all", "cleanup",
}

CRITICAL_ACTIONS = {
    "execute_risky",   # running a RISKY pentest command
}


# ── First run setup ───────────────────────────────────────────────────────────

def is_first_run() -> bool:
    return not AUTH_FILE.exists()


def setup_account() -> bool:
    """
    Interactive account creation on first run.
    Returns True on success.
    """
    from codesage.utils.display import c, BOLD, CYAN, GREEN, ORANGE, RED
    import builtins

    builtins.print()
    builtins.print(c("  ╔══════════════════════════════════════════╗", CYAN))
    builtins.print(c("  ║         Create Your CodeSage Account     ║", CYAN))
    builtins.print(c("  ╚══════════════════════════════════════════╝", CYAN))
    builtins.print()
    builtins.print(c("  Your credentials are stored locally only.", GREEN))
    builtins.print(c("  Password is bcrypt-hashed — never stored in plaintext.", GREEN))
    builtins.print()

    # Username
    try:
        username = input(c("  Username: ", BOLD+CYAN)).strip()
    except (EOFError, KeyboardInterrupt):
        return False

    if not username or len(username) < 2:
        builtins.print(c("  Username must be at least 2 characters.", ORANGE))
        return False

    # Age confirmation
    builtins.print()
    builtins.print(c("  CodeSage is for users 18 years of age or older.", ORANGE))
    try:
        age_confirm = input(c("  I confirm I am 18 or older [y/n]: ", BOLD+ORANGE)).strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False

    if age_confirm not in ("y", "yes"):
        builtins.print(c("  You must be 18 or older to use CodeSage.", RED))
        return False

    # Password
    builtins.print()
    try:
        pwd = getpass.getpass(c("  Password (min 8 chars): ", BOLD+CYAN))
        pwd_confirm = getpass.getpass(c("  Confirm password: ", BOLD+CYAN))
    except (EOFError, KeyboardInterrupt):
        return False

    if len(pwd) < 8:
        builtins.print(c("  Password must be at least 8 characters.", ORANGE))
        return False

    if pwd != pwd_confirm:
        builtins.print(c("  Passwords do not match.", ORANGE))
        return False

    # Hash and store
    pw_hash = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt(rounds=12)).decode()

    auth_data = {
        "username":         username,
        "password_hash":    pw_hash,
        "created_at":       datetime.utcnow().isoformat() + "Z",
        "last_login":       None,
        "failed_attempts":  0,
        "locked":           False,
        "terms_accepted":   False,
        "terms_version":    None,
        "terms_accepted_at": None,
        "age_confirmed":    True,
        "tools_setup_done": False,
    }

    _save_auth(auth_data)
    builtins.print()
    builtins.print(c(f"  ✓ Account created for {username}.", GREEN))
    return True


# ── Login ─────────────────────────────────────────────────────────────────────

def login() -> bool:
    """
    Prompt for credentials and validate.
    Sets the in-memory SESSION_TOKEN on success.
    Returns True on success.
    """
    global SESSION_TOKEN
    from codesage.utils.display import c, BOLD, CYAN, GREEN, ORANGE, RED
    import builtins

    auth = _load_auth()
    if not auth:
        return False

    if auth.get("locked"):
        builtins.print(c("  Account locked after too many failed attempts.", RED))
        builtins.print(c("  Delete ~/.codesage/auth.json to reset (this wipes all config).", ORANGE))
        return False

    builtins.print()
    builtins.print(c("  CodeSage — Authentication Required", BOLD))
    builtins.print()

    try:
        username = input(c("  Username: ", BOLD+CYAN)).strip()
        pwd      = getpass.getpass(c("  Password: ", BOLD+CYAN))
    except (EOFError, KeyboardInterrupt):
        return False

    # Validate
    if username != auth["username"]:
        _record_failure(auth)
        builtins.print(c("  Authentication failed.", RED))
        return False

    try:
        match = bcrypt.checkpw(pwd.encode(), auth["password_hash"].encode())
    except Exception:
        match = False

    if not match:
        remaining = _record_failure(auth)
        if remaining > 0:
            builtins.print(c(f"  Authentication failed. {remaining} attempt(s) remaining.", RED))
        else:
            builtins.print(c("  Account locked. Too many failed attempts.", RED))
        return False

    # Success
    auth["failed_attempts"] = 0
    auth["last_login"] = datetime.utcnow().isoformat() + "Z"
    _save_auth(auth)

    SESSION_TOKEN = secrets.token_hex(32)
    builtins.print(c(f"  ✓ Welcome back, {username}.", GREEN))
    logger.info(f"Login success: {username}")
    return True


def is_authenticated() -> bool:
    return SESSION_TOKEN is not None


# ── Re-authentication for high/critical commands ──────────────────────────────

def require_reauth(reason: str = "") -> bool:
    """
    Prompt user to re-enter password for high-level operations.
    Returns True if confirmed.
    """
    from codesage.utils.display import c, BOLD, ORANGE, GREEN, RED
    import builtins

    auth = _load_auth()
    if not auth:
        return False

    builtins.print()
    builtins.print(c("  ⚠  HIGH LEVEL OPERATION — Re-authentication required", BOLD+ORANGE))
    if reason:
        builtins.print(c(f"  Reason: {reason}", ORANGE))
    builtins.print()

    try:
        pwd = getpass.getpass(c("  Confirm password: ", BOLD+ORANGE))
    except (EOFError, KeyboardInterrupt):
        return False

    try:
        match = bcrypt.checkpw(pwd.encode(), auth["password_hash"].encode())
    except Exception:
        match = False

    if match:
        builtins.print(c("  ✓ Confirmed.", GREEN))
        logger.info(f"Re-auth success for: {reason}")
        return True
    else:
        builtins.print(c("  Authentication failed.", RED))
        logger.warning(f"Re-auth failed for: {reason}")
        return False


def get_command_level(command: str) -> str:
    """Return 'low', 'medium', 'high', or 'critical' for a command string."""
    cmd = command.strip().lower()
    for hc in HIGH_COMMANDS:
        if cmd.startswith(hc):
            return "high"
    for mc in MEDIUM_COMMANDS:
        if cmd.startswith(mc):
            return "medium"
    return "low"


# ── Terms acceptance ──────────────────────────────────────────────────────────

def terms_accepted() -> bool:
    auth = _load_auth()
    if not auth:
        return False
    return (
        auth.get("terms_accepted") is True
        and auth.get("terms_version") == CURRENT_TERMS_VERSION
    )


def record_terms_acceptance(time_on_screen: int):
    """Record that the user accepted the terms with forensic metadata."""
    auth = _load_auth()
    if not auth:
        return

    auth["terms_accepted"]    = True
    auth["terms_version"]     = CURRENT_TERMS_VERSION
    auth["terms_accepted_at"] = datetime.utcnow().isoformat() + "Z"
    auth["acceptance_method"] = "scroll_and_type"
    auth["time_on_screen_s"]  = time_on_screen
    auth["machine_id_hash"]   = _machine_id_hash()
    _save_auth(auth)
    logger.info(f"Terms v{CURRENT_TERMS_VERSION} accepted ({time_on_screen}s on screen)")


def mark_tools_setup_done():
    """Mark that the initial tool setup check has been performed."""
    auth = _load_auth()
    if not auth:
        return
    auth["tools_setup_done"] = True
    _save_auth(auth)
    logger.info("Initial tool setup check marked as done.")


# ── Change password ───────────────────────────────────────────────────────────

def change_password() -> bool:
    from codesage.utils.display import c, BOLD, CYAN, GREEN, ORANGE
    import builtins

    if not require_reauth("change password"):
        return False

    try:
        new_pwd     = getpass.getpass(c("  New password (min 8 chars): ", BOLD+CYAN))
        new_confirm = getpass.getpass(c("  Confirm new password: ", BOLD+CYAN))
    except (EOFError, KeyboardInterrupt):
        return False

    if len(new_pwd) < 8:
        builtins.print(c("  Password must be at least 8 characters.", ORANGE))
        return False
    if new_pwd != new_confirm:
        builtins.print(c("  Passwords do not match.", ORANGE))
        return False

    auth = _load_auth()
    auth["password_hash"] = bcrypt.hashpw(new_pwd.encode(), bcrypt.gensalt(rounds=12)).decode()
    _save_auth(auth)
    builtins.print(c("  ✓ Password updated.", GREEN))
    return True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_auth() -> dict | None:
    if not AUTH_FILE.exists():
        return None
    try:
        return json.loads(AUTH_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _save_auth(data: dict):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    AUTH_FILE.write_text(json.dumps(data, indent=2))
    AUTH_FILE.chmod(0o600)


def _record_failure(auth: dict) -> int:
    """Increment failed attempts. Lock account if max reached. Returns remaining attempts."""
    auth["failed_attempts"] = auth.get("failed_attempts", 0) + 1
    remaining = MAX_ATTEMPTS - auth["failed_attempts"]
    if remaining <= 0:
        auth["locked"] = True
        logger.warning(f"Account locked: {auth.get('username','?')}")
    _save_auth(auth)
    return max(0, remaining)


def _machine_id_hash() -> str:
    mac = str(uuid.getnode())
    return hashlib.sha256(mac.encode()).hexdigest()[:16]


def get_username() -> str:
    auth = _load_auth()
    return auth.get("username", "user") if auth else "user"
