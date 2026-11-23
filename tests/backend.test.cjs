const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');

function setup() {
  const storage = {clientId:'https://client.example/'};
  let listener, callbackState, callbackMe = 'https://me.example/', requests = [];
  const browser = {runtime:{onMessage:{addListener(fn){listener=fn;}}}, storage:{local:{async get(){return {...storage};}, async set(o){Object.assign(storage,o);}, async remove(k){delete storage[k];}}}, identity:{getRedirectURL(){return 'https://extension.example/';}, async launchWebAuthFlow({url}){const u=new URL(url); assert.equal(u.searchParams.get('code_challenge_method'),'S256'); callbackState=u.searchParams.get('state'); return `https://extension.example/?state=${callbackState}&code=abc`;}}};
  const fetch = async (url, options={}) => {
    requests.push({url,options});
    if (url === 'https://me.example/') return new Response('<link rel="authorization_endpoint" href="/auth"><a href="/token" rel="token_endpoint"></a>',{headers:{link:'</mp>; rel="micropub"'}});
    if (url === 'https://me.example/token') return Response.json({access_token:'secret',me:callbackMe,token_type:'Bearer',scope:'create media'});
    if (url === 'https://me.example/mp?q=config') return Response.json({'media-endpoint':'https://media.example/upload'});
    if (url === 'https://me.example/mp') return new Response(null,{status:201,headers:{location:'/post/1'}});
    if (url === 'https://media.example/upload') return new Response(null,{status:201,headers:{location:'/photo'}});
    throw Error('unanticipated URL');
  };
  const ctx=vm.createContext({browser,fetch,URL,URLSearchParams,crypto:webcrypto,TextEncoder,Response,Blob,FormData,Uint8Array,btoa,atob,console});
  vm.runInContext(fs.readFileSync('src/auth.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('src/background.js','utf8'),ctx);
  const send = message => new Promise(resolve => listener(message,{},resolve));
  return {send,storage,requests,ctx,browser,setMe(v){callbackMe=v;}};
}
test('login, config, publish, upload, session and logout', async()=>{
  const {send,storage,requests}=setup();
  delete storage.clientId;
  assert.equal((await send({type:'session'})).session,null);
  assert.equal((await send({type:'login',me:'https://me.example/',clientId:'https://client.example/'})).me,'https://me.example/');
  assert.equal(storage.clientId,'https://client.example/');
  assert.equal(storage.session.accessToken,'secret');
  assert.equal(JSON.stringify(await send({type:'session'})).includes('secret'),false);
  assert.equal((await send({type:'config'})).config['media-endpoint'],'https://media.example/upload');
  assert.equal((await send({type:'publish',properties:{content:['hello']}})).location,'https://me.example/post/1');
  assert.equal((await send({type:'upload',dataUrl:'data:text/plain;base64,aGk=',filename:'a.txt',mimeType:'text/plain'})).location,'https://media.example/photo');
  const token = requests.find(r=>r.url.endsWith('/token'));
  assert.equal(token.options.body.get('code_verifier').length,43);
  assert.equal(requests.find(r=>r.url.endsWith('/upload')).options.redirect,'error');
  assert.equal(requests.find(r=>r.url.endsWith('/mp')).options.headers.Authorization,'Bearer secret');
  await send({type:'logout'}); assert.equal(storage.session,undefined);
});
test('rejects wrong state and identity and insecure endpoints',async()=>{
  let env=setup(); env.browser.identity.launchWebAuthFlow=async()=> 'https://extension.example/?state=wrong&code=abc';
  assert.equal((await env.send({type:'login',me:'https://me.example/'})).ok,false);
  assert.equal(env.requests.some(r=>r.url.endsWith('/token')),false);
  env=setup(); env.setMe('https://evil.example/');
  assert.equal((await env.send({type:'login',me:'https://me.example/'})).ok,false);
  assert.equal(env.storage.session,undefined);
  assert.throws(()=>env.ctx.EkAuth.parseLinks('<link rel="micropub" href="http://evil/">','','https://me.example/'));
});
test('diagnostics allowlist, old sessions, config and redaction', async()=>{
  const env=setup();
  let result=await env.send({type:'diagnostics'});
  assert.equal(result.session,null);
  assert.equal(result.clientId,'https://client.example/');
  assert.equal(result.redirect,'https://extension.example/');
  await env.send({type:'login',me:'https://me.example/'});
  env.storage.session.code='code-private'; env.storage.session.verifier='verifier-private';
  env.storage.session.draft='draft-private'; env.storage.micropubPopupDraft='draft-private';
  result=await env.send({type:'diagnostics'});
  assert.equal(result.session.authorizationEndpoint,'https://me.example/auth');
  assert.equal(result.session.tokenEndpoint,'https://me.example/token');
  assert.equal(result.session.scope,'create media');
  for (const value of ['secret','code-private','verifier-private','draft-private']) assert.equal(JSON.stringify(result).includes(value),false);
  assert.equal((await env.send({type:'diagnostic-config'})).config['media-endpoint'],'https://media.example/upload');
  env.ctx.fetch=async()=>Response.json({access_token:'other-private',nested:{code_verifier:'verifier-private',draft:'draft-private',description:'secret',safe:'yes'}});
  const cfg=await env.send({type:'diagnostic-config'});
  for (const value of ['secret','other-private','verifier-private','draft-private']) assert.equal(JSON.stringify(cfg).includes(value),false);
  assert.equal(cfg.config.nested.safe,'yes');
  env.ctx.fetch=async()=>new Response('',{status:403});
  assert.match((await env.send({type:'diagnostic-config'})).error,/HTTP 403/);
  env.storage.session={me:'https://me.example/',micropub:'https://me.example/mp',accessToken:'secret'};
  result=await env.send({type:'diagnostics'});
  assert.equal(result.session.authorizationEndpoint,null);
  assert.equal(result.session.scope,null);
});
test('Firefox uses the default client ID and ignores script markup',async()=>{
  const env=setup(); delete env.storage.clientId;
  let authorization;
  env.browser.identity.launchWebAuthFlow=async ({url})=>{ authorization=new URL(url); return `https://extension.example/?state=${authorization.searchParams.get('state')}&code=abc`; };
  assert.equal((await env.send({type:'diagnostics'})).clientId,'https://ek.p83.dev/client.json');
  assert.equal((await env.send({type:'login',me:'https://me.example/'})).ok,true);
  assert.equal(authorization.searchParams.get('client_id'),'https://ek.p83.dev/client.json');
  assert.equal(env.requests.find(r=>r.url.endsWith('/token')).options.body.get('client_id'),'https://ek.p83.dev/client.json');
  assert.equal(env.storage.clientId,undefined);
  const links=env.ctx.EkAuth.parseLinks('<script>"<link rel=micropub href=https://evil/>"</script><link rel="micropub" href="/good">','','https://me.example/');
  assert.equal(links.micropub,'https://me.example/good');
});

test('source, categories and mutation requests', async()=>{
  const env=setup(); env.storage.session={me:'https://me.example/',micropub:'https://me.example/mp',accessToken:'secret'};
  const calls=[];
  env.ctx.fetch=async (url,options)=>{
    calls.push({url,options}); const u=new URL(url);
    if (u.searchParams.get('q')==='source') return Response.json({type:['h-entry'],properties:{content:['old']}});
    if (u.searchParams.get('q')==='category') return Response.json({categories:['one','two']});
    return new Response(null,{status:204});
  };
  assert.deepEqual(JSON.parse(JSON.stringify((await env.send({type:'categories'})).categories)),['one','two']);
  assert.equal((await env.send({type:'source',url:'https://me.example/post?a=1&b=2'})).source.properties.content[0],'old');
  assert.equal(new URL(calls[1].url).searchParams.get('url'),'https://me.example/post?a=1&b=2');
  for (const type of ['update','delete','undelete']) {
    assert.equal((await env.send({type,url:'https://me.example/post',replace:{content:['new']}})).status,204);
    const body=JSON.parse(calls.at(-1).options.body);
    assert.equal(body.action,type); assert.equal(body.url,'https://me.example/post');
    if(type==='update') assert.deepEqual(body.replace,{content:['new']}); else assert.equal('replace' in body,false);
    assert.equal(calls.at(-1).options.redirect,'error');
  }
  const before=calls.length; assert.equal((await env.send({type:'delete',url:'http://me.example/post'})).ok,false); assert.equal(calls.length,before);
  env.ctx.fetch=async()=>{throw Error('secret network detail');};
  assert.equal((await env.send({type:'delete',url:'https://me.example/post'})).error,'Request failed');
});
test('publish moves Micropub controls to top level only when supplied',async()=>{
  const env=setup(); env.storage.session={me:'https://me.example/',micropub:'https://me.example/mp',accessToken:'secret'};
  await env.send({type:'publish',properties:{content:['hello'],'mp-destination':'https://site.example/','mp-syndicate-to':['target']}});
  let body=JSON.parse(env.requests.at(-1).options.body);
  assert.deepEqual(body.properties,{content:['hello']}); assert.equal(body['mp-destination'],'https://site.example/'); assert.deepEqual(body['mp-syndicate-to'],['target']);
  await env.send({type:'publish',properties:{content:['hello']}}); body=JSON.parse(env.requests.at(-1).options.body);
  assert.equal('mp-destination' in body,false); assert.equal('mp-syndicate-to' in body,false);
  assert.deepEqual(body.type,['h-entry']);
  await env.send({type:'publish',properties:{content:['passage'],'read-of':[{type:['h-cite'],properties:{url:['https://page.example/']}}]},h:'highlight'});
  body=JSON.parse(env.requests.at(-1).options.body);
  assert.deepEqual(body.type,['h-entry','h-highlight']);
  assert.equal(body.properties.content[0],'passage');
});
test('permissions are requested by caller before login or upload',async()=>{
  const env=setup(); const granted=new Set(); env.browser.permissions={async contains({origins}){return granted.has(origins[0]);}};
  assert.equal((await env.send({type:'permissions-needed',me:'https://me.example:8443/'})).permissionOrigin,'https://me.example/*');
  let result=await env.send({type:'login',me:'https://me.example/'});
  assert.equal(result.permissionOrigin,'https://me.example/*'); assert.equal(env.requests.length,0);
  granted.add(result.permissionOrigin); result=await env.send({type:'login',me:'https://me.example/'});
  assert.equal(result.ok,true); assert.equal(env.requests[0].options.redirect,'error');
  result=await env.send({type:'upload',dataUrl:'data:text/plain;base64,aGk=',filename:'a',mimeType:'text/plain'});
  assert.equal(result.permissionOrigin,'https://media.example/*'); assert.equal(env.requests.some(r=>r.url==='https://media.example/upload'),false);
  granted.add(result.permissionOrigin); assert.equal((await env.send({type:'upload',dataUrl:'data:text/plain;base64,aGk=',filename:'a',mimeType:'text/plain'})).ok,true);
});
test('cross-host discovery stops before authorization until endpoints are granted',async()=>{
  const env=setup(); const granted=new Set(['https://me.example/*']); let launched=false;
  env.browser.permissions={async contains({origins}){return granted.has(origins[0]);}};
  env.browser.identity.launchWebAuthFlow=async ({url})=>{ launched=true; const u=new URL(url); assert.equal(u.searchParams.get('scope'),'create update delete media'); return `https://extension.example/?state=${u.searchParams.get('state')}&code=abc`; };
  env.ctx.fetch=async (url, options)=>{
    if(url==='https://me.example/') return new Response('<link rel="authorization_endpoint" href="https://auth.example/auth"><link rel="token_endpoint" href="https://token.example/token"><link rel="micropub" href="https://mp.example/endpoint">');
    if(url==='https://token.example/token') return Response.json({access_token:'secret',me:'https://me.example/'});
    throw new Error('Unexpected request');
  };
  let result=await env.send({type:'login',me:'https://me.example/'});
  assert.equal(result.permissionOrigin,'https://token.example/*'); assert.equal(launched,false);
  granted.add(result.permissionOrigin); result=await env.send({type:'login',me:'https://me.example/'});
  assert.equal(result.permissionOrigin,'https://mp.example/*'); assert.equal(launched,false);
  granted.add(result.permissionOrigin); result=await env.send({type:'login',me:'https://me.example/'});
  assert.equal(result.ok,true); assert.equal(launched,true);
});
