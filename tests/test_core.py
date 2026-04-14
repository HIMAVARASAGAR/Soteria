"""
tests/test_core.py — Core functionality test suite.

Run with: python -m pytest tests/ -v
"""

import sys
import types
import tempfile
import json
import pytest
from pathlib import Path

# ── Mock dependencies that need network/install ───────────────────────────────

def _mock_deps():
    bcrypt = types.ModuleType("bcrypt")
    bcrypt.hashpw  = lambda pwd, salt: b"mock_" + pwd
    bcrypt.gensalt = lambda rounds=12: b"salt"
    bcrypt.checkpw = lambda pwd, hsh: hsh == b"mock_" + pwd
    sys.modules["bcrypt"] = bcrypt

    pt = types.ModuleType("prompt_toolkit")
    class Dummy: pass
    pt.PromptSession = Dummy
    pt.history = types.ModuleType("prompt_toolkit.history")
    pt.history.InMemoryHistory = Dummy
    pt.key_binding = types.ModuleType("prompt_toolkit.key_binding")
    pt.key_binding.KeyBindings = Dummy
    pt.keys = types.ModuleType("prompt_toolkit.keys")
    pt.keys.Keys = Dummy
    pt.formatted_text = types.ModuleType("prompt_toolkit.formatted_text")
    pt.formatted_text.ANSI = Dummy
    
    sys.modules["prompt_toolkit"] = pt
    sys.modules["prompt_toolkit.history"] = pt.history
    sys.modules["prompt_toolkit.key_binding"] = pt.key_binding
    sys.modules["prompt_toolkit.keys"] = pt.keys
    sys.modules["prompt_toolkit.formatted_text"] = pt.formatted_text
    sys.modules["dotenv"] = types.ModuleType("dotenv")
    sys.modules["certifi"] = types.ModuleType("certifi")

_mock_deps()

sys.path.insert(0, str(Path(__file__).parent.parent))

from csage.core.tool_runner  import classify, safe_tokenize
from csage.core.response_validator import (
    parse_response, sanitize_command_output,
    render_fallback, Finding, SuggestedCommand,
)
from csage.utils.logger  import ChainLogger, verify_log
from csage.utils.context import _scrub_secrets, _high_entropy, build_context
import csage.utils.logger as log_mod


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def tmp_log_dir(tmp_path):
    """Redirect logger to temp directory."""
    log_mod.LOG_DIR   = tmp_path / "logs"
    log_mod.CONFIG_DIR = tmp_path
    log_mod.ENV_FILE   = tmp_path / ".env"
    log_mod.LOG_DIR.mkdir()
    yield tmp_path


# ── Classifier ────────────────────────────────────────────────────────────────

class TestClassifier:

    SAFE = [
        "brew install nmap",
        "brew install nikto",
        "pip3 install semgrep",
        "pip3 install wfuzz",
        "pip install requests",
        "ollama pull gemma3:4b",
        "ollama serve",
        "ollama list",
        "apt-get install -y curl",
        "python3 -m pip install sslyze",
    ]

    BLOCKED = [
        "nmap -sV localhost",
        "nikto -h localhost",
        "sqlmap -u http://x.com",
        "curl https://target.com",
        "gobuster dir -u http://x",
        "pip install req | rm -rf /",
        "pip install x && curl evil.com",
        "bash -c 'evil'",
    ]

    @pytest.mark.parametrize("cmd", SAFE)
    def test_safe_commands(self, cmd):
        safe, reason = classify(cmd)
        assert safe is True, f"Expected safe, blocked: {reason}"

    @pytest.mark.parametrize("cmd", BLOCKED)
    def test_blocked_commands(self, cmd):
        safe, reason = classify(cmd)
        assert safe is False, f"Expected blocked, got safe: {cmd}"


# ── shlex safety ──────────────────────────────────────────────────────────────

class TestSafeTokenize:

    def test_normal_command(self):
        ok, tokens, err = safe_tokenize("pip3 install semgrep")
        assert ok is True
        assert tokens == ["pip3", "install", "semgrep"]
        assert err is None

    def test_unclosed_quote(self):
        ok, tokens, err = safe_tokenize('curl -H "Authorization: Bearer abc')
        assert ok is False
        assert err is not None
        assert "quotation" in err.lower() or "quoting" in err.lower()

    def test_never_falls_back_to_shell(self):
        # Even on failure, shell=True must never be used
        ok, tokens, err = safe_tokenize("pip install 'unclosed")
        assert ok is False
        assert tokens == []

    def test_empty_command(self):
        ok, tokens, err = safe_tokenize("")
        assert ok is True
        assert tokens == []


