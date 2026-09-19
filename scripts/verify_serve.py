#!/usr/bin/env python3
"""Deploy smoke test: serve dist/ and assert the built page actually works.

Run after `pnpm build`. Exits non-zero if the bundle would 404, ship no
mount point, or omit the module entry, so a broken deploy is caught locally
instead of by a judge opening the link.
"""
import functools
import http.server
import socketserver
import sys
import threading
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "dist"
PORT = 4173

if not ROOT.is_dir():
    sys.exit(f"build output missing: {ROOT} -- run `pnpm build` first")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: ARG002 - silence access logging
        pass


def main() -> int:
    handler = functools.partial(Quiet, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), handler) as httpd:
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=10) as r:
                status, body = r.status, r.read().decode("utf-8", "replace")
        finally:
            httpd.shutdown()

    checks = {
        "http 200": status == 200,
        "has #root mount": 'id="root"' in body,
        "has module entry": "type=\"module\"" in body,
        "no unresolved source path": "/src/main.tsx" not in body,
    }
    for name, ok in checks.items():
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
