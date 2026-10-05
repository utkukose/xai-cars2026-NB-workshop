#!/usr/bin/env python3
"""Update the repository owner and name in every link (Colab badges, GitHub Pages address, citation files).

Usage:  python tools/set_repo_name.py NEW_NAME [--owner NEW_OWNER] [--current OWNER/NAME]
"""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = ["README.md", "WORKSHOP_GUIDE.md", "CITATION.cff", "notebooks/*.ipynb", "docs/*.html",
            "docs/lab-ui.js", "dashboard/app.py"]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("name", help="new repository name")
    parser.add_argument("--owner", default="utkukose", help="new GitHub user or organisation")
    parser.add_argument("--current", default="utkukose/xai-cars2026-NB-workshop", help="current OWNER/NAME")
    args = parser.parse_args()
    old_owner, old_name = args.current.split("/")
    replacements = [(f"{old_owner}/{old_name}", f"{args.owner}/{args.name}"),
                    (f"{old_owner}.github.io/{old_name}", f"{args.owner}.github.io/{args.name}")]
    changed = 0
    for pattern in PATTERNS:
        for path in sorted(ROOT.glob(pattern)):
            text = path.read_text(encoding="utf-8")
            new = text
            for old, rep in replacements:
                new = new.replace(old, rep)
            if new != text:
                path.write_text(new, encoding="utf-8")
                changed += 1
                print(f"updated {path.relative_to(ROOT)}")
    print(f"{changed} files updated")


if __name__ == "__main__":
    main()
