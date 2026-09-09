# WebSTRAW Native Bridge

This bridge lets an external program (for example a Python script) ask the
WebSTRAW browser extension to load a web page and download the captured page
under a filename you choose. The browser downloads the file its usual way, into
your default downloads directory. The **second parameter is only a filename** —
no folder path is used or expected.

## How it works

A browser extension cannot open a listening socket, so it cannot be contacted
directly by an outside program. Native messaging solves this: the browser
launches a small local *host* process and talks to it over stdin/stdout. This
bridge uses that host as a relay.

```
your Python program  <--TCP 127.0.0.1:8787-->  bridge host  <--stdio-->  WebSTRAW extension
      (client)                                 (Python)                    (browser)
```

1. You send `{"url": "...", "filename": "..."}` to the bridge host over a local
   TCP socket.
2. The host forwards it to the extension through native messaging.
3. The extension opens the URL in a background tab, waits for it to finish
   loading, captures the full page, and downloads it. The provided `filename`
   becomes the exact name of the downloaded file.
4. The background tab is closed automatically.

## Message format

Request (client → bridge), one JSON object per line, newline-terminated:

```json
{ "url": "https://example.com", "filename": "example-page.html" }
```

Both fields are required. `filename` is used verbatim as the download name
(illegal filename characters and any path separators are replaced with `_`, so
it always stays a single filename with no folder).

Acknowledgement (bridge → client):

```json
{ "status": "forwarded", "url": "https://example.com", "filename": "example-page.html" }
```

`status` is `forwarded` when the request reached the extension, or `error` with
an `error` message when the request was rejected.

## Files in this folder

| File | Purpose |
| --- | --- |
| `webstraw_bridge_host.py` | The native-messaging host + local TCP relay. |
| `webstraw_bridge_host.log` | Auto-created log of received requests and their status. |
| `webstraw_bridge_host.bat` | Windows launcher the browser runs. |
| `webstraw_bridge.json` | Native host manifest (Chrome/Edge/Chromium). |
| `webstraw_bridge.firefox.json` | Native host manifest (Firefox). |
| `webstraw_client.py` | Example Python client. |

## Setup

### 1. Requirements

- Python 3 installed and on your `PATH`.
- The WebSTRAW extension installed, built from this repository so it includes
  the native bridge (`src/core/bg/native-bridge.js`).

### 2. Get your extension ID

- **Chrome/Edge**: open `chrome://extensions`, enable Developer mode, and copy
  the ID shown under WebSTRAW.
- **Firefox**: the ID is the gecko id from `manifest.json`
  (`{531906d3-e22f-4a6c-a102-8057b88a1a63}`).

### 3. Edit the host manifest

Open `webstraw_bridge.json` (or `webstraw_bridge.firefox.json` for Firefox)
and set:

- `path` to the absolute path of `webstraw_bridge_host.bat`, e.g.
  `C:\\Tools\\webstraw\\native-bridge\\webstraw_bridge_host.bat`
  (use double backslashes in JSON).
- For Chrome/Edge: replace `REPLACE_WITH_YOUR_EXTENSION_ID` in `allowed_origins`
  with your extension ID, keeping the `chrome-extension://` prefix and trailing
  slash.

### 4. Register the host (Windows registry)

On Windows the browser locates the host by reading a **registry key** named after
the host (`webstraw_bridge`). The key's `(default)` value must be the absolute
path to the host manifest JSON. Three pieces must all agree:

1. the **registry key** points to the manifest file,
2. the manifest's `path` points to `webstraw_bridge_host.bat`,
3. the manifest's `allowed_origins` contains your extension ID.

Steps 2 and 3 were done in section 3. Now create the registry key.

#### 4.1 Confirm the manifest path

Note the full path to the manifest you edited, for example
`d:\Dev\Others\WebSTRAW\native-bridge\webstraw_bridge.json`. You will use it
below.

#### 4.2 Create the registry key

`HKCU` (current user) does **not** require an elevated/admin PowerShell. Adjust
`$manifest` to your actual path.

**Chrome:**

```powershell
$manifest = "d:\Dev\Others\WebSTRAW\native-bridge\webstraw_bridge.json"
New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\webstraw_bridge" -Force |
  Set-ItemProperty -Name "(default)" -Value $manifest
```

**Microsoft Edge** (only the vendor path differs):

```powershell
$manifest = "d:\Dev\Others\WebSTRAW\native-bridge\webstraw_bridge.json"
New-Item -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\webstraw_bridge" -Force |
  Set-ItemProperty -Name "(default)" -Value $manifest
```

**Firefox** (uses the Firefox manifest with `allowed_extensions`):

```powershell
$manifest = "d:\Dev\Others\WebSTRAW\native-bridge\webstraw_bridge.firefox.json"
New-Item -Path "HKCU:\Software\Mozilla\NativeMessagingHosts\webstraw_bridge" -Force |
  Set-ItemProperty -Name "(default)" -Value $manifest
```

To register for **all users** on the machine instead of just the current user,
use the same paths under `HKLM:\Software\...` from an **elevated** (Run as
administrator) PowerShell.

