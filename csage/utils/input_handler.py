"""
input_handler.py — prompt_toolkit powered terminal input.

Features:
- Enter = send, Shift+Enter = newline
- Input locked while AI is thinking (is_thinking flag)
- Spinner animation during AI calls
- Input history (up arrow)
- Hidden password input via getpass
- Markdown stripping for clean AI output rendering
"""

import threading
import time
import sys
import itertools
import re
import builtins
from typing import Callable

from prompt_toolkit import PromptSession
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.keys import Keys
from prompt_toolkit.formatted_text import ANSI
from prompt_toolkit.history import InMemoryHistory

from csage.utils.display import c, BOLD, CYAN, GRAY, GREEN, ORANGE, YELLOW


# ── State ─────────────────────────────────────────────────────────────────────

_is_thinking = False
_session: PromptSession | None = None


def _get_session() -> PromptSession:
    global _session
    if _session is None:
        _session = PromptSession(history=InMemoryHistory())
    return _session


# ── Key bindings ──────────────────────────────────────────────────────────────

def _build_bindings() -> KeyBindings:
    kb = KeyBindings()

    @kb.add(Keys.ControlJ)   # Enter
    @kb.add(Keys.ControlM)   # also Enter on some terminals
    def handle_enter(event):
        if _is_thinking:
            # Silently discard — do not queue
            builtins.print(c("\n  ⏳ Please wait — AI is thinking...", GRAY))
            return
        event.current_buffer.validate_and_handle()



    return kb


# ── Public input function ─────────────────────────────────────────────────────

def get_input(prompt_text: str = "") -> str:
    """
    Get multiline input from user.
    - Enter sends
    - Shift+Enter inserts newline
    - Blocked (with message) while AI is thinking
    """
    if _is_thinking:
        builtins.print(c("  ⏳ AI is still thinking. Please wait...", YELLOW))
        return ""

    session = _get_session()
    kb = _build_bindings()

    formatted_prompt = ANSI(c(f"\n  ▶ {prompt_text} ", BOLD+CYAN))

    try:
        result = session.prompt(
            formatted_prompt,
            key_bindings=kb,
            multiline=False,   # single line by default; Shift+Enter adds \n
        )
        return result.strip()
    except (EOFError, KeyboardInterrupt):
        return "quit"


def get_multiline_input(prompt_text: str = "") -> str:
    """
    Multiline paste mode — user types END on its own line to finish.
    Used for pasting command output.
    """
    if _is_thinking:
        builtins.print(c("  ⏳ AI is still thinking. Please wait...", YELLOW))
        return ""

    builtins.print(c(f"  {prompt_text}", CYAN))
    builtins.print(c("  Type END on its own line when done.", GRAY))
    builtins.print()

    lines = []
    try:
        while True:
            line = input()
            if line.strip().upper() == "END":
                break
            lines.append(line)
    except (EOFError, KeyboardInterrupt):
        pass

    return "\n".join(lines)


# ── Thinking lock ─────────────────────────────────────────────────────────────

class ThinkingContext:
    """
    Context manager that locks input and shows a spinner.

    Usage:
        with thinking("Analyzing output"):
            response = llm.chat(...)
    """

    def __init__(self, message: str = "Thinking"):
        self.message = message
        self._spinner_thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def __enter__(self):
        global _is_thinking
        _is_thinking = True
        self._stop_event.clear()
        self._spinner_thread = threading.Thread(
            target=_spin,
            args=(self.message, self._stop_event),
            daemon=True,
        )
        self._spinner_thread.start()
        return self

    def __exit__(self, *_):
        global _is_thinking
        self._stop_event.set()
        if self._spinner_thread:
            self._spinner_thread.join(timeout=1.0)
        _is_thinking = False
        # Clear the spinner line
        sys.stdout.write("\r" + " " * (len(self.message) + 10) + "\r")
        sys.stdout.flush()


def thinking(message: str = "Thinking") -> ThinkingContext:
    return ThinkingContext(message)


