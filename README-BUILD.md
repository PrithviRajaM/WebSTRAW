# Building the extension

Requirements: Node.js 26 (includes npm) and the `zip` command.

Run:

    ./build-extension.sh

The script runs `npm ci`, builds the `lib` folder with rollup, and produces both
`singlefile-extension-firefox.zip` (Manifest V2, for Firefox) and
`singlefile-extension-chrome.zip` (Manifest V3, for Chromium browsers such as Edge and Chrome).

## Chromium (Edge/Chrome) manifest

The repository root ships two manifests:

- `manifest.json` — Manifest V2, used by Firefox (persistent background page, `sidebar_action`, `browser_action`, the `menus` permission).
- `manifest.chrome.json` — Manifest V3, used by Chromium browsers (service-worker background, `action`, `side_panel`, `contextMenus`, `declarativeNetRequest`).

The Chromium package is the same source as the Firefox one, except `manifest.chrome.json` is staged as `manifest.json`.

## Loading the Chromium build unpacked (Windows-friendly)

The `build-extension.sh` script requires a Unix shell. To load the extension unpacked in Edge/Chrome on any platform:

    npm run build:bundles   # builds the lib/ folder with rollup
    npm run stage:chrome    # assembles a loadable .staging-chrome/ folder

Then open `edge://extensions` (or `chrome://extensions`), enable Developer mode, choose "Load unpacked" and select the `.staging-chrome` folder.

## Difference with the published package

The published package differs from this build by one string. The Woleet API key is injected at packaging time. This source contains the placeholder `WOLEET_API_KEY_PLACEHOLDER` in `src/lib/woleet/woleet.js`. The same placeholder appears in the bundled file `lib/single-file-extension-background.js`. Everything else is byte-identical.
