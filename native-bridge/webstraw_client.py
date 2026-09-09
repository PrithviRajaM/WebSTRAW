#!/usr/bin/env python3
"""
Example Python client for the WebSTRAW native-messaging bridge.

This connects to the local TCP server exposed by webstraw_bridge_host.py and
asks the WebSTRAW extension to load a web page and download it under a chosen
filename.

Usage:
    python webstraw_client.py https://example.com example-page.html
"""

import json
import socket
import sys

HOST = "127.0.0.1"
PORT = 8787


def save_page(url, filename, host=HOST, port=PORT, timeout=10):
    """Ask the extension to load `url` and download it as `filename`.

    Returns the acknowledgement dict from the bridge host, e.g.
    {"status": "forwarded", "url": ..., "filename": ...}.
    """
    request = json.dumps({"url": url, "filename": filename}) + "\n"
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(request.encode("utf-8"))
        response = sock.recv(4096).decode("utf-8").strip()
    return json.loads(response) if response else {}


def main():
    if len(sys.argv) != 3:
        print("usage: python webstraw_client.py <url> <filename>")
        sys.exit(1)
    url, filename = sys.argv[1], sys.argv[2]
    result = save_page(url, filename)
    print(result)


if __name__ == "__main__":
    main()
