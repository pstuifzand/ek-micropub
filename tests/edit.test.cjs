const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function setup({search = '', respond, initial = {}} = {}) {
  const ids = ['url','controls','notice','identity','session-note','editor','title','content','content-hint','category','load-form','edit-form','delete','undelete'];
  const elements = Object.fromEntries(ids.map(id => [id,{value:'', disabled:false, hidden:false, textContent:'', classList:{toggle(){}}, handlers:{}, addEventListener(type, fn){this.handlers[type]=fn;}}]));
  for (const [id, value] of Object.entries(initial)) elements[id].value = value;
  const sent = [], confirmations = [];
  let response = respond || (m => m.type === 'session' ? {ok:true,session:{me:'https://me.example/'}} : {ok:true});
  const browser = {runtime:{async sendMessage(m){sent.push(JSON.parse(JSON.stringify(m))); return response(m);}}};
  const context = vm.createContext({browser,document:{getElementById:id=>elements[id]},location:{search},URL,URLSearchParams,confirm:()=>confirmations.shift() ?? false});
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

test('handoff loads the exact decoded URL after session verification',async()=>{
  const postUrl='https://example.test/post?a=1&b=%2F#part';
  const e=await setup({search:'?url='+encodeURIComponent(postUrl),respond:m=>m.type==='session'?{ok:true,session:{authenticated:true}}:{ok:true,source}});
  assert.deepEqual(e.sent,[{type:'session'},{type:'source',url:postUrl}]);
  assert.equal(e.elements.url.value,postUrl); assert.equal(e.elements.title.value,'Title');
  assert.equal(e.elements.editor.hidden,false); assert.equal(e.elements.notice.textContent,'Post loaded.');
});
test('handoff validates URL and requires a signed-in session',async()=>{
  for (const value of ['javascript:alert(1)','not a url','']) {
    const e=await setup({search:'?url='+encodeURIComponent(value)});
    assert.deepEqual(e.sent,[{type:'session'}]); assert.match(e.elements.notice.textContent,/URL/);
  }
  const e=await setup({search:'?url=https%3A%2F%2Fexample.test%2Fpost',respond:()=>({ok:true,session:{}})});
  assert.deepEqual(e.sent,[{type:'session'}]); assert.match(e.elements.notice.textContent,/Sign in/);
});
test('handoff source failure is visible and leaves form contents intact',async()=>{
  const e=await setup({search:'?url=https%3A%2F%2Fexample.test%2Fpost',initial:{title:'Unsaved',content:'Draft',category:'tag'},respond:m=>m.type==='session'?{ok:true,session:{me:'me'}}:{ok:false,error:'Source unavailable'}});
  assert.deepEqual(e.sent,[{type:'session'},{type:'source',url:'https://example.test/post'}]);
  assert.equal(e.elements.notice.textContent,'Source unavailable');
  assert.equal(e.elements.title.value,'Unsaved'); assert.equal(e.elements.content.value,'Draft'); assert.equal(e.elements.category.value,'tag');
  assert.equal(e.elements.controls.disabled,false);
});
test('direct edit page does not request a source',async()=>{
  const e=await setup(); assert.deepEqual(e.sent,[{type:'session'}]);
});
