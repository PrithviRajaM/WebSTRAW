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

/* global browser, chrome, document, URL */

// Bridges the background code to an offscreen document on the Chromium MV3 build, where the
// service worker has no DOM, no URL.createObjectURL, and no document.execCommand. On Firefox
// (persistent background page) and any environment without the chrome.offscreen API, these
// helpers run directly against the ambient DOM/URL, preserving the original MV2 behavior.

const OFFSCREEN_DOCUMENT_PATH = "/src/core/bg/offscreen.html";
const chromeAPI = typeof chrome != "undefined" ? chrome : (typeof globalThis != "undefined" ? globalThis.chrome : undefined);
const OFFSCREEN_SUPPORTED = Boolean(chromeAPI && chromeAPI.offscreen);
let creatingOffscreenDocument;

export {
	createObjectURL,
	revokeObjectURL,
	copyToClipboard
};

async function createObjectURL(blob, mimeType) {
	if (OFFSCREEN_SUPPORTED) {
		await ensureOffscreenDocument();
		const buffer = await blob.arrayBuffer();
		const response = await browser.runtime.sendMessage({
			method: "offscreen.createObjectURL",
			array: Array.from(new Uint8Array(buffer)),
			mimeType: mimeType || blob.type
		});
		return response.url;
	}
	return URL.createObjectURL(blob);
}

async function revokeObjectURL(url) {
	if (!url) {
		return;
	}
	if (OFFSCREEN_SUPPORTED) {
		try {
			await browser.runtime.sendMessage({ method: "offscreen.revokeObjectURL", url });
			// eslint-disable-next-line no-unused-vars
		} catch (error) {
			// the offscreen document may already be closed; the blob URL dies with it
		}
	} else {
		URL.revokeObjectURL(url);
	}
}

async function copyToClipboard(mimeType, content) {
	if (OFFSCREEN_SUPPORTED) {
		await ensureOffscreenDocument();
		await browser.runtime.sendMessage({ method: "offscreen.copyToClipboard", mimeType, content });
	} else {
		const command = "copy";
		document.addEventListener(command, listener);
		document.execCommand(command);
		document.removeEventListener(command, listener);
	}

	function listener(event) {
		event.clipboardData.setData(mimeType, content);
		event.clipboardData.setData("text/plain", content);
		event.preventDefault();
	}
}

async function ensureOffscreenDocument() {
	const existingContexts = await chromeAPI.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
		documentUrls: [chromeAPI.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
	});
	if (existingContexts.length > 0) {
		return;
	}
	if (creatingOffscreenDocument) {
		await creatingOffscreenDocument;
	} else {
		creatingOffscreenDocument = chromeAPI.offscreen.createDocument({
			url: OFFSCREEN_DOCUMENT_PATH,
			reasons: ["BLOBS", "CLIPBOARD"],
			justification: "Create blob URLs for downloads and viewer tabs, and copy saved pages to the clipboard."
		});
		try {
			await creatingOffscreenDocument;
		} finally {
			creatingOffscreenDocument = null;
		}
	}
}