#### 4.3 Verify the key

```powershell
Get-ItemProperty -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\webstraw_bridge" -Name "(default)"
```

The `(default)` value printed must be the manifest path, and that file must
exist. Common mistakes:

- **Wrong value type**: the browser reads the key's unnamed `(default)` value,
  not a named value. The commands above set it correctly.
- **Key name mismatch**: the key name, the manifest `name` field, and the name
  passed to `connectNative` must all be `webstraw_bridge` (already the case in
  this project).
- **Relative or variable paths**: both the registry value and the manifest
  `path` must be absolute. Do not use `%`-style environment variables.
- **`python` not found**: the browser launches `webstraw_bridge_host.bat`,
  which calls `python`. If Python is not on `PATH`, edit the `.bat` to use the
  full path to `python.exe`.

#### 4.4 Remove the registration (when needed)

```powershell
Remove-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\webstraw_bridge" -Force
```

### 4b. Register the host (macOS / Linux)

Instead of the registry, copy the manifest into the browser's native-messaging
hosts directory, and point `path` at `webstraw_bridge_host.py` (make it
executable with `chmod +x`). Common locations:

- Chrome (Linux): `~/.config/google-chrome/NativeMessagingHosts/webstraw_bridge.json`
- Chrome (macOS): `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/webstraw_bridge.json`
- Firefox (Linux): `~/.mozilla/native-messaging-hosts/webstraw_bridge.json`
- Firefox (macOS): `~/Library/Application Support/Mozilla/NativeMessagingHosts/webstraw_bridge.json`

### 5. Start the browser

The extension connects to the host automatically on startup (and retries every
few seconds if the host is not registered yet). When the connection succeeds,
the host's TCP server is listening on `127.0.0.1:8787`.

## Using it from Python

Minimal example (see `webstraw_client.py` for a runnable version):

```python
import json, socket

def save_page(url, filename, host="127.0.0.1", port=8787, timeout=10):
    request = json.dumps({"url": url, "filename": filename}) + "\n"
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(request.encode("utf-8"))
        response = sock.recv(4096).decode("utf-8").strip()
    return json.loads(response) if response else {}

print(save_page("https://example.com", "example-page.html"))
```

Or from the command line:

```powershell
python webstraw_client.py https://example.com example-page.html
```

The page is downloaded as `example-page.html` in your browser's downloads
folder. If a file with that name already exists, the browser makes the name
unique (e.g. `example-page(1).html`).

## Logging (check received requests and their status)

The bridge host writes a log so you can confirm whether a request was received
and how far it got in processing. Each bridge request is assigned a short
`requestId`; the extension echoes it back in its reply, so the log correlates a
request with its final status.

By default the log is written next to the host script as
`webstraw_bridge_host.log`. Override the location with the
`WEBSTRAW_BRIDGE_LOG` environment variable before the browser launches the
host (e.g. set it in `webstraw_bridge_host.bat`).

Each line is one JSON record with a timestamp and an `event` marking a point in
the lifecycle:

| `event` | Meaning |
| --- | --- |
| `host-start` / `listening` | The host started and the TCP server is up. |
| `received` | A request arrived from a client on the TCP socket. |
| `forwarded` | The request was passed to the extension. |
| `rejected` | The request was malformed (bad JSON or missing fields). |
| `started` | The extension acknowledged it began saving the page. |
| `error` | The extension reported a failure for that `requestId`. |
| `disconnect` | The browser closed the native-messaging connection. |

A typical successful request produces three correlated lines:

```json
{"time": "2026-01-01T12:00:00", "event": "received",  "requestId": "req-1", "url": "https://example.com", "filename": "p.html"}
{"time": "2026-01-01T12:00:00", "event": "forwarded", "requestId": "req-1", "url": "https://example.com", "filename": "p.html"}
{"time": "2026-01-01T12:00:02", "event": "started",   "requestId": "req-1", "url": "https://example.com", "filename": "p.html"}
```

To watch it live on Windows:

```powershell
Get-Content -Wait -Tail 20 "d:\Dev\Others\WebSTRAW\native-bridge\webstraw_bridge_host.log"
```

## Notes and troubleshooting

- **Filename only, no folder**: the bridge intentionally ignores any directory
  component. Slashes and other path characters in the filename are replaced with
  `_`. The download always lands in the default downloads directory.
- **The extension does the fetching**: the page is loaded in a real browser tab,
  so JavaScript-rendered content, logged-in sessions, and cookies work exactly
  as they do when you save a page manually.
- **Port already in use**: change `PORT` in `webstraw_bridge_host.py` if
  `8787` conflicts with something else on your machine.
- **No connection / nothing downloads**: confirm the extension ID in the
  manifest, that the registry key (Windows) or manifest file (macOS/Linux) points
  to the correct absolute path, and that `python` runs from the `.bat`. Errors
  from the host are written to stderr, which the browser captures in its native
  messaging logs.
- **Security**: the TCP server listens only on `127.0.0.1`, so it is reachable
  only from the local machine. Any local program can still send requests to it;
  do not run this on a shared/multi-user host if that is a concern.
