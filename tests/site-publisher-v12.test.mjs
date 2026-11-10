import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const publisherOrigin='https://publisher.example';
const siteOrigin='https://owner.github.io';
function harness(){
  let listener, popup, code, issued=[];
  const site={origin:siteOrigin};
  const fetch=async(url,opts)=>{
    issued.push({url,opts});
    if(url.endsWith('/api/prepare'))return new Response(JSON.stringify({id:'a'.repeat(43)}),{status:200});
    if(url.endsWith('/api/publish'))return new Response(JSON.stringify({commit:'b'.repeat(40),base:'c'.repeat(64)}),{status:200});
    throw new Error('Unexpected request: '+url);
  };
  const context={
    document:{querySelector:selector=>selector==='meta[name="ml-publisher"]'?{content:publisherOrigin}:null},
    location:site,URL,crypto:webcrypto,btoa,structuredClone,fetch,Date,Error,Object,Promise,Uint8Array,
    setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{},
  };
  context.window={
    open(url){assert.equal(url,'about:blank');return popup={closed:false,location:{replace(url){popup.url=url;}},postMessage(d,origin){popup.message={d,origin};},close(){popup.closed=true;}};},
    addEventListener(kind,handler){if(kind==='message')listener=handler;},removeEventListener(){}
  };
  context.globalThis=context;
  vm.runInNewContext(fs.readFileSync(new URL('../assets/publisher.js',import.meta.url),'utf8'),context);
  return {publisher:context.MLPublisher,emitted:(d,origin=publisherOrigin)=>listener({source:popup,origin,data:d}),get popup(){return popup;},get issued(){return issued;}};
}
test('v12 popup returns a short-lived grant, then publishes without another window or cookie',async()=>{
  const h=harness();const login=h.publisher.connect();
  assert.match(h.popup.url,/connect=1/);
  const channel=new URL(h.popup.url).hash.match(/channel=([A-Za-z0-9_-]{43})/)[1];
  h.emitted({type:'ml-auth-ready',channel});
  assert.equal(h.popup.message.d.type,'ml-auth-init');assert.equal(h.popup.message.origin,publisherOrigin);
  const credential='A'.repeat(43),csrf='B'.repeat(43);
  h.emitted({type:'ml-auth-granted',channel,credential,csrf,expires:Date.now()+600000,version:'publisher-v12-20261111'},'https://attacker.example');
  assert.equal(await h.publisher.check(),false);
  h.emitted({type:'ml-auth-granted',channel,credential,csrf,expires:Date.now()+600000,version:'publisher-v12-20261111'});
  await login;assert.equal(await h.publisher.check(),true);assert.equal(h.popup.closed,true);
  const prior=h.popup;
  const result=await h.publisher.open({kind:'article',slug:'x'});
  assert.equal(result.commit,'b'.repeat(40));assert.equal(prior,h.popup);
  assert.equal(h.issued.length,2);
  for(const r of h.issued){assert.equal(r.opts.credentials,'omit');assert.equal(r.opts.headers.Authorization,'Bearer '+credential);assert.equal(r.opts.headers['X-CSRF-Token'],csrf);}
});