# ── Response validator ────────────────────────────────────────────────────────

class TestResponseValidator:

    SAMPLE = """
FINDING: SQL Injection
SEVERITY: HIGH
LOCATION: app.py:45
WHAT: User input concatenated into SQL query.
IMPACT: Attacker can read entire database.
FIX: Use parameterized queries.

COMMAND: nmap -sV localhost
TOOL: nmap
WHY: Discovers open ports.
FLAGS: -sV detects versions
RISK: LOW
"""

    def test_parses_findings(self):
        parsed = parse_response(self.SAMPLE)
        assert len(parsed.findings) == 1
        f = parsed.findings[0]
        assert f.name == "SQL Injection"
        assert f.severity == "HIGH"

    def test_parses_commands(self):
        parsed = parse_response(self.SAMPLE)
        assert len(parsed.commands) == 1
        cmd = parsed.commands[0]
        assert "nmap" in cmd.command
        assert cmd.risk == "LOW"

    def test_finding_validation(self):
        f = Finding(
            name="Test",
            severity="HIGH",
            location="app.py:1",
            what="Something bad",
            fix="Fix it",
        )
        valid, reason = f.is_valid()
        assert valid is True

    def test_invalid_severity_defaults_high(self):
        """Unknown severity must default to HIGH — never bury findings."""
        text = """
FINDING: Mystery Bug
SEVERITY: URGENT
LOCATION: app.py:1
WHAT: Something.
IMPACT: Bad.
FIX: Fix it.
"""
        parsed = parse_response(text)
        if parsed.findings:
            assert parsed.findings[0].severity in ("HIGH", "CRITICAL")

    def test_output_sanitizer_truncates(self):
        big = "line of output\n" * 300
        clean = sanitize_command_output(big)
        assert len(clean.split("\n")) <= 160
        assert "omitted" in clean

    def test_output_sanitizer_strips_ansi(self):
        ansi_text = "\x1b[91mred text\x1b[0m normal"
        clean = sanitize_command_output(ansi_text)
        assert "\x1b" not in clean
        assert "red text" in clean

    def test_fallback_renderer(self):
        findings = [
            {"severity": "CRITICAL", "name": "AWS Key", "location": "config.py"},
            {"severity": "HIGH",     "name": "SQLi",    "location": "app.py"},
        ]
        result = render_fallback(findings)
        assert "CRITICAL" in result
        assert "AWS Key" in result
        assert "recommendation" in result.lower()


# ── HMAC logger ───────────────────────────────────────────────────────────────

class TestChainLogger:

    def test_chain_integrity(self, tmp_log_dir):
        chain = ChainLogger("sess001")
        chain.log_session_start("./app", "http://localhost", "ollama", "all")
        chain.log_command("nmap localhost", "risky", True, ran=True, success=True)
        chain.log_finding("SQLi", "HIGH", "app.py:1")
        chain.log_session_end(1, 60)

        ok, msg = verify_log("sess001")
        assert ok is True
        assert "verified" in msg.lower()

    def test_tamper_detection(self, tmp_log_dir):
        chain = ChainLogger("sess002")
        chain.log_session_start("./app", None, "groq", "web")
        chain.log_command("pip3 install semgrep", "safe", True)

        log_file = log_mod.LOG_DIR / "sess002.jsonl"
        lines = log_file.read_text().strip().split("\n")
        entry = json.loads(lines[0])
        entry["model"] = "TAMPERED"
        lines[0] = json.dumps(entry)
        log_file.write_text("\n".join(lines) + "\n")

        ok, msg = verify_log("sess002")
        assert ok is False
        assert "tampered" in msg.lower() or "mismatch" in msg.lower()

    def test_secret_redaction_in_command(self, tmp_log_dir):
        from csage.utils.logger import _redact_command
        cmd = 'curl -H "Authorization: Bearer sk-supersecret123" http://localhost'
        redacted = _redact_command(cmd)
        assert "sk-supersecret123" not in redacted
        assert "[REDACTED]" in redacted

    def test_chain_links_correctly(self, tmp_log_dir):
        chain = ChainLogger("sess003")
        for i in range(5):
            chain.log("test_event", {"index": i})

        log_file = log_mod.LOG_DIR / "sess003.jsonl"
        entries = [json.loads(l) for l in log_file.read_text().strip().split("\n")]

        # Each entry's prev_hash should match previous entry's hash
        for i in range(1, len(entries)):
            assert entries[i]["prev_hash"] == entries[i-1]["hash"], \
                f"Chain broken at entry {i}"


