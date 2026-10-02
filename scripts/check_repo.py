#!/usr/bin/env python3
"""Check tracked text files for whitespace and local Markdown link targets."""

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
LINK = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")


def tracked_files():
    output = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT)
    return [ROOT / name.decode("utf-8", "surrogateescape") for name in output.split(b"\0") if name]


def check():
    errors = []
    for path in tracked_files():
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # Binary files are not text documents.
        relative = path.relative_to(ROOT)
        if text and not text.endswith("\n"):
            errors.append(f"{relative}: missing final newline")
        for number, line in enumerate(text.splitlines(), 1):
            if line.rstrip(" \t") != line:
                errors.append(f"{relative}:{number}: trailing whitespace")
            if path.suffix.lower() != ".md":
                continue
            for match in LINK.finditer(line):
                target = match.group(1).split(' "', 1)[0].strip("<>")
                parsed = urlsplit(target)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                resolved = (ROOT if parsed.path.startswith("/") else path.parent) / unquote(parsed.path.lstrip("/"))
                if not resolved.exists():
                    errors.append(f"{relative}:{number}: missing link target {target}")
    return errors


if __name__ == "__main__":
    problems = check()
    print("\n".join(problems) if problems else "Repository checks passed.")
    sys.exit(bool(problems))
