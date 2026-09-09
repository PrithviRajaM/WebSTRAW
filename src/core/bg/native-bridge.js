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

/* global browser, setTimeout */

import * as business from "./business.js";

// Name of the native-messaging host registered on the operating system.
// A local program (e.g. a Python script) implements this host and pushes
// { url, filename } requests to the extension through it.
const NATIVE_HOST_NAME = "webstraw_bridge";

// Delay (ms) before trying to reconnect after the host disconnects.
const RECONNECT_DELAY = 5000;

// Characters that must never appear in a download filename. They are replaced
// so the name provided by the caller is used as-is as much as possible.
const ILLEGAL_FILENAME_CHARACTERS = /[/\\:*?"<>|\u0000-\u001F\u007F]+/g; // eslint-disable-line no-control-regex

let port, enabled;

export {
	enable,
	disable,
	isEnabled
};

function isEnabled() {
	return Boolean(enabled);
}

function enable() {
	if (!enabled) {
		enabled = true;
		connect();
	}
}

function disable() {
	enabled = false;
	if (port) {
		try {
			port.disconnect();
		} catch {
			// ignored
		}
		port = null;
	}
}

function connect() {
	if (!enabled || port) {
		return;
	}
	try {
		port = browser.runtime.connectNative(NATIVE_HOST_NAME);
	} catch {
		port = null;
		scheduleReconnect();
		return;
	}
	port.onMessage.addListener(onMessage);
	port.onDisconnect.addListener(onDisconnect);
}

function onDisconnect() {
	port = null;
	if (enabled) {
		scheduleReconnect();
	}
}

function scheduleReconnect() {
	setTimeout(() => {
		if (enabled && !port) {
			connect();
		}
	}, RECONNECT_DELAY);
}

async function onMessage(message) {
	if (!message || typeof message != "object") {
		return;
	}
	const requestId = message.requestId;
	try {
		const url = message.url;
		const filename = message.filename;
		if (typeof url != "string" || !url) {
			throw new Error("Missing or invalid 'url'");
		}
		if (typeof filename != "string" || !filename) {
			throw new Error("Missing or invalid 'filename'");
		}
		await saveUrl(url, filename);
		reply({ requestId, status: "started", url, filename });
	} catch (error) {
		reply({ requestId, status: "error", error: error && (error.message || String(error)) });
	}
}

function reply(response) {
	if (port) {
		try {
			port.postMessage(response);
		} catch {
			// ignored
		}
	}
}

function saveUrl(url, filename) {
	// The filename is forced through the filename template. Because the value
	// contains no {placeholder} tokens, the WebSTRAW core outputs it verbatim
	// as the name of the downloaded file. The browser then downloads it the
	// usual way, into the default downloads directory.
	const forcedFilename = sanitizeFilename(filename);
	return business.saveUrls([url], {
		filenameTemplate: forcedFilename,
		filenameConflictAction: "uniquify",
		confirmFilename: false,
		backgroundSave: true,
		removeSingleFileComment: false
	});
}

function sanitizeFilename(filename) {
	// Keep the caller-provided name intact, only stripping path separators and
	// characters the OS forbids in filenames.
	return filename.replace(ILLEGAL_FILENAME_CHARACTERS, "_").trim();
}
