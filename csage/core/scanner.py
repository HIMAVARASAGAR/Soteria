"""
Static scanner — quickly checks a local project folder for common
vulnerability patterns before handing off to the AI.
No external tools needed, pure Python + grep patterns.
"""

import os
import re
from pathlib import Path


# Patterns: (name, severity, regex, file_extensions)
PATTERNS = [
    # Secrets / credentials
    ("Hardcoded password", "HIGH",
     r'(?i)(password|passwd|pwd)\s*=\s*["\'][^"\']{4,}["\']',
     [".py", ".js", ".ts", ".php", ".rb", ".java", ".go", ".env"]),

    ("Hardcoded API key / secret", "HIGH",
     r'(?i)(api_key|apikey|secret_key|secret|token)\s*=\s*["\'][A-Za-z0-9_\-]{16,}["\']',
     [".py", ".js", ".ts", ".php", ".rb", ".java", ".go", ".env"]),

    ("AWS credential in code", "CRITICAL",
     r'AKIA[0-9A-Z]{16}',
     [".py", ".js", ".ts", ".php", ".rb", ".java", ".go", ".env", ".yml", ".yaml"]),

    ("Private key material", "CRITICAL",
     r'-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
     [".pem", ".key", ".txt", ".py", ".js", ".env"]),

    # Injection patterns
    ("Potential SQL injection (string concat)", "HIGH",
     r'(?i)(execute|query|raw)\s*\(\s*["\'].*\+|f["\'].*SELECT.*\{',
     [".py", ".js", ".ts", ".php", ".rb", ".java"]),

    ("Potential command injection (shell=True)", "HIGH",
     r'subprocess\.(call|run|Popen).*shell\s*=\s*True',
     [".py"]),

    ("Potential command injection (exec/eval)", "HIGH",
     r'\b(eval|exec)\s*\(',
     [".py", ".js", ".ts", ".php", ".rb"]),

    # XSS patterns
    ("Potential XSS (innerHTML)", "MEDIUM",
     r'\.innerHTML\s*=',
     [".js", ".ts", ".html"]),

    ("Potential XSS (document.write)", "MEDIUM",
     r'document\.write\s*\(',
     [".js", ".ts"]),

    # Insecure configs
    ("Debug mode enabled", "MEDIUM",
     r'(?i)(debug\s*=\s*True|DEBUG\s*=\s*True|app\.run\(.*debug\s*=\s*True)',
     [".py", ".js", ".ts", ".env"]),

    ("CORS wildcard (*)", "MEDIUM",
     r'(?i)(Access-Control-Allow-Origin.*\*|cors.*origin.*\*)',
     [".py", ".js", ".ts", ".php", ".rb", ".java"]),

    ("JWT secret too short or hardcoded", "HIGH",
     r'(?i)(jwt.*secret|secret.*jwt)\s*=\s*["\'][^"\']{1,20}["\']',
     [".py", ".js", ".ts", ".php", ".rb", ".java", ".env"]),

    ("Insecure cookie (no httponly/secure)", "LOW",
     r'(?i)set_cookie\((?!.*httponly)',
     [".py", ".rb"]),

    ("MD5 used for password hashing", "HIGH",
     r'(?i)(md5|hashlib\.md5)\s*\(',
     [".py", ".php", ".rb", ".java"]),

    ("Weak random (not cryptographic)", "MEDIUM",
     r'(?i)(random\.random|Math\.random)\s*\(',
     [".py", ".js", ".ts"]),

    # Sensitive file exposure
    (".env file in repo", "HIGH",
     r'.*',
     [".env"]),

    ("Private key file present", "CRITICAL",
     r'.*',
     [".pem", ".key", ".p12", ".pfx"]),
]

# Files/dirs to skip
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv",
             "env", ".tox", "dist", "build", ".next", ".nuxt"}
SKIP_FILES = {"package-lock.json", "yarn.lock", "poetry.lock", "Pipfile.lock"}

MAX_FILE_SIZE = 500_000  # 500KB — skip huge files


class StaticScanner:
    def __init__(self, path):
        self.root = Path(path).resolve()
        self.findings = []

    def scan(self):
        self._walk(self.root)
        return self.findings

    def _walk(self, directory):
        try:
            for item in directory.iterdir():
                if item.is_dir():
                    if item.name not in SKIP_DIRS:
                        self._walk(item)
                elif item.is_file():
                    if item.name not in SKIP_FILES:
                        self._scan_file(item)
        except PermissionError:
            pass

    def _scan_file(self, filepath):
        # Check if it's just a sensitive file by extension/name
        ext = filepath.suffix.lower()
        name = filepath.name.lower()

        # Special check for .env and key files
        if name == ".env" or name.endswith(".env"):
            self.findings.append({
                "name": ".env file found in project",
                "severity": "HIGH",
                "location": str(filepath.relative_to(self.root)),
                "line": None,
                "match": "(file exists)",
            })
            return

        if ext in (".pem", ".key", ".p12", ".pfx"):
            self.findings.append({
                "name": "Private key/cert file in project",
                "severity": "CRITICAL",
                "location": str(filepath.relative_to(self.root)),
                "line": None,
                "match": "(file exists)",
            })
            return

        # Skip binary and large files
        try:
            size = filepath.stat().st_size
            if size > MAX_FILE_SIZE:
                return
        except OSError:
            return

        # Only scan text-like files
        text_exts = {".py", ".js", ".ts", ".jsx", ".tsx", ".php", ".rb",
                     ".java", ".go", ".cs", ".rs", ".html", ".env",
                     ".yml", ".yaml", ".toml", ".cfg", ".ini", ".sh", ".txt"}
        if ext not in text_exts:
            return

        try:
            content = filepath.read_text(errors="ignore")
        except OSError:
            return

        lines = content.split("\n")

        for name_p, severity, pattern, extensions in PATTERNS:
            if extensions and ext not in extensions:
                continue
            if pattern == r'.*':
                continue  # handled above

            try:
                regex = re.compile(pattern)
            except re.error:
                continue

            for i, line in enumerate(lines, 1):
                if regex.search(line):
                    # Sanitize the match for display (hide actual secrets)
                    sanitized = line.strip()[:120]
                    if any(kw in name_p.lower() for kw in ("password", "key", "secret", "token", "credential")):
                        sanitized = sanitized[:40] + "... [redacted]"

                    finding = {
                        "name": name_p,
                        "severity": severity,
                        "location": f"{filepath.relative_to(self.root)}:{i}",
                        "line": i,
                        "match": sanitized,
                    }

                    # Avoid duplicate pattern matches in same file
                    key = (name_p, str(filepath.relative_to(self.root)))
                    if not any(f["name"] == name_p and
                               f["location"].split(":")[0] == str(filepath.relative_to(self.root))
                               for f in self.findings):
                        self.findings.append(finding)
                    break
