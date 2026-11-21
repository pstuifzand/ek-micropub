# Implementation checklist

- Sign-in: investigate a standards-compatible public client identity and browser callback registration; do not invent or deploy an identity without a controlled public URL.
- Capture: context menus for pages, links, selections and images; never silently overwrite a draft.
- Site-aware composer: discover post types, categories, destinations and syndication; preserve server defaults.
- Composer: pop-out editing, multiple local drafts for the one account, explicit clear, media previews and alt text.
- Failure: keep form and media intact; tell the user to check the site before trying again. Never enqueue or automatically retry a post.
- Existing posts: fetch source and allow deliberate update, deletion and undeletion; preserve untouched properties.
- Permissions: prefer host-specific optional grants; test actual permission prompts and split-origin discovery rather than relying on a mocked success.
- Verify: backend tests, Chromium extension UI and Firefox build, then a disposable server where possible. Report actual verification and external blockers.
