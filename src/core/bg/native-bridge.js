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

/* global browser, chrome, setTimeout */

import * as business from "./business.js";
import * as config from "./config.js";

// On the Chromium MV3 build the background is a service worker that can be suspended, which
// silently drops setTimeout timers. chrome.alarms survives suspension, so it is used as a
// reliable fallback to re-check the native connection. Firefox (persistent background page)
// has no such lifecycle, so the setTimeout path is enough there.
const chromeAPI = typeof chrome != "undefined" ? chrome : (typeof globalThis != "undefined" ? globalThis.chrome : undefined);
const ALARMS_SUPPORTED = Boolean(chromeAPI && chromeAPI.alarms);
const RECONNECT_ALARM_NAME = "webstraw-bridge-reconnect";

// Name of the native-messaging host registered on the operating system.
// A local program (e.g. a Python script) implements this host and pushes
// { url, filename } requests to the extension through it.
const NATIVE_HOST_NAME = "webstraw_bridge";

// Delay (ms) before trying to reconnect after the host disconnects.
const RECONNECT_DELAY = 5000;

// Characters that must never appear in a download filename. They are replaced
// so the name provided by the caller is used as-is as much as possible.
const ILLEGAL_FILENAME_CHARACTERS = /[/\\:*?"<>|\u0000-\u001F\u007F]+/g; // eslint-disable-line no-control-regex

// Prefix used for all diagnostic log lines so they are easy to filter in the
// background service-worker console (chrome://extensions -> "service worker",
// or about:debugging -> Inspect in Firefox).
const LOG_PREFIX = "[webstraw-bridge]";

let port, enabled;

function log(...args) {
	console.log(LOG_PREFIX, ...args); // eslint-disable-line no-console
}

function logError(...args) {
	console.error(LOG_PREFIX, ...args); // eslint-disable-line no-console
}

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
		log("enabling native bridge, connecting to host", NATIVE_HOST_NAME);
		connect();
	}
}

function disable() {
	enabled = false;
	log("disabling native bridge");
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
	} catch (error) {
		port = null;
		logError("connectNative failed", error);
		scheduleReconnect();
		return;
	}
	log("connected to native host, listening for messages");
	port.onMessage.addListener(onMessage);
	port.onDisconnect.addListener(onDisconnect);
}

function onDisconnect() {
	port = null;
	// browser.runtime.lastError carries the reason the native host went away
	// (e.g. host not found, host crashed). It is only meaningful here.
	const lastError = browser.runtime && browser.runtime.lastError;
	logError("native host disconnected", lastError ? lastError.message : "(no error detail)");
	if (enabled) {
		log("scheduling reconnect in", RECONNECT_DELAY, "ms");
		scheduleReconnect();
	}
}

function scheduleReconnect() {
	// Fast path: reconnect quickly while the worker is still alive.
	setTimeout(() => {
		if (enabled && !port) {
			connect();
		}
	}, RECONNECT_DELAY);
	// Reliable fallback for a suspended MV3 service worker: an alarm wakes the worker back up
	// and re-runs the reconnect check even after setTimeout has been discarded.
	if (ALARMS_SUPPORTED) {
		try {
			chromeAPI.alarms.create(RECONNECT_ALARM_NAME, { delayInMinutes: 0.5 });
			// eslint-disable-next-line no-unused-vars
		} catch (error) {
			// alarms unavailable; the setTimeout fast path still applies
		}
	}
}

if (ALARMS_SUPPORTED) {
	chromeAPI.alarms.onAlarm.addListener(alarm => {
		if (alarm.name == RECONNECT_ALARM_NAME) {
			if (enabled && !port) {
				connect();
			} else {
				try {
					chromeAPI.alarms.clear(RECONNECT_ALARM_NAME);
					// eslint-disable-next-line no-unused-vars
				} catch (error) {
					// ignored
				}
			}
		}
	});
}

async function onMessage(message) {
	if (!message || typeof message != "object") {
		logError("ignoring non-object message from host", message);
		return;
	}
	const requestId = message.requestId;
	log("message received from host", { requestId, url: message.url, filename: message.filename });
	try {
		const url = message.url;
		const filename = message.filename;
		if (typeof url != "string" || !url) {
			throw new Error("Missing or invalid 'url'");
		}
		if (typeof filename != "string" || !filename) {
			throw new Error("Missing or invalid 'filename'");
		}
		log("starting saveUrl", { requestId, url, filename });
		await saveUrl(url, filename);
		log("saveUrl resolved, replying 'started'", { requestId });
		reply({ requestId, status: "started", url, filename });
	} catch (error) {
		logError("saveUrl failed, replying 'error'", { requestId, error });
		reply({ requestId, status: "error", error: error && (error.message || String(error)) });
	}
}

function reply(response) {
	if (port) {
		try {
			port.postMessage(response);
			log("reply sent to host", response);
		} catch (error) {
			logError("reply postMessage failed", { response, error });
		}
	} else {
		logError("cannot reply, native port is not connected", response);
	}
}

async function saveUrl(url, filename) {
	// The filename is forced through the filename template. Because the value
	// contains no {placeholder} tokens, the WebSTRAW core outputs it verbatim
	// as the name of the downloaded file. The browser then downloads it the
	// usual way, into the default downloads directory.
	const forcedFilename = sanitizeFilename(filename);
	// business.saveUrls silently skips URLs whose profile is disabled, so it
	// resolves without queuing anything. Detect that here so the log makes the
	// no-op visible instead of reporting a misleading 'started'.
	try {
		const urlOptions = await config.getOptions(url);
		if (urlOptions && urlOptions.profileName == config.DISABLED_PROFILE_NAME) {
			logError("WebSTRAW is disabled for this URL; nothing will be saved", { url });
		}
	} catch (error) {
		logError("could not read profile options for url", { url, error });
	}
	log("calling business.saveUrls", { url, forcedFilename });
	// business.saveUrls resolves once the save task is *queued*, not once the
	// download completes. So a 'started' reply confirms queuing, not a finished
	// file. Watch the WebSTRAW task UI / downloads for final completion.
	const result = business.saveUrls([url], {
		filenameTemplate: forcedFilename,
		filenameConflictAction: "uniquify",
		confirmFilename: false,
		backgroundSave: true,
		removeSingleFileComment: false
	});
	Promise.resolve(result).then(
		() => log("business.saveUrls promise resolved (task queued)", { forcedFilename }),
		error => logError("business.saveUrls promise rejected", { forcedFilename, error })
	);
	return result;
}

function sanitizeFilename(filename) {
	// Keep the caller-provided name intact, only stripping path separators and
	// characters the OS forbids in filenames.
	return filename.replace(ILLEGAL_FILENAME_CHARACTERS, "_").trim();
}
