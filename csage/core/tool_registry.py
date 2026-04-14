import json
import logging
from pathlib import Path

logger = logging.getLogger("csage.registry")

CONFIG_DIR = Path.home() / ".csage"
TOOLS_FILE = CONFIG_DIR / "tools.json"

DEFAULT_TOOLS = {
    "nmap":     {"linux": "sudo apt-get install -y nmap",     "mac": "brew install nmap",    "win": "winget install nmap"},
    "nikto":    {"linux": "sudo apt-get install -y nikto",    "mac": "brew install nikto",   "win": "python -m pip install nikto-wrapper || echo 'Nikto not natively supported on Windows. Use WSL or Docker.'"},
    "sqlmap":   {"linux": "sudo apt-get install -y sqlmap",   "mac": "brew install sqlmap",  "win": "pip3 install sqlmap"},
    "gobuster": {"linux": "sudo apt-get install -y gobuster", "mac": "brew install gobuster","win": "go install github.com/OJ/gobuster/v3@latest"},
    "ffuf":     {"linux": "sudo apt-get install -y ffuf",     "mac": "brew install ffuf",    "win": "go install github.com/ffuf/ffuf@latest"},
    "curl":     {"linux": "sudo apt-get install -y curl",     "mac": "brew install curl",    "win": "winget install curl"},
    "openssl":  {"linux": "sudo apt-get install -y openssl",  "mac": "brew install openssl", "win": "winget install openssl"},
    "wfuzz":    {"linux": "pip3 install wfuzz",               "mac": "pip3 install wfuzz",   "win": "pip3 install wfuzz"},
    "semgrep":  {"linux": "pip3 install semgrep",             "mac": "pip3 install semgrep", "win": "pip3 install semgrep"},
    "sslyze":   {"linux": "pip3 install sslyze",              "mac": "pip3 install sslyze",  "win": "pip3 install sslyze"},
    "hydra":    {"linux": "sudo apt-get install -y hydra",    "mac": "brew install hydra",   "win": "winget install hydra"},
    "wapiti":   {"linux": "pip3 install wapiti3",             "mac": "pip3 install wapiti3", "win": "pip3 install wapiti3"},
    "whatweb":  {"linux": "sudo apt-get install -y whatweb",  "mac": "brew install whatweb", "win": "gem install whatweb"},
}

DEFAULT_LINKS = {
    "nmap":     "https://nmap.org/download.html",
    "nikto":    "https://github.com/sullo/nikto#installation",
    "sqlmap":   "https://github.com/sqlmapproject/sqlmap/wiki/Installation",
    "gobuster": "https://github.com/OJ/gobuster#installation",
    "ffuf":     "https://github.com/ffuf/ffuf#installation",
    "curl":     "https://curl.se/download.html",
    "openssl":  "https://www.openssl.org/source/",
    "wfuzz":    "https://wfuzz.readthedocs.io/en/latest/user/installation.html",
    "semgrep":  "https://semgrep.dev/docs/installing-semgrep-community/",
    "sslyze":   "https://github.com/nabla-c0d3/sslyze#installation",
    "hydra":    "https://github.com/vanhauser-thc/thc-hydra#installation",
    "wapiti":   "https://wapiti-scanner.github.io/manual.html#installation",
    "whatweb":  "https://github.com/urbanadventurer/WhatWeb#installation",
}

class ToolRegistry:
    def __init__(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self.tools = DEFAULT_TOOLS.copy()
        self.links = DEFAULT_LINKS.copy()
        self._load()

    def _load(self):
        if TOOLS_FILE.exists():
            try:
                data = json.loads(TOOLS_FILE.read_text())
                self.tools.update(data.get("installers", {}))
                self.links.update(data.get("links", {}))
            except Exception as e:
                logger.error(f"Failed to load tools registry: {e}")

    def _save(self):
        # We only save the DELTAS from defaults to keep file small
        user_installers = {k: v for k, v in self.tools.items() if k not in DEFAULT_TOOLS or DEFAULT_TOOLS[k] != v}
        user_links = {k: v for k, v in self.links.items() if k not in DEFAULT_LINKS or DEFAULT_LINKS[k] != v}
        
        data = {
            "installers": user_installers,
            "links": user_links
        }
        TOOLS_FILE.write_text(json.dumps(data, indent=2))

    def add_tool(self, name: str, installers: dict, link: str = ""):
        self.tools[name] = installers
        if link:
            self.links[name] = link
        self._save()

    def remove_tool(self, name: str):
        if name in self.tools:
            del self.tools[name]
        if name in self.links:
            del self.links[name]
        self._save()

    def get_installer(self, name: str) -> dict:
        return self.tools.get(name, {})

    def get_link(self, name: str) -> str:
        return self.links.get(name, f"https://google.com/search?q={name}+security+tool")

# Global instance
registry = ToolRegistry()
