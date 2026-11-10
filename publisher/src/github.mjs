import '../../assets/content-policy.js';
import {assert,HttpError,hash} from './security.mjs';
const P=globalThis.MLPolicy;
const SHA=/^[a-f0-9]{40}$/;
export class GitHub {
  constructor(env, token, transport=fetch) {this.env=env;this.token=token;this.transport=(input,init)=>transport(input,init);this.repo=`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;}
  async request(path,body,method) {
    assert(path.startsWith('/') && !path.startsWith('//'),500,'Invalid API path');
    const response=await this.transport('https://api.github.com'+path,{
      method:method||(body?'POST':'GET'),redirect:'manual',signal:AbortSignal.timeout(12000),
      headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+this.token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'math-library-publisher','Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(response.status===401) throw new HttpError(401,'GitHub authorization has expired. Sign in again.');
    if(response.status===403) throw new HttpError(403,'GitHub denied access or its rate limit was reached.');
    assert(response.ok,502,'GitHub request failed');
    // Never reflect GitHub errors, tokens, upstream bodies or exception stacks.
    const raw=await response.text();assert(raw.length<=2_000_000,502,'GitHub response is too large');
    let result;try{result=JSON.parse(raw);}catch{throw new HttpError(502,'Invalid GitHub response');}
    return result;
  }
  async identity() {
    const user=await this.request('/user');
    assert(String(user.id)===this.env.GITHUB_OWNER_ID,403,'Only the configured owner may publish.');
    const repo=await this.request(this.repo);
    assert(String(repo.id)===this.env.GITHUB_REPO_ID && String(repo.owner?.id)===this.env.GITHUB_OWNER_ID && repo.full_name?.toLowerCase()===`${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}`.toLowerCase() && repo.permissions?.push===true && !repo.archived,403,'Repository identity or write permission mismatch.');
    return user;
  }
  async tree(oid) {
    assert(SHA.test(oid),502,'Invalid Git object ID');
    const data=await this.request(`${this.repo}/git/trees/${oid}`);
    assert(!data.truncated && Array.isArray(data.tree) && data.tree.length<=5000,422,'Unsupported repository tree');
    return data.tree;
  }
  regular(entry) {assert(entry && entry.type==='blob' && entry.mode==='100644' && SHA.test(entry.sha),422,'Only regular content files can be edited.');}
  async blob(entry) {
    this.regular(entry);
    const data=await this.request(`${this.repo}/git/blobs/${entry.sha}`);
    assert(data.encoding==='base64' && Number.isInteger(data.size) && data.size<=P.LIMIT.bytes && typeof data.content==='string' && data.content.length<400000,422,'Unsupported content file');
    try {
      const bytes=Uint8Array.from(atob(data.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
      assert(bytes.length===data.size,502,'Invalid file size');
      return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    } catch(e) {if(e instanceof HttpError) throw e; throw new HttpError(422,'Content is not UTF-8 text');}
  }
  async snapshot(op) {
    const ref=await this.request(`${this.repo}/git/ref/heads/${this.env.GITHUB_BRANCH}`);
    assert(ref.object?.type==='commit' && SHA.test(ref.object.sha),422,'Invalid publication branch');
    const head=ref.object.sha;
    const commit=await this.request(`${this.repo}/git/commits/${head}`);
    const root=await this.tree(commit.tree?.sha);
    const collectionsEntry=root.find(e=>e.path==='collections.json');
    const collectionsText=await this.blob(collectionsEntry);
    let collections;try{collections=P.collections(JSON.parse(collectionsText));}catch{throw new HttpError(422,'Invalid remote collections');}
    let source=null;
    if(op.kind==='article') {
      const dir=root.find(e=>e.path==='notes');
      assert(dir?.type==='tree' && dir.mode==='040000',422,'The notes directory must be a real Git tree');
      const entries=await this.tree(dir.sha);
      const entry=entries.find(e=>e.path===op.slug+'.md');
      if(entry) source=await this.blob(entry);
    }
    return {head,collections,collectionsText,source};
  }
  async prepare(op) {
    try {P.operation(op);} catch(e) {throw new HttpError(422,e.message);}
    await this.identity();
    const snap=await this.snapshot(op), next=structuredClone(snap.collections);
    for(const c of op.collections) {
      assert(!next.some(x=>x.id===c.id),409,'A section with this identifier already exists. Reload before publishing.');
      next.push(c);
    }
    try{P.collections(next);}catch(e){throw new HttpError(422,e.message);}
    const changes=[];
    if(op.collections.length) changes.push({path:'collections.json',before:snap.collectionsText,after:JSON.stringify(next,null,2)+'\n'});
    if(op.kind==='article') {
      assert(next.some(x=>x.id===op.collection),422,'Unknown article section');
      assert((snap.source===null && op.base===null) || (snap.source!==null && op.base!==null && await hash(snap.source)===op.base),409,'This draft is based on a different revision. Your draft is preserved; compare it with the current article before publishing.');
      const after=P.serialize(op.blocks,op.collection);
      if(after!==snap.source) changes.push({path:`notes/${op.slug}.md`,before:snap.source||'',after});
    }
    assert(changes.length>0,409,'No changes to publish.');
    return {head:snap.head,changes,base:op.kind==='article'?await hash(P.serialize(op.blocks,op.collection)):null,kind:op.kind};
  }
  async publish(review) {
    await this.identity(); // Recheck owner and repository permissions immediately before the write.
    const additions=review.changes.map(c=>({path:c.path,contents:encode(c.after)}));
    // No arbitrary GraphQL, paths, branches, deletions, author or message from the client.
    const result=await this.request('/graphql',{
      query:'mutation Publish($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input:$input) { commit { oid } } }',
      variables:{input:{branch:{repositoryNameWithOwner:`${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}`,branchName:this.env.GITHUB_BRANCH},expectedHeadOid:review.head,
        message:{headline:review.kind==='article'?'Publish mathematical article':'Add library section'},fileChanges:{additions}}}
    });
    if(result.errors?.length) throw new HttpError(409,'GitHub did not confirm the commit. The branch may have changed or a rule blocked publication. Review again; nothing will be force-pushed.');
    const oid=result.data?.createCommitOnBranch?.commit?.oid;
    assert(SHA.test(oid),502,'GitHub did not confirm a commit. Check history before retrying.');
    return {commit:oid,base:review.base,url:`https://github.com/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/commit/${oid}`};
  }
}
function encode(value) {const bytes=new TextEncoder().encode(value);let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.slice(i,i+8192));return btoa(s);}
