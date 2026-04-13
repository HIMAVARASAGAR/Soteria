"""
context.py — Project folder analysis.

Fixes:
  - Files before directories in tree
  - Token cap on tree output
  - Cloud safety: no file contents sent to cloud LLMs
  - Entropy-based secret scrubbing
"""

import re
import math
from pathlib import Path
from urllib.parse import urlparse

INTERESTING_FILES = [
    "package.json","requirements.txt","Pipfile","pyproject.toml",
    "Gemfile","pom.xml","build.gradle","go.mod","composer.json",
    "Dockerfile","docker-compose.yml","docker-compose.yaml",
    ".env.example","config.py","settings.py","config.js",
    "app.py","main.py","server.py","index.js","app.js",
    "web.config","nginx.conf","apache.conf",".htaccess",
    "README.md","SECURITY.md",
]

TECH_INDICATORS = {
    "requirements.txt":"Python","Pipfile":"Python (Pipenv)",
    "pyproject.toml":"Python (modern)","manage.py":"Django",
    "app.py":"Flask/FastAPI","Gemfile":"Ruby on Rails",
    "pom.xml":"Java (Maven)","build.gradle":"Java (Gradle)",
    "go.mod":"Go","composer.json":"PHP","package.json":"Node.js",
    "next.config.js":"Next.js","nuxt.config.js":"Nuxt.js",
    "angular.json":"Angular","vue.config.js":"Vue.js",
    "Cargo.toml":"Rust","Dockerfile":"Docker",
    "docker-compose.yml":"Docker Compose",
}

SKIP_DIRS  = {".git","node_modules","__pycache__",".venv","venv","env",
              "dist","build",".next",".nuxt",".tox"}
SKIP_FILES = {"package-lock.json","yarn.lock","poetry.lock","Pipfile.lock"}

MAX_TREE_CHARS = 3_000
MAX_FILE_CHARS = 1_500
SECRET_KEYWORDS = [
    "password","passwd","pwd","secret","api_key","apikey",
    "token","auth","credential","private_key","access_key",
    "database_url","db_url","connection_string",
]


def build_context(target_path: str | None, target_url: str | None,
                  is_cloud: bool = False) -> dict:
    ctx: dict = {}

    if target_url:
        parsed = urlparse(target_url)
        ctx["url"]              = target_url
        ctx["host"]             = parsed.netloc
        ctx["scheme"]           = parsed.scheme
        ctx["is_local_target"]  = _is_local(target_url)

    if target_path:
        root = Path(target_path).resolve()
        ctx["path"]            = str(root)
        ctx["tech_stack"]      = _detect_tech(root)
        ctx["file_tree"]       = _file_tree(root)
        ctx["cloud_safety_active"] = is_cloud
        ctx["package_files"]   = {} if is_cloud else _read_interesting_files(root)

    if "is_local_target" not in ctx:
        ctx["is_local_target"] = bool(target_path)

    return ctx


def _is_local(target: str) -> bool:
    return any(x in target for x in ["localhost","127.0.0.1","0.0.0.0","::1"])


def _detect_tech(root: Path) -> list[str]:
    techs = []
    for fname, tech in TECH_INDICATORS.items():
        if (root / fname).exists():
            techs.append(tech)
    if not techs:
        exts: set[str] = set()
        for p in root.rglob("*"):
            if p.is_file() and p.suffix:
                exts.add(p.suffix)
            if len(exts) > 200:
                break
        for ext, name in {".py":"Python",".js":"JavaScript",".ts":"TypeScript",
                          ".php":"PHP",".rb":"Ruby",".java":"Java",".go":"Go"}.items():
            if ext in exts:
                techs.append(name)
    return list(dict.fromkeys(techs))


def _file_tree(root: Path, max_depth: int = 2) -> str:
    lines = [root.name + "/"]
    _walk(root, lines, "", 0, max_depth)
    result = "\n".join(lines)
    return result[:MAX_TREE_CHARS] + ("\n...(truncated)" if len(result) > MAX_TREE_CHARS else "")


def _walk(directory: Path, lines: list, prefix: str, depth: int, max_depth: int):
    if depth >= max_depth:
        return
    try:
        all_items = list(directory.iterdir())
    except PermissionError:
        return
    # Files first, then dirs — fixes audit finding
    files = sorted([i for i in all_items if i.is_file()
                    and i.name not in SKIP_FILES and not i.name.startswith(".")])
    dirs  = sorted([i for i in all_items if i.is_dir()
                    and i.name not in SKIP_DIRS and not i.name.startswith(".")])
    items = files + dirs
    for i, item in enumerate(items[:40]):
        is_last   = (i == len(items) - 1)
        connector = "└── " if is_last else "├── "
        lines.append(prefix + connector + item.name + ("/" if item.is_dir() else ""))
        if item.is_dir():
            _walk(item, lines, prefix + ("    " if is_last else "│   "), depth+1, max_depth)


def _read_interesting_files(root: Path) -> dict[str, str]:
    found: dict[str, str] = {}
    for fname in INTERESTING_FILES:
        fpath = root / fname
        if fpath.exists() and fpath.is_file():
            try:
                raw = fpath.read_text(errors="ignore")
                found[fname] = _scrub_secrets(raw)[:MAX_FILE_CHARS]
            except OSError:
                pass
    return found


def _scrub_secrets(content: str) -> str:
    lines, out = content.split("\n"), []
    for line in lines:
        ll = line.lower()
        if any(kw in ll for kw in SECRET_KEYWORDS) and ("=" in line or ":" in line):
            key = line.split("=")[0] if "=" in line else line.split(":")[0]
            out.append(f"{key.rstrip()} = [REDACTED]")
            continue
        tokens = re.split(r'[\s=:"\']+', line)
        if any(_high_entropy(t) for t in tokens if len(t) > 15):
            out.append("[line redacted — high entropy]")
            continue
        out.append(line)
    return "\n".join(out)


def _high_entropy(s: str) -> bool:
    if len(s) < 16:
        return False
    freq: dict = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    entropy = -sum((f/len(s)) * math.log2(f/len(s)) for f in freq.values())
    return entropy > 3.8
