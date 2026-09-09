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

/* global browser, document, Blob, URL */

// Offscreen document used by the Chromium MV3 build. A service worker has no DOM and no
// URL.createObjectURL, so the blob-URL and clipboard operations the background code relies on
// are delegated here. The service-worker side (offscreen-proxy.js) forwards requests via
// runtime messages tagged with method "offscreen.*".
//
// Blob URLs created here stay valid as long as this document lives and the blob is referenced,
// so they can be handed to chrome.downloads.download and to viewer tabs. We keep the backing
// Blob objects in a Map keyed by the created URL so the garbage collector does not drop them.

const blobs = new Map();

browser.runtime.onMessage.addListener((message, sender) => {
	if (sender.id != browser.runtime.id) {
		return;
	}
	if (message.method == "offscreen.createObjectURL") {
		const blob = new Blob([new Uint8Array(message.array)], { type: message.mimeType });
		const url = URL.createObjectURL(blob);
		blobs.set(url, blob);
		return Promise.resolve({ url });
	}
	if (message.method == "offscreen.revokeObjectURL") {
		if (message.url) {
			URL.revokeObjectURL(message.url);
			blobs.delete(message.url);
		}
		return Promise.resolve({});
	}
	if (message.method == "offscreen.copyToClipboard") {
		copyToClipboard(message.mimeType, message.content);
		return Promise.resolve({});
	}
});

function copyToClipboard(mimeType, content) {
	const command = "copy";
	document.addEventListener(command, listener);
	document.execCommand(command);
	document.removeEventListener(command, listener);

	function listener(event) {
		event.clipboardData.setData(mimeType, content);
		event.clipboardData.setData("text/plain", content);
		event.preventDefault();
	}
}
