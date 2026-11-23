const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup() {
  const nodes = new Map();
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.value = ''; this.hidden = false; this.children = []; this.listeners = {}; this.classList = {toggle(){}}; this.dataset = {}; this.options = this.children; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    focus() { this.focused = true; }
    async fire(name, event = {}) { for (const fn of this.listeners[name] || []) await fn({preventDefault(){}, ...event}); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; this.options = this.children; }
    reset() { for (const id of ['kind','title','target','content','categories','status','visibility','description','note','source-title','source-author','destination']) get(id).value = ''; }
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  get('destination').append(new Element('option'));
  const store = {};
  const calls = [];
  const browser = {storage:{local:{async get() {return store}, async set(x){Object.assign(store,x)}, async remove(k){delete store[k]}}}, runtime:{async sendMessage(msg){calls.push(msg); if(msg.type === 'session') return {ok:true,session:null}; if(msg.type === 'publish') return {ok:false,error:'network failure'}; return {ok:true}}, getURL:x=>x}, tabs:{async query(){return []}, async create(){}}};
  const document = {getElementById:get, createElement:tag=>new Element(tag), createTextNode:text=>({textContent:text}), querySelectorAll:selector=>{ const match=selector.match(/^#(destination|syndication) input(:checked)?$/); if (!match) return []; return get(match[1]).children.flatMap(label=>label.children.filter(x=>x.tagName==='input')).filter(x=>!match[2] || x.checked); }};
  const context = vm.createContext({browser,document,console,confirm:()=>true,prompt:()=>null});
  let code = fs.readFileSync('src/popup.js','utf8').replace(/initialize\(\);\s*$/, '');
  vm.runInContext(code, context);
  return {context,get,calls,store,browser,run:code=>vm.runInContext(code,context)};
}
test('Firefox login proceeds without a stored client ID', async () => {
  const {get,calls} = setup();
  get('me').value = 'https://me.example/';
  await get('login-form').fire('submit', {submitter:{disabled:false}});
  assert.equal(calls.find(x=>x.type==='login').me, 'https://me.example/');
});
test('inline clear confirms, cancels and rejects changed drafts', async () => {
  const {get,run} = setup(); get('content').value = 'Keep me';
  await get('clear-draft').fire('click'); assert.equal(get('cancel-clear-draft').focused,true);
  await get('cancel-clear-draft').fire('click'); assert.equal(get('content').value,'Keep me'); assert.equal(get('clear-draft').focused,true);
  await get('clear-draft').fire('click'); await get('clear-draft-prompt').fire('keydown',{key:'Escape'}); assert.equal(get('clear-draft-prompt').hidden,true);
  await get('clear-draft').fire('click'); get('content').value='Changed'; await get('confirm-clear-draft').fire('click'); assert.equal(get('content').value,'Changed');
  await get('clear-draft').fire('click'); run("activeDraft = 'Other'"); await get('confirm-clear-draft').fire('click'); assert.equal(get('content').value,'Changed');
  await get('clear-draft').fire('click'); await get('confirm-clear-draft').fire('click'); assert.equal(get('content').value,'');
});
test('new draft validates names, preserves content, and handles escape', async () => {
  const {get,run,store} = setup(); get('content').value='Original';
  await get('new-draft').fire('click'); assert.equal(get('new-draft-name').focused,true);
  await get('confirm-new-draft').fire('click'); assert.match(get('new-draft-error').textContent,/Enter/);
  get('new-draft-name').value='Default'; run("drafts.Default = {} "); await get('confirm-new-draft').fire('click'); assert.match(get('new-draft-error').textContent,/exists/);
  await get('new-draft-prompt').fire('keydown',{key:'Escape'}); assert.equal(get('new-draft').focused,true); assert.equal(get('content').value,'Original');
  await get('new-draft').fire('click'); get('new-draft-name').value='New'; await get('confirm-new-draft').fire('click');
  assert.equal(store.micropubDrafts.Default.content,'Original'); assert.equal(store.micropubActiveDraft,'New'); assert.equal(get('content').value,'');
});
test('new draft does not overwrite changed or duplicate draft during async save', async () => {
  const {get,run,browser} = setup(); let release; browser.storage.local.set=()=>new Promise(r=>{release=r});
  get('content').value='Original'; await get('new-draft').fire('click'); get('new-draft-name').value='New';
  const creating=get('confirm-new-draft').fire('click'); await new Promise(r=>setImmediate(r));
  get('content').value='Changed'; run("drafts.New = {content:'Existing'}"); release(); await creating;
  assert.equal(get('content').value,'Changed'); assert.equal(run('drafts.New.content'),'Existing'); assert.equal(run('activeDraft'),'Default');
});
test('capture requires inline confirmation and rejects stale choices', async () => {
  const {get,run,store} = setup(); run("pendingCapture={kind:'reply',content:'Capture'}; $('content').value='Original'");
  await get('apply-capture').fire('click'); assert.equal(get('cancel-capture').focused,true);
  await get('confirm-capture-prompt').fire('keydown',{key:'Escape'}); assert.equal(get('apply-capture').focused,true); assert.equal(get('content').value,'Original');
  await get('apply-capture').fire('click'); get('content').value='Edited'; await get('confirm-capture').fire('click'); assert.equal(get('content').value,'Edited'); assert.ok(run('pendingCapture'));
  await get('apply-capture').fire('click'); await get('confirm-capture').fire('click'); assert.equal(get('content').value,'Capture'); assert.equal(run('pendingCapture'),null);
});
test('destinations support multiple choices, legacy drafts and server default', async () => {
  const {run,get,calls,store}=setup();
  run(`configure({config:{destination:[{uid:'site',name:'My site'},{uid:'reader',name:'Reader'}]}},{destination:'site'})`);
  const inputs=get('destination').children.map(x=>x.children[0]); assert.equal(inputs[0].checked,true); assert.equal(inputs[1].checked,false);
  inputs[1].checked=true; get('kind').value='note'; get('content').value='Test'; await run('saveDraft()');
  assert.deepEqual(Array.from(store.micropubDrafts.Default.destination),['site','reader']);
  await get('compose-form').fire('submit'); assert.deepEqual(Array.from(calls.filter(x=>x.type==='publish').at(-1).properties['mp-destination']),['site','reader']);
  inputs.forEach(x=>x.checked=false); await get('compose-form').fire('submit'); assert.equal(calls.filter(x=>x.type==='publish').at(-1).properties['mp-destination'],undefined);
  run(`loadDraft({destination:['site','reader']})`); assert.equal(inputs[0].checked,true); assert.equal(inputs[1].checked,true);
});
test('server post types filter supported kinds and preserve names', () => {
  const {run,get} = setup();
  run(`configure({config:{'post-types':[{type:'note',name:'Short note'},{type:'article',name:'Essay'},{type:'highlight',name:'Highlight'},{type:'unknown',name:'Other'}]}},{kind:'article'})`);
  assert.deepEqual(get('kind').children.map(x=>[x.value,x.textContent]), [['note','Short note'],['article','Essay'],['highlight','Highlight']]);
  assert.equal(get('kind').value,'article');
});
test('legacy photos and alt text survive persistence; failed publish retains draft', async () => {
  const {run,get,calls,store} = setup();
  run(`photos = ['https://example.com/a.jpg', {value:'https://example.com/b.jpg',alt:'A bird'}]; $('content').value = 'hello'; $('kind').value = 'note'`);
  await get('compose-form').fire('submit');
  const payload = calls.find(x=>x.type==='publish');
  assert.deepEqual(JSON.parse(JSON.stringify(payload.properties.photo)), ['https://example.com/a.jpg',{value:'https://example.com/b.jpg',alt:'A bird'}]);
  assert.equal(get('content').value, 'hello');
  assert.match(get('notice').textContent, /check your site before retrying/);
  await run('saveDraft()');
  assert.equal(store.micropubDrafts.Default.photos[1].alt,'A bird');
});
test('safe markdown preview creates text nodes instead of interpreting HTML', () => {
  const {run,get} = setup();
  get('content').value = '<img onerror=alert(1)> **bold**'; run('renderPreview()');
  assert.equal(get('preview').children[0].textContent, '<img onerror=alert(1)> ');
  assert.equal(get('preview').children[1].tagName, 'strong');
  assert.equal(get('preview').children[1].textContent, 'bold');
});
test('bookmark name, summary and visibility respect server default', async () => {
  const {get,calls,run,store} = setup();
  get('kind').value='bookmark'; get('title').value='Name'; get('description').value='Description'; get('target').value='https://example.com/page'; get('content').value='my note';
  await get('compose-form').fire('submit');
  let props=calls.filter(x=>x.type==='publish').at(-1).properties;
  assert.equal(props.name[0],'Name'); assert.equal(props.summary[0],'Description'); assert.equal(props['bookmark-of'][0],'https://example.com/page'); assert.equal(props.visibility,undefined);
  get('visibility').value='private'; await run('saveDraft()'); assert.equal(store.micropubDrafts.Default.visibility,'private');
  await get('compose-form').fire('submit'); props=calls.filter(x=>x.type==='publish').at(-1).properties; assert.equal(props.visibility[0],'private');
  run(`configure({config:{'unsupported-properties':['visibility']}},{})`); const before=calls.length; await get('compose-form').fire('submit'); assert.equal(calls.length,before); assert.match(get('notice').textContent,/unsupported/);
});
test('use page reads metadata without replacing written text or accepting stale results', async () => {
  const {get,browser} = setup();
  browser.tabs.query = async () => [{id:5,url:'https://page.example/'}];
  browser.scripting = {executeScript:async () => [{result:{url:'https://page.example/',title:'Page title',description:'Page description'}}]};
  get('kind').value='bookmark'; get('content').value='my own notes'; await get('use-page').fire('click');
  assert.equal(get('target').value,'https://page.example/'); assert.equal(get('title').value,'Page title'); assert.equal(get('description').value,'Page description'); assert.equal(get('content').value,'my own notes');
  get('title').value='My name'; get('description').value='My description'; await get('use-page').fire('click'); assert.equal(get('title').value,'My name'); assert.equal(get('description').value,'My description');
  browser.scripting.executeScript = async () => { get('target').value='https://other.example/'; return [{result:{url:'https://page.example/',title:'stale',description:'stale'}}]; };
  get('title').value=''; get('description').value=''; await get('use-page').fire('click'); assert.equal(get('title').value,''); assert.equal(get('description').value,'');
});
test('replace URL uses inline confirmation, cancellation and stale-draft protection', async () => {
  const {get,browser,run} = setup();
  browser.tabs.query = async () => [{id:5,url:'https://page.example/'}];
  browser.scripting = {executeScript:async () => [{result:{url:'https://page.example/',title:'Fetched',description:'Fetched description'}}]};
  get('kind').value='bookmark'; get('target').value='https://old.example/'; get('title').value='My name';
  await get('use-page').fire('click'); assert.equal(get('replace-target-prompt').hidden,false); assert.equal(get('cancel-target').focused,true);
  await get('cancel-target').fire('click'); assert.equal(get('target').value,'https://old.example/'); assert.equal(get('replace-target-prompt').hidden,true);
  await get('use-page').fire('click'); await get('confirm-target').fire('click'); assert.equal(get('target').value,'https://page.example/'); assert.equal(get('title').value,'My name'); assert.equal(get('description').value,'Fetched description');
  get('target').value='https://old.example/'; await get('use-page').fire('click'); get('target').value='https://changed.example/'; await get('confirm-target').fire('click'); assert.equal(get('target').value,'https://changed.example/');
  get('target').value='https://old.example/'; await get('use-page').fire('click'); run("activeDraft = 'Other'"); await get('confirm-target').fire('click'); assert.equal(get('target').value,'https://old.example/');
  await get('use-page').fire('click'); await get('replace-target-prompt').fire('keydown',{key:'Escape'}); assert.equal(get('replace-target-prompt').hidden,true); assert.equal(get('target').value,'https://old.example/');
});
test('highlight capture keeps the passage verbatim and publishes a citation', async () => {
  const {get,calls,run} = setup();
  run("$('kind').replaceChildren(Object.assign(document.createElement('option'),{value:'highlight'}))");
  run(`pendingCapture={kind:'highlight',target:'https://page.example/read',content:'A passage\\nkept whole.',title:'The Page'}`);
  await get('apply-capture').fire('click');
  assert.equal(get('kind').value,'highlight');
  assert.equal(get('content').value,'A passage\nkept whole.');
  assert.equal(get('target').value,'https://page.example/read');
  assert.equal(get('source-title').value,'The Page');
  assert.equal(get('source-field').hidden,false);
  assert.equal(get('note-field').hidden,false);
  get('note').value='Why it matters.';
  get('source-author').value='A. Writer';
  await get('compose-form').fire('submit');
  const message = calls.filter(x=>x.type==='publish').at(-1);
  const props = message.properties;
  assert.deepEqual(Array.from(props.content),['A passage\nkept whole.']);
  assert.deepEqual(Array.from(props.note),['Why it matters.']);
  assert.deepEqual(Array.from(props['read-of'][0].properties.url),['https://page.example/read']);
  assert.deepEqual(Array.from(props['read-of'][0].properties.name),['The Page']);
  assert.deepEqual(Array.from(props['read-of'][0].properties.author),['A. Writer']);
  assert.equal(props['in-reply-to'],undefined);
  assert.equal(message.h,'highlight');
});
test('edit button checks current URL against source before opening', async () => {
  const {get,browser,calls} = setup(); let opened='';
  browser.tabs.query=async()=>[{id:5,url:'https://site.example/post'}]; browser.tabs.create=async ({url})=>{opened=url};
  browser.runtime.sendMessage=async msg=>{ calls.push(msg); return msg.type==='source' ? {ok:true,source:{properties:{content:['test']}}} : {ok:true}; };
  await get('edit-current').fire('click'); assert.equal(calls[0].type,'source'); assert.equal(calls[0].url,'https://site.example/post'); assert.match(opened,/edit\.html\?url=https%3A%2F%2Fsite\.example%2Fpost/);
  opened=''; browser.runtime.sendMessage=async()=>({ok:false,error:'Not found'}); await get('edit-current').fire('click'); assert.equal(opened,''); assert.match(get('notice').textContent,/Not found/);
});
