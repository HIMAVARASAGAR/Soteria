# CodeSage Changelog

## v1.0.0 — 2026
Initial release.

### Features
- AI-assisted security testing (navigator model — AI advises, user executes)
- 15 cloud AI providers + 10 local hosting apps
- Two-tier execution: setup commands auto-run, pentest commands user-typed only
- HMAC hash-chained tamper-evident logging
- bcrypt user authentication with re-auth for high-level operations
- Forced terms acceptance with scroll gate and forensic consent record
- Static code scanner (zero dependencies)
- Context exfiltration protection for cloud backends
- Exponential backoff for API rate limits
- shlex.split() with graceful ValueError handling (never shell=True)
- Report export: .md, .html, .json
- CLI subcommands: scan, config, model, logs, packages, cleanup, reset, terms, version
