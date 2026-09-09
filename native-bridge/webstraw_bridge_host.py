#!/usr/bin/env python3
"""
WebSTRAW native-messaging bridge host.

The browser launches this script (via chrome.runtime.connectNative) and talks to
it over stdin/stdout using the native-messaging protocol (a 4-byte little-endian
length prefix followed by a UTF-8 JSON payload).

Because a browser extension cannot open a listening socket, this host acts as the
bridge: it exposes a small TCP server on 127.0.0.1 that your own programs
(for example a Python client) connect to. Any {"url": ..., "filename": ...}
request received on that socket is forwarded to the extension, which loads the
URL and downloads the captured page using the given filename.

Wire:  your program  <--TCP-->  this host  <--stdio-->  browser extension

Logging
-------
Every request received, every forward to the extension, and every acknowledgement
sent back by the extension is appended to a log file so you can check whether a
bridge request was received and how far it got in processing. Each bridge request
is assigned a short requestId; the extension echoes it back in its reply, letting
the log correlate a request with its final status (started / error).

The log file location can be overridden with the WEBSTRAW_BRIDGE_LOG environment
variable. By default it is written next to this script as
"webstraw_bridge_host.log".
"""

import itertools
import json
import os
import socket
import struct
import sys
import threading
from datetime import datetime

# Local TCP endpoint your client programs connect to.
HOST = "127.0.0.1"
PORT = 8787

# Path to the log file. Override with the WEBSTRAW_BRIDGE_LOG env var.
LOG_PATH = os.environ.get(
    "WEBSTRAW_BRIDGE_LOG",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "webstraw_bridge_host.log")
)

# Guard so we only ever send well-formed frames to the browser.
_stdout_lock = threading.Lock()

# Guard so concurrent client threads never interleave log lines.
_log_lock = threading.Lock()

# Monotonic counter used to mint per-request ids (e.g. "req-1", "req-2", ...).
_request_ids = itertools.count(1)


def _log(event, requestId=None, **fields):
    """Append one structured, timestamped line to the log file (and stderr).

    `event` is a short lifecycle marker such as "received", "forwarded",
    "started", "error" or "disconnect". `requestId` ties the line back to the
    originating bridge request when available.
    """
    record = {"time": datetime.now().isoformat(timespec="seconds"), "event": event}
    if requestId is not None:
        record["requestId"] = requestId
    record.update(fields)
    line = json.dumps(record, ensure_ascii=False)
    with _log_lock:
        try:
            with open(LOG_PATH, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except OSError:
            # Never let logging failures break the bridge itself.
            pass
    # Mirror to stderr too; the browser captures this in its native-messaging logs.
    sys.stderr.write(line + "\n")
    sys.stderr.flush()


def _read_native_message():
    """Read one message sent by the browser over stdin. Returns None on EOF."""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    message_length = struct.unpack("<I", raw_length)[0]
    data = sys.stdin.buffer.read(message_length)
    if len(data) < message_length:
        return None
    return json.loads(data.decode("utf-8"))


def _send_native_message(message):
    """Send one message to the browser over stdout using the native protocol."""
    encoded = json.dumps(message).encode("utf-8")
    with _stdout_lock:
        sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()


def _handle_client(conn, addr):
    """Handle one connected client: read newline-delimited JSON requests."""
    with conn:
        buffered = b""
        while True:
            try:
                chunk = conn.recv(4096)
            except OSError:
                break
            if not chunk:
                break
            buffered += chunk
            while b"\n" in buffered:
                line, buffered = buffered.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    request = json.loads(line.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    _log("rejected", error="invalid JSON", peer=str(addr))
                    _reply(conn, {"status": "error", "error": "invalid JSON"})
                    continue
                requestId = "req-%d" % next(_request_ids)
                url = request.get("url")
                filename = request.get("filename")
                _log("received", requestId, url=url, filename=filename, peer=str(addr))
                if not url or not filename:
                    _log("rejected", requestId,
                         error="both 'url' and 'filename' are required")
                    _reply(conn, {"status": "error", "requestId": requestId,
                                  "error": "both 'url' and 'filename' are required"})
                    continue
                # Forward the request to the browser extension. The requestId is
                # included so the extension can echo it back, letting the log
                # correlate the eventual started/error status with this request.
                _send_native_message({"requestId": requestId, "url": url, "filename": filename})
                _log("forwarded", requestId, url=url, filename=filename)
                _reply(conn, {"status": "forwarded", "requestId": requestId,
                              "url": url, "filename": filename})


def _reply(conn, payload):
    try:
        conn.sendall((json.dumps(payload) + "\n").encode("utf-8"))
    except OSError:
        pass


def _run_tcp_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen(16)
    _log("listening", host=HOST, port=PORT)
    while True:
        try:
            conn, addr = server.accept()
        except OSError:
            break
        threading.Thread(target=_handle_client, args=(conn, addr), daemon=True).start()


def main():
    _log("host-start", log=LOG_PATH)
    # Start the local TCP server your client programs will connect to.
    threading.Thread(target=_run_tcp_server, daemon=True).start()

    # Keep reading messages from the browser (replies such as {status:"started"}).
    # When the browser disconnects, stdin hits EOF and we exit cleanly.
    while True:
        message = _read_native_message()
        if message is None:
            break
        # Log the extension's acknowledgement, correlated by requestId so the
        # log shows the final processing status of each forwarded request.
        if isinstance(message, dict):
            status = message.get("status", "ack")
            _log(status, message.get("requestId"),
                 url=message.get("url"), filename=message.get("filename"),
                 error=message.get("error"))
        else:
            _log("ack", raw=message)
    _log("disconnect")


if __name__ == "__main__":
    main()
