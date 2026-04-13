"""
logger.py — HMAC hash-chained tamper-evident session logging.

Every entry is chained to the previous via HMAC-SHA256.
A user-derived key (stored in ~/.codesage/.env) signs each entry.
Tampering with any entry breaks the chain — provable in court.

Decision log: HMAC chosen over plain SHA-256 because SHA-256 alone
only detects accidental corruption. Anyone with access to the log
file can recompute SHA-256 hashes of modified entries. HMAC with a
secret key the attacker doesn't have makes the chain genuinely
tamper-evident, not just tamper-detectable.
"""

import json
import hmac
import hashlib
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("codesage.logger")

CONFIG_DIR  = Path.home() / ".codesage"
LOG_DIR     = CONFIG_DIR / "logs"
ENV_FILE    = CONFIG_DIR / ".env"

# Sensitive flag patterns — these tool flags may carry secrets
SENSITIVE_FLAGS = {
    "curl":    ["-H", "--header", "-u", "--user", "-d", "--data"],
    "python":  ["apikey", "api_key", "token", "password", "secret"],
    "python3": ["apikey", "api_key", "token", "password", "secret"],
    "wget":    ["--password", "--http-password"],
    "ssh":     ["-i", "-l"],
}


# ── Key management ────────────────────────────────────────────────────────────

def _get_or_create_log_key() -> bytes:
    """
    Load CODESAGE_LOG_KEY from ~/.codesage/.env.
    Generate and store it if it doesn't exist yet.
    """
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    # Try to load existing key
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith("CODESAGE_LOG_KEY="):
                key_hex = line.split("=", 1)[1].strip()
                try:
                    return bytes.fromhex(key_hex)
                except ValueError:
                    pass  # corrupted — regenerate below

    # Generate new key
    key = os.urandom(32)  # 256-bit key
    _append_env("CODESAGE_LOG_KEY", key.hex())
    logger.info("Generated new CODESAGE_LOG_KEY")
    return key


