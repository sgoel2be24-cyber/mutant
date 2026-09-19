#!/usr/bin/env python3
"""Trivial local static server for the built site (no dependencies).

Used to verify the production bundle actually serves before deploying.
"""
import functools
import http.server
import socketserver
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
ROOT = Path(__file__).resolve().parent.parent / "dist"

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))

if __name__ == "__main__":
    if not ROOT.is_dir():
        raise SystemExit(f"build output missing: {ROOT} (run `pnpm build` first)")
    with socketserver.TCPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"serving {ROOT} on http://127.0.0.1:{PORT}")
        httpd.serve_forever()
