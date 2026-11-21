# ek-micropub

A work-in-progress browser extension for publishing to your own Micropub server from Firefox and Chromium. The initial goal is a small, configurable text-post composer that leaves publishing decisions to the server unless you explicitly choose otherwise. See [the plan and review checklist](docs/plan.md) for scope and verification. Features described there are targets, not a claim that they work yet.

## Development installation

Run `npm test` and `npm run build` with Node.js 20 or newer. The build produces `dist/firefox/` and `dist/chromium/`.

- **Firefox:** open `about:debugging`, choose **This Firefox**, then **Load Temporary Add-on** and select `dist/firefox/manifest.json`. The add-on is removed when Firefox restarts; use **Reload** after changes.[3]
- **Chromium/Chrome:** open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chromium/`. Reload the extension after changes.[4]

Temporary and unpacked builds are for development; a successful load does not prove authentication or publishing works. Firefox temporary-install behavior can differ from a signed installation.[3]

Open **Diagnostics** from the popup for client setup and details about the signed-in site. The page is local to the extension; its site configuration can contain sensitive information, so review it before sharing.

The composer supports notes, articles, bookmarks, replies, likes and reposts; a current-page link or selected text; categories; photo uploads; and server-advertised syndication and destinations. Fields left at “Server default” are omitted rather than forcing a client preference. Drafts are stored locally in the browser profile. Sign-out deletes the local token but does not revoke it at the issuer.

Current limitations: this is an early development build, not a complete Micropub client. Multiple accounts, offline queues, issuer-side revocation, and comprehensive server interoperability are not implemented. `q=config` is optional; if it fails, site-specific choices and uploads are unavailable. HTTPS host access is requested per discovered host, and the extension requests `create update delete media` authorization scopes. Authenticated requests and identity discovery do not follow redirects; enter the site's final HTTPS URL. A failed publish retains the form and is never automatically retried; check your site before retrying. Multiple simultaneously open composers can overwrite local draft changes; use one at a time. No real account has yet been used to verify this build end to end.

## Identity and security

IndieAuth uses a resolvable HTTP(S) URL as `client_id`, not an extension ID or a secret. A deployer must control and publish that client URL and its metadata, including exact cross-host browser redirect URLs. The browser-specific redirect and stable extension identity must be established before a real authorization flow can be relied on; no public client URL or deployment is assumed here.[2][5]

An extension cannot keep a bundled client secret secret. Access tokens grant publishing authority: use HTTPS, request minimal scopes, avoid logging or syncing tokens, and protect the browser profile. Browser extension storage is not a secure vault against someone with access to the profile or a compromised extension. Test with a disposable account or token first. Do not paste tokens into bug reports or screenshots.

## Sources

[2] https://indieauth.spec.indieweb.org
[3] https://www.extensionworkshop.com/documentation/develop/temporary-installation-in-firefox
[4] https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world
[5] https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity
