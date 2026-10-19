#!/usr/bin/env python3
"""Execute the workshop notebooks and report the result of each one.

Usage:  python tools/run_notebooks.py [--quick] [--timeout SECONDS] [NAME ...]

--quick sets XAI_WORKSHOP_QUICK=1, which shrinks sample sizes and iteration counts. Optional names select
notebooks by substring, for example "NB4". The exit code is 1 if any notebook fails.
"""
import argparse
import os
import sys
import time
from pathlib import Path

import nbformat
from nbclient import NotebookClient

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("names", nargs="*", help="substrings that select notebooks")
    parser.add_argument("--quick", action="store_true", help="run with smaller samples")
    parser.add_argument("--timeout", type=int, default=1800, help="time limit per cell in seconds")
    args = parser.parse_args()
    if args.quick:
        os.environ["XAI_WORKSHOP_QUICK"] = "1"
    paths = sorted((ROOT / "notebooks").glob("NB*.ipynb"))
    if args.names:
        paths = [p for p in paths if any(n in p.name for n in args.names)]
    failures = 0
    for path in paths:
        nb = nbformat.read(path, as_version=4)
        start = time.time()
        try:
            NotebookClient(nb, timeout=args.timeout, kernel_name="python3",
                           resources={"metadata": {"path": str(path.parent)}}).execute()
            print(f"{path.name}: ok in {time.time() - start:.0f} s", flush=True)
        except Exception as exc:
            failures += 1
            first_line = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
            print(f"{path.name}: FAILED after {time.time() - start:.0f} s ({type(exc).__name__}: {first_line[:300]})", flush=True)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
