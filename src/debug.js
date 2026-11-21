'use strict';
const api = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
function call(object, method, ...args) {
  if (globalThis.browser) return Promise.resolve(object[method](...args));
  return new Promise((resolve, reject) => object[method](...args, value => {
    const error = api.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(value);
  }));
}
async function message(type) {
  const response = await call(api.runtime, 'sendMessage', {type});
  if (!response?.ok) throw new Error(response?.error || 'No response from the extension.');
  return response;
}
async function loadConfig() {
  $('config').textContent = 'Loading…';
  try { $('config').textContent = JSON.stringify((await message('diagnostic-config')).config, null, 2); }
  catch (error) { $('config').textContent = `Could not load configuration: ${error.message}`; }
}
async function initialize() {
  try {
    const data = await message('diagnostics');
    $('redirect').textContent = data.redirect || 'Unavailable';
    $('client-id').value = data.clientId || '';
    if (!data.session) { $('session-status').textContent = 'Not signed in. Set your client ID here, then sign in from the extension popup.'; return; }
    $('session-status').textContent = 'Connected. Endpoints and scopes not recorded by older sessions are shown as such; sign in again to record them.';
    for (const key of ['me', 'micropub', 'authorizationEndpoint', 'tokenEndpoint', 'indieauthMetadata', 'scope']) $(key).textContent = data.session[key] || 'Not recorded';
    $('session').hidden = false; $('config-section').hidden = false;
    await loadConfig();
  } catch (error) { $('session-status').textContent = `Diagnostics unavailable: ${error.message}`; }
}
$('client-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const value = $('client-id').value.trim();
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Use an HTTPS URL without credentials or a fragment.');
    await call(api.storage.local, 'set', {clientId:value});
    $('client-id').value = value;
    $('notice').textContent = 'Client ID saved. Sign in from the extension popup.';
  } catch (error) { $('notice').textContent = `Could not save client ID: ${error.message}`; }
});
$('refresh').addEventListener('click', loadConfig);
initialize();
