# CSage  

[![Version](https://img.shields.io/badge/version-0.1.2-blue.svg)](https://github.com/HIMAVARASAGAR/csage)
[![Python](https://img.shields.io/badge/python-3.10%2B-green.svg)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-Source--Available-orange.svg)](LICENSE.md)

**CSage** is a professional, AI-powered cybersecurity testing assistant designed for developers and security researchers. 

Unlike conventional "black-box" scanners, CSage utilizes the **Navigator Model**: an intent-driven pipeline where the AI acts as an expert consultant—analyzing targets, formulating step-by-step testing plans, and providing precise, explained commands—while you maintain absolute control over execution.

---

##  Key Features

- **Navigator Architecture**: Intent-driven testing where AI advises and users authorize.
- **Smart Tool Discovery**: Automatically detects, installs, and configures industry-standard tools (`nmap`, `sqlmap`, `gobuster`, etc.).
- **Hybrid AI Engine**: Seamlessly switch between local models (Ollama, LM Studio) and cloud high-performance providers (Groq, OpenAI, Gemini).
- **Tamper-Evident Logging**: Every command and finding is recorded in an HMAC hash-chained log for forensic integrity.
- **Security Checkpoints**: High-risk operations require explicit user confirmation and re-authentication.

---

##  Installation

CSage is optimized for macOS, Linux, and Windows (via WSL).

1.  **Clone & Navigate**:
    ```bash
    git clone https://github.com/HIMAVARASAGAR/csage.git
    cd csage
    ```

2.  **Global Installation**:
    ```bash
    pip3 install .
    ```

3.  **Dependency Setup**:
    CSage will automatically check for required security binaries on its first run. You can also manually trigger this with:
    ```bash
    csage tools install
    ```

---

##  CLI Reference

### Main Commands

| Command | Alias | Description |
| :--- | :--- | :--- |
| `csage scan` | - | Start an interactive, AI-guided security audit. |
| `csage model` | - | Configure AI providers, models, and API keys. |
| `csage logs` | - | View session history and verify log integrity. |
| `csage tools` | `packages` | Manage localized security tool installations. |
| `csage config` | - | Manage user account, passwords, and global settings. |
| `csage cleanup` | - | Remove temporary files, caches, and optionally logs. |
| `csage version` | - | Display current version and terms status. |
| `csage terms` | - | View the End User License Agreement (EULA). |
| `csage ai-test` | - | Specialized module for testing AI prompt security. |
| `csage reset` | `factory-reset`| **Danger Zone**: Wipe all local configuration and accounts. |

### Subcommand Details

*   **Scanning**: 
    - `csage scan --url <url>` : Target a specific web application.
    - `csage scan --target <path>` : Target a local source code directory.
*   **Logging**:
    - `csage logs show <session_id>` : Display a chronological narrative of a specific session.
    - `csage logs --verify` : Validate the HMAC integrity of all session logs.
*   **Tool Registry (New)**:
    - CSage now features a persistent registry at `~/.csage/tools.json`.
    - `csage tools add <name> [cmd]` : Add a custom tool. If `cmd` is omitted, the **AI will generate it** for your OS.
    - `csage tools remove <name>` : Remove a custom tool from the registry.
    - **In-Scan Auto-Setup**: If the AI recommends a tool you don't have, it will automatically offer to install it using its internal knowledge of your OS.
*   **Config**:
    - `csage config password` : Change your local authentication password.
    - `csage config keys-remove <provider>` : Safely purge an API key from local storage.

---

##  Interactive Session Commands

Once inside a scanning session, use these primary controls to interact with the AI assistant:

- **`[next]` (or Enter)**: Requests the next recommended step from the AI.
- **`[run]`**: Executes a suggested command (requires user authorization).
- **`[paste]`**: Paste output from a command you ran manually.
- **`[ask]`**: Ask a freeform question to the security analyst.
- **`[report]`**: Generate a structured markdown/HTML/JSON report of current findings.
- **`[model]`**: Hot-swap the underlying AI model without ending the session.
- **`[quit]`**: Safely terminate the session and finalize logs.

---

## 🛠️ Troubleshooting & OS Compatibility

 **macOS & Linux**: Officially supported via native dependency mapping.
 **Windows (Native)**: Supported via `winget`, `pip3`, and `go`. 
 **Windows (WSL)**: Highly recommended for the best experience.

**Dependency Issues?**
If `csage tools install` fails to automate a tool setup:
1.  Check the "Manual Path" provides in the terminal.
2.  Ensure your package managers (`brew`, `apt`, `winget`, `go`) are up to date and in your PATH.
3.  Consult the [Official Manual](LICENSE.md) or tool-specific documentation.
