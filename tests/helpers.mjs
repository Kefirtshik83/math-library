import {createApp} from '../publisher/src/app.mjs';
import {hash} from '../publisher/src/security.mjs';
export const env={PUBLISHER_ORIGIN:'https://publisher.example',SITE_ORIGIN:'https://owner.github.io',SITE_URL:'https://owner.github.io/math-library/',GITHUB_OWNER:'owner',GITHUB_REPO:'math-library',GITHUB_BRANCH:'main',GITHUB_OWNER_ID:'123',GITHUB_REPO_ID:'456',GITHUB_CLIENT_ID:'test-client',GITHUB_CLIENT_SECRET:'test-secret-not-real',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
export const collections=[{id:'mathematical-notes',title:'Notes',description:'',parent:null,order:10}];
export const article=(extra={})=>({kind:'article',slug:'test',base:null,collection:'mathematical-notes',blocks:[{id:'b1',source:'# Test'},{id:'b2',source:'Text with $x^2$.'}],collections:[],...extra});
export class MemoryStorage {
  data=new Map();tail=Promise.resolve();
  async get(k){return structuredClone(this.data.get(k));}
  async put(k,v){this.data.set(k,structuredClone(v));}
  async delete(k){this.data.delete(k);}
  async list(){return structuredClone(this.data);}
  async transaction(fn){const p=this.tail.then(()=>fn(this));this.tail=p.catch(()=>{});return p;}
}
export function fakeGitHub() {
  const f={calls:[],files:new Map([['collections.json',JSON.stringify(collections,null,2)+'\n']]),user:123,repo:456,owner:123,push:true,head:'a'.repeat(40),commits:[],modes:{},failCommit:false,expired:false};
  const sha=name=>Buffer.from(name).toString('hex').padEnd(40,'0').slice(0,40);
  const entry=(path,name=path)=>({path,sha:sha(name),mode:f.modes[name]||'100644',type:(f.modes[name]==='160000'?'commit':'blob')});
  f.fetch=async(url,options={})=>{
    url=String(url);const parsed=options.body?JSON.parse(options.body instanceof URLSearchParams?'null':String(options.body)):null;
    f.calls.push({url,options,body:parsed});
    const result=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    if(url==='https://github.com/login/oauth/access_token')return result({access_token:'test-only-user-token',token_type:'bearer',expires_in:28800,refresh_token:'discard-this-test-refresh-token'});
    if(options.method==='DELETE')return new Response(null,{status:204});
    if(f.expired)return result({},401);
    if(url==='https://api.github.com/user')return result({id:f.user});
    if(url==='https://api.github.com/repos/owner/math-library')return result({id:f.repo,owner:{id:f.owner},full_name:'owner/math-library',permissions:{push:f.push},archived:false});
    if(url.endsWith('/git/ref/heads/main'))return result({object:{type:'commit',sha:f.head}});
    if(url.includes('/git/commits/'))return result({tree:{sha:'b'.repeat(40)}});
    if(url.endsWith('/git/trees/'+'b'.repeat(40)))return result({tree:[entry('collections.json'),{path:'notes',type:f.modes.notes==='120000'?'blob':'tree',mode:f.modes.notes||'040000',sha:'c'.repeat(40)}]});
    if(url.endsWith('/git/trees/'+'c'.repeat(40)))return result({tree:[...f.files.keys()].filter(k=>k.startsWith('notes/')).map(k=>entry(k.slice(6),k))});
    if(url.includes('/git/blobs/')){
      const key=[...f.files.keys()].find(k=>sha(k)===url.split('/').pop());
      if(!key)throw Error('Unknown fake blob');
      const value=f.files.get(key);return result({encoding:'base64',size:Buffer.byteLength(value),content:Buffer.from(value).toString('base64')});
    }
    if(url==='https://api.github.com/graphql'){
      const input=parsed.variables.input;
      if(input.expectedHeadOid!==f.head || f.failCommit)return result({errors:[{message:'SECRET-UPSTREAM-DETAIL'}]});
      f.commits.push(input);for(const c of input.fileChanges.additions)f.files.set(c.path,Buffer.from(c.contents,'base64').toString());
      f.head=String(f.commits.length).repeat(40);return result({data:{createCommitOnBranch:{commit:{oid:f.head}}}});
    }
    throw Error('Unexpected GitHub call '+url);
  };
  return f;
}
export function harness(overrides={}) {
  const storage=new MemoryStorage(),gh=fakeGitHub();let clock=1_800_000_000_000;
  const environment={...env,...overrides};
  const app=createApp({env:environment,storage,transport:(...a)=>gh.fetch(...a),now:()=>clock,assets:{html:'test html',js:'test js',css:'test css'}});
  const h={app,storage,gh,env:environment,tick:n=>{clock+=n;},cookie:'',csrf:''};
  h.request=(path,{method='GET',body,headers={},auth=true}={})=>app(new Request(environment.PUBLISHER_ORIGIN+path,{method,headers:{...(auth&&h.cookie?{Cookie:h.cookie}:{}),...(method==='POST'?{Origin:environment.PUBLISHER_ORIGIN,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json','X-CSRF-Token':h.csrf}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
  h.begin=async()=>{
    const start=await h.request('/auth/start',{method:'POST'});
    const target=new URL(start.headers.get('Location'));
    const binding=start.headers.getSetCookie()[0].split(';')[0];
    return {start,target,binding,path:'/auth/callback?code=test-code&state='+target.searchParams.get('state')};
  };
  h.login=async()=>{
    const flow=await h.begin();const response=await h.request(flow.path,{headers:{Cookie:flow.binding},auth:false});
    if(response.status===303){h.cookie=response.headers.getSetCookie().find(x=>x.startsWith('__Host-ml-session=')).split(';')[0];h.csrf=(await (await h.request('/api/session')).json()).csrf;}
    return {flow,response};
  };
  h.prepare=async op=>h.request('/api/prepare',{method:'POST',body:op});
  h.publish=async id=>h.request('/api/publish',{method:'POST',body:{id}});
  return h;
}
export {hash};