def _spin(message: str, stop: threading.Event):
    """Braille spinner animation."""
    frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    for frame in itertools.cycle(frames):
        if stop.is_set():
            break
        sys.stdout.write(f"\r  {c(frame, CYAN)}  {c(message + '...', GRAY)}")
        sys.stdout.flush()
        time.sleep(0.08)


# ── Terms scroll display ──────────────────────────────────────────────────────

def show_terms_with_gate(terms_text: str) -> tuple[bool, int]:
    """
    Display terms in a paginated view.
    User must scroll through everything before AGREE input unlocks.
    Enforces a minimum 10-second viewing time.

    Returns (accepted: bool, time_on_screen: int seconds)
    """
    from csage.utils.display import c, BOLD, CYAN, GREEN, ORANGE, RED, GRAY
    import builtins, math

    lines      = terms_text.split("\n")
    page_size  = 30
    total_pages = math.ceil(len(lines) / page_size)
    start_time = time.time()
    MIN_SECONDS = 10

    from csage import __version__
    builtins.print()
    builtins.print(c("  ╔══════════════════════════════════════════════════════════╗", CYAN))
    builtins.print(c(f"  ║         CSage — Terms of Use & License v{__version__}          ║", CYAN))
    builtins.print(c("  ║     Scroll through all sections before accepting.        ║", GRAY))
    builtins.print(c("  ╚══════════════════════════════════════════════════════════╝", CYAN))
    builtins.print()

    page = 0
    while page < total_pages:
        # Print current page
        start = page * page_size
        chunk = lines[start:start + page_size]
        for line in chunk:
            builtins.print("  " + line)

        is_last = (page == total_pages - 1)

        if is_last:
            builtins.print()
            builtins.print(c("  ─────────────────────────────────────────────────────────", CYAN))
            builtins.print(c("  You have reached the end of the Terms of Use.", BOLD))
            builtins.print()

            # Enforce minimum time
            elapsed = time.time() - start_time
            if elapsed < MIN_SECONDS:
                remaining = int(MIN_SECONDS - elapsed) + 1
                builtins.print(c(f"  Please take a moment to review the terms.", ORANGE))
                for i in range(remaining, 0, -1):
                    sys.stdout.write(
                        c(f"\r  You may proceed in [{i}] seconds...   ", ORANGE)
                    )
                    sys.stdout.flush()
                    time.sleep(1)
                sys.stdout.write("\r" + " " * 50 + "\r")
                sys.stdout.flush()
                builtins.print()

            break
        else:
            builtins.print()
            builtins.print(c(f"  Page {page+1}/{total_pages} — Press Enter to continue, 'q' to quit", GRAY))
            try:
                key = input("  ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                return False, int(time.time() - start_time)
            if key == "q":
                return False, int(time.time() - start_time)
            page += 1

    # Input now unlocked
    builtins.print(c("  By typing AGREE you confirm you have read and accept all terms.", BOLD))
    builtins.print(c("  Type EXIT to quit without accepting.", GRAY))
    builtins.print()

    try:
        response = input(c("  ▶ ", BOLD+CYAN)).strip().upper()
    except (EOFError, KeyboardInterrupt):
        response = "EXIT"

    total_time = int(time.time() - start_time)

    if response == "AGREE":
        builtins.print(c(f"  ✓ Terms accepted. ({total_time}s on screen)", GREEN))
        return True, total_time
    else:
        builtins.print(c("  Terms not accepted. Exiting.", ORANGE))
        return False, total_time


# ── Markdown stripping ────────────────────────────────────────────────────────

def strip_markdown(text: str) -> str:
    """
    Convert basic markdown to clean terminal text.
    **bold** → text, _italic_ → text, `code` → text,
    # headers → UPPERCASE section labels.
    """
    # Headers
    text = re.sub(r'^#{1,3}\s+(.+)$', lambda m: m.group(1).upper(), text, flags=re.MULTILINE)
    # Bold
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    # Italic
    text = re.sub(r'_(.+?)_', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    # Inline code — keep content, drop backticks
    text = re.sub(r'`([^`]+)`', r'\1', text)
    # Links [text](url) → text
    text = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', text)
    # Horizontal rules
    text = re.sub(r'^[-*_]{3,}$', '─' * 60, text, flags=re.MULTILINE)

    return text
