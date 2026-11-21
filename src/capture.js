/* Classic background script. The composer consumes pendingCapture explicitly. */
(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  if (!api?.contextMenus || !api?.runtime || !api?.tabs || !api?.storage?.local) return;
  const promiseApi = !!globalThis.browser;
  const definitions = [
    ['bookmark-page', 'Bookmark page', ['page'], 'bookmark', 'page'],
    ['reply-page', 'Reply to page', ['page'], 'reply', 'page'],
    ['like-page', 'Like page', ['page'], 'like', 'page'],
    ['bookmark-link', 'Bookmark link', ['link'], 'bookmark', 'link'],
    ['reply-link', 'Reply to link', ['link'], 'reply', 'link'],
    ['like-link', 'Like link', ['link'], 'like', 'link'],
    ['quote-selection', 'Quote selection', ['selection'], 'quote', 'selection'],
    ['highlight-selection', 'Highlight selection', ['selection'], 'highlight', 'selection'],
    ['bookmark-image', 'Bookmark image', ['image'], 'bookmark', 'image'],
    ['like-image', 'Like image', ['image'], 'like', 'image']
  ];
  const prefix = 'ek-capture-';
  function call(object, method, ...args) {
    if (promiseApi) {
      try { return Promise.resolve(object[method](...args)); } catch (error) { return Promise.reject(error); }
    }
    return new Promise((resolve, reject) => {
      try {
        object[method](...args, result => {
          const error = api.runtime.lastError;
          if (error) reject(new Error(error.message)); else resolve(result);
        });
      } catch (error) { reject(error); }
    });
  }
  function safeUrl(value) {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
    } catch (_) { return ''; }
  }
  async function register() {
    for (const [id, title, contexts] of definitions) {
      // Remove only our own IDs, retaining menus owned by other components.
      try { await call(api.contextMenus, 'remove', prefix + id); } catch (_) {}
      await call(api.contextMenus, 'create', {id:prefix + id, title, contexts});
    }
  }
  // Serialize install/startup events, which can arrive close together.
  let registration = Promise.resolve();
  function scheduleRegistration() {
    registration = registration.catch(() => {}).then(register).catch(error => console.error('Capture menu registration failed', error));
  }
  api.runtime.onInstalled.addListener(scheduleRegistration);
  api.runtime.onStartup.addListener(scheduleRegistration);
  let captures = Promise.resolve();
  api.contextMenus.onClicked.addListener((info, tab) => {
    const definition = definitions.find(item => prefix + item[0] === info.menuItemId);
    if (!definition) return;
    captures = captures.catch(() => {}).then(async () => {
      const [, , , kind, source] = definition;
      const target = safeUrl(source === 'link' ? info.linkUrl : source === 'image' ? info.srcUrl : info.pageUrl);
      if (!target) return;
      // A quote is prose and gets the blockquote marks; a highlight is a
      // passage kept verbatim, and the site does the quoting.
      const marked = source === 'selection' && typeof info.selectionText === 'string'
        ? (kind === 'highlight' ? info.selectionText : info.selectionText.split(/\r?\n/).map(line => `> ${line}`).join('\n'))
        : '';
      const pendingCapture = {kind, target, content:marked, title:kind === 'bookmark' && source !== 'page' ? '' : (typeof tab?.title === 'string' ? tab.title : '')};
      const existing = await call(api.storage.local, 'get', ['pendingCapture', 'stagedCapture']);
      // Never silently replace a capture the composer has not consumed.
      if (existing?.pendingCapture || existing?.stagedCapture) {
        await call(api.tabs, 'create', {url:api.runtime.getURL('src/popup.html?capture=1&captureConflict=1')});
        return;
      }
      if (kind === 'bookmark' && source === 'page' && Number.isInteger(tab?.id) && api.scripting?.executeScript) {
        try {
          const results = await call(api.scripting, 'executeScript', {
            target:{tabId:tab.id},
            func:() => {
              const description = document.querySelector('meta[name="description" i]')?.getAttribute('content')?.trim() ||
                document.querySelector('meta[property="og:description" i]')?.getAttribute('content')?.trim() || '';
              return {url:location.href, title:document.title, description};
            }
          });
          const metadata = results?.[0]?.result;
          if (metadata?.url === target) {
            if (typeof metadata.title === 'string' && metadata.title) pendingCapture.title = metadata.title;
            if (typeof metadata.description === 'string' && metadata.description) pendingCapture.description = metadata.description;
          }
        } catch (_) {} // Restricted pages and missing permissions still produce a usable capture.
        // Another composer may stage a capture while the script is running.
        const latest = await call(api.storage.local, 'get', ['pendingCapture', 'stagedCapture']);
        if (latest?.pendingCapture || latest?.stagedCapture) {
          await call(api.tabs, 'create', {url:api.runtime.getURL('src/popup.html?capture=1&captureConflict=1')});
          return;
        }
      }
      await call(api.storage.local, 'set', {pendingCapture});
      await call(api.tabs, 'create', {url:api.runtime.getURL('src/popup.html?capture=1')});
    }).catch(error => console.error('Capture failed', error));
  });
  if (api.action?.onClicked) api.action.onClicked.addListener(() => {
    call(api.tabs, 'create', {url:api.runtime.getURL('src/popup.html')}).catch(error => console.error('Could not open composer', error));
  });
})();
