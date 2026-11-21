const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(promiseStyle) {
  const events = () => ({listeners:[], addListener(fn){this.listeners.push(fn);}, fire(...args){for (const fn of this.listeners) fn(...args);}});
  const installed=events(), startup=events(), clicked=events(), action=events();
  const menus = new Map(), storage={micropubPopupDraft:{content:'existing'}, session:{accessToken:'secret'}}, tabs=[], reads=[];
  const wrap = fn => promiseStyle ? (...args) => Promise.resolve(fn(...args)) : (...args) => { const cb=args.pop(); try { const result=fn(...args); queueMicrotask(()=>cb(result)); } catch (error) { queueMicrotask(()=>{api.runtime.lastError={message:error.message}; cb(); delete api.runtime.lastError;}); } };
  const api={runtime:{onInstalled:installed,onStartup:startup,getURL:path=>'extension://id/'+path},
    contextMenus:{onClicked:clicked,remove:wrap(id=>{if (!menus.delete(id)) throw Error('missing');}),create:wrap(item=>{if(menus.has(item.id)) throw Error('duplicate'); menus.set(item.id,item);})},
    storage:{local:{get:wrap(key=>{reads.push(key); return {[key]:storage[key]};}),set:wrap(value=>Object.assign(storage,value))}},
    tabs:{create:wrap(value=>tabs.push(value))},action:{onClicked:action}};
  const ctx=vm.createContext({[promiseStyle?'browser':'chrome']:api, URL, console});
  vm.runInContext(fs.readFileSync('src/capture.js','utf8'),ctx);
  return {installed,startup,clicked,action,menus,storage,tabs,reads};
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
for (const promiseStyle of [false,true]) {
  test(`${promiseStyle?'Firefox promises':'Chromium callbacks'}: menus, capture, conflicts and action`, async()=>{
    const e=setup(promiseStyle); e.installed.fire(); e.startup.fire(); await settle();
    assert.equal(e.menus.size,9);
    assert.deepEqual(Array.from([...e.menus.values()].find(x=>x.id==='ek-capture-quote-selection').contexts),['selection']);
    e.clicked.fire({menuItemId:'ek-capture-quote-selection',pageUrl:'https://example.test/page',selectionText:'Selected text'},{title:'Page title'}); await settle();
    assert.equal(JSON.stringify(e.storage.pendingCapture),JSON.stringify({kind:'quote',target:'https://example.test/page',content:'Selected text',title:'Page title'}));
    assert.equal(e.tabs[0].url,'extension://id/src/popup.html?capture=1');
    assert.equal(e.storage.micropubPopupDraft.content,'existing');
    e.clicked.fire({menuItemId:'ek-capture-bookmark-link',linkUrl:'https://other.test/',pageUrl:'https://page.test/'},{title:'Page'}); await settle();
    assert.equal(e.storage.pendingCapture.kind,'quote');
    assert.equal(e.tabs[1].url,'extension://id/src/popup.html?capture=1&captureConflict=1');
    delete e.storage.pendingCapture;
    e.clicked.fire({menuItemId:'ek-capture-like-image',srcUrl:'javascript:alert(1)',pageUrl:'https://page.test/'},{}); await settle();
    assert.equal(e.tabs.length,2); assert.equal(e.storage.pendingCapture,undefined);
    e.clicked.fire({menuItemId:'ek-capture-like-image',srcUrl:'http://image.test/a',pageUrl:'https://page.test/'},{}); await settle();
    assert.equal(e.storage.pendingCapture.target,'http://image.test/a'); assert.equal(e.storage.pendingCapture.kind,'like');
    assert.ok(e.reads.every(key=>key==='pendingCapture'));
    e.action.fire({}); await settle(); assert.equal(e.tabs.at(-1).url,'extension://id/src/popup.html');
  });
}
