const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function setup() {
  const ids = ['url','controls','notice','identity','session-note','editor','title','content','content-hint','category','load-form','edit-form','delete','undelete'];
  const elements = Object.fromEntries(ids.map(id => [id,{value:'', disabled:false, hidden:false, textContent:'', classList:{toggle(){}}, handlers:{}, addEventListener(type, fn){this.handlers[type]=fn;}}]));
  const sent = [], confirmations = [];
  let response = m => m.type === 'session' ? {ok:true,session:{me:'https://me.example/'}} : {ok:true};
  const browser = {runtime:{async sendMessage(m){sent.push(JSON.parse(JSON.stringify(m))); return response(m);}}};
  const context = vm.createContext({browser,document:{getElementById:id=>elements[id]},URL,confirm:()=>confirmations.shift() ?? false});
  vm.runInContext(fs.readFileSync('src/edit.js','utf8'),context);
  const flush = () => new Promise(resolve=>setImmediate(resolve));
  await flush();
  async function fire(id, type) { elements[id].handlers[type]({preventDefault(){}}); await flush(); }
  return {elements,sent,confirmations,fire,setResponse(fn){response=fn;}};
}
const source = {type:['h-entry'],properties:{name:['Title'],content:[{html:'<b>old</b>',other:'keep'}],category:['one','two'],photo:['https://example/photo']}};

test('load source and replace only edited properties, preserving rich content and extra fields',async()=>{
  const e=await setup(); e.elements.url.value='https://example/post';
  e.setResponse(m=>m.type==='source'?{ok:true,source}:{ok:true});
  await e.fire('load-form','submit');
  assert.deepEqual(e.sent.at(-1),{type:'source',url:'https://example/post'});
  assert.equal(e.elements.content.value,'<b>old</b>');
  e.elements.title.value='New'; await e.fire('edit-form','submit');
  assert.deepEqual(e.sent.at(-1),{type:'update',url:'https://example/post',replace:{name:['New']}});
  e.elements.content.value='<script>literal</script>'; e.elements.category.value='two\nnew';
  await e.fire('edit-form','submit');
  assert.deepEqual(e.sent.at(-1),{type:'update',url:'https://example/post',replace:{content:[{html:'<script>literal</script>',other:'keep'}],category:['two','new']}});
  const count=e.sent.length; await e.fire('edit-form','submit'); assert.equal(e.sent.length,count);
});
test('failures retain inputs, reject changed URL, and show scope errors as text',async()=>{
  const e=await setup(); e.elements.url.value='https://example/post';
  e.setResponse(m=>m.type==='source'?{ok:true,source}:{ok:false,error:'Missing update scope <b>scope</b>'});
  await e.fire('load-form','submit'); e.elements.title.value='Unsaved';
  await e.fire('edit-form','submit'); assert.equal(e.elements.title.value,'Unsaved'); assert.equal(e.elements.notice.textContent,'Missing update scope <b>scope</b>');
  e.elements.url.value='https://example/other'; const count=e.sent.length;
  await e.fire('edit-form','submit'); assert.equal(e.sent.length,count); assert.match(e.elements.notice.textContent,/URL has changed/);
  e.confirmations.push(true); e.setResponse(()=>({ok:false,error:'Source unavailable'}));
  await e.fire('load-form','submit'); assert.equal(e.elements.title.value,'Unsaved');
});
test('delete and undelete require explicit confirmation and need no source',async()=>{
  const e=await setup(); e.elements.url.value='https://example/deleted';
  const count=e.sent.length; await e.fire('delete','click'); assert.equal(e.sent.length,count);
  e.confirmations.push(true); await e.fire('delete','click'); assert.deepEqual(e.sent.at(-1),{type:'delete',url:'https://example/deleted'});
  e.confirmations.push(true); await e.fire('undelete','click'); assert.deepEqual(e.sent.at(-1),{type:'undelete',url:'https://example/deleted'});
});
