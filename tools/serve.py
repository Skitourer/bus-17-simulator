"""Local development server: serves the repository on http://localhost:8017/ without browser caching.

Usage:  uv run poe serve   (or: python tools/serve.py [port])
Browsers otherwise keep old copies of the ES modules and mix them with new HTML after an update.
"""

import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PORT = 8017


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Static files with `Cache-Control: no-store`."""

    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as server:
        print(f'http://localhost:{port}/  (Ctrl+C to stop)')
        server.serve_forever()


if __name__ == '__main__':
    main()
