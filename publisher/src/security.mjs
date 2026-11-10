export class HttpError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
export const assert=(ok,status,message)=>{if(!ok) throw new HttpError(status,message);};
export const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
export function b64url(bytes) {return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export async function hash(value) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function challenge(value) {return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
export function cookie(request,name) {
  const values=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
  return values.length===1?values[0].slice(name.length+1):'';
}
export function setCookie(name,value,seconds,sameSite='Strict') {
  return `${name}=${value}; Secure; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${seconds}`;
}
export const SID='__Host-ml-session', FLOW='__Host-ml-oauth';
export function config(env) {
  const origin=new URL(env.PUBLISHER_ORIGIN), site=new URL(env.SITE_ORIGIN), url=new URL(env.SITE_URL);
  assert(origin.protocol==='https:' && origin.origin===env.PUBLISHER_ORIGIN && !origin.username && !origin.password && !/REPLACE/i.test(origin.host),503,'Publisher is not configured');
  assert(site.protocol==='https:' && site.origin===env.SITE_ORIGIN && url.origin===site.origin && site.origin!==origin.origin && !url.username && !url.password && !url.search && !url.hash,503,'Invalid site configuration');
  assert(/^[A-Za-z0-9-]+$/.test(env.GITHUB_OWNER) && /^[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPO) && /^[A-Za-z0-9_-]+$/.test(env.GITHUB_BRANCH),503,'Invalid repository configuration');
  assert(/^[1-9][0-9]*$/.test(env.GITHUB_OWNER_ID) && /^[1-9][0-9]*$/.test(env.GITHUB_REPO_ID),503,'Numeric GitHub IDs are required');
  assert(env.GITHUB_CLIENT_ID && !env.GITHUB_CLIENT_ID.includes('REPLACE') && env.GITHUB_CLIENT_SECRET && env.SESSION_ENCRYPTION_KEY,503,'Publisher secrets are not configured');
  return env;
}
export function sameOrigin(request,env) {
  assert(request.headers.get('Origin')===env.PUBLISHER_ORIGIN,403,'Untrusted request origin');
  const site=request.headers.get('Sec-Fetch-Site');
  assert(!site || site==='same-origin',403,'Cross-site request rejected');
}
export async function jsonBody(request,max=524288) {
  assert(/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')||''),415,'JSON is required');
  const length=request.headers.get('Content-Length');
  assert(length===null || (/^\d+$/.test(length) && Number(length)<=max),413,'Request is too large');
  assert(!request.headers.has('Content-Encoding'),415,'Content encoding is not supported');
  const reader=request.body?.getReader(); assert(reader,400,'Missing request body');
  const chunks=[]; let size=0;
  try {
    for(;;) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new HttpError(413,'Request is too large');}chunks.push(value);}
    const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  } catch(e) {if(e instanceof HttpError)throw e;throw new HttpError(400,'Invalid JSON');}
}
async function key(env) {
  let bytes;try{bytes=Uint8Array.from(atob(env.SESSION_ENCRYPTION_KEY),c=>c.charCodeAt(0));}catch{throw new HttpError(503,'Invalid encryption configuration');}
  assert(bytes.length===32,503,'Invalid encryption configuration');
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
export async function seal(value,env,context) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},await key(env),new TextEncoder().encode(value));
  return {iv:Array.from(iv),data:Array.from(new Uint8Array(encrypted))};
}
export async function unseal(value,env,context) {
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv),additionalData:new TextEncoder().encode(context)},await key(env),new Uint8Array(value.data)));
}
export function json(value,status=200,headers={}) {return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});}
export function secure(response,request=null,env=null) {
  const h=new Headers(response.headers);
  h.set('Cache-Control','no-store');h.set('Pragma','no-cache');h.set('Referrer-Policy','same-origin');
  h.set('X-Content-Type-Options','nosniff');h.set('X-Frame-Options','DENY');
  h.set('Strict-Transport-Security','max-age=31536000');
  h.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
  h.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'self' https://github.com; frame-ancestors 'none'; object-src 'none'");
  // No wildcard origins and no exposure of GitHub credentials. Only the
  // configured static site can use the owner session from another origin.
  if(request && env && new URL(request.url).pathname.startsWith('/api/') &&
     request.headers.get('Origin')===env.SITE_ORIGIN) {
    h.set('Access-Control-Allow-Origin',env.SITE_ORIGIN);
    h.set('Access-Control-Allow-Credentials','true');
    h.set('Vary','Origin');
    h.set('Access-Control-Allow-Headers','Content-Type, X-CSRF-Token');
    h.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  }
  return new Response(response.body,{status:response.status,headers:h});
}
