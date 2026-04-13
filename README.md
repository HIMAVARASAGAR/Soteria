# Vexa 🔮

Vexa is a professional, AI-powered cybersecurity testing assistant. Instead of acting as a fully autonomous (and dangerous) black-box, Vexa follows an "intent-driven" navigator model. It acts as an expert advisor that analyzes the target, formulates a step-by-step testing plan, generates precise execution commands (while explaining them), and analyzes the outputs you provide to hunt for vulnerabilities. 

## Features
- **Deterministic Tool Automation:** Identifies missing CLI security tools (like `nikto`, `sqlmap`, `gobuster`) and automatically resolves dependencies via your native package manager.
- **Continuous AI Pipeline:** When you execute an AI-suggested command, Vexa automatically pipes the output back into the AI to find issues immediately without manual copying.
- **Local & Cloud LLMs:** Works seamlessly with large cloud models (Groq, Gemini, OpenAI) and local, privacy-preserving models (Ollama, LM Studio).
- **Security Checkpoints:** Never executes pentesting payloads automatically. You manually verify, authorize, and run all risky commands for supreme safety and hallucination defense.

---

## Prerequisites 🛠️

Vexa acts as an orchestrator for several industry-standard security tools. For the most seamless experience, we recommend having these toolsets available on your system **before** running your first scan:

- **Network Analysis:** `nmap`, `curl`, `openssl`
- **Web App Security:** `nikto`, `sqlmap`
- **Recon & Enumeration:** `gobuster` or `ffuf`
- **Code Analysis:** `semgrep`
- **SSL/TLS Testing:** `sslyze`

**Don't have them?** Don't worry. Vexa includes an automated installation wizard that helps you fetch missing tools via `brew` (macOS), `apt` (Linux), or `winget` (Windows). If you don't use a package manager, Vexa will provide direct download links for manual setup.

---

## Installation

Vexa is designed to hook directly into your global system path for absolute convenience, allowing you to trigger audits from any directory.

1. Ensure you are running Python 3.10+
2. Clone this repository and navigate into the folder containing `pyproject.toml`.
3. Install the application globally:
```bash
pip3 install . --break-system-packages
```
*(Note: If utilizing a mature virtual environment workflow, run `pip install .` inside your `.venv`)*

---

## Getting Started

To launch Vexa against a target directory, IP, or URL simply type:

```bash
vexa https://example.com
```

**Inside the session, you can input:**
- `[run]` to manually execute a risky command recommended by the AI.
- `[tools]` to manually invoke the vulnerability tools dependency checker.
- `[model]` to switch your AI model without restarting.
- Or drop a generic conversational message to ask it conceptual questions!

---

## Setting Up AI Models

Vexa automatically handles configuration using an interactive setup wizard! 

Upon your first launch, the wizard will prompt you:
1. **Choose Local vs. Cloud:** Select whether to use a local privacy instance (like Ollama running `gemma3:4b`), or a blazing-fast Cloud Provider.
2. **Setup API Keys:** If a cloud provider is selected, you'll be prompted for an API key. 
3. **Saving State:** That key is natively encrypted and stored securely at `~/.vexa/.env` with strict `chmod 600` permissions. The model you selected will be saved to `~/.vexa/config.json`.

If you ever wish to modify these, enter `vexa --reset-model` or type `[model]` while inside an audit.

---

## Known Errors & OS Compatibility

✅ **macOS & Linux**: Officially supported via native dependency mapping.
✅ **Windows (Native)**: Supported via `winget`, `pip3`, and `go`. Some specialized tools may require manual installation.
🛠️ **Windows (WSL)**: Highly recommended for the best experience, as all tools are available via `apt`.

**Other Known Errors:**
- `whatweb` is no longer supported on the macOS Homebrew architecture and will be bypassed automatically.

---

## Reporting Issues
Bug Tracker / Issues: **[TBA]**
