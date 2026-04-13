"""
shell.py — Environment and Shell detection intelligence.
Detects OS, Shell type (WSL, PowerShell, CMD, Bash), and capabilities.
"""

import os
import sys
import platform
import logging

logger = logging.getLogger("vexa.shell")

def get_shell_info():
    """
    Returns a dictionary with environment metadata.
    {
        'os': 'windows' | 'mac' | 'linux',
        'is_wsl': bool,
        'shell': 'powershell' | 'cmd' | 'bash' | 'zsh' | 'unknown',
    }
    """
    sys_name = platform.system().lower()
    info = {
        'os': 'linux' if sys_name == 'linux' else ('windows' if sys_name == 'windows' else 'mac'),
        'is_wsl': False,
        'shell': 'unknown'
    }

    # 1. WSL Detection
    if info['os'] == 'linux':
        try:
            with open('/proc/version', 'r') as f:
                if 'microsoft' in f.read().lower():
                    info['is_wsl'] = True
        except:
            pass

    # 2. Shell Detection
    if info['os'] == 'windows':
        # PowerShell detection via env vars
        if os.environ.get('PSModulePath'):
            info['shell'] = 'powershell'
        else:
            info['shell'] = 'cmd'
    else:
        # Mac/Linux shell
        shell_path = os.environ.get('SHELL', '').lower()
        if 'zsh' in shell_path:
            info['shell'] = 'zsh'
        elif 'bash' in shell_path:
            info['shell'] = 'bash'
        else:
            info['shell'] = 'bash' # Default assumption for posix

    return info

def get_shell_label():
    """Returns a user-friendly string of the current environment."""
    info = get_shell_info()
    os_label = "WSL" if info['is_wsl'] else info['os'].capitalize()
    shell_label = info['shell'].capitalize()
    return f"{os_label} ({shell_label})"
