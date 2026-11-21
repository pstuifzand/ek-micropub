/* Popup/backend boundary: responses are {ok, ...}; see the integration notes in
 * the handoff. Optional Micropub properties are never sent until selected. */
'use strict';
const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
const draftKey = 'micropubPopupDraft';
const fields = ['kind', 'title', 'target', 'content', 'categories', 'status'];
let photos = [];
let currentPage = '';
let saving = Promise.resolve();
let drafts = {};
let activeDraft = 'Default';
let pendingCapture = null;
let categoryNames = [];

function call(object, method, ...args) {
  if (!object || typeof object[method] !== 'function') return Promise.reject(new Error(`${method} is unavailable in this browser.`));
  if (globalThis.browser) return Promise.resolve(object[method](...args));
  return new Promise((resolve, reject) => object[method](...args, value => {
    const error = api.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(value);
  }));
}
let missingOrigin = '';
async function message(payload) {
  const result = await call(api.runtime, 'sendMessage', payload);
  if (result?.permissionOrigin) { missingOrigin = result.permissionOrigin; $('grant-host').hidden = false; $('grant-host').textContent = `Allow access to ${missingOrigin}`; throw new Error(`Site access required: ${missingOrigin}`); }
  if (!result || !result.ok) throw new Error(result?.error || 'No response from the extension.');
  return result;
}
$('grant-host').addEventListener('click', async () => {
  try {
    const granted = await call(api.permissions, 'request', {origins:[missingOrigin]});
    if (!granted) throw new Error('Site access was not granted.');
    $('grant-host').hidden = true; missingOrigin = '';
    notice('Access granted. Please repeat the action.');
  } catch (error) { notice(error.message, true); }
});
function notice(text, error = false, url = '') {
  const el = $('notice'); el.hidden = false; el.classList.toggle('error', error); el.textContent = text;
  if (url && /^https?:\/\//i.test(url)) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = ' View post ↗'; el.append(a); }
}
function show(view) { for (const id of ['loading', 'login-view', 'compose-view']) $(id).hidden = id !== view; $('logout').hidden = view !== 'compose-view'; }
function updateKind() {
  const kind = $('kind').value;
  $('title-field').hidden = kind !== 'article';
  $('target-field').hidden = !['bookmark', 'reply', 'like', 'repost'].includes(kind);
  $('target-label').textContent = ({bookmark:'Bookmark URL',reply:'Reply to',like:'Like URL',repost:'Repost URL'})[kind] || 'URL';
  $('target').required = !$('target-field').hidden;
}
function draft() { return {...Object.fromEntries(fields.map(id => [id, $(id).value])), photos, destination: $('destination').value, syndication: [...document.querySelectorAll('#syndication input:checked')].map(x => x.value)}; }
function saveDraft() {
  const value = draft(), name = activeDraft;
  drafts[name] = value;
  const snapshot = {...drafts};
  if (api?.storage?.local) saving = saving.catch(() => {}).then(() => call(api.storage.local, 'set', {micropubDrafts: snapshot, micropubActiveDraft: name, [draftKey]: value})).then(() => { $('draft-hint').textContent = 'Draft saved on this device'; }).catch(() => { $('draft-hint').textContent = 'Draft could not be saved on this device'; });
  return saving;
}
function renderDraftNames() {
  $('draft-select').replaceChildren();
  for (const name of Object.keys(drafts)) { const option = document.createElement('option'); option.value = name; option.textContent = name; $('draft-select').append(option); }
  $('draft-select').value = activeDraft;
}
function loadDraft(saved = {}) {
  $('compose-form').reset();
  for (const id of fields) if (typeof saved[id] === 'string') $(id).value = saved[id];
  if (!$('kind').value && $('kind').options.length) $('kind').selectedIndex = 0;
  photos = Array.isArray(saved.photos) ? saved.photos.filter(x => typeof x === 'string' || (x && typeof x.value === 'string')) : [];
  $('destination').value = saved.destination || '';
  document.querySelectorAll('#syndication input').forEach(x => { x.checked = (saved.syndication || []).includes(x.value); });
  renderPhotos(); updateKind();
}
function renderPhotos() {
  $('photos').replaceChildren();
  photos.forEach((photo, index) => {
    const url = typeof photo === 'string' ? photo : photo.value;
    const row = document.createElement('div'); row.className = 'photo-row';
    const image = document.createElement('img'); image.src = url; image.alt = ''; image.referrerPolicy = 'no-referrer';
    const label = document.createElement('label'); label.textContent = 'Alt text';
    const alt = document.createElement('input'); alt.placeholder = 'Describe this photo'; alt.value = typeof photo === 'string' ? '' : (photo.alt || '');
    alt.addEventListener('input', () => { photos[index] = alt.value ? {value:url, alt:alt.value} : url; saveDraft(); }); label.append(alt);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = 'Remove'; button.addEventListener('click', () => { photos.splice(index, 1); renderPhotos(); saveDraft(); });
    row.append(image, label, button); $('photos').append(row);
  });
}
function choices(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => typeof item === 'string' ? {uid:item,name:item} : {uid:item.uid || item.type || item.url || item.id, name:item.name || item.title || item.uid || item.type || item.url || item.id}).filter(x => typeof x.uid === 'string' && x.uid);
}
function configure(result, saved) {
  const config = result.config || result;
  const destinations = choices(config.destination || config.destinations);
  const targets = choices(config['syndicate-to'] || config.syndication || config.syndicateTo);
  const types = choices(config['post-types'] || config.postTypes);
  if (types.length) {
    const supported = new Set(['note','article','bookmark','reply','like','repost']);
    const available = types.filter(x => supported.has(x.uid));
    if (available.length) { $('kind').replaceChildren(); for (const item of available) { const option = document.createElement('option'); option.value = item.uid; option.textContent = item.name; $('kind').append(option); } if (saved?.kind && available.some(x => x.uid === saved.kind)) $('kind').value = saved.kind; updateKind(); }
  }
  $('destination').replaceChildren($('destination').options[0]); $('syndication').replaceChildren();
  for (const item of destinations) { const option = document.createElement('option'); option.value = item.uid; option.textContent = item.name; $('destination').append(option); }
  $('destination-field').hidden = !destinations.length;
  if (saved?.destination) $('destination').value = saved.destination;
  for (const item of targets) { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.uid; input.checked = (saved?.syndication || []).includes(item.uid); label.append(input, document.createTextNode(item.name)); $('syndication').append(label); }
  $('syndication-field').hidden = !targets.length;
  $('upload-field').hidden = !(config['media-endpoint'] || config.mediaEndpoint || config.uploadAvailable);
}
async function initialize() {
  if (!api?.runtime) { show('login-view'); notice('Extension APIs are unavailable. Open this page from the installed extension.', true); return; }
  let saved = {};
  try { if (api.storage?.local) { const values = await call(api.storage.local, 'get', [draftKey, 'clientId', 'micropubDrafts', 'micropubActiveDraft', 'pendingCapture', 'stagedCapture']); drafts = values.micropubDrafts || {}; activeDraft = values.micropubActiveDraft || 'Default'; saved = drafts[activeDraft] || values[draftKey] || {}; drafts[activeDraft] = saved; pendingCapture = values.pendingCapture || values.stagedCapture || null; if (values.pendingCapture) { await call(api.storage.local, 'set', {stagedCapture: values.pendingCapture}); await call(api.storage.local, 'remove', 'pendingCapture'); } renderDraftNames(); $('setup-note').hidden = !!values.clientId; } } catch (_) { /* composer still works without persistence */ }
  loadDraft(saved); if (pendingCapture) $('capture-prompt').hidden = false;
  try {
    const session = await message({type:'session'});
    const data = session.session || session;
    if (!(data.me || data.authenticated || data.loggedIn)) { show('login-view'); return; }
    $('identity').textContent = data.me || 'Connected'; show('compose-view');
    try { configure(await message({type:'config'}), saved); } catch (_) { notice('Could not load site options. Publishing will use your server defaults.', true); }
    loadCategories();
    if (pendingCapture && !fields.some(id => id !== 'kind' && $(id).value.trim()) && !photos.length) applyCapture(false);
    try { const tabs = await call(api.tabs, 'query', {active:true, currentWindow:true}); currentPage = tabs[0]?.url || ''; } catch (_) { /* tab access is optional */ }
  } catch (error) { show('login-view'); notice(error.message, true); }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter || $('login-form').querySelector('[type="submit"]'); button.disabled = true;
  try {
    const {clientId} = await call(api.storage.local, 'get', 'clientId');
    if (!clientId) { $('setup-note').hidden = false; throw new Error('Set up the client ID in Diagnostics first.'); }
    const response = await message({type:'login', me:$('me').value.trim()});
    const data = response.session || response; $('identity').textContent = data.me || $('me').value.trim(); show('compose-view'); $('notice').hidden = true;
    try { configure(await message({type:'config'}), {}); } catch (_) { notice('Could not load site options. Publishing will use your server defaults.', true); }
    loadCategories();
    try { const tabs = await call(api.tabs, 'query', {active:true,currentWindow:true}); currentPage = tabs[0]?.url || ''; } catch (_) {}
  } catch (error) { notice(error.message, true); } finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => { $('logout').disabled = true; try { await message({type:'logout'}); show('login-view'); notice('Signed out. Your local draft is still available.'); } catch (error) { notice(error.message, true); } finally { $('logout').disabled = false; } });
