/* Load auth.js first in Firefox's background.scripts; Chromium workers import it here. */
if (!globalThis.EkAuth && typeof importScripts === 'function') importScripts('auth.js');
if (typeof importScripts === 'function') importScripts('capture.js');
const extensionApi = globalThis.browser || globalThis.chrome;
async function handleMessage(message) {
  try {
    if (!globalThis.EkAuth) throw new Error('Authentication backend not loaded');
    const auth = globalThis.EkAuth;
    switch (message && message.type) {
      case 'login': return {ok:true, ...await auth.login(message.me, message.clientId)};
      case 'logout': await auth.logout(); return {ok:true};
      case 'session': {
        try { const session = await auth.getSession(); return {ok:true, session:{me:session.me}}; }
        catch (e) { if (e.message === 'Not logged in') return {ok:true, session:null}; throw e; }
      }
      case 'config': return {ok:true, config:await auth.config(await auth.getSession())};
      case 'permissions-needed': return {ok:true, permissionOrigin:auth.originPermission(message.me)};
      case 'categories': return {ok:true, ...await auth.categories(await auth.getSession())};
      case 'source': return {ok:true, source:await auth.source(await auth.getSession(), message.url)};
      case 'update': return {ok:true, ...await auth.action(await auth.getSession(), 'update', message.url, message.replace)};
      case 'delete': return {ok:true, ...await auth.action(await auth.getSession(), 'delete', message.url)};
      case 'undelete': return {ok:true, ...await auth.action(await auth.getSession(), 'undelete', message.url)};
      case 'diagnostics': return {ok:true, ...await auth.diagnostics()};
      case 'diagnostic-config': return {ok:true, config:await auth.diagnosticConfig()};
      case 'publish': return {ok:true, ...await auth.publish(await auth.getSession(), message.properties)};
      case 'upload': return {ok:true, ...await auth.upload(await auth.getSession(), message.dataUrl, message.filename, message.mimeType)};
      default: return {ok:false, error:'Unknown message type'};
    }
  } catch (e) {
    if (e?.permissionOrigin) return {ok:false, error:'Host permission required', permissionOrigin:e.permissionOrigin};
    const safe = /^(Set storage\.local\.clientId|Only HTTPS URLs|Invalid URL|Identity discovery failed|Identity is missing|Authorization was cancelled|Invalid authorization callback|Authorization denied|Authorization code missing|Token exchange failed|Token response identity|Unsupported token type|Not logged in|Micropub request failed \(HTTP \d+\)|Properties must|No media endpoint|Invalid upload|Media response has no Location|Authentication backend not loaded)/;
    return {ok:false, error:typeof e?.message === 'string' && safe.test(e.message) ? e.message : 'Request failed'};
  }
}
// Returning true keeps Chromium's callback channel alive; also works in Firefox.
extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse, () => sendResponse({ok:false, error:'Request failed'}));
  return true;
});
