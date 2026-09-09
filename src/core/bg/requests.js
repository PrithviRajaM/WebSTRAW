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

/* global browser, chrome */

import {
	REQUEST_ID_HEADER_NAME,
	referrers
} from "../../lib/single-file/fetch/bg/fetch.js";

// The Referer header cannot be set through fetch()/XHR (it is a forbidden header), so WebSTRAW
// tags a resource request with a lookup id header (REQUEST_ID_HEADER_NAME) and injects the real
// Referer just before the request goes out.
//
// - Firefox (persistent background page): a blocking webRequest.onBeforeSendHeaders listener
//   swaps the id header for the stored Referer. Manifest V2 allows blocking webRequest.
// - Chromium MV3 (Edge/Chrome): blocking webRequest is gone, so declarativeNetRequest session
//   rules do the same header modification. Because a DNR action cannot read a per-request value
//   from a JS Map, each rule matches the id header value and carries its own Referer value; the
//   rule is created just before the request and removed once consumed.

const chromeAPI = typeof chrome != "undefined" ? chrome : (typeof globalThis != "undefined" ? globalThis.chrome : undefined);
const DNR_SUPPORTED = Boolean(chromeAPI && chromeAPI.declarativeNetRequest && chromeAPI.declarativeNetRequest.updateSessionRules);
const WEB_REQUEST_SUPPORTED = Boolean(browser.webRequest && browser.webRequest.onBeforeSendHeaders);
// Session rule ids are allocated in this range so they never collide with static rules.
const DNR_RULE_ID_BASE = 100000;

let referrerOnErrorEnabled = false;
let nextRuleId = DNR_RULE_ID_BASE;
const activeRuleIds = new Set();

export {
	onMessage,
	enableReferrerOnError,
	injectReferrer,
	clearInjectedReferrer
};

function onMessage(message) {
	if (message.method.endsWith(".enableReferrerOnError")) {
		enableReferrerOnError();
		return {};
	}
	if (message.method.endsWith(".disableReferrerOnError")) {
		disableReferrerOnError();
		return {};
	}
}

// Called by fetch.js right before a tagged request. On Chromium it creates a one-shot session
// DNR rule that removes the id header and sets Referer for requests carrying that id value.
// Returns a token used to remove the rule afterwards. On Firefox this is a no-op (the global
// blocking listener handles it) and returns undefined.
async function injectReferrer(requestId) {
	if (!referrerOnErrorEnabled || !DNR_SUPPORTED) {
		return;
	}
	const referrer = referrers.get(requestId);
	if (!referrer) {
		return;
	}
	referrers.delete(requestId);
	const ruleId = nextRuleId++;
	if (nextRuleId > DNR_RULE_ID_BASE + 100000) {
		nextRuleId = DNR_RULE_ID_BASE;
	}
	activeRuleIds.add(ruleId);
	await chromeAPI.declarativeNetRequest.updateSessionRules({
		addRules: [{
			id: ruleId,
			priority: 1,
			condition: {
				requestHeaders: [{ header: REQUEST_ID_HEADER_NAME, values: [requestId] }],
				resourceTypes: ["xmlhttprequest", "other"]
			},
			action: {
				type: "modifyHeaders",
				requestHeaders: [
					{ header: REQUEST_ID_HEADER_NAME, operation: "remove" },
					{ header: "referer", operation: "set", value: referrer }
				]
			}
		}]
	});
	return ruleId;
}

async function clearInjectedReferrer(ruleId) {
	if (ruleId === undefined || !DNR_SUPPORTED) {
		return;
	}
	activeRuleIds.delete(ruleId);
	try {
		await chromeAPI.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
		// eslint-disable-next-line no-unused-vars
	} catch (error) {
		// the rule may already be gone; ignore
	}
}

function injectRefererHeader(details) {
	if (referrerOnErrorEnabled) {
		let requestIdHeader = details.requestHeaders.find(header => header.name === REQUEST_ID_HEADER_NAME);
		if (requestIdHeader) {
			details.requestHeaders = details.requestHeaders.filter(header => header.name !== REQUEST_ID_HEADER_NAME);
			const referrer = referrers.get(requestIdHeader.value);
			if (referrer) {
				referrers.delete(requestIdHeader.value);
				const header = details.requestHeaders.find(header => header.name.toLowerCase() === "referer");
				if (!header) {
					details.requestHeaders.push({ name: "Referer", value: referrer });
					return { requestHeaders: details.requestHeaders };
				}
			}
		}
	}
}

function enableReferrerOnError() {
	if (!referrerOnErrorEnabled) {
		// On Chromium MV3, per-request session rules are added on demand in injectReferrer, so
		// only the flag is flipped here. On Firefox, register the blocking webRequest listener.
		if (!DNR_SUPPORTED && WEB_REQUEST_SUPPORTED) {
			try {
				browser.webRequest.onBeforeSendHeaders.addListener(injectRefererHeader, { urls: ["<all_urls>"] }, ["blocking", "requestHeaders", "extraHeaders"]);
				// eslint-disable-next-line no-unused-vars
			} catch (error) {
				browser.webRequest.onBeforeSendHeaders.addListener(injectRefererHeader, { urls: ["<all_urls>"] }, ["blocking", "requestHeaders"]);
			}
		}
		referrerOnErrorEnabled = true;
	}
}

function disableReferrerOnError() {
	if (!DNR_SUPPORTED && WEB_REQUEST_SUPPORTED) {
		try {
			browser.webRequest.onBeforeSendHeaders.removeListener(injectRefererHeader);
			// eslint-disable-next-line no-unused-vars
		} catch (error) {
			// ignored
		}
	} else if (DNR_SUPPORTED && activeRuleIds.size) {
		const removeRuleIds = Array.from(activeRuleIds);
		activeRuleIds.clear();
		chromeAPI.declarativeNetRequest.updateSessionRules({ removeRuleIds }).catch(() => { /* ignored */ });
	}
	referrerOnErrorEnabled = false;
}