def _append_env(key: str, value: str):
    """Append or update a key in ~/.codesage/.env"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    found = False

    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(f"{key}="):
                lines.append(f"{key}={value}")
                found = True
            else:
                lines.append(line)

    if not found:
        lines.append(f"{key}={value}")

    ENV_FILE.write_text("\n".join(lines) + "\n")
    ENV_FILE.chmod(0o600)


# ── Machine fingerprint ───────────────────────────────────────────────────────

def _machine_id_hash() -> str:
    """One-way hash of MAC address — identifies machine without storing PII."""
    mac = str(uuid.getnode())
    return hashlib.sha256(mac.encode()).hexdigest()[:16]


# ── HMAC chain ────────────────────────────────────────────────────────────────

def _compute_hmac(key: bytes, prev_hash: str, entry_data: dict) -> str:
    """Compute HMAC-SHA256 over prev_hash + sorted entry data."""
    payload = prev_hash + json.dumps(entry_data, sort_keys=True)
    return hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()


def _get_prev_hash(log_file: Path, key: bytes) -> str:
    """Get the hash of the last entry in the log, or genesis hash if empty."""
    if not log_file.exists():
        # Genesis block — hash of "CODESAGE_GENESIS" with the key
        return hmac.new(key, b"CODESAGE_GENESIS", hashlib.sha256).hexdigest()

    lines = [l.strip() for l in log_file.read_text().splitlines() if l.strip()]
    if not lines:
        return hmac.new(key, b"CODESAGE_GENESIS", hashlib.sha256).hexdigest()

    try:
        last = json.loads(lines[-1])
        return last.get("hash", "")
    except (json.JSONDecodeError, KeyError):
        return hmac.new(key, b"CODESAGE_GENESIS", hashlib.sha256).hexdigest()


# ── Main logger class ─────────────────────────────────────────────────────────

class ChainLogger:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.log_file = LOG_DIR / f"{session_id}.jsonl"
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        self._key = _get_or_create_log_key()

    def log(self, event_type: str, data: dict):
        """
        Write a new chained log entry.
        Sensitive values are detected and redacted before writing.
        """
        clean_data = _redact_sensitive(data)

        entry_data = {
            "timestamp":  datetime.utcnow().isoformat() + "Z",
            "session_id": self.session_id,
            "type":       event_type,
            "machine_id": _machine_id_hash(),
            **clean_data,
        }

        prev_hash = _get_prev_hash(self.log_file, self._key)
        entry_data["prev_hash"] = prev_hash
        entry_data["hash"] = _compute_hmac(self._key, prev_hash, entry_data)

        with open(self.log_file, "a") as f:
            f.write(json.dumps(entry_data) + "\n")

        logger.debug(f"Logged [{event_type}] to {self.log_file.name}")

    def log_command(self, command: str, risk_level: str, confirmed: bool,
                    ran: bool = False, success: bool = False):
        self.log("command", {
            "command":    _redact_command(command),
            "risk_level": risk_level,
            "confirmed":  confirmed,
            "ran":        ran,
            "success":    success,
        })

    def log_finding(self, name: str, severity: str, location: str):
        self.log("finding", {
            "name":     name,
            "severity": severity,
            "location": location,
        })

    def log_session_start(self, target_path: str | None, target_url: str | None,
                          model: str, scope: str):
        self.log("session_start", {
            "target_path": target_path or "",
            "target_url":  target_url or "",
            "model":       model,
            "scope":       scope,
        })

    def log_session_end(self, findings_count: int, duration_seconds: int):
        self.log("session_end", {
            "findings_count":  findings_count,
            "duration_seconds": duration_seconds,
        })

    def log_auth(self, event: str, username: str, success: bool):
        self.log("auth", {
            "event":    event,
            "username": username,
            "success":  success,
        })


# ── Verification ──────────────────────────────────────────────────────────────

def verify_log(session_id: str) -> tuple[bool, str]:
    """
    Walk the entire log chain for a session and verify every HMAC.
    Returns (all_valid, message).
    """
    log_file = LOG_DIR / f"{session_id}.jsonl"
    if not log_file.exists():
        return False, f"Log file not found: {log_file}"

    key = _get_or_create_log_key()
    lines = [l.strip() for l in log_file.read_text().splitlines() if l.strip()]

    if not lines:
        return True, "Log is empty."

    prev_hash = hmac.new(key, b"CODESAGE_GENESIS", hashlib.sha256).hexdigest()
    genesis_hash = prev_hash

    for i, line in enumerate(lines):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            return False, f"Entry {i+1}: JSON parse error — log may be corrupted."

        stored_hash   = entry.get("hash", "")
        stored_prev   = entry.get("prev_hash", "")
        expected_prev = prev_hash if i > 0 else genesis_hash

        if stored_prev != expected_prev:
            return False, (
                f"Entry {i+1} ({entry.get('type','?')} at {entry.get('timestamp','?')}): "
                f"prev_hash mismatch — chain broken here."
            )

        # Recompute HMAC without the hash field itself
        check_data = {k: v for k, v in entry.items() if k != "hash"}
        expected_hash = _compute_hmac(key, stored_prev, check_data)

        if stored_hash != expected_hash:
            return False, (
                f"Entry {i+1} ({entry.get('type','?')} at {entry.get('timestamp','?')}): "
                f"HMAC mismatch — this entry was tampered with."
            )

        prev_hash = stored_hash

    return True, f"✓ All {len(lines)} entries verified — log integrity intact."


def list_sessions() -> list[dict]:
    """Return summary of all logged sessions."""
    if not LOG_DIR.exists():
        return []

    sessions = []
    for log_file in sorted(LOG_DIR.glob("*.jsonl"), reverse=True):
        lines = [l.strip() for l in log_file.read_text().splitlines() if l.strip()]
        if not lines:
            continue
        try:
            first = json.loads(lines[0])
            last  = json.loads(lines[-1])
            sessions.append({
                "session_id": log_file.stem,
                "started":    first.get("timestamp", "?"),
                "ended":      last.get("timestamp", "?"),
                "entries":    len(lines),
                "type":       last.get("type", "?"),
            })
        except (json.JSONDecodeError, KeyError):
            pass
    return sessions


# ── Sensitive data handling ───────────────────────────────────────────────────

_SECRET_PATTERNS = [
    "password", "passwd", "pwd", "secret", "api_key", "apikey",
    "token", "auth", "credential", "private_key", "access_key",
]


def _redact_sensitive(data: dict) -> dict:
    """Redact any dict values whose keys suggest secret content."""
    clean = {}
    for k, v in data.items():
        if any(p in k.lower() for p in _SECRET_PATTERNS):
            clean[k] = "[REDACTED]"
        elif isinstance(v, str) and _looks_like_secret(v):
            clean[k] = "[REDACTED — high entropy value]"
        else:
            clean[k] = v
    return clean


def _redact_command(command: str) -> str:
    """
    Redact sensitive flag values from commands before logging.
    e.g. curl -H "Authorization: Bearer sk-abc123" → curl -H "[REDACTED]"
    """
    import shlex
    try:
        tokens = shlex.split(command)
    except ValueError:
        return "[command — parse error]"

    if not tokens:
        return command

    tool = tokens[0].lower().split("/")[-1]
    sensitive_flags = SENSITIVE_FLAGS.get(tool, [])

    result = []
    skip_next = False
    for i, token in enumerate(tokens):
        if skip_next:
            result.append("[REDACTED]")
            skip_next = False
            continue
        if token in sensitive_flags:
            result.append(token)
            skip_next = True
        else:
            result.append(token)

    return " ".join(result)


def _looks_like_secret(value: str) -> bool:
    """Rough entropy check — high-entropy strings are likely secrets."""
    if len(value) < 20:
        return False
    import math
    freq = {}
    for c in value:
        freq[c] = freq.get(c, 0) + 1
    entropy = -sum(
        (f / len(value)) * math.log2(f / len(value))
        for f in freq.values()
    )
    return entropy > 3.8  # threshold for secret detection
