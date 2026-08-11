# Soteria VS Code Extension

A practical VS Code companion for Soteria with a project-aware **Control Center**, predictable terminal launch behavior, and quick access to useful Soteria workflows.

## Features

- **Real Control Center status** in the Activity Bar:
  - whether the configured `soteria` command is installed
  - the launch command being used
  - whether the launch shim injects `CLAUDE_CODE_USE_OPENAI=1`
  - the current workspace folder
  - the launch cwd that will be used for terminal sessions
  - whether `.soteria-profile.json` exists in the current workspace root
  - a conservative provider summary derived from the workspace profile or known environment flags
- **Project-aware launch behavior**:
  - `Launch Soteria` launches from the active editor's workspace when possible
  - falls back to the first workspace folder when needed
  - avoids launching from an arbitrary default cwd when a project is open
- **Practical sidebar actions**:
  - Launch Soteria
  - Launch in Workspace Root
  - Open Workspace Profile
  - Open Repository
  - Open Setup Guide
  - Open Command Palette
- **Built-in dark theme**: `Soteria Terminal Black`
- **Microsoft Foundry / Azure OpenAI**: optional wizard and settings store endpoint, API version, deployment name, and API key (Secret Storage); launch injects `OPENAI_*` and `AZURE_OPENAI_API_VERSION` into the Soteria terminal (see `docs/advanced-setup.md` on the repo).

## Requirements

- VS Code `1.95+`
- `soteria` available in your terminal PATH (`npm install -g @himavarasagar/soteria@latest`)

## Commands

- `Soteria: Open Control Center`
- `Soteria: Launch in Terminal`
- `Soteria: Launch in Workspace Root`
- `Soteria: Open Repository`
- `Soteria: Open Setup Guide`
- `Soteria: Open Workspace Profile`
- `Soteria: New Chat` / `Soteria: Open Chat Panel` / `Soteria: Resume Session` / `Soteria: Abort Generation`
- `Soteria: Configure Azure / Foundry Chat (wizard)`
- `Soteria: Set Azure / Foundry API Key (Secret Storage)`
- `Soteria: Clear Azure / Foundry API Key`
- `Soteria: Open Azure / Foundry Settings`

## Microsoft Foundry / Azure OpenAI (terminal chat)

1. Command Palette → **Soteria: Configure Azure / Foundry Chat (wizard)** and enter endpoint, API version, deployment name, and API key; or set `soteria.azure.*` in Settings and use **Soteria: Set Azure / Foundry API Key**.
2. Enable **Soteria: Azure: Enabled** (the wizard turns this on).
3. **Soteria: Launch in Terminal** — the extension merges env vars the OpenAI shim expects (`CLAUDE_CODE_USE_OPENAI`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `AZURE_OPENAI_API_VERSION`, and `OPENAI_AZURE_STYLE` when forced).

If you use `.soteria-profile.json` for the same workspace, leave Azure injection off to avoid conflicting provider configuration.

## Settings

- `soteria.launchCommand` (default: `soteria`)
- `soteria.terminalName` (default: `Soteria`)
- `soteria.useOpenAIShim` (default: `false`)
- `soteria.azure.*` — Foundry / Azure OpenAI terminal injection (see Settings UI)
- `soteria.permissionMode` — chat permission mode

`soteria.useOpenAIShim` only injects `CLAUDE_CODE_USE_OPENAI=1` when Azure injection did not already set it. It does not configure endpoints or keys by itself.

## Notes on Status Detection

- Provider status prefers the real workspace `.soteria-profile.json` file when present.
- If no saved profile exists, the extension falls back to known environment flags available to the VS Code extension host.
- If the source of truth is unclear, the extension shows `unknown` instead of guessing.

## Development

From this folder:

```bash
npm run test
npm run lint
```

To package (optional):

```bash
npm run package
```

