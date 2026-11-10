import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {harness,hash} from './helpers.mjs';
const source=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function dom(html,path='articles/coarse-group-cohomology.html?edit=1'){
  const d=new JSDOM(html,{url:'https://owner.github.io/math-library/'+path,runScripts:'outside-only',pretendToBeVisual:true});
  const w=d.window;w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
  Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
  w.alerts=[];w.alert=x=>w.alerts.push(x);w.confirm=()=>true;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.eval(source('assets/content-policy.js'));w.eval(source('assets/vendor/dompurify.min.js'));
  return d;
}
function loadEditor(d,{drafts={},publish}={}){
  const w=d.window;w.localStorage.setItem('ml-editor-drafts-v1',JSON.stringify(drafts));
  w.MLPublisher={open:publish||(()=>Promise.reject(Error('mock not configured'))),connect:()=>{}};
  w.eval(source('assets/math-tools.js'));
  w.MathJax={startup:{promise:Promise.resolve()},tex2svgPromise:async()=>w.document.createElement('div')};
  w.eval(source('assets/editor.js'));return w;
}
const articleData=html=>JSON.parse(new JSDOM(html).window.document.querySelector('#ml-article-data').textContent);
const html=source('articles/coarse-group-cohomology.html');
function click(w,selector){const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();}