$('compose-form').addEventListener('input', saveDraft);
$('compose-form').addEventListener('change', saveDraft);
$('kind').addEventListener('change', updateKind);
$('use-page').addEventListener('click', () => { if (currentPage && /^https?:/i.test(currentPage)) { $('target').value = currentPage; saveDraft(); } else notice('The current page URL is unavailable.', true); });
$('use-selection').addEventListener('click', async () => {
  try { const tabs = await call(api.tabs, 'query', {active:true,currentWindow:true}); if (!tabs[0]?.id) throw new Error('No active tab is available.'); const result = await call(api.scripting, 'executeScript', {target:{tabId:tabs[0].id}, func:() => window.getSelection().toString()}); const text = result?.[0]?.result; if (!text) throw new Error('No text is selected on this page.'); $('content').value += ($('content').value ? '\n\n' : '') + text; saveDraft(); } catch (error) { notice(`Could not read selection: ${error.message}`, true); }
});
async function uploadFile(file) {
  if (!file || !file.type.startsWith('image/')) { notice('Choose an image first.', true); return; }
  $('upload').disabled = true; $('upload-progress').textContent = `Uploading ${file.name || 'image'}…`;
  try {
    const dataUrl = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read the file.')); reader.readAsDataURL(file); });
    const response = await message({type:'upload', dataUrl, filename:file.name || 'image.png', mimeType:file.type}); const url = response.url || response.location;
    if (!url) throw new Error('The upload returned no media URL.'); photos.push(url); renderPhotos(); await saveDraft(); $('file').value = ''; notice('Photo uploaded.');
  } catch (error) { notice(error.message, true); } finally { $('upload').disabled = false; $('upload-progress').textContent = ''; }
}
$('upload').addEventListener('click', () => uploadFile($('file').files[0]));
$('compose-form').addEventListener('paste', event => { const file = [...(event.clipboardData?.files || [])].find(x => x.type.startsWith('image/')); if (file && !$('upload-field').hidden) { event.preventDefault(); uploadFile(file); } });
$('compose-form').addEventListener('dragover', event => { if (!$('upload-field').hidden && [...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
$('compose-form').addEventListener('drop', event => { const file = [...(event.dataTransfer?.files || [])].find(x => x.type.startsWith('image/')); if (file && !$('upload-field').hidden) { event.preventDefault(); uploadFile(file); } });
async function loadCategories() {
  try { const result = await message({type:'categories'}); categoryNames = (result.categories || []).map(item => typeof item === 'string' ? item : item.name).filter(Boolean); suggestCategories(); } catch (_) { /* categories are optional */ }
}
function suggestCategories() { const parts = $('categories').value.split(','); const prefix = parts.length > 1 ? parts.slice(0,-1).join(',') + ', ' : ''; $('category-options').replaceChildren(); for (const name of categoryNames) { const option = document.createElement('option'); option.value = prefix + name; $('category-options').append(option); } }
$('categories').addEventListener('input', suggestCategories);
$('draft-select').addEventListener('change', async () => { const next = $('draft-select').value; await saveDraft(); activeDraft = next; loadDraft(drafts[next]); await saveDraft(); });
$('new-draft').addEventListener('click', async () => { const name = prompt('Name for the new draft:')?.trim(); if (!name) return; if (Object.hasOwn(drafts, name)) { notice('A draft with that name already exists.', true); return; } await saveDraft(); activeDraft = name; drafts[name] = {}; renderDraftNames(); loadDraft(); await saveDraft(); });
$('clear-draft').addEventListener('click', async () => { if (!confirm('Clear this draft? This cannot be undone.')) return; loadDraft(); await saveDraft(); });
$('popout').addEventListener('click', async () => { await saveDraft(); await call(api.tabs, 'create', {url:api.runtime.getURL('src/popup.html')}); });
function applyCapture(ask = true) { if (!pendingCapture) return; if (ask && (fields.some(id => id !== 'kind' && $(id).value.trim()) || photos.length) && !confirm('Apply this capture and replace the current draft fields?')) return; const c = pendingCapture; const kind = c.kind === 'quote' ? 'reply' : c.kind; if (typeof kind === 'string' && [...$('kind').options].some(x => x.value === kind)) $('kind').value = kind; for (const id of ['target','content','title']) if (typeof c[id] === 'string') $(id).value = c[id]; pendingCapture = null; call(api.storage.local, 'remove', 'stagedCapture').catch(() => {}); $('capture-prompt').hidden = true; updateKind(); saveDraft(); }
$('apply-capture').addEventListener('click', () => applyCapture());
document.querySelectorAll('[data-wrap]').forEach(button => button.addEventListener('click', () => { const el = $('content'), start = el.selectionStart, end = el.selectionEnd, wrap = button.dataset.wrap; el.setRangeText(wrap + el.value.slice(start,end) + wrap, start, end, 'select'); el.focus(); saveDraft(); }));
function renderPreview() {
  const preview = $('preview'); preview.replaceChildren();
  // Build DOM nodes, never HTML: raw markup and unsafe links remain plain text.
  const text = $('content').value, pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let position = 0, match;
  while ((match = pattern.exec(text))) { preview.append(document.createTextNode(text.slice(position, match.index))); const token = match[0], tag = token.startsWith('**') ? 'strong' : token.startsWith('*') ? 'em' : 'code', edge = tag === 'strong' ? 2 : 1; const el = document.createElement(tag); el.textContent = token.slice(edge,-edge); preview.append(el); position = pattern.lastIndex; }
  preview.append(document.createTextNode(text.slice(position)));
}
$('preview-toggle').addEventListener('click', () => { $('preview').hidden = !$('preview').hidden; if (!$('preview').hidden) renderPreview(); });
$('content').addEventListener('input', () => { if (!$('preview').hidden) renderPreview(); });
$('compose-form').addEventListener('submit', async event => {
  event.preventDefault(); const properties = {}; const kind = $('kind').value; const content = $('content').value.trim(); const title = $('title').value.trim(); const target = $('target').value.trim();
  if (content) properties.content = [content]; if (kind === 'article' && title) properties.name = [title];
  const targetProperty = {bookmark:'bookmark-of', reply:'in-reply-to', like:'like-of', repost:'repost-of'}[kind]; if (targetProperty && target) properties[targetProperty] = [target];
  const categories = $('categories').value.split(',').map(x => x.trim()).filter(Boolean); if (categories.length) properties.category = categories;
  if ($('status').value) properties['post-status'] = [$('status').value]; if ($('destination').value) properties['mp-destination'] = [$('destination').value];
  const syndication = [...document.querySelectorAll('#syndication input:checked')].map(x => x.value); if (syndication.length) properties['mp-syndicate-to'] = syndication; if (photos.length) properties.photo = [...photos];
  if (!content && !title && !targetProperty && !photos.length) { notice('Add some content before publishing.', true); return; }
  const submittedDraft = JSON.stringify(draft());
  $('publish').disabled = true;
  try { const response = await message({type:'publish', properties}); const url = response.url || response.location; notice(response.status === 202 || response.accepted ? 'Accepted by your server; processing may still be pending.' : 'Your server accepted the post.', false, url); if (JSON.stringify(draft()) === submittedDraft) { loadDraft(); saveDraft(); } } catch (error) { notice(`${error.message} Your draft is preserved. If the result is uncertain, check your site before retrying to avoid a duplicate.`, true); } finally { $('publish').disabled = false; }
});
initialize();
