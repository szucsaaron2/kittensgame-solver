#!/usr/bin/env python3
"""
Concatenates all src/*.js files (sorted by filename) into the final
userscript and copies it to the clipboard.
W
Usage:
    python build.py          # build + copy to clipboard
    python build.py --out    # also write mcts_autoplayer.user.js
"""

import glob
import os
import subprocess
import sys

SRC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")
OUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mcts_autoplayer.user.js")

def build():
    parts = sorted(glob.glob(os.path.join(SRC_DIR, "*.js")))
    if not parts:
        print("ERROR: No .js files found in src/")
        sys.exit(1)

    chunks = []
    for path in parts:
        with open(path, "r", encoding="utf-8") as f:
            chunks.append(f.read())

    script = "\n".join(chunks)

    # Print summary
    total_lines = script.count("\n") + 1
    print(f"Built from {len(parts)} files, {total_lines} lines total:")
    for p in parts:
        name = os.path.basename(p)
        with open(p, "r", encoding="utf-8") as f:
            lines = sum(1 for _ in f)
        print(f"  {name:25s} {lines:>5} lines")

    # Copy to clipboard (Windows)
    try:
        proc = subprocess.Popen(["clip.exe"], stdin=subprocess.PIPE)
        proc.communicate(script.encode("utf-16-le"))
        print(f"\nCopied to clipboard! ({total_lines} lines)")
    except FileNotFoundError:
        # Fallback: try xclip (WSL/Linux) or pbcopy (macOS)
        for cmd in [["xclip", "-selection", "clipboard"], ["pbcopy"]]:
            try:
                proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
                proc.communicate(script.encode("utf-8"))
                print(f"\nCopied to clipboard! ({total_lines} lines)")
                break
            except FileNotFoundError:
                continue
        else:
            print("\nWARNING: Could not copy to clipboard (no clip.exe/xclip/pbcopy found)")

    # Optionally write output file
    if "--out" in sys.argv:
        with open(OUT_FILE, "w", encoding="utf-8") as f:
            f.write(script)
        print(f"Wrote {OUT_FILE}")

    return script

if __name__ == "__main__":
    build()