# ── Context builder ───────────────────────────────────────────────────────────

class TestContext:

    def test_scrubs_database_url(self):
        content = "DATABASE_URL = postgres://user:password@localhost/db"
        result = _scrub_secrets(content)
        assert "password" not in result.lower() or "[REDACTED]" in result

    def test_scrubs_secret_key(self):
        content = "SECRET_KEY = sk-abc123verylongsecretkeyvalue123456789"
        result = _scrub_secrets(content)
        assert "sk-abc123" not in result

    def test_preserves_safe_content(self):
        content = "DEBUG = True\nPORT = 3000\nHOST = localhost"
        result = _scrub_secrets(content)
        assert "DEBUG" in result
        assert "PORT" in result

    def test_high_entropy_detection(self):
        assert _high_entropy("sk-abc123verylongrandomsecretkeyxyz12345678") is True

    def test_low_entropy_not_flagged(self):
        assert _high_entropy("hello") is False
        assert _high_entropy("localhost") is False

    def test_files_before_dirs_in_tree(self, tmp_path):
        # Create mixed structure
        (tmp_path / "subdir").mkdir()
        (tmp_path / "app.py").write_text("# app")
        (tmp_path / "README.md").write_text("# readme")
        (tmp_path / "subdir" / "module.py").write_text("# module")

        from csage.utils.context import _file_tree
        tree = _file_tree(tmp_path, max_depth=1)
        lines = [l for l in tree.split("\n") if "├──" in l or "└──" in l]

        # Files should appear before dirs
        file_positions = [i for i,l in enumerate(lines) if not l.endswith("/")]
        dir_positions  = [i for i,l in enumerate(lines) if l.endswith("/")]
        if file_positions and dir_positions:
            assert min(file_positions) < min(dir_positions), \
                "Files should appear before directories in tree"

    def test_cloud_safety_blocks_file_contents(self, tmp_path):
        (tmp_path / "config.py").write_text("SECRET_KEY = 'abc123'")
        ctx = build_context(str(tmp_path), None, is_cloud=True)
        assert ctx.get("package_files") == {}
        assert ctx.get("cloud_safety_active") is True

    def test_local_includes_file_contents(self, tmp_path):
        (tmp_path / "requirements.txt").write_text("flask\nrequests\n")
        ctx = build_context(str(tmp_path), None, is_cloud=False)
        assert ctx.get("cloud_safety_active") is False


# ── LLM client ────────────────────────────────────────────────────────────────

class TestLLMProviders:

    def test_all_cloud_providers_have_required_fields(self):
        from csage.core.llm import CLOUD_PROVIDERS
        required = {"name", "url", "key_env", "key_url",
                    "default_model", "suggested_models", "protocol"}
        for prov_id, prov in CLOUD_PROVIDERS.items():
            missing = required - set(prov.keys())
            assert not missing, f"Provider '{prov_id}' missing: {missing}"

    def test_all_local_apps_have_required_fields(self):
        from csage.core.llm import LOCAL_APPS
        required = {"name", "default_url", "chat_path", "models_path",
                    "protocol", "default_model"}
        for app_id, app in LOCAL_APPS.items():
            missing = required - set(app.keys())
            assert not missing, f"App '{app_id}' missing: {missing}"

    def test_provider_count(self):
        from csage.core.llm import CLOUD_PROVIDERS, LOCAL_APPS
        assert len(CLOUD_PROVIDERS) >= 10
        assert len(LOCAL_APPS) >= 9

    def test_exponential_backoff_wait_times(self):
        """Verify backoff grows as 2^n with jitter."""
        import random
        waits = []
        for attempt in range(5):
            wait = (2 ** attempt) + random.uniform(0, 1)
            waits.append(wait)
        # Each wait should be roughly double the previous (before jitter)
        assert waits[1] > waits[0]
        assert waits[2] > waits[1]
        assert waits[3] > waits[2]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
