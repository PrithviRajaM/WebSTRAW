/*
 * Copyright 2010-2020 Gildas Lormeau
 * contact : gildas.lormeau <at> gmail.com
 *
 * This file is part of WebSTRAW.
 *
 *   The code in this file is free software: you can redistribute it and/or
 *   modify it under the terms of the GNU Affero General Public License
 *   (GNU AGPL) as published by the Free Software Foundation, either version 3
 *   of the License, or (at your option) any later version.
 *
 *   The code in this file is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero
 *   General Public License for more details.
 *
 *   As additional permission under GNU AGPL version 3 section 7, you may
 *   distribute UNMODIFIED VERSIONS OF THIS file without the copy of the GNU
 *   AGPL normally required by section 4, provided you include this license
 *   notice and a URL through which recipients can access the Corresponding
 *   Source.
 */

// Cross-platform staging for the Chromium (Edge/Chrome) unpacked extension.
//
// The repository root ships the Firefox Manifest V2 manifest.json, so loading the workspace
// directly into a Chromium browser would use the wrong manifest. This script assembles a
// ready-to-load unpacked directory under .staging-chrome/ with the Manifest V3 manifest
// (manifest.chrome.json) copied in as manifest.json, alongside the built lib/, _locales/ and
// src/. Run `npm run build:bundles` first (or use `npm run stage:chrome` which does both when
// invoked through the package script order documented in README-BUILD.md).

/* global process */

import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const stagingDir = join(rootDir, ".staging-chrome");

if (!existsSync(join(rootDir, "lib", "single-file-extension-worker.js"))) {
	console.error("Missing lib/single-file-extension-worker.js. Run `npm run build:bundles` first."); // eslint-disable-line no-console
	process.exit(1);
}

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

copyFileSync(join(rootDir, "manifest.chrome.json"), join(stagingDir, "manifest.json"));
for (const entry of ["lib", "_locales", "src"]) {
	cpSync(join(rootDir, entry), join(stagingDir, entry), { recursive: true });
}

console.log("Staged Chromium unpacked extension at:", stagingDir); // eslint-disable-line no-console
console.log("Load it in Edge via edge://extensions -> Load unpacked -> select the .staging-chrome folder."); // eslint-disable-line no-console
