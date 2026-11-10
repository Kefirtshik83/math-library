/* Shared by the editor, publisher and adversarial tests. No HTML or Git API here. */
(() => {
  'use strict';
  const LIMIT = {bytes:262144, blocks:1000, block:65536, collections:200, depth:12};
  const badIds = new Set(['__proto__','constructor','prototype','draft']);
  function fail(message) {throw new Error(message);}
  function object(v, keys, required=keys) {
    if (!v || Array.isArray(v) || typeof v!=='object' ||
        Object.keys(v).some(k=>!keys.includes(k)) || required.some(k=>!Object.hasOwn(v,k))) fail('Invalid fields');
  }
  function string(v,max,label) {
    if(typeof v!=='string' || !v.trim() || v.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail('Invalid '+label);
    return v;
  }
  function slug(v) {
    if(typeof v!=='string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(v) || badIds.has(v)) fail('Invalid identifier');
    return v;
  }
  function collection(c) {
    object(c,['id','title','description','parent','order']); slug(c.id);
    string(c.title,200,'title');
    if(typeof c.description!=='string' || c.description.length>2000) fail('Invalid description');
    if(c.parent!==null) slug(c.parent);
    if(!Number.isSafeInteger(c.order) || c.order<0 || c.order>100000) fail('Invalid order');
    return c;
  }
  function collections(items) {
    if(!Array.isArray(items) || !items.length || items.length>LIMIT.collections) fail('Invalid collections');
    const byId=new Map();
    for(const c of items) {collection(c); if(byId.has(c.id)) fail('Duplicate collection'); byId.set(c.id,c);}
    for(const c of items) {
      const seen=new Set([c.id]); let parent=c.parent;
      while(parent!==null) {
        if(!byId.has(parent) || seen.has(parent) || seen.size>LIMIT.depth) fail('Invalid collection hierarchy');
        seen.add(parent); parent=byId.get(parent).parent;
      }
    }
    return items;
  }
  function fold(source) {
    const s=source.trim();
    if(s==='<!-- ml:fold-end -->') return {kind:'end'};
    const m=s.match(/^<!-- ml:fold-start title="([^"\r\n]{1,200})" open="(true|false)" -->$/);
    if(m) return {kind:'start',title:m[1],open:m[2]==='true'};
    if(/<!--\s*ml:fold-/.test(s)) fail('Invalid fold marker');
    return null;
  }
  function blocks(items) {
    if(!Array.isArray(items) || !items.length || items.length>LIMIT.blocks) fail('Invalid blocks');
    let depth=0; const ids=new Set();
    for(const b of items) {
      object(b,['id','source']);
      if(typeof b.id!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.id) || badIds.has(b.id) || ids.has(b.id)) fail('Invalid or duplicate block ID');
      ids.add(b.id); string(b.source,LIMIT.block,'block source');
      if(/<!--\s*ml:(block|collection):/i.test(b.source)) fail('Embedded structural marker');
      const f=fold(b.source);
      if(f?.kind==='start' && ++depth>LIMIT.depth) fail('Too many nested folds');
      if(f?.kind==='end' && --depth<0) fail('Unmatched fold');
    }
    if(depth) fail('Unclosed fold');
    return items;
  }
  function serialize(items,cid,meta=true) {
    blocks(items); slug(cid);
    const source=(meta?'<!-- ml:collection:'+cid+' -->\n\n':'')+items.map(b=>'<!-- ml:block:'+b.id+' -->\n'+b.source.trim()+'\n\n').join('');
    if(new TextEncoder().encode(source).length>LIMIT.bytes) fail('Article is too large');
    return source;
  }
  function operation(op) {
    if(op?.kind==='article') {
      object(op,['kind','slug','base','collection','blocks','collections']);
      slug(op.slug); slug(op.collection); blocks(op.blocks);
      if(op.base!==null && (typeof op.base!=='string' || !/^[a-f0-9]{64}$/.test(op.base))) fail('Invalid original revision');
      serialize(op.blocks,op.collection);
    } else if(op?.kind==='collections') {
      object(op,['kind','collections']);
    } else fail('Unknown operation');
    if(!Array.isArray(op.collections) || op.collections.length>LIMIT.depth) fail('Invalid collection additions');
    op.collections.forEach(collection);
    if(op.kind==='collections' && !op.collections.length) fail('No collections to add');
    return op;
  }
  // Used for localStorage input too: browser storage is data, not trusted markup.
  function draft(d) {
    slug(d?.slug); slug(d.collection); blocks(d.blocks); serialize(d.blocks,d.collection);
    if(typeof d.title!=='string' || d.title.length>1000) fail('Invalid draft title');
    return d;
  }
  function safeHref(value) {
    if(typeof value!=='string' || /[\x00-\x20\x7f\\]/.test(value) || value.startsWith('//')) return null;
    if(/^(?:https?:\/\/|mailto:)/i.test(value)) return value;
    if(/^[^:?#]*:/.test(value)) return null;
    return value;
  }
  globalThis.MLPolicy=Object.freeze({LIMIT,object,slug,collection,collections,fold,blocks,serialize,operation,draft,safeHref});
})();
