import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,article,hash,collections} from './helpers.mjs';
import {challenge,random} from '../publisher/src/security.mjs';
import {cleanup} from '../publisher/src/app.mjs';

test('owner OAuth uses PKCE, exact redirect, repository scope, secure rotated cookies and encrypted token',async()=>{
  const h=harness(),{flow,response}=await h.login();assert.equal(response.status,303);
  assert.equal(flow.target.origin,'https://github.com');assert.equal(flow.target.searchParams.get('code_challenge_method'),'S256');
  const exchange=h.gh.calls.find(x=>x.url.includes('access_token')).options.body;
  assert.equal(await challenge(exchange.get('code_verifier')),flow.target.searchParams.get('code_challenge'));
  assert.equal(exchange.get('repository_id'),'456');assert.equal(exchange.get('redirect_uri'),h.env.PUBLISHER_ORIGIN+'/auth/callback');
  for(const c of response.headers.getSetCookie())assert.match(c,/Secure; HttpOnly; SameSite=(Strict|Lax); Path=\//);
  const stored=JSON.stringify([...h.storage.data]);assert.ok(!stored.includes('test-only-user-token'));assert.ok(!stored.includes('discard-this-test-refresh-token'));
  assert.ok(!JSON.stringify(await (await h.request('/api/session')).json()).includes('token'));
});
for(const [label,changes] of [['wrong account',{user:999}],['wrong repo identity',{repo:999}],['repository moved',{owner:999}],['write access removed',{push:false}]]){
  test('login rejects '+label,async()=>{const h=harness();Object.assign(h.gh,changes);const {response}=await h.login();assert.equal(response.status,403);assert.ok(!response.headers.has('Set-Cookie'));assert.equal(h.gh.commits.length,0);assert.ok(h.gh.calls.some(x=>x.options.method==='DELETE'));});
}
for(const caseName of ['wrong state','missing binding','wrong binding','duplicate state','duplicate code','expired']){
 test('OAuth rejects '+caseName,async()=>{const h=harness(),f=await h.begin();let path=f.path,cookie=f.binding;if(caseName==='wrong state')path='/auth/callback?code=test-code&state='+random();if(caseName==='missing binding')cookie='';if(caseName==='wrong binding')cookie='__Host-ml-oauth='+random();if(caseName==='duplicate state')path+='&state=x';if(caseName==='duplicate code')path+='&code=x';if(caseName==='expired')h.tick(300001);const r=await h.request(path,{headers:{Cookie:cookie},auth:false});assert.equal(r.status,400);assert.equal(h.gh.calls.length,0);});
}
test('OAuth callback is single use even under concurrent replay',async()=>{const h=harness(),f=await h.begin();const rs=await Promise.all([h.request(f.path,{headers:{Cookie:f.binding}}),h.request(f.path,{headers:{Cookie:f.binding}})]);assert.deepEqual(rs.map(r=>r.status).sort(),[303,400]);assert.equal(h.gh.calls.filter(x=>x.url.includes('access_token')).length,1);});
test('failed OAuth exchange consumes state',async()=>{const h=harness(),f=await h.begin();h.gh.fetch=async()=>new Response('{}',{status:502});assert.equal((await h.request(f.path,{headers:{Cookie:f.binding}})).status,502);assert.equal((await h.request(f.path,{headers:{Cookie:f.binding}})).status,400);});
test('login start requires same-origin POST and rate limits attempts',async()=>{const h=harness();assert.equal((await h.request('/auth/start')).status,404);assert.equal((await h.request('/auth/start',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);for(let i=0;i<8;i++)assert.equal((await h.request('/auth/start',{method:'POST'})).status,303);assert.equal((await h.request('/auth/start',{method:'POST'})).status,429);});
test('placeholder configuration fails closed',async()=>{const h=harness({GITHUB_OWNER_ID:'REPLACE'});assert.equal((await h.request('/publish')).status,503);assert.equal(h.gh.calls.length,0);});
test('no authenticated API access for anonymous visitors or browser bearer tokens',async()=>{const h=harness();assert.equal((await h.prepare(article())).status,401);assert.equal((await h.request('/api/session')).status,401);assert.equal((await h.request('/publish',{headers:{Authorization:'Bearer token'}})).status,400);});
for(const [label,headers] of [['evil Origin',{Origin:'https://evil.example'}],['null Origin',{Origin:'null'}],['missing Origin',{Origin:''}],['missing CSRF',{'X-CSRF-Token':''}],['forged CSRF',{'X-CSRF-Token':'fake'}],['cross-site metadata',{'Sec-Fetch-Site':'cross-site'}]]){
 test('mutation rejects '+label,async()=>{const h=harness();await h.login();const before=h.gh.calls.length;assert.equal((await h.request('/api/prepare',{method:'POST',body:article(),headers})).status,403);assert.equal(h.gh.calls.length,before);});
}
test('CORS and clickjacking headers are restrictive on successes and errors',async()=>{const h=harness();for(const path of ['/publish','/not-found','/api/session']){const r=await h.request(path,{headers:{Origin:'https://evil.example'}});assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('X-Frame-Options'),'DENY');assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);}assert.equal((await h.request('/api/prepare',{method:'OPTIONS'})).status,404);});
test('logout invalidates cookie replay and revokes GitHub token',async()=>{const h=harness();await h.login();const old=h.cookie;const r=await h.request('/api/logout',{method:'POST',body:{}});assert.equal(r.status,200);h.cookie=old;assert.equal((await h.request('/api/session')).status,401);assert.ok(h.gh.calls.some(x=>x.options.method==='DELETE'));});
test('session expires after idle and absolute time; GET cannot keep it alive',async()=>{const h=harness();await h.login();h.tick(14*60000);assert.equal((await h.request('/api/session')).status,200);h.tick(60001);assert.equal((await h.prepare(article())).status,401);const second=harness();await second.login();for(let i=0;i<2;i++){second.tick(14*60000);assert.equal((await second.prepare(article())).status,200);}second.tick(2*60000+1);assert.equal((await second.prepare(article())).status,401);});
test('session cookie duplication and owner configuration change are rejected',async()=>{const h=harness();await h.login();assert.equal((await h.request('/api/session',{headers:{Cookie:h.cookie+'; '+h.cookie}})).status,401);h.env.GITHUB_OWNER_ID='999';assert.equal((await h.request('/api/session')).status,401);});
test('cleanup removes expired OAuth and session records',async()=>{const h=harness();await h.login();await cleanup(h.storage,Number.MAX_SAFE_INTEGER);assert.equal((await h.request('/api/session')).status,401);});
test('prepare is read-only; publish writes a fixed path once with expected head',async()=>{const h=harness();await h.login();const before=await h.prepare(article());assert.equal(before.status,200);assert.equal(h.gh.commits.length,0);const review=await before.json();const first=await h.publish(review.id);assert.equal(first.status,200);const result=await first.json();assert.equal(result.base,await hash(h.gh.files.get('notes/test.md')));const again=await h.publish(review.id);assert.equal(again.status,200);assert.deepEqual(await again.json(),result);assert.equal(h.gh.commits.length,1);assert.equal(h.gh.commits[0].expectedHeadOid,'a'.repeat(40));assert.deepEqual(h.gh.commits[0].fileChanges.additions.map(x=>x.path),['notes/test.md']);assert.equal(h.gh.commits[0].fileChanges.deletions,undefined);});
test('concurrent confirmation cannot create two commits',async()=>{const h=harness();await h.login();const {id}=await (await h.prepare(article())).json();await Promise.all([h.publish(id),h.publish(id)]);assert.equal(h.gh.commits.length,1);});
test('review IDs are bound to a session',async()=>{const h=harness();await h.login();const {id}=await (await h.prepare(article())).json();h.cookie='';await h.login();assert.equal((await h.publish(id)).status,409);assert.equal(h.gh.commits.length,0);});
test('review expires and a new review invalidates the old confirmation',async()=>{const h=harness();await h.login();const a=await (await h.prepare(article())).json();const b=await (await h.prepare(article({slug:'second'}))).json();assert.equal((await h.publish(a.id)).status,409);h.tick(300001);assert.equal((await h.publish(b.id)).status,409);});
test('branch changes during review abort atomically without forcing',async()=>{const h=harness();await h.login();const {id}=await (await h.prepare(article())).json();h.gh.head='d'.repeat(40);const r=await h.publish(id);assert.equal(r.status,409);assert.equal(h.gh.commits.length,0);assert.ok(!(await r.text()).includes('SECRET-UPSTREAM'));});
test('owner or permission revocation after review prevents writes',async()=>{const h=harness();await h.login();const {id}=await (await h.prepare(article())).json();h.gh.push=false;assert.equal((await h.publish(id)).status,403);assert.equal(h.gh.commits.length,0);});
test('an indeterminate upstream write is not retried',async()=>{const h=harness();await h.login();const {id}=await (await h.prepare(article())).json();const original=h.gh.fetch;let calls=0;h.gh.fetch=async(...args)=>{if(args[0].endsWith('/graphql')){calls++;throw Error('network with SECRET');}return original(...args);};assert.equal((await h.publish(id)).status,500);assert.equal((await h.publish(id)).status,409);assert.equal(calls,1);});
test('article baseline must match exact remote bytes including Unicode',async()=>{const h=harness();h.gh.files.set('notes/test.md','Математика\n');await h.login();assert.equal((await h.prepare(article())).status,409);assert.equal((await h.prepare(article({base:'0'.repeat(64)}))).status,409);assert.equal((await h.prepare(article({base:await hash('Математика\n')}))).status,200);});
test('article and new nested sections are one atomic commit',async()=>{const h=harness();await h.login();const added=[{id:'teaching',title:'Teaching',description:'',parent:null,order:20},{id:'algebra',title:'Algebra',description:'',parent:'teaching',order:10}];const review=await (await h.prepare(article({collection:'algebra',collections:added}))).json();assert.equal(review.changes.length,2);assert.equal((await h.publish(review.id)).status,200);assert.equal(h.gh.commits.length,1);assert.deepEqual(h.gh.commits[0].fileChanges.additions.map(x=>x.path).sort(),['collections.json','notes/test.md']);});
for(const [label,modes] of [['symlinked note',{'notes/test.md':'120000'}],['submodule note',{'notes/test.md':'160000'}],['executable note',{'notes/test.md':'100755'}],['symlinked directory',{notes:'120000'}],['symlinked collections',{'collections.json':'120000'}]]){
 test('rejects '+label,async()=>{const h=harness();h.gh.files.set('notes/test.md','text');h.gh.modes=modes;await h.login();assert.equal((await h.prepare(article({base:await hash('text')}))).status,422);assert.equal(h.gh.commits.length,0);});
}
for(const bad of ['../build.py','../../.github/workflows/pages.yml','a/b','a%2fb','a%252fb','a\\b','/etc/passwd','.git','draft','a.md','test?ref=evil','тест','constructor','a\u0000b']){
 test('path attack rejected: '+JSON.stringify(bad),async()=>{const h=harness();await h.login();assert.equal((await h.prepare(article({slug:bad}))).status,422);assert.equal(h.gh.commits.length,0);});
}
for(const extra of [{path:'build.py'},{branch:'evil'},{repo:'other'},{owner:'other'},{message:'override'},{__dangerous:true}]){
 test('rejects arbitrary request field '+Object.keys(extra)[0],async()=>{const h=harness();await h.login();assert.equal((await h.prepare({...article(),...extra})).status,422);});
}
test('rejects forged payload with prototype keys, block IDs, structural markers and unknown operations',async()=>{const h=harness();await h.login();for(const op of [JSON.parse(JSON.stringify(article()).replace('"kind"','"__proto__":{},"kind"')),{kind:'delete',path:'build.py'},article({blocks:[{id:'x" onclick="evil',source:'text'}]}),article({blocks:[{id:'b1',source:'<!-- ml:block:escape -->\ntext'}]}),article({blocks:[{id:'b1',source:'text'},{id:'b1',source:'again'}]})])assert.equal((await h.prepare(op)).status,422);});
test('sections cannot replace existing records or create cycles',async()=>{const h=harness();await h.login();assert.equal((await h.prepare({kind:'collections',collections})).status,409);for(const parent of ['missing','loop'])assert.equal((await h.prepare({kind:'collections',collections:[{id:'loop',title:'Loop',description:'',parent,order:1}]})).status,422);});
test('JSON, UTF-8 and request limits fail before writes',async()=>{const h=harness();await h.login();assert.equal((await h.request('/api/prepare',{method:'POST',body:'no json'})).status,400);assert.equal((await h.request('/api/prepare',{method:'POST',body:article(),headers:{'Content-Type':'text/plain'}})).status,415);assert.equal((await h.request('/api/prepare',{method:'POST',body:'x'.repeat(524289)})).status,413);assert.equal((await h.request('/api/prepare',{method:'POST',body:article(),headers:{'Content-Encoding':'gzip'}})).status,415);assert.equal(h.gh.commits.length,0);});
test('upstream redirects are rejected without forwarding secrets to another host',async()=>{
  const h=harness(),flow=await h.begin();h.gh.fetch=async(url,options)=>{
    assert.equal(url,'https://github.com/login/oauth/access_token');assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://evil.example/collect'}});
  };
  assert.equal((await h.request(flow.path,{headers:{Cookie:flow.binding}})).status,502);
});
test('public article origin cannot call privileged mutations',async()=>{
  const h=harness();await h.login();assert.equal((await h.request('/api/prepare',{method:'POST',body:article(),headers:{Origin:h.env.SITE_ORIGIN}})).status,403);assert.equal(h.gh.commits.length,0);
});
test('revoked GitHub token blocks confirmation even with a live local session',async()=>{
  const h=harness();await h.login();const {id}=await (await h.prepare(article())).json();h.gh.expired=true;assert.equal((await h.publish(id)).status,401);assert.equal(h.gh.commits.length,0);
});
test('unbounded and non-expiring OAuth tokens are rejected and revoked',async()=>{
  for(const expires of [undefined,0,28801,'28800']){
    const h=harness(),f=await h.begin(),original=h.gh.fetch;
    h.gh.fetch=async(url,options)=>url.includes('login/oauth/access_token')?new Response(JSON.stringify({access_token:'test-only-user-token',token_type:'bearer',expires_in:expires}),{headers:{'Content-Type':'application/json'}}):original(url,options);
    assert.equal((await h.request(f.path,{headers:{Cookie:f.binding}})).status,403);
    assert.ok(h.gh.calls.some(c=>c.options.method==='DELETE'));
  }
});
test('invalid UTF-8 and excessive source/fold depth fail closed',async()=>{
  const h=harness();await h.login();
  const response=await h.app(new Request(h.env.PUBLISHER_ORIGIN+'/api/prepare',{method:'POST',headers:{Cookie:h.cookie,Origin:h.env.PUBLISHER_ORIGIN,'Content-Type':'application/json','X-CSRF-Token':h.csrf},body:new Uint8Array([0xc3,0x28])}));
  assert.equal(response.status,400);
  assert.equal((await h.prepare(article({blocks:[{id:'b1',source:'x'.repeat(65537)}]}))).status,422);
  const blocks=[...Array.from({length:13},(_,i)=>({id:'s'+i,source:'<!-- ml:fold-start title="X" open="true" -->'})),...Array.from({length:13},(_,i)=>({id:'e'+i,source:'<!-- ml:fold-end -->'}))];
  assert.equal((await h.prepare(article({blocks}))).status,422);
});
