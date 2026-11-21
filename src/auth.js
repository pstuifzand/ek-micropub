/* Classic script shared by Firefox background pages and Chromium workers. */
(function (root) {
  'use strict';
  const api = root.browser || root.chrome;
  const isFirefox = !!root.browser;
  const call = (object, method, ...args) => isFirefox
    ? object[method](...args)
    : new Promise((resolve, reject) => object[method](...args, result => {
      const error = api.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve(result);
    }));
  const secure = (value, base) => {
    let u;
    try { u = new URL(value, base); } catch { throw new Error('Invalid URL'); }
    if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Only HTTPS URLs without credentials are allowed');
    u.hash = '';
    return u.href;
  };
  const originPermission = value => `https://${new URL(secure(value)).hostname}/*`;
  async function requirePermissions(urls) {
    if (!api.permissions?.contains) return;
    for (const origin of [...new Set(urls.filter(Boolean).map(originPermission))]) {
      if (!await call(api.permissions, 'contains', {origins:[origin]})) {
        const error = new Error('Host permission required');
        error.permissionOrigin = origin;
        throw error;
      }
    }
  }
  const bytes = n => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };
  const b64 = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decode = s => s.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, x => {
    const m = {'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'};
    if (m[x.toLowerCase()]) return m[x.toLowerCase()];
    const n = x.slice(2, -1); const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : '\ufffd';
  });
  function addLink(result, rel, href, base) {
    if (!href || !rel) return;
    for (const name of rel.toLowerCase().split(/\s+/)) {
      if (['authorization_endpoint','token_endpoint','micropub','media-endpoint','indieauth-metadata'].includes(name) && !result[name]) result[name] = secure(href, base);
    }
  }
  function parseLinks(html, header, base) {
    const result = {};
    // Split link-values outside quoted strings and URI references.
    for (const part of (header || '').split(/,(?=\s*<)/)) {
      const target = part.match(/^\s*<([^>]*)>/);
      const rel = part.match(/(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i);
      if (target && rel) addLink(result, rel[1] || rel[2], target[1], base);
    }
    // Only real link/a start tags; no script text is interpreted as markup.
    const sanitized = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
    for (const tag of sanitized.matchAll(/<(?:link|a)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
      const attrs = {};
      for (const a of tag[0].matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4]);
      addLink(result, attrs.rel, attrs.href, base);
    }
    return result;
  }
  async function discover(me) {
    const url = secure(me);
    await requirePermissions([url]);
    const response = await fetch(url, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Identity discovery failed');
    const canonical = secure(response.url || url);
    const html = await response.text();
    const links = parseLinks(html, response.headers.get('link'), canonical);
    if (links['indieauth-metadata']) {
      await requirePermissions([links['indieauth-metadata']]);
      const metadataResponse = await fetch(links['indieauth-metadata'], {redirect:'error', credentials:'omit', referrerPolicy:'no-referrer'});
      if (!metadataResponse.ok) throw new Error('Identity discovery failed');
      const metadata = await metadataResponse.json();
      if (metadata.issuer) links.issuer = secure(metadata.issuer);
      if (metadata.authorization_endpoint) links.authorization_endpoint = secure(metadata.authorization_endpoint, links['indieauth-metadata']);
      if (metadata.token_endpoint) links.token_endpoint = secure(metadata.token_endpoint, links['indieauth-metadata']);
      if (Array.isArray(metadata.code_challenge_methods_supported) && !metadata.code_challenge_methods_supported.includes('S256')) throw new Error('Identity server does not support PKCE S256');
    }
    return { me: canonical, ...links };
  }
  async function storageGet() { return (await call(api.storage.local, 'get', ['session', 'clientId'])); }
  async function login(me, suppliedClientId) {
    if (suppliedClientId) await call(api.storage.local, 'set', {clientId:secure(suppliedClientId)});
    const { clientId } = await storageGet();
    if (!clientId) throw new Error('Set storage.local.clientId to your publicly hosted HTTPS IndieAuth client ID; it must register this extension redirect URI');
    const client = secure(clientId);
    const redirect = api.identity.getRedirectURL();
    const discovered = await discover(me);
    if (!discovered.authorization_endpoint || !discovered.token_endpoint || !discovered.micropub) throw new Error('Identity is missing required IndieAuth or Micropub endpoints');
    await requirePermissions([discovered.token_endpoint, discovered.micropub]);
    const state = b64(bytes(32)), verifier = b64(bytes(32));
    const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const auth = new URL(discovered.authorization_endpoint);
    for (const [k, v] of Object.entries({response_type:'code', client_id:client, redirect_uri:redirect, state, me:discovered.me, scope:'create update delete media', code_challenge:challenge, code_challenge_method:'S256'})) auth.searchParams.set(k, v);
    const returned = await call(api.identity, 'launchWebAuthFlow', {url:auth.href, interactive:true});
    if (!returned) throw new Error('Authorization was cancelled');
    const callback = new URL(returned), expected = new URL(redirect);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.hash || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== state) throw new Error('Invalid authorization callback');
    if (discovered.issuer && (callback.searchParams.getAll('iss').length !== 1 || callback.searchParams.get('iss') !== discovered.issuer)) throw new Error('Invalid authorization callback issuer');
    if (callback.searchParams.has('error')) throw new Error('Authorization denied');
    if (callback.searchParams.getAll('code').length !== 1 || !callback.searchParams.get('code')) throw new Error('Authorization code missing');
    const response = await fetch(discovered.token_endpoint, {method:'POST', redirect:'error', credentials:'omit', referrerPolicy:'no-referrer', headers:{'Content-Type':'application/x-www-form-urlencoded', 'Accept':'application/json'}, body:new URLSearchParams({grant_type:'authorization_code', code:callback.searchParams.get('code'), client_id:client, redirect_uri:redirect, code_verifier:verifier})});
    if (!response.ok) throw new Error('Token exchange failed');
    let token;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) token = await response.json();
    else token = Object.fromEntries(new URLSearchParams(await response.text()));
    if (typeof token.access_token !== 'string' || !token.access_token || typeof token.me !== 'string' || secure(token.me) !== discovered.me) throw new Error('Token response identity does not match the requested identity');
    if (token.token_type && token.token_type.toLowerCase() !== 'bearer') throw new Error('Unsupported token type');
    const session = {me:discovered.me, micropub:discovered.micropub, accessToken:token.access_token,
      authorizationEndpoint:discovered.authorization_endpoint, tokenEndpoint:discovered.token_endpoint,
      ...(discovered['indieauth-metadata'] ? {indieauthMetadata:discovered['indieauth-metadata']} : {}),
      ...(typeof token.scope === 'string' ? {scope:token.scope} : {})};
    await call(api.storage.local, 'set', {session});
    return {me:session.me};
  }
  async function getSession() {
    const {session} = await storageGet();
    if (!session || !session.accessToken || !session.me || !session.micropub) throw new Error('Not logged in');
    secure(session.me); secure(session.micropub);
    return session;
  }
  async function request(url, session, options = {}) {
    await requirePermissions([url]);
    const response = await fetch(secure(url), {...options, redirect:'error', credentials:'omit', referrerPolicy:'no-referrer', headers:{...options.headers, Authorization:`Bearer ${session.accessToken}`}});
    if (!response.ok) throw new Error(`Micropub request failed (HTTP ${response.status})`);
    return response;
  }
  async function config(session) {
    const url = new URL(session.micropub); url.searchParams.set('q','config');
    const response = await request(url.href, session, {headers:{Accept:'application/json'}});
    return response.json();
  }
  async function categories(session) {
    const url = new URL(session.micropub); url.searchParams.set('q','category');
    const data = await (await request(url.href, session, {headers:{Accept:'application/json'}})).json();
    return {categories:Array.isArray(data.categories) ? data.categories : []};
  }
  async function source(session, postUrl) {
    const url = new URL(session.micropub); url.searchParams.set('q','source'); url.searchParams.set('url', secure(postUrl));
    return (await request(url.href, session, {headers:{Accept:'application/json'}})).json();
  }
  async function action(session, name, postUrl, properties) {
    const body = {action:name, url:secure(postUrl)};
    if (name === 'update') {
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('Properties must be an object');
      body.replace = properties;
    }
    const response = await request(session.micropub, session, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    return {status:response.status};
  }
  async function publish(session, properties, h) {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('Properties must be an object');
    const content = {...properties};
    // A post is an h-entry; a highlight says so too, because the server picks
    // the post type from the named types rather than from the properties.
    const declared = h === 'highlight' ? ['h-entry', 'h-highlight'] : ['h-entry'];
    const body = {type:declared, properties:content};
    for (const key of ['mp-destination', 'mp-syndicate-to']) {
      if (Object.prototype.hasOwnProperty.call(content, key)) {
        body[key] = content[key];
        delete content[key];
      }
    }
    const response = await request(session.micropub, session, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const location = response.headers.get('location');
    return {status:response.status, location:location ? secure(location, session.micropub) : null};
  }
  async function upload(session, dataUrl, filename, mimeType) {
    const cfg = await config(session);
    if (typeof cfg['media-endpoint'] !== 'string') throw new Error('No media endpoint advertised');
    const endpoint = secure(cfg['media-endpoint'], session.micropub);
    if (typeof dataUrl !== 'string' || !/^data:[^,]*;base64,/i.test(dataUrl) || typeof filename !== 'string' || !filename || typeof mimeType !== 'string' || !mimeType) throw new Error('Invalid upload');
    let data;
    try { data = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)); } catch { throw new Error('Invalid upload data'); }
    const bytes = Uint8Array.from(data, c => c.charCodeAt(0));
    const form = new FormData(); form.append('file', new Blob([bytes], {type:mimeType}), filename);
    const response = await request(endpoint, session, {method:'POST', body:form});
    const location = response.headers.get('location');
    if (!location) throw new Error('Media response has no Location');
    return {location:secure(location, endpoint)};
  }
  async function diagnostics() {
    const {session, clientId} = await storageGet();
    const secret = typeof session?.accessToken === 'string' ? session.accessToken : '';
    const clean = value => typeof value === 'string' ? (secret ? value.split(secret).join('[redacted]') : value) : null;
    const info = {clientId:clean(clientId), redirect:clean(api.identity.getRedirectURL()), session:null};
    if (session?.me && session?.micropub && secret) {
      info.session = {};
      for (const key of ['me', 'micropub', 'authorizationEndpoint', 'tokenEndpoint', 'indieauthMetadata', 'scope']) info.session[key] = clean(session[key]);
    }
    return info;
  }
  async function diagnosticConfig() {
    const session = await getSession();
    const result = await config(session);
    const redact = (value, key = '') => {
      if (/(?:access.?token|authorization|code.?verifier|(?:^|[_-])code(?:$|[_-])|secret|password|draft)/i.test(key)) return '[redacted]';
      if (typeof value === 'string') return value.split(session.accessToken).join('[redacted]');
      if (Array.isArray(value)) return value.map(item => redact(item));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
      return value;
    };
    return redact(result);
  }
  async function logout() { await call(api.storage.local, 'remove', 'session'); }
  root.EkAuth = {login, logout, getSession, config, categories, source, action, originPermission, diagnostics, diagnosticConfig, publish, upload, parseLinks, discover, secure};
})(globalThis);
