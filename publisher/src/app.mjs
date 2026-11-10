import {GitHub} from './github.mjs';
import {HttpError,assert,random,hash,challenge,cookie,setCookie,SID,FLOW,config,sameOrigin,jsonBody,seal,unseal,json,secure} from './security.mjs';
const AGE=30*60*1000, IDLE=15*60*1000, LOGIN_AGE=5*60*1000, REVIEW_AGE=5*60*1000;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
export function createApp({env,storage,assets,transport=fetch,now=()=>Date.now()}) {
  const redirect=(path,headers={})=>new Response(null,{status:303,headers:{Location:path,...headers}});
  async function revoke(token) {
    try {const r=await transport(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`,{method:'DELETE',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{Accept:'application/vnd.github+json','User-Agent':'math-library-publisher','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json',Authorization:'Basic '+btoa(env.GITHUB_CLIENT_ID+':'+env.GITHUB_CLIENT_SECRET)},body:JSON.stringify({access_token:token})});return r.ok;}catch{return false;}
  }
  async function session(request,touch=true) {
    const sid=cookie(request,SID);assert(TOKEN.test(sid),401,'Sign in to publish.');
    const key='session:'+await hash(sid);
    const s=await storage.transaction(async tx=>{
      const value=await tx.get(key);
      assert(value && value.expires>now() && value.last+IDLE>now(),401,'Session expired. Sign in again.');
      assert(value.owner===env.GITHUB_OWNER_ID,401,'Session owner changed. Sign in again.');
      if(touch){value.last=now();await tx.put(key,value);}
      return value;
    });
    const token=await unseal(s.token,env,key);
    return {sid,key,s,token};
  }
  async function mutation(request) {
    sameOrigin(request,env);
    const auth=await session(request);
    assert(request.headers.get('X-CSRF-Token')===auth.s.csrf,403,'Invalid CSRF token');
    return auth;
  }
  async function start(request) {
    sameOrigin(request,env);
    const ip=await hash(request.headers.get('CF-Connecting-IP')||'unknown');
    await storage.transaction(async tx=>{
      const bucket=Math.floor(now()/LOGIN_AGE);
      const counts=(await tx.get('login-rate'))||{bucket,ips:{},total:0};
      if(counts.bucket!==bucket){counts.bucket=bucket;counts.ips={};counts.total=0;}
      assert(counts.total<60 && (counts.ips[ip]||0)<8,429,'Too many login attempts. Try again later.');
      counts.total++;counts.ips[ip]=(counts.ips[ip]||0)+1;await tx.put('login-rate',counts);
    });
    const state=random(),binding=random(),verifier=random(),key='flow:'+await hash(state);
    await storage.put(key,{binding:await hash(binding),verifier,expires:now()+LOGIN_AGE});
    const target=new URL('https://github.com/login/oauth/authorize');
    target.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:env.PUBLISHER_ORIGIN+'/auth/callback',state,
      code_challenge:await challenge(verifier),code_challenge_method:'S256',allow_signup:'false',scope:'offline_access'});
    return redirect(target.href,{'Set-Cookie':setCookie(FLOW,binding,300,'Lax')});
  }
  async function callback(request,url) {
    assert([...url.searchParams.keys()].every(k=>['code','state','error','error_description','error_uri'].includes(k)) && ['state','code'].every(k=>url.searchParams.getAll(k).length===1),400,'Invalid OAuth callback');
    const state=url.searchParams.get('state'),code=url.searchParams.get('code'),binding=cookie(request,FLOW);
    assert(TOKEN.test(state||'') && TOKEN.test(binding) && /^[A-Za-z0-9_-]{1,256}$/.test(code||''),400,'Invalid OAuth callback');
    const key='flow:'+await hash(state),bindingHash=await hash(binding);
    const flow=await storage.transaction(async tx=>{
      const f=await tx.get(key);
      assert(f && f.expires>now() && f.binding===bindingHash,400,'Expired or invalid login. Start again.');
      await tx.delete(key);return f; // consume BEFORE the exchange, including failed exchanges
    });
    const exchange=await transport('https://github.com/login/oauth/access_token',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),
      headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:env.PUBLISHER_ORIGIN+'/auth/callback',code_verifier:flow.verifier,repository_id:env.GITHUB_REPO_ID})
    });
    assert(exchange.ok,502,'GitHub login failed.');
    const data=await exchange.json();
    assert(!data.error && typeof data.access_token==='string' && data.access_token.length<1024 && data.token_type?.toLowerCase()==='bearer',401,'GitHub login failed.');
    let accepted=false;
    try {
      assert(Number.isFinite(data.expires_in) && data.expires_in>0 && data.expires_in<=28800,403,'Enable expiring GitHub App user tokens.');
      await new GitHub(env,data.access_token,transport).identity();
      const old=cookie(request,SID);if(TOKEN.test(old)) await storage.delete('session:'+await hash(old));
      const sid=random(),sk='session:'+await hash(sid),expires=now()+Math.min(AGE,data.expires_in*1000);
      await storage.put(sk,{owner:env.GITHUB_OWNER_ID,token:await seal(data.access_token,env,sk),csrf:random(),expires,last:now()});
      // Refresh tokens are intentionally discarded. A session never refreshes itself.
      const headers=new Headers({Location:'/publish'});
      headers.append('Set-Cookie',setCookie(SID,sid,Math.floor((expires-now())/1000)));
      headers.append('Set-Cookie',setCookie(FLOW,'',0,'Lax'));accepted=true;
      return new Response(null,{status:303,headers});
    } finally {if(!accepted) await revoke(data.access_token);}
  }
  async function route(request) {
    config(env);
    const url=new URL(request.url);
    assert(url.origin===env.PUBLISHER_ORIGIN,403,'Invalid request host');
    assert(!request.headers.has('Authorization'),400,'Browser bearer tokens are not accepted');
    if(request.method==='GET' && url.pathname==='/publish') return new Response(assets.html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
    if(request.method==='GET' && url.pathname==='/publish.js') return new Response(assets.js,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
    if(request.method==='GET' && url.pathname==='/publish.css') return new Response(assets.css,{headers:{'Content-Type':'text/css; charset=utf-8'}});
    if(request.method==='GET' && url.pathname==='/config') return json({siteOrigin:env.SITE_ORIGIN,siteURL:env.SITE_URL,repository:env.GITHUB_OWNER+'/'+env.GITHUB_REPO});
    if(request.method==='POST' && url.pathname==='/auth/start') return start(request);
    if(request.method==='GET' && url.pathname==='/auth/callback') return callback(request,url);
    if(url.pathname.startsWith('/api/')) {
      // Fetch Metadata supplements, but never replaces, Origin and CSRF checks.
      const site=request.headers.get('Sec-Fetch-Site');assert(!site || site==='same-origin',403,'Cross-site API request');
      if(request.method==='GET' && url.pathname==='/api/session') {
        const {s}=await session(request,false);return json({csrf:s.csrf,expires:s.expires});
      }
      if(request.method==='POST' && url.pathname==='/api/logout') {
        const auth=await mutation(request);await storage.delete(auth.key);
        const revoked=await revoke(auth.token);
        return json({loggedOut:true,githubTokenRevoked:revoked},200,{'Set-Cookie':setCookie(SID,'',0)});
      }
      if(request.method==='POST' && url.pathname==='/api/prepare') {
        const auth=await mutation(request),op=await jsonBody(request);
        // One pending review per session; repeated requests cannot fill the database.
        const review=await new GitHub(env,auth.token,transport).prepare(op);
        const id=random();
        await storage.put('review:'+auth.key,{id,review,expires:now()+REVIEW_AGE,status:'ready'});
        return json({id,head:review.head,changes:review.changes,expires:now()+REVIEW_AGE});
      }
      if(request.method==='POST' && url.pathname==='/api/publish') {
        const auth=await mutation(request),body=await jsonBody(request,1024);
        assert(body && Object.keys(body).length===1 && TOKEN.test(body.id||''),400,'Invalid review');
        const key='review:'+auth.key;
        const pending=await storage.transaction(async tx=>{
          const r=await tx.get(key);assert(r && r.id===body.id && r.expires>now(),409,'Review expired or replaced. Review again.');
          if(r.status==='done')return r;
          assert(r.status==='ready',409,'Publication already submitted. Check GitHub history before retrying.');
          r.status='submitted';await tx.put(key,r);return r;
        });
        if(pending.status==='done')return json(pending.result);
        // Once claimed, never retry an uncertain write automatically.
        const result=await new GitHub(env,auth.token,transport).publish(pending.review);
        // Do not replace a newer review created by another tab while GitHub was responding.
        await storage.transaction(async tx=>{const r=await tx.get(key);if(r?.id===body.id){r.status='done';r.result=result;await tx.put(key,r);}});
        return json(result);
      }
    }
    throw new HttpError(404,'Not found');
  }
  return async request=>{
    try{return secure(await route(request));}
    catch(e){return secure(json({error:e instanceof HttpError?e.message:'The publisher could not complete the request. Your draft is unchanged.'},e instanceof HttpError?e.status:500));}
  };
}
export async function cleanup(storage,now=Date.now()) {
  // Bounded by login quotas and short expirations. No tokens or drafts in logs.
  const items=await storage.list();
  for(const [key,value] of items) if(value.expires && value.expires<=now) await storage.delete(key);
}