test('existing article keeps per-block editing, folds and local drafts with exact baseline',async()=>{
  const d=dom(html),w=loadEditor(d);try{
    assert.equal(w.document.querySelector('#edit-toolbar').hidden,false);
    assert.ok(w.document.querySelectorAll('details.proof-fold').length>=2);
    click(w,'[data-edit-block="b002"]');w.document.querySelector('#edit-source').value='Changed $x_1^2$.';click(w,'[data-action="save-draft"]');await delay(25);
    const draft=JSON.parse(w.localStorage.getItem('ml-editor-drafts-v1'))['coarse-group-cohomology'];
    assert.equal(draft.blocks.find(x=>x.id==='b002').source,'Changed $x_1^2$.');
    assert.equal(draft.baseRevision,articleData(html).sourceSha256);
    assert.ok(draft.blocks.some(x=>x.id==='foldalg'));
  }finally{d.window.close();}
});
test('stale draft retains its old baseline after a newer page is loaded',async()=>{
  const data=articleData(html),draft={...data,baseRevision:'a'.repeat(64)};draft.blocks[1].source='An old edit';
  let sent;const d=dom(html),w=loadEditor(d,{drafts:{[draft.slug]:draft},publish:async op=>{sent=op;throw Error('expected conflict');}});
  try{click(w,'[data-action="publish-article"]');await delay(20);assert.equal(sent.base,'a'.repeat(64));assert.equal(sent.blocks[1].source,'An old edit');assert.ok(w.localStorage.getItem('ml-editor-drafts-v1').includes('An old edit'));}finally{w.close();}
});
test('legacy sourceExact recovers a baseline; legacy draft without one fails closed',async()=>{
  const data=articleData(html),draft={...data};delete draft.baseRevision;delete draft.sourceSha256;
  const d=dom(html),w=loadEditor(d,{drafts:{[draft.slug]:draft}});
  try{await delay(40);const saved=JSON.parse(w.localStorage.getItem('ml-editor-drafts-v1'))[draft.slug];assert.equal(saved.baseRevision,await hash(data.sourceExact));}finally{w.close();}
  delete draft.sourceExact;let sent=false;
  const d2=dom(html),w2=loadEditor(d2,{drafts:{[draft.slug]:draft},publish:async()=>{sent=true;}});
  try{click(w2,'[data-action="publish-article"]');await delay(20);assert.equal(sent,false);assert.ok(w2.document.querySelector('#ml-edit-notice')?.textContent.includes('исходная ревизия'));}finally{w2.close();}
});
test('stored path is never used as a publication target',async()=>{
  const data=articleData(html),draft={...data,baseRevision:data.sourceSha256,path:'.github/workflows/pages.yml'};let sent;
  const d=dom(html),w=loadEditor(d,{drafts:{[draft.slug]:draft},publish:async op=>{sent=op;throw Error('stop');}});
  try{click(w,'[data-action="publish-article"]');await delay(20);assert.equal(sent.slug,data.slug);assert.ok(!Object.hasOwn(sent,'path'));}finally{w.close();}
});
test('malicious localStorage block IDs are ignored instead of becoming markup',()=>{
  const data=articleData(html);data.blocks[1].id='x"><img src=x onerror=evil()>';
  const d=dom(html),w=loadEditor(d,{drafts:{[data.slug]:data}});try{assert.equal(w.document.querySelectorAll('img[onerror]').length,0);assert.ok(w.document.querySelector('[data-edit-block="b002"]'));}finally{w.close();}
});
test('preview rejects raw HTML, dangerous links and attributes but keeps math text',async()=>{
  const d=dom(html),w=loadEditor(d);try{
    click(w,'[data-edit-block="b002"]');const textarea=w.document.querySelector('#edit-source');
    textarea.value='<img src=x onerror=evil()> [X](javascript:evil) [Y](data:text/html,evil) $\\href{javascript:evil}{x}$\n\n::: {.editor-modal-head}';textarea.dispatchEvent(new w.Event('input'));await delay(350);
    const p=w.document.querySelector('#edit-preview');assert.equal(p.querySelectorAll('img,script,[onclick],[onerror],[style]').length,0);
    for(const a of p.querySelectorAll('a'))assert.ok(!/^(javascript|data|vbscript):/i.test(a.getAttribute('href')));
    assert.ok(p.textContent.includes('\\href'));
  }finally{w.close();}
});
test('publishing an editor operation through the real server keeps unrelated blocks',async()=>{
  const h=harness();await h.login();const data=articleData(html);h.gh.files.set('notes/'+data.slug+'.md',data.sourceExact);
  const d=dom(html),w=loadEditor(d,{publish:async op=>{
    const response=await h.prepare(op);assert.equal(response.status,200);const review=await response.json();const result=await h.publish(review.id);assert.equal(result.status,200);return result.json();
  }});
  try{
    click(w,'[data-edit-block="b002"]');w.document.querySelector('#edit-source').value='Updated only this paragraph.';click(w,'[data-action="publish"]');await delay(100);
    assert.equal(h.gh.commits.length,1);const text=h.gh.files.get('notes/'+data.slug+'.md');assert.ok(text.includes('Updated only this paragraph.'));
    for(const b of data.blocks.filter(x=>x.id!=='b002'))assert.ok(text.includes(b.source),b.id);
    assert.deepEqual(Object.keys(JSON.parse(w.localStorage.getItem('ml-editor-drafts-v1'))),[]);
  }finally{w.close();}
});
test('edits made while the publication window is open are preserved',async()=>{
  let resolve,submitted;const d=dom(html),w=loadEditor(d,{publish:op=>{submitted=op;return new Promise(r=>{resolve=r;});}});
  try{
    click(w,'[data-action="publish-article"]');await delay(60);click(w,'[data-edit-block="b002"]');w.document.querySelector('#edit-source').value='Newer local edit';click(w,'[data-action="save-draft"]');
    await delay(80);assert.equal(typeof resolve,'function');resolve({base:'b'.repeat(64),commit:'a'.repeat(40)});await delay(30);
    const saved=JSON.parse(w.localStorage.getItem('ml-editor-drafts-v1'))['coarse-group-cohomology'];
    assert.equal(saved.blocks.find(b=>b.id==='b002').source,'Newer local edit');assert.equal(saved.baseRevision,'b'.repeat(64));assert.notEqual(submitted.blocks[1].source,'Newer local edit');
  }finally{w.close();}
});
test('new articles and section drafts still work with a null creation baseline',()=>{
  const d=dom(source('index.html'),'index.html?edit=1'),w=loadEditor(d);try{
    click(w,'[data-action="new-collection"]');w.document.querySelector('#collection-title').value='Algebra';w.document.querySelector('#collection-id').value='algebra';click(w,'[data-action="create-collection-local"]');
    const sections=JSON.parse(w.localStorage.getItem('ml-collection-drafts-v1'));assert.equal(sections.algebra.title,'Algebra');
    click(w,'[data-action="new-article"]');w.document.querySelector('#new-title').value='Test';w.document.querySelector('#new-slug').value='test';w.document.querySelector('#new-category').value='algebra';
    // Publishing starts without navigating in jsdom. The rejected mock leaves the draft.
    click(w,'[data-action="create-publish"]');const drafts=JSON.parse(w.localStorage.getItem('ml-editor-drafts-v1'));assert.equal(drafts.test.baseRevision,null);assert.equal(drafts.test.collection,'algebra');
  }finally{w.close();}
});
test('publisher transport checks origin, window and channel; spoofed success is ignored',async()=>{
  const d=dom('<meta name="ml-publisher" content="https://publisher.example">','index.html'),w=d.window;
  const outgoing=[];const popup={closed:false,postMessage:(m,o)=>outgoing.push({m,o})};let openURL;w.open=url=>{openURL=url;return popup;};
  w.eval(source('assets/publisher.js'));const promise=w.MLPublisher.open({kind:'collections',collections:[]});
  let settled=false;promise.then(()=>{settled=true;});const channel=new URLSearchParams(new URL(openURL).hash.slice(1)).get('channel');
  const event=(origin,from,data)=>w.dispatchEvent(new w.MessageEvent('message',{origin,source:from,data:{...data,channel}}));
  try{
    event('https://evil.example',popup,{type:'ml-publish-done'});event('https://publisher.example',{}, {type:'ml-publish-done'});await delay(10);assert.equal(settled,false);
    event('https://publisher.example',popup,{type:'ml-publish-ready'});assert.equal(outgoing.length,1);assert.equal(outgoing[0].o,'https://publisher.example');
    event('https://publisher.example',popup,{type:'ml-publish-done',result:{commit:'a'.repeat(40)}});assert.equal((await promise).commit,'a'.repeat(40));
  }finally{w.close();}
});
test('publisher review renders malicious source as text, and never confirms automatically',async()=>{
  const d=dom(source('publisher/public/publish.html')),w=d.window;
  // The DOM location need not be the broker for this isolated script test: fetch is stubbed.
  const calls=[],sender={postMessage:()=>{}};Object.defineProperty(w,'opener',{value:sender});
  const channel='a'.repeat(43);w.history.replaceState(null,'','#channel='+channel);
  w.fetch=async(path,options={})=>{
    calls.push({path,options});const value=path==='/config'?{siteOrigin:'https://owner.github.io',siteURL:'https://owner.github.io/math-library/',repository:'owner/math-library'}:path==='/api/session'?{csrf:'test'}:{id:'review',head:'a'.repeat(40),changes:[{path:'notes/test.md',before:'old',after:'<img src=x onerror=evil()> $\\href{javascript:x}{y}$'}]};
    return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  };
  try{
    w.eval(source('publisher/public/publish.js'));await delay(20);
    w.dispatchEvent(new w.MessageEvent('message',{origin:'https://evil.example',source:sender,data:{type:'ml-publish-draft',channel,operation:{kind:'article'}}}));await delay(10);assert.ok(!calls.some(c=>c.path==='/api/prepare'));
    w.dispatchEvent(new w.MessageEvent('message',{origin:'https://owner.github.io',source:sender,data:{type:'ml-publish-draft',channel,operation:{kind:'article'}}}));await delay(20);
    assert.ok(calls.some(c=>c.path==='/api/prepare'));assert.ok(!calls.some(c=>c.path==='/api/publish'));
    assert.equal(w.document.querySelectorAll('img,script:not([src])').length,0);assert.ok(w.document.querySelector('#changes').textContent.includes('<img'));
    assert.equal(w.document.querySelector('#publish').disabled,true);
  }finally{w.close();}
});
test('production MathJax renders AMS math without HTML/require/autoload commands',async()=>{
  const d=dom('<div id="math">\\[\\frac{x^2}{2}+\\mathbb{R}\\]</div><div id="evil">\\(\\href{javascript:evil()}{x}\\require{html}\\style{position:fixed}{y}\\)</div>'),w=d.window;
  try{
    w.eval(source('assets/mathjax-config.js'));w.eval(source('assets/vendor/mathjax-tex-svg.js'));
    await Promise.race([w.MathJax.startup.promise,delay(5000).then(()=>{throw Error('MathJax timed out');})]);
    assert.ok(w.document.querySelector('#math svg'));assert.equal(w.document.querySelectorAll('a[href^="javascript:"]').length,0);
    assert.deepEqual(Array.from(w.MathJax.config.tex.packages),['base','ams','newcommand']);
    assert.ok(![...w.document.querySelectorAll('#evil [style]')].some(e=>e.getAttribute('style').includes('position:fixed')));
  }finally{w.close();}
});

