# IndieAuth client identity: release design

## Decision

Ship a fixed, developer-controlled public HTTPS client metadata URL as the extension's default `client_id`. The user supplies only their site. Pin the Firefox add-on ID and Chromium release extension ID, obtain each browser's actual `identity.getRedirectURL()` for each release channel, and publish those **exact** callback URLs in metadata before shipping. No browser client secret is involved. This repository alone cannot make the default work: the client URL must be deployed and publicly fetchable, and its exact callbacks verified against the released browser builds. No public deployment or actual login has been performed in this investigation.

**Important correction:** Firefox's `moz-extension://` origin has a per-profile UUID, but this is not the documented identity API callback. MDN says the latter derives from the add-on ID; Mozilla's own test fixes `identity@mozilla.org` and asserts a fixed hashed callback. Therefore per-install Firefox registration is not established as necessary; with a stable add-on ID, the official evidence supports a stable callback. Temporary installs without an explicit ID can change it. Verify across fresh profiles, installs, Firefox versions and actual distribution builds before relying on this, and do not assume third-party claims that confuse the two origins. The callback can also differ for separately identified release, beta and development builds.

## Metadata to publish later

Illustrative values only; never ship these placeholders. Host `https://app.example/client.json` as `application/json`:

```json
{
  "client_id": "https://app.example/client.json",
  "client_uri": "https://app.example/",
  "client_name": "ek-micropub",
  "redirect_uris": [
    "https://ACTUAL-CHROMIUM-ID.chromiumapp.org/",
    "https://ACTUAL-FIREFOX-HASH.extensions.allizom.org/"
  ]
}
```

`client_uri` must prefix `client_id`; the `client_id` field must match the metadata URL. Record the **literal** outputs of `getRedirectURL()` including path and trailing slash; do not publish a wildcard. If IDs change in a new build, update the metadata before distributing that build; retain old callbacks while old releases remain supported, and account for server metadata caching. Older IndieAuth servers may support only HTML client metadata and `rel="redirect_uri"`; compatibility needs explicit testing and, if needed, a separately designed compatible representation at the same client URL. Merely publishing a JSON document and assuming all older servers accept it is not evidence of interoperability.

The living standard says clients SHOULD publish JSON metadata, servers SHOULD fetch it, and for cross-origin callbacks servers SHOULD verify a published callback and SHOULD block if absent. When verifying, comparison MUST be exact; its security section requires verification **or** displaying the redirect URL to the user. Consequently rejection by a strict server is a real interoperability blocker, not a claim that every conforming server must reject all unregistered redirects. There is no need for the end user to create a client ID at their own authorization server.

## Flow and security

The extension discovers the entered site's authorization, token and Micropub endpoints, uses the deployed URL as `client_id`, and uses the browser-generated exact callback as `redirect_uri`. Keep a fresh high-entropy state and PKCE S256 verifier per attempt, validate state and issuer against discovered metadata, redeem the single-use code with the same client ID, redirect and verifier, and verify the returned `me` as specified. The browser intercepts the callback; the extension exchanges the code and holds the resulting token. The fixed callback identifies the app; neither the callback nor a bundled secret authenticates an individual installation. Test errors, replay, scope and identity changes too.

Current `src/auth.js` requires a stored user-supplied `clientId`, and calls `getRedirectURL()` and `launchWebAuthFlow()`. It constructs PKCE and validates state, but does not retain and validate the discovered metadata issuer / callback `iss`; separately address that before claiming complete living-standard conformance. The release design above is not implemented or verified end-to-end here.

## Alternatives and limits

* **Hosted same-origin callback and web relay:** a public client URL and same-origin callback avoid listing browser callback URIs. A purpose-built page could pass the response back through an extension-controlled channel; an open redirect to an arbitrary browser callback is unsafe and is not a finished design. `launchWebAuthFlow` itself only completes on the browser's permitted redirect target, so this requires a carefully authenticated, state-bound handoff and browser-specific testing. A relay sees the code, and must not receive the PKCE verifier or token; secure the page against injection, logging and referrer leaks. This is an alternative architecture, not a drop-in redirect.
* **Per-install metadata:** if empirical testing finds callbacks vary, an operator-controlled service can provision a distinct public metadata URL listing that installation's exact callback. This needs a deployed service, abuse controls, lifecycle and privacy policies; registration must not let a malicious party change someone else's metadata. No wildcard is involved, but it is more operationally complex.
* **Native helper/loopback:** RFC 8252 permits loopback redirects and a dynamically chosen port for native apps. That does not override IndieAuth's exact published cross-origin redirect verification. Firefox's specially intercepted `http://127.0.0.1/mozoauth2/<derived-subdomain>` has a fixed special format, not a general extension listener. A remote authorization server MUST NOT fetch a loopback client ID, so local metadata does not solve publication; same-origin loopback client IDs may be accepted by some servers but are not a dependable public-client-identity solution and a native helper is extra installation.
* **Manual configuration** remains a development fallback, not the requested site-only experience. A public, reachable operator-controlled client page or an authorization server's explicitly supported alternative is still required for predictable cross-origin behavior. No arbitrary third-party application's client ID should be reused.

## Release verification gate

1. Capture the exact `getRedirectURL()` from actual Firefox and Chromium release packages in at least two clean profiles; test repeated installation and document pinned IDs and browser versions. Also check separate store channels and unpacked development builds.
2. Deploy only after approval; publicly GET the client ID and inspect JSON, MIME type, IDs, exact callbacks and cache headers. Test older HTML-only servers separately.
3. Exercise a disposable real issuer with strict exact-match validation, both browsers, `iss`, state and PKCE, and token exchange; test an unlisted callback is refused and failure messages are useful. Test real discovery and Micropub with appropriate permissions. Mock tests and source inspection are not proof of login.

## Sources

* [IndieAuth living standard, client identifiers, metadata, redirects, authorization and security](https://indieauth.spec.indieweb.org/).
* [MDN: WebExtensions identity API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity) and [getRedirectURL](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity/getRedirectURL).
* [Mozilla Firefox identity API test](https://searchfox.org/firefox-main/source/toolkit/components/extensions/test/mochitest/test_ext_identity.html) and [Firefox `moz-extension` UUID implementation](https://searchfox.org/firefox-main/source/toolkit/components/extensions/Extension.sys.mjs).
* [Chrome identity API](https://developer.chrome.com/docs/extensions/reference/api/identity) and [Chromium implementation overview](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/extensions/api/identity/README.md).
* [RFC 8252, OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html), especially sections 7.3 and 8.3.
