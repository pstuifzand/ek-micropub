'use strict';
const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
let loadedUrl = '';
let original = {};
let baseline = {};

function callMessage(payload) {
  if (!api?.runtime?.sendMessage) return Promise.reject(new Error('Extension APIs are unavailable.'));
  if (globalThis.browser) return Promise.resolve(api.runtime.sendMessage(payload));
  return new Promise((resolve, reject) => api.runtime.sendMessage(payload, result => {
    const error = api.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(result);
  }));
}
async function message(payload) {
  const result = await callMessage(payload);
  if (!result?.ok) throw new Error(result?.error || 'No response from the extension.');
  return result;
}
function notice(text, error = false) {
  const element = $('notice'); element.hidden = false;
  element.classList.toggle('error', error); element.textContent = text;
}
function url() {
  const value = $('url').value.trim();
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw new Error('Enter a valid post URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Enter an HTTP or HTTPS post URL.');
  return value;
}
function dirty() { return ['title', 'content', 'category'].some(id => !$(id).disabled && $(id).value !== baseline[id]); }
function render(source, postUrl) {
  if (!source || typeof source !== 'object' || !source.properties || typeof source.properties !== 'object' || Array.isArray(source.properties)) throw new Error('The server returned an invalid source response.');
  const props = source.properties;
  const name = props.name ?? [];
  const content = props.content ?? [];
  const category = props.category ?? [];
  if (![name, content, category].every(Array.isArray)) throw new Error('The server returned unsupported source properties.');
  original = {name, content, category};
  $('title').disabled = name.some(x => typeof x !== 'string');
  $('title').value = typeof name[0] === 'string' ? name[0] : '';
  const first = content[0];
  const rich = first && typeof first === 'object' && typeof first.html === 'string';
  $('content').disabled = content.length > 0 && typeof first !== 'string' && !rich;
  $('content').value = rich ? first.html : typeof first === 'string' ? first : '';
  $('content-hint').textContent = $('content').disabled ? 'This content format cannot be edited here.' : rich ? 'HTML source is shown as text; edit it carefully.' : '';
  $('category').disabled = category.some(x => typeof x !== 'string' || /[\r\n]/.test(x));
  $('category').value = category.join('\n');
  if ($('category').disabled) $('content-hint').textContent += ' Categories in this format cannot be edited here.';
  baseline = Object.fromEntries(['title', 'content', 'category'].map(id => [id, $(id).value]));
  loadedUrl = postUrl; $('editor').hidden = false;
}
async function busy(fn) {
  $('controls').disabled = true;
  try { await fn(); } catch (error) { notice(error.message, true); }
  finally { $('controls').disabled = false; }
}
$('load-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(async () => {
    const postUrl = url();
    if (loadedUrl && dirty() && !confirm('Discard your unsaved changes and load another source?')) return;
    const result = await message({type:'source', url:postUrl});
    render(result.source, postUrl); notice('Post loaded.');
  });
});
$('edit-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(async () => {
    const postUrl = url();
    if (!loadedUrl || postUrl !== loadedUrl) throw new Error('The URL has changed. Load this post before saving.');
    const replace = {};
    if (!$('title').disabled && $('title').value !== baseline.title) replace.name = [$('title').value, ...original.name.slice(1)];
    if (!$('content').disabled && $('content').value !== baseline.content) {
      const first = original.content[0];
      replace.content = [first && typeof first === 'object' ? {...first, html:$('content').value} : $('content').value, ...original.content.slice(1)];
    }
    if (!$('category').disabled && $('category').value !== baseline.category) replace.category = $('category').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (!Object.keys(replace).length) { notice('No changes to save.'); return; }
    await message({type:'update', url:postUrl, replace});
    Object.assign(original, replace);
    baseline = Object.fromEntries(['title', 'content', 'category'].map(id => [id, $(id).value]));
    notice('Changes saved.');
  });
});
for (const action of ['delete', 'undelete']) $(action).addEventListener('click', () => {
  busy(async () => {
    const postUrl = url();
    if (!confirm(`${action === 'delete' ? 'Delete' : 'Undelete'} this post?\n\n${postUrl}`)) return;
    await message({type:action, url:postUrl});
    notice(action === 'delete' ? 'Post deleted.' : 'Post undeleted.');
  });
});
(async () => {
  try {
    const response = await message({type:'session'});
    const session = response.session || response;
    if (!(session.me || session.authenticated || session.loggedIn)) throw new Error('Sign in from the extension popup first.');
    $('identity').textContent = session.me || 'Connected'; $('session-note').hidden = true; $('controls').disabled = false;
  } catch (error) { $('session-note').textContent = 'Sign in from the extension popup to edit posts.'; notice(error.message, true); }
})();
