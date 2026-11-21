# Plan and independent review guide

## First usable slice (target, not a feature inventory)

1. Configure a profile URL and discover Micropub and IndieAuth endpoints. Support HTML and HTTP Link discovery, relative URLs and redirects; prefer IndieAuth metadata, with legacy authorization/token links as a compatibility fallback.[1][2] If discovery or browser permissions fail, show a useful error rather than guess endpoints. Manual endpoint configuration can be offered as an explicit override.
2. Connect using authorization code flow with PKCE and a user-controlled, resolvable client identity; ask for `create` scope only for basic publishing. Validate state, issuer where applicable, redirect and the returned identity against the discovered flow before retaining a token.[2] See identity deployment below. A manually provisioned bearer token, if offered, is a separate development path, not IndieAuth.
3. Compose and explicitly submit a UTF-8 plain-text `h=entry` using `application/x-www-form-urlencoded` with `content`, authenticated by bearer header.[1] Allow optional fields only when deliberately supplied; omit empty or unset properties rather than inventing a title, post status, visibility, category, syndication target, or timestamp. In particular, omitting status means **server default**, not necessarily draft or public. Explain that publishing may be public and require an explicit submit.
4. Recognize `201 Created` and `202 Accepted` with `Location`, show the returned URL and distinguish accepted from completed; surface errors without exposing credentials. A timeout or ambiguous failure is not evidence the post failed: retain the text and warn before retrying to avoid duplicates.[1]
5. Query `q=config` when supported, preserving any existing endpoint query string, and use advertised options as capabilities rather than mandatory defaults. An unavailable or unsupported config query should not prevent basic text posting.[1] Only send a destination or syndication target after an explicit selection.

Work can be staged: a compose UI and manually configured endpoint/token may be built before discovery or IndieAuth, but the full slice is not complete until its authentication, publishing, and cross-browser checks pass. Do not call the extension standards-conformant on the basis of a partial implementation.

## Public client identity and deployment

The IndieAuth client identifier is a resolvable HTTP(S) URL with client metadata, not a browser extension identifier. The living standard recommends a JSON client metadata document including its `client_id`, `client_uri` and redirect URIs; for a cross-host or custom-scheme redirect, publish the exact redirect URI in client metadata. The specification also documents HTML `rel=redirect_uri` as an alternative for a web-page client ID and notes older HTML client metadata for compatibility.[2]

The maintainer must choose and control a real client URL, publish metadata at that URL, determine each browser's actual redirect URL, and publish exact values before testing with an authorization server. If using browser identity APIs, redirect URLs depend on extension IDs; Firefox temporary IDs can change unless explicitly set.[5] Stable IDs, including development versus release IDs and browser-specific distribution, need a deliberate setup. An unpacked development install may need its own published redirect or a separately controlled development client URL. Do not imply an example domain is a usable identity. Verify interoperability with the intended authorization server: metadata formats and redirect policies vary.

IndieAuth clients must use PKCE; use fresh cryptographically random state and verifier per attempt, `S256`, verify the response and bind the transaction to the discovered server. Never embed a client secret in distributed extension code.[2] Tokens are bearer credentials: keep them out of URLs, logs, sync storage, web pages and screenshots; restrict extension permissions and message handlers, do not send credentials to arbitrary discovered redirects, and offer local disconnect/removal. Local extension storage is not an encrypted secret store. Revocation, if available, is distinct from deleting the local copy. Require HTTPS for production endpoints and avoid leaking tokens on redirects. Document any development-only exceptions explicitly.

## Independent review and test matrix

Run these against a controlled mock server before a disposable real site; record browser version, build, server and actual results. These are acceptance checks, not tests already executed.

- **Browser loading:** Firefox temporary add-on and Chromium unpacked build each load, open composer, reload successfully and report permission errors. Test Firefox restart and stable redirect identity separately.
- **Discovery:** HTML and HTTP Link headers, relative URLs, redirects, existing endpoint query strings, metadata discovery and legacy fallback; malformed, missing and conflicting endpoints fail safely. Test both browsers' host-permission behavior.
- **Authorization:** successful code exchange; reject wrong state, mismatched issuer, wrong redirect, missing/expired code and invalid PKCE; denial/cancel leaves no usable token. Check exact published redirect URI for each browser and test at least one real IndieAuth server. Inspect requests and storage for secret leakage.
- **Server defaults:** with no optional choices, inspect the actual POST: only intended properties, no default `post-status`, `published`, category, syndication or visibility; a mock server's defaults remain in effect. With explicit selections, verify only those selections appear; clearing a field removes it.
- **Wire format:** UTF-8 and special characters round-trip, `h=entry` and `content` are form-encoded, bearer token is in the Authorization header, and existing endpoint query parameters survive `q=config`. Test absent and malformed config and an endpoint without a media endpoint.[1]
- **Responses and safety:** handle 201 and 202 plus Location, error bodies, missing Location, unauthorized/forbidden, network timeout and duplicate-click attempts. Do not report acceptance as confirmed publication or retry ambiguous failures automatically; preserve the draft and redact credentials.
- **Interoperability:** use [micropub.rocks](https://micropub.rocks/) where appropriate and a disposable real Micropub server; verify the published post and the actual server defaults independently. Avoid claiming untested server or browser support.[1]

## Later milestones

- Optional explicit post properties and server-advertised syndication/destination selection; accessible composer and deliberate active-page capture.
- Media uploads: first query for a media endpoint; if present upload there, otherwise use multipart to the Micropub endpoint. A media endpoint may be on another host; obtain appropriate permissions without assuming same origin.[1]
- Editing, deleting, drafts, richer content and multiple accounts only after their server capabilities and authorization scopes are handled and independently tested.
- Signed releases, stable browser identities, privacy review, automated cross-browser integration tests, recovery and token revocation where supported.

## Sources

[1] https://www.w3.org/TR/micropub
[2] https://indieauth.spec.indieweb.org
[5] https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity
