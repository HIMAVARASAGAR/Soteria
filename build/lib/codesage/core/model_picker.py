"""
model_picker.py — Interactive model setup wizard.

Saves config to ~/.codesage/config.json.
API keys saved to ~/.codesage/.env (chmod 600) via getpass (never echoed).
"""

import os
import json
import getpass
import logging
from pathlib import Path
from codesage.core.llm import (
    LLMClient, CLOUD_PROVIDERS, LOCAL_APPS,
    ollama_list_models, ollama_pull_model,
    ollama_is_running, ollama_start_server,
    TransientError, FatalError,
)

logger = logging.getLogger("codesage.picker")

CONFIG_DIR  = Path.home() / ".codesage"
CONFIG_FILE = CONFIG_DIR / "config.json"
ENV_FILE    = CONFIG_DIR / ".env"


def load_config() -> dict | None:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            return None
    return None


def save_config(config: dict):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))
    CONFIG_FILE.chmod(0o600)


def reset_config():
    if CONFIG_FILE.exists():
        CONFIG_FILE.unlink()


def _save_api_key(provider: str, key: str):
    """Save API key to ~/.codesage/.env with chmod 600."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    prov = CLOUD_PROVIDERS.get(provider, {})
    env_var = prov.get("key_env", f"{provider.upper()}_API_KEY")

    lines = []
    found = False
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(f"{env_var}="):
                lines.append(f"{env_var}={key}")
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f"{env_var}={key}")

    ENV_FILE.write_text("\n".join(lines) + "\n")
    ENV_FILE.chmod(0o600)
    logger.info(f"Saved API key for {provider} to .env")


def _load_api_key(provider: str) -> str:
    """Load API key from .env file or environment."""
    prov = CLOUD_PROVIDERS.get(provider, {})
    env_var = prov.get("key_env", f"{provider.upper()}_API_KEY")

    # Check real environment first
    val = os.environ.get(env_var, "")
    if val:
        return val

    # Check .env file
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(f"{env_var}="):
                return line.split("=", 1)[1].strip()
    return ""


def run_picker(force: bool = False) -> LLMClient:
    from codesage.utils.display import c, CYAN, BOLD, GREEN, YELLOW, GRAY, WHITE, ORANGE
    import builtins

    if not force:
        saved = load_config()
        if saved:
            try:
                client = LLMClient(saved)
                ok, msg = client.ping()
                if ok:
                    builtins.print(c(f"  Using saved model: {client.display_name}", BOLD+GREEN))
                    builtins.print(c(f"  (Run with --reset-model to change)", GRAY))
                    builtins.print()
                    return client
                else:
                    builtins.print(c(f"  Saved model unreachable ({msg}), re-running setup...", YELLOW))
            except Exception as e:
                builtins.print(c(f"  Saved config invalid ({e}), re-running setup...", YELLOW))

    builtins.print()
    builtins.print(c("  ╔══════════════════════════════════════════╗", CYAN))
    builtins.print(c("  ║       CodeSage — Model Setup             ║", CYAN))
    builtins.print(c("  ╚══════════════════════════════════════════╝", CYAN))
    builtins.print()
    builtins.print(c("  Where is your AI running?\n", BOLD))
    builtins.print(c("  [1]", BOLD+CYAN) + "  Local  — Ollama / LM Studio / Jan / any local app")
    builtins.print(c("  [2]", BOLD+CYAN) + "  Cloud  — Groq / OpenAI / Gemini / Anthropic / etc.")
    builtins.print()

    choice = _ask("Pick [1/2]").strip()
    builtins.print()

    config = _pick_local() if choice == "1" else _pick_cloud()

    # Test connection
    client = LLMClient(config)
    builtins.print(c("\n  Testing connection...", CYAN))
    ok, msg = client.ping()
    if ok:
        builtins.print(c(f"  ✓ {msg}", GREEN))
    else:
        builtins.print(c(f"  ✗ {msg}", ORANGE))
        builtins.print(c("  Saving anyway — fix connectivity and retry.", YELLOW))

    save = _ask(c("  Save as default? [Y/n] ", CYAN)).strip().lower()
    if save in ("", "y", "yes"):
        save_config(config)
        builtins.print(c(f"  ✓ Saved to {CONFIG_FILE}", GRAY))

    builtins.print()
    return client


def _pick_local() -> dict:
    from codesage.utils.display import c, CYAN, BOLD, GREEN, YELLOW, GRAY, ORANGE
    import builtins

    builtins.print(c("  Which local app?\n", BOLD))
    apps = list(LOCAL_APPS.items())
    for i, (key, app) in enumerate(apps, 1):
        builtins.print(c(f"  [{i}]", BOLD+CYAN) + f"  {app['name']}")
    builtins.print()

    choice = _ask("Pick a number").strip()
    try:
        idx = int(choice) - 1
        app_key, app_info = apps[idx]
    except (ValueError, IndexError):
        builtins.print(c("  Invalid, defaulting to Ollama.", YELLOW))
        app_key, app_info = "ollama", LOCAL_APPS["ollama"]

    builtins.print(c(f"\n  Selected: {app_info['name']}", BOLD+GREEN))

    default_url = app_info["default_url"]
    url_input   = _ask(f"  Base URL [{default_url}]: ").strip()
    base_url    = url_input if url_input else default_url

    model = _ollama_flow(base_url) if app_key == "ollama" else _pick_local_model(app_info)

    key = _ask("  API key if required (blank for none): ").strip()

    return {
        "type":     "local",
        "provider": app_key,
        "model":    model,
        "base_url": base_url,
        "api_key":  key,
    }


def _pick_local_model(app_info: dict) -> str:
    default = app_info.get("default_model", "local-model")
    m = _ask(f"  Model name [{default}]: ").strip()
    return m if m else default


def _ollama_flow(base_url: str) -> str:
    from codesage.utils.display import c, CYAN, BOLD, GREEN, YELLOW, ORANGE, GRAY
    import builtins

    builtins.print()
    builtins.print(c("  Checking Ollama...", CYAN))

    running = ollama_is_running(base_url)
    if not running:
        builtins.print(c("  ✗ Ollama is not running.", ORANGE))
        start = _ask("  Start it now? [Y/n] ").strip().lower()
        if start in ("", "y", "yes"):
            builtins.print(c("  Starting ollama serve...", CYAN))
            ok = ollama_start_server()
            if ok:
                builtins.print(c("  ✓ Ollama started!", GREEN))
                running = True
            else:
                builtins.print(c("  ✗ Could not start Ollama.", ORANGE))
                builtins.print(c("  Run 'ollama serve' manually before scanning.", YELLOW))

    available = ollama_list_models(base_url) if running else []
    if available:
        builtins.print(c("\n  Models already pulled:", BOLD))
        for i, m in enumerate(available, 1):
            builtins.print(f"    {c(str(i)+'.', CYAN)} {m}")

    SUGGESTED = [
        ("gemma3:4b",    "Google Gemma 3 4B  — fast (~3GB)"),
        ("gemma3:12b",   "Google Gemma 3 12B — smart (~8GB RAM)"),
        ("gemma3:27b",   "Google Gemma 3 27B — best (~20GB RAM)"),
        ("llama3.2:3b",  "Meta Llama 3.2 3B  — very fast (~2GB)"),
        ("llama3.1:8b",  "Meta Llama 3.1 8B  — solid (~5GB)"),
    ]
    not_pulled = [(m, d) for m, d in SUGGESTED if m not in available]

    builtins.print()
    builtins.print(c("  Pick a model:\n", BOLD))
    all_models = available + [m for m, _ in not_pulled]
    for i, m in enumerate(all_models, 1):
        tag = c(" ✓ pulled", GREEN) if m in available else c(" (not pulled)", GRAY)
        builtins.print(f"    {c(str(i)+'.', CYAN)} {m}{tag}")
    builtins.print(f"    {c(str(len(all_models)+1)+'.', CYAN)} Type a custom model name")
    builtins.print()

    sel = _ask("  Pick number or type name").strip()
    chosen = None
    try:
        idx = int(sel) - 1
        if 0 <= idx < len(all_models):
            chosen = all_models[idx]
    except ValueError:
        chosen = sel if sel else "gemma3:4b"

    if not chosen:
        chosen = "gemma3:4b"

    if running and chosen not in available:
        builtins.print()
        pull = _ask(f"  '{chosen}' not pulled. Pull now? [Y/n] ").strip().lower()
        if pull in ("", "y", "yes"):
            builtins.print(c(f"  Pulling {chosen}...", CYAN))
            ok = ollama_pull_model(chosen)
            if ok:
                builtins.print(c(f"  ✓ Pulled successfully!", GREEN))
            else:
                builtins.print(c(f"  ✗ Pull failed. Run: ollama pull {chosen}", ORANGE))

    return chosen


def _pick_cloud(default: str | None = None) -> dict:
    from codesage.utils.display import c, CYAN, BOLD, GREEN, YELLOW, GRAY, ORANGE
    import builtins

    builtins.print(c("  Which cloud provider?\n", BOLD))
    providers = list(CLOUD_PROVIDERS.items())
    for i, (key, prov) in enumerate(providers, 1):
        builtins.print(c(f"  [{i:>2}]", BOLD+CYAN) + f"  {prov['name']}")
    builtins.print()

    choice = _ask("Pick a number").strip()
    try:
        idx = int(choice) - 1
        prov_key, prov_info = providers[idx]
    except (ValueError, IndexError):
        builtins.print(c("  Invalid, defaulting to Groq.", YELLOW))
        prov_key  = "groq"
        prov_info = CLOUD_PROVIDERS["groq"]

    builtins.print(c(f"\n  Selected: {prov_info['name']}", BOLD+GREEN))

    # Load existing key or prompt for new one
    existing_key = _load_api_key(prov_key)
    if existing_key:
        builtins.print(c(f"  ✓ Found saved API key for {prov_info['name']}", GREEN))
        api_key = existing_key
    else:
        builtins.print(c(f"\n  Get your API key at: {prov_info['key_url']}", GRAY))
        builtins.print(c("  Key input is hidden — will not be shown.", GRAY))
        builtins.print()
        try:
            api_key = getpass.getpass(c(f"  ▶ {prov_info['name']} API key: ", BOLD+CYAN))
        except (EOFError, KeyboardInterrupt):
            api_key = ""

        if api_key:
            _save_api_key(prov_key, api_key)
            builtins.print(c("  ✓ Key saved to ~/.codesage/.env (chmod 600)", GREEN))
        else:
            builtins.print(c("  No key entered. Set it before scanning.", ORANGE))

    # Model selection
    builtins.print(c("\n  Suggested models:\n", BOLD))
    models = prov_info["suggested_models"]
    for i, m in enumerate(models, 1):
        default_tag = c("  ← default", GREEN) if m == prov_info["default_model"] else ""
        builtins.print(f"    {c(str(i)+'.', CYAN)} {m}{default_tag}")
    builtins.print(f"    {c(str(len(models)+1)+'.', CYAN)} Type a custom model name")
    builtins.print()

    sel = _ask("  Pick number or type name").strip()
    chosen = prov_info["default_model"]
    try:
        idx = int(sel) - 1
        if 0 <= idx < len(models):
            chosen = models[idx]
    except ValueError:
        if sel:
            chosen = sel

    return {
        "type":     "cloud",
        "provider": prov_key,
        "model":    chosen,
        "api_key":  api_key,
        "base_url": "",
    }


def _ask(prompt: str = "") -> str:
    from codesage.utils.display import c, BOLD, CYAN
    try:
        return input(c(f"  ▶ {prompt} ", BOLD+CYAN))
    except (EOFError, KeyboardInterrupt):
        return ""
