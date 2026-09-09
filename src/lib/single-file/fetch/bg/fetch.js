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

/* global browser, fetch */

const referrers = new Map();
const REQUEST_ID_HEADER_NAME = "x-single-file-request-id";
const MAX_CONTENT_SIZE = 8 * (1024 * 1024);

export {
	REQUEST_ID_HEADER_NAME,
	referrers,
	fetchResource
};

// injectReferrer/clearInjectedReferrer live in requests.js, which also imports from this module.
// The cycle is safe: these bindings are only read at call time, not during module evaluation.
import { injectReferrer, clearInjectedReferrer } from "../../../../core/bg/requests.js";

browser.runtime.onMessage.addListener((message, sender) => {
	if (message.method && message.method.startsWith("singlefile.fetch")) {
		return new Promise(resolve => {
			onRequest(message, sender)
				.then(resolve)
				.catch(error => resolve({ error: error && (error.message || error.toString()) }));
		});
	}
});

async function onRequest(message, sender) {
	if (message.method == "singlefile.fetch") {
		try {
			const response = await fetchResource(message.url, { referrer: message.referrer, headers: message.headers });
			return sendResponse(sender.tab.id, message.requestId, response);
		} catch (error) {
			return sendResponse(sender.tab.id, message.requestId, { error: error.message, array: [] });
		}
	} else if (message.method == "singlefile.fetchFrame") {
		return browser.tabs.sendMessage(sender.tab.id, message);
	}
}

async function sendResponse(tabId, requestId, response) {
	for (let blockIndex = 0; blockIndex * MAX_CONTENT_SIZE <= response.array.length; blockIndex++) {
		const message = {
			method: "singlefile.fetchResponse",
			requestId,
			headers: response.headers,
			status: response.status,
			error: response.error
		};
		message.truncated = response.array.length > MAX_CONTENT_SIZE;
		if (message.truncated) {
			message.finished = (blockIndex + 1) * MAX_CONTENT_SIZE > response.array.length;
			message.array = response.array.slice(blockIndex * MAX_CONTENT_SIZE, (blockIndex + 1) * MAX_CONTENT_SIZE);
		} else {
			message.array = response.array;
		}
		await browser.tabs.sendMessage(tabId, message);
	}
	return {};
}

async function fetchResource(url, options = {}, includeRequestId) {
	// A service worker (Chromium MV3) has no XMLHttpRequest, so use fetch(). On Firefox's
	// persistent background page fetch() works too, so this single path serves both. The
	// former xhr.withCredentials = true maps to credentials: "include".
	const requestInit = {
		method: "GET",
		credentials: "include",
		headers: {}
	};
	if (options.headers) {
		for (const entry of Object.entries(options.headers)) {
			requestInit.headers[entry[0]] = entry[1];
		}
	}
	let randomId, referrerRuleId;
	if (includeRequestId) {
		// The Referer header cannot be set through fetch() (it is a forbidden header name), so
		// tag the request with a lookup id and let the referer helper inject the real Referer
		// (via declarativeNetRequest on Chromium / blocking webRequest on Firefox).
		randomId = String(Math.random()).substring(2);
		setReferrer(randomId, options.referrer);
		requestInit.headers[REQUEST_ID_HEADER_NAME] = randomId;
		referrerRuleId = await injectReferrer(randomId);
	}
	let response;
	try {
		response = await fetch(url, requestInit);
	} catch (error) {
		throw new Error(error.message || String(error), { cause: error });
	} finally {
		if (referrerRuleId !== undefined) {
			await clearInjectedReferrer(referrerRuleId);
		}
	}
	const status = response.status;
	if ((status == 401 || status == 403 || status == 404) && !includeRequestId) {
		return fetchResource(url, options, true);
	}
	const arrayBuffer = await response.arrayBuffer();
	if (!status && !arrayBuffer.byteLength) {
		throw new Error("Empty response");
	}
	return {
		arrayBuffer,
		array: Array.from(new Uint8Array(arrayBuffer)),
		headers: { "content-type": response.headers.get("Content-Type") },
		status
	};
}

function setReferrer(requestId, referrer) {
	referrers.set(requestId, referrer);
}