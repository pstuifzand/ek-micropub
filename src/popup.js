/* Popup/backend boundary: responses are {ok, ...}; see the integration notes in
 * the handoff. Optional Micropub properties are never sent until selected. */
'use strict';
const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
const draftKey = 'micropubPopupDraft';
const fields = ['kind', 'title', 'target', 'content', 'categories', 'status', 'visibility', 'description', 'note', 'source-title', 'source-author'];
let photos = [];
let currentPage = '';
let saving = Promise.resolve();
let drafts = {};
let activeDraft = 'Default';
let pendingCapture = null;
let categoryNames = [];
let visibilityUnsupported = false;

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
function show(view) { for (const id of ['loading', 'login-view', 'compose-view']) $(id).hidden = id !== view; $('logout').hidden = view !== 'compose-view'; $('edit-current').hidden = view !== 'compose-view'; }
function updateKind() {
  const kind = $('kind').value;
  const highlight = kind === 'highlight';
  $('title-field').hidden = kind !== 'article' && kind !== 'bookmark';
  $('title-label').textContent = kind === 'bookmark' ? 'Name' : 'Title';
  $('description-field').hidden = kind !== 'bookmark';
  $('target-field').hidden = !['bookmark', 'reply', 'like', 'repost', 'highlight'].includes(kind);
  $('target-label').textContent = ({bookmark:'Bookmark URL',reply:'Reply to',like:'Like URL',repost:'Repost URL',highlight:'Source URL'})[kind] || 'URL';
  $('target').required = !$('target-field').hidden;
  // A highlight keeps the passage and the note apart: the passage is the post,
  // the note is what the reader wrote beside it.
  $('source-field').hidden = !highlight;
  $('note-field').hidden = !highlight;
  $('content-label').textContent = highlight ? 'Passage' : 'Your words';
  $('content').placeholder = highlight ? 'Text you selected' : "What's on your mind?";
}
function selectedDestinations(saved) { return Array.isArray(saved) ? saved : typeof saved === 'string' && saved ? [saved] : []; }
function draft() { return {...Object.fromEntries(fields.map(id => [id, $(id).value])), photos, destination: [...document.querySelectorAll('#destination input:checked')].map(x => x.value), syndication: [...document.querySelectorAll('#syndication input:checked')].map(x => x.value)}; }
function saveDraft() {
  const value = draft(), name = activeDraft;
  Object.defineProperty(drafts, name, {value, writable:true, enumerable:true, configurable:true});
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
  document.querySelectorAll('#destination input').forEach(x => { x.checked = selectedDestinations(saved.destination).includes(x.value); });
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
  visibilityUnsupported = Array.isArray(config['unsupported-properties']) && config['unsupported-properties'].includes('visibility');
  $('visibility-warning').textContent = visibilityUnsupported ? 'Your server reports that visibility is unsupported.' : 'Visibility depends on your server; verify that it enforces private posts.';
  const destinations = choices(config.destination || config.destinations);
  const targets = choices(config['syndicate-to'] || config.syndication || config.syndicateTo);
  const types = choices(config['post-types'] || config.postTypes);
  if (types.length) {
    const supported = new Set(['note','article','bookmark','reply','like','repost','highlight']);
    const available = types.filter(x => supported.has(x.uid));
    if (available.length) { $('kind').replaceChildren(); for (const item of available) { const option = document.createElement('option'); option.value = item.uid; option.textContent = item.name; $('kind').append(option); } if (saved?.kind && available.some(x => x.uid === saved.kind)) $('kind').value = saved.kind; updateKind(); }
  }
  $('destination').replaceChildren(); $('syndication').replaceChildren();
  for (const item of destinations) { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.uid; input.checked = selectedDestinations(saved?.destination).includes(item.uid); label.append(input, document.createTextNode(item.name)); $('destination').append(label); }
  $('destination-field').hidden = !destinations.length;
  for (const item of targets) { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.uid; input.checked = (saved?.syndication || []).includes(item.uid); label.append(input, document.createTextNode(item.name)); $('syndication').append(label); }
  $('syndication-field').hidden = !targets.length;
  $('upload-field').hidden = !(config['media-endpoint'] || config.mediaEndpoint || config.uploadAvailable);
}
async function initialize() {
  if (!api?.runtime) { show('login-view'); notice('Extension APIs are unavailable. Open this page from the installed extension.', true); return; }
  let saved = {};
  try { if (api.storage?.local) { const values = await call(api.storage.local, 'get', [draftKey, 'clientId', 'micropubDrafts', 'micropubActiveDraft', 'pendingCapture', 'stagedCapture']); drafts = values.micropubDrafts || {}; activeDraft = values.micropubActiveDraft || 'Default'; saved = drafts[activeDraft] || values[draftKey] || {}; drafts[activeDraft] = saved; pendingCapture = values.pendingCapture || values.stagedCapture || null; if (values.pendingCapture) { await call(api.storage.local, 'set', {stagedCapture: values.pendingCapture}); await call(api.storage.local, 'remove', 'pendingCapture'); } renderDraftNames(); $('setup-note').hidden = !!values.clientId; } } catch (_) { /* composer still works without persistence */ }
  loadDraft(saved); if (pendingCapture) $('capture-prompt').hidden = false;
  if (new URLSearchParams(globalThis.location?.search || '').has('captureConflict')) notice('A previous capture is still waiting. Apply it before capturing another page.', true);
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
$('edit-current').addEventListener('click', async () => {
  $('edit-current').disabled = true;
  try {
    const tabs = await call(api.tabs, 'query', {active:true, currentWindow:true});
    const url = tabs[0]?.url || '';
    if (!/^https:\/\//i.test(url)) throw new Error('Open a post on your site first.');
    const result = await message({type:'source', url});
    if (!result.source?.properties || typeof result.source.properties !== 'object' || Array.isArray(result.source.properties)) throw new Error('This page is not available as a Micropub post.');
    await call(api.tabs, 'create', {url:api.runtime.getURL('src/edit.html') + '?url=' + encodeURIComponent(url)});
  } catch (error) { notice(`Cannot edit this page: ${error.message}`, true); }
  finally { $('edit-current').disabled = false; }
});
$('menu').addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('menu').open) { $('menu').open = false; $('menu').querySelector('summary').focus(); event.preventDefault(); }
});
$('logout').addEventListener('click', async () => { $('logout').disabled = true; try { await message({type:'logout'}); show('login-view'); notice('Signed out. Your local draft is still available.'); } catch (error) { notice(error.message, true); } finally { $('logout').disabled = false; } });
$('compose-form').addEventListener('input', saveDraft);
$('compose-form').addEventListener('change', saveDraft);
$('kind').addEventListener('change', updateKind);
let pendingTarget = null;
function closeTargetPrompt() { pendingTarget = null; $('replace-target-prompt').hidden = true; }
async function usePage(tab) {
    $('target').value = tab.url;
    await saveDraft();
    if ($('kind').value !== 'bookmark') return;
    const targetAtStart = tab.url;
    const result = await call(api.scripting, 'executeScript', {target:{tabId:tab.id}, func:() => ({url:location.href,title:document.title,description:document.querySelector('meta[name="description" i]')?.content || document.querySelector('meta[property="og:description" i]')?.content || ''})});
    const metadata = result?.[0]?.result;
    if (!metadata || metadata.url !== targetAtStart || $('target').value !== targetAtStart || $('kind').value !== 'bookmark') return;
    if (!$('title').value.trim() && metadata.title) $('title').value = metadata.title;
    if (!$('description').value.trim() && metadata.description) $('description').value = metadata.description;
    await saveDraft();
}
$('use-page').addEventListener('click', async () => {
  try {
    closeTargetPrompt();
    const tabs = await call(api.tabs, 'query', {active:true, currentWindow:true});
    const tab = tabs[0];
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) throw new Error('The current page URL is unavailable.');
    if ($('target').value && $('target').value !== tab.url) {
      pendingTarget = {tab, target:$('target').value, kind:$('kind').value, draft:activeDraft};
      $('replace-target-prompt').hidden = false;
      $('cancel-target').focus();
      return;
    }
    await usePage(tab);
  } catch (error) { notice(`Could not read page details: ${error.message}`, true); }
});
$('cancel-target').addEventListener('click', () => { closeTargetPrompt(); $('use-page').focus(); });
$('replace-target-prompt').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeTargetPrompt(); $('use-page').focus(); } });
$('confirm-target').addEventListener('click', async () => {
  const pending = pendingTarget;
  closeTargetPrompt();
  $('use-page').focus();
  if (!pending) return;
  if (pending.target !== $('target').value || pending.kind !== $('kind').value || pending.draft !== activeDraft) { notice('Draft changed; choose Use page again.', true); return; }
  try { await usePage(pending.tab); } catch (error) { notice(`Could not read page details: ${error.message}`, true); }
});
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
// Each choice is bound to the exact draft shown when it was opened.
let pendingChoice = null;
let changingDraft = false;
function choiceSnapshot() { return {name:activeDraft, value:JSON.stringify(draft())}; }
function choiceIsCurrent(choice) { return choice && choice.name === activeDraft && choice.value === JSON.stringify(draft()); }
function closeChoice(focus = true) {
  const choice = pendingChoice;
  pendingChoice = null;
  for (const id of ['new-draft-prompt', 'clear-draft-prompt', 'confirm-capture-prompt']) $(id).hidden = true;
  if (focus && choice) $(choice.trigger).focus();
}
function openChoice(type, trigger, prompt, initialFocus) {
  closeChoice(false);
  pendingChoice = {...choiceSnapshot(), type, trigger, capture:pendingCapture};
  $(prompt).hidden = false;
  $(initialFocus).focus();
}
for (const [panel, cancel] of [['new-draft-prompt','cancel-new-draft'], ['clear-draft-prompt','cancel-clear-draft'], ['confirm-capture-prompt','cancel-capture']]) {
  $(cancel).addEventListener('click', () => closeChoice());
  $(panel).addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeChoice(); } });
}
$('draft-select').addEventListener('change', async () => {
  const next = $('draft-select').value;
  if (changingDraft) { $('draft-select').value = activeDraft; return; }
  changingDraft = true;
  const before = choiceSnapshot();
  await saveDraft();
  if (!choiceIsCurrent(before) || !Object.hasOwn(drafts, next)) { $('draft-select').value = activeDraft; notice('Draft changed; choose the draft again.', true); changingDraft = false; return; }
  closeChoice(false); activeDraft = next; loadDraft(drafts[next]); await saveDraft(); changingDraft = false;
});
$('new-draft').addEventListener('click', () => {
  $('new-draft-name').value = ''; $('new-draft-error').textContent = '';
  openChoice('new', 'new-draft', 'new-draft-prompt', 'new-draft-name');
});
$('new-draft-name').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('confirm-new-draft').click(); } });
$('confirm-new-draft').addEventListener('click', async () => {
  const choice = pendingChoice, name = $('new-draft-name').value.trim();
  if (!choice || choice.type !== 'new' || changingDraft) return;
  if (!name || Object.hasOwn(drafts, name)) { $('new-draft-error').textContent = name ? 'A draft with that name already exists.' : 'Enter a draft name.'; $('new-draft-name').focus(); return; }
  if (!choiceIsCurrent(choice)) { closeChoice(); notice('Draft changed; choose New again.', true); return; }
  changingDraft = true;
  await saveDraft();
  if (pendingChoice !== choice || !choiceIsCurrent(choice) || Object.hasOwn(drafts, name)) {
    if (pendingChoice === choice) { closeChoice(); notice('Draft changed or name already exists; choose New again.', true); }
    changingDraft = false; return;
  }
  closeChoice(); activeDraft = name; Object.defineProperty(drafts, name, {value:{}, writable:true, enumerable:true, configurable:true}); renderDraftNames(); loadDraft(); await saveDraft(); changingDraft = false;
});
$('clear-draft').addEventListener('click', () => openChoice('clear', 'clear-draft', 'clear-draft-prompt', 'cancel-clear-draft'));
$('confirm-clear-draft').addEventListener('click', async () => {
  const choice = pendingChoice;
  if (!choice || choice.type !== 'clear' || changingDraft) return;
  closeChoice();
  if (!choiceIsCurrent(choice)) { notice('Draft changed; choose Clear draft again.', true); return; }
  loadDraft(); await saveDraft();
});
$('popout').addEventListener('click', async () => { await saveDraft(); await call(api.tabs, 'create', {url:api.runtime.getURL('src/popup.html')}); });
function applyCapture(ask = true) {
  if (!pendingCapture) return;
  if (ask && (fields.some(id => id !== 'kind' && $(id).value.trim()) || photos.length)) { openChoice('capture', 'apply-capture', 'confirm-capture-prompt', 'cancel-capture'); return; }
  const c = pendingCapture; const kind = c.kind === 'quote' ? 'reply' : c.kind;
  if (typeof kind === 'string' && [...$('kind').options].some(x => x.value === kind)) $('kind').value = kind;
  if (typeof c.target === 'string' && c.target) $('target').value = c.target;
  if (typeof c.content === 'string' && c.content) $('content').value = c.content;
  if (kind === 'bookmark') {
    if (!$('title').value.trim() && c.title) $('title').value = c.title;
    if (!$('description').value.trim() && c.description) $('description').value = c.description;
  }
  if (kind === 'highlight') {
    if (!$('source-title').value.trim() && typeof c.title === 'string' && c.title) $('source-title').value = c.title;
    if (!$('source-author').value.trim() && typeof c.author === 'string' && c.author) $('source-author').value = c.author;
  }
  pendingCapture = null; call(api.storage.local, 'remove', 'stagedCapture').catch(() => {}); $('capture-prompt').hidden = true; updateKind(); saveDraft();
}
$('apply-capture').addEventListener('click', () => applyCapture());
$('confirm-capture').addEventListener('click', () => {
  const choice = pendingChoice;
  if (!choice || choice.type !== 'capture' || changingDraft) return;
  closeChoice();
  if (!choiceIsCurrent(choice) || choice.capture !== pendingCapture) { notice('Draft or capture changed; choose Apply capture again.', true); return; }
  applyCapture(false);
});
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
  if (content) properties.content = [content]; if ((kind === 'article' || kind === 'bookmark') && title) properties.name = [title];
  if (kind === 'bookmark' && $('description').value.trim()) properties.summary = [$('description').value.trim()];
  const targetProperty = {bookmark:'bookmark-of', reply:'in-reply-to', like:'like-of', repost:'repost-of'}[kind]; if (targetProperty && target) properties[targetProperty] = [target];
  if (kind === 'highlight') {
    // The source is a citation, so the title and the author travel with the
    // URL: the site shows "From <title> by <author>" above the passage.
    const sourceTitle = $('source-title').value.trim(), sourceAuthor = $('source-author').value.trim(), note = $('note').value.trim();
    const cite = {type:['h-cite'], properties:{}};
    if (target) cite.properties.url = [target];
    if (sourceTitle || target) cite.properties.name = [sourceTitle || target];
    if (sourceAuthor) cite.properties.author = [sourceAuthor];
    if (target || sourceTitle || sourceAuthor) properties['read-of'] = [cite];
    if (note) properties.note = [note];
  }
  const categories = $('categories').value.split(',').map(x => x.trim()).filter(Boolean); if (categories.length) properties.category = categories;
  if ($('visibility').value && visibilityUnsupported) { notice('Your server reports that visibility is unsupported. Choose Server default or check the server before publishing.', true); return; }
  if ($('visibility').value) properties.visibility = [$('visibility').value];
  if ($('status').value) properties['post-status'] = [$('status').value]; const destinations = [...document.querySelectorAll('#destination input:checked')].map(x => x.value); if (destinations.length) properties['mp-destination'] = destinations;
  const syndication = [...document.querySelectorAll('#syndication input:checked')].map(x => x.value); if (syndication.length) properties['mp-syndicate-to'] = syndication; if (photos.length) properties.photo = [...photos];
  if (!content && !title && !targetProperty && !photos.length) { notice('Add some content before publishing.', true); return; }
  const submittedDraft = JSON.stringify(draft());
  $('publish').disabled = true;
  try { const response = await message({type:'publish', properties, h:kind === 'highlight' ? 'highlight' : ''}); const url = response.url || response.location; notice(response.status === 202 || response.accepted ? 'Accepted by your server; processing may still be pending.' : 'Your server accepted the post.', false, url); if (JSON.stringify(draft()) === submittedDraft) { loadDraft(); saveDraft(); } } catch (error) { notice(`${error.message} Your draft is preserved. If the result is uncertain, check your site before retrying to avoid a duplicate.`, true); } finally { $('publish').disabled = false; }
});
initialize();
