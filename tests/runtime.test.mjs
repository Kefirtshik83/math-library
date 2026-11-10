import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {env,fakeGitHub,article} from './helpers.mjs';

test('real workerd/SQLite runtime: OAuth, single-use review, commit and revocation',async()=>{
  assert.ok(fs.existsSync('worker-dist/worker.js'),'Run npm run worker:check before runtime tests');
  const gh=fakeGitHub();
  const mf=new Miniflare(convertV4MiniflareOptions({modulesRoot:'worker-dist',modules:[{type:'ESModule',path:'worker-dist/worker.js'},...fs.readdirSync('worker-dist').filter(n=>/\.(html|css)$|-publish\.js$/.test(n)).map(n=>({type:'Text',path:'worker-dist/'+n}))],
    compatibilityDate:'2026-11-01',bindings:env,
    durableObjects:{STATE:{className:'PublisherState',useSQLite:true}},
    outboundService:async request=>gh.fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:request.method==='GET'?undefined:request.headers.get('Content-Type')?.includes('urlencoded')?new URLSearchParams(await request.text()):await request.text()})
  }));
  try{
    const origin=env.PUBLISHER_ORIGIN;
    const req=(path,options={})=>mf.dispatchFetch(origin+path,{redirect:'manual',...options});
    const start=await req('/auth/start',{method:'POST',headers:{Origin:origin}});assert.equal(start.status,303);
    const state=new URL(start.headers.get('Location')).searchParams.get('state');
    const binding=start.headers.get('Set-Cookie').split(';')[0];
    const callback=await req('/auth/callback?code=test-code&state='+state,{headers:{Cookie:binding}});assert.equal(callback.status,303);
    const cookies=callback.headers.getSetCookie(),session=cookies.find(x=>x.startsWith('__Host-ml-session=')).split(';')[0];
    const s=await (await req('/api/session',{headers:{Cookie:session}})).json();assert.ok(s.csrf);
    const headers={Cookie:session,Origin:origin,'Sec-Fetch-Site':'same-origin','X-CSRF-Token':s.csrf,'Content-Type':'application/json'};
    // Large enough to exceed the DO KV value limit: exercises actual SQLite storage.
    const op=article({blocks:[{id:'b1',source:'# Long article'},...Array.from({length:4},(_,i)=>({id:'large'+i,source:'x'.repeat(60000)}))]});
    const p=await req('/api/prepare',{method:'POST',headers,body:JSON.stringify(op)});assert.equal(p.status,200,await p.clone().text());
    const {id}=await p.json();
    const results=await Promise.all([req('/api/publish',{method:'POST',headers,body:JSON.stringify({id})}),req('/api/publish',{method:'POST',headers,body:JSON.stringify({id})})]);
    assert.ok(results.some(r=>r.status===200));assert.equal(gh.commits.length,1);
    const logout=await req('/api/logout',{method:'POST',headers,body:'{}'});assert.equal(logout.status,200);
    assert.equal((await req('/api/session',{headers:{Cookie:session}})).status,401);
    assert.equal((await req('/auth/callback?code=test-code&state='+state,{headers:{Cookie:binding}})).status,400);
  }finally{await mf.dispose();}
});