test('a successful publication cannot overwrite another tab’s newer local draft',async()=>{
  let resolve;const d=dom(html),w=loadEditor(d,{publish:()=>new Promise(r=>{resolve=r;})});
  try{
    click(w,'[data-action="publish-article"]');await delay(70);
    const other={...articleData(html),baseRevision:articleData(html).sourceSha256};other.blocks[1].source='Different tab newer edit';
    w.localStorage.setItem('ml-editor-drafts-v1',JSON.stringify({[other.slug]:other}));
    await delay(80);assert.equal(typeof resolve,'function');resolve({base:'b'.repeat(64),commit:'a'.repeat(40)});await delay(30);
    const saved=JSON.parse(w.localStorage.getItem('ml-editor-drafts-v1'))[other.slug];
    assert.equal(saved.blocks[1].source,'Different tab newer edit');assert.equal(saved.baseRevision,other.baseRevision);
  }finally{w.close();}
});

test('an OAuth-detached popup drops its stored request and cannot auto-prepare it',async()=>{
  const d=dom(source('publisher/public/publish.html')),w=d.window,calls=[];
  w.sessionStorage.setItem('ml-pending',JSON.stringify({channel:'a'.repeat(43),operation:{kind:'article'}}));
  w.fetch=async path=>{calls.push(path);return new Response(JSON.stringify(path==='/config'?{siteOrigin:'https://owner.github.io',siteURL:'https://owner.github.io/math-library/',repository:'owner/math-library'}:{csrf:'test'}));};
  try{w.eval(source('publisher/public/publish.js'));await delay(30);assert.ok(!calls.includes('/api/prepare'));assert.equal(w.sessionStorage.getItem('ml-pending'),null);}finally{w.close();}
});

test('new editor recovers the revision from a cached pre-upgrade HTML page',async()=>{
  const d=dom(html),w=d.window,data=articleData(html);delete data.sourceSha256;
  w.document.querySelector('#ml-article-data').textContent=JSON.stringify(data);
  loadEditor(d);
  try{await delay(50);const saved=JSON.parse(w.localStorage.getItem('ml-editor-drafts-v1'))[data.slug];assert.equal(saved.baseRevision,await hash(data.sourceExact));}finally{w.close();}
});

test('source highlighting escapes user text and does not execute raw HTML',()=>{
  const d=dom(html),w=loadEditor(d);try{
    click(w,'[data-edit-block="b002"]');const area=w.document.querySelector('#edit-source');
    area.value='<img src=x onerror=evil()> $\\frac{a}{b}$';area.dispatchEvent(new w.Event('input'));
    assert.equal(w.document.querySelector('#edit-highlight img'),null);
    assert.ok(w.document.querySelector('#edit-highlight .tex-command'));
  }finally{w.close();}
});
