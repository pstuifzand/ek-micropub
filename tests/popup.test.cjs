const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup() {
  const nodes = new Map();
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.value = ''; this.hidden = false; this.children = []; this.listeners = {}; this.classList = {toggle(){}}; this.dataset = {}; this.options = this.children; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    async fire(name, event = {}) { for (const fn of this.listeners[name] || []) await fn({preventDefault(){}, ...event}); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; this.options = this.children; }
    reset() { for (const id of ['kind','title','target','content','categories','status','destination']) get(id).value = ''; }
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  get('destination').append(new Element('option'));
  const store = {};
  const calls = [];
  const browser = {storage:{local:{async get() {return store}, async set(x){Object.assign(store,x)}, async remove(k){delete store[k]}}}, runtime:{async sendMessage(msg){calls.push(msg); if(msg.type === 'session') return {ok:true,session:null}; if(msg.type === 'publish') return {ok:false,error:'network failure'}; return {ok:true}}, getURL:x=>x}, tabs:{async query(){return []}, async create(){}}};
  const document = {getElementById:get, createElement:tag=>new Element(tag), createTextNode:text=>({textContent:text}), querySelectorAll:()=>[]};
  const context = vm.createContext({browser,document,console,confirm:()=>true,prompt:()=>null});
  let code = fs.readFileSync('src/popup.js','utf8').replace(/initialize\(\);\s*$/, '');
  vm.runInContext(code, context);
  return {context,get,calls,store,run:code=>vm.runInContext(code,context)};
}
test('server post types filter supported kinds and preserve names', () => {
  const {run,get} = setup();
  run(`configure({config:{'post-types':[{type:'note',name:'Short note'},{type:'article',name:'Essay'},{type:'unknown',name:'Other'}]}},{kind:'article'})`);
  assert.deepEqual(get('kind').children.map(x=>[x.value,x.textContent]), [['note','Short note'],['article','Essay']]);
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
