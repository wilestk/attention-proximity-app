"""
run.py — start backend and frontend together.
Usage:  python run.py
Stop:   Ctrl+C
"""

import subprocess
import sys
import os
import signal
import pathlib

ROOT     = pathlib.Path(__file__).parent
BACKEND  = ROOT / "backend" / "app.py"
FRONTEND = ROOT / "frontend"

procs = []

def shutdown(sig=None, frame=None):
    print("\nShutting down...")
    for p in procs:
        p.terminate()
    sys.exit(0)

signal.signal(signal.SIGINT,  shutdown)
signal.signal(signal.SIGTERM, shutdown)

print("Starting backend...")
procs.append(subprocess.Popen(
    [sys.executable, str(BACKEND)],
    cwd=ROOT / "backend",
))

print("Starting frontend...")
procs.append(subprocess.Popen(
    ["npm", "run", "dev"],
    cwd=FRONTEND,
    shell=(sys.platform == "win32"),
))

print("Both running. Ctrl+C to stop.\n")
for p in procs:
    p.wait()
