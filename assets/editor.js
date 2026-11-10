/* Mathematical Library editor. Publication credentials stay on a separate origin. */
(() => {
  'use strict';
  const $ = (s, scope=document) => scope.querySelector(s);
  const all = (s, scope=document) => [...scope.querySelectorAll(s)];
  const dataEl = $('#ml-article-data');
  const draftSlug = new URL(location.href).searchParams.get('draft');
  const params = new URL(location.href).searchParams;
  const STORAGE = 'ml-editor-drafts-v1';
  const policy = globalThis.MLPolicy;
  const COL_DRAFTS = 'ml-collection-drafts-v1';
  const publishedCollections = JSON.parse($('#ml-collections-data')?.textContent || '[]');
  let current = dataEl ? JSON.parse(dataEl.textContent) : null;
  if(current){current.collection ||= 'mathematical-notes';current.sourceHasMeta ??= false;}
  let selected = null, editing = false, publishing = false;
  if(current && /^[a-f0-9]{64}$/.test(current.sourceSha256||'')) current.baseRevision=current.sourceSha256;
  // Remove obsolete repository settings, never persist credentials.
  try {localStorage.removeItem('ml-gh-settings-v1');} catch(_) {}
  async function recoverBase(article) {
    if(Object.hasOwn(article,'baseRevision'))return;
    if(typeof article.sourceExact==='string'){
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(article.sourceExact));
      article.baseRevision=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
      if(current===article)remember();
    }
    // Old drafts without an original source remain exportable, but cannot overwrite a note.
  }

  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function draftsRead() {
    try {
      const raw=JSON.parse(localStorage.getItem(STORAGE)||'{}'),clean=Object.create(null);
      for(const [key,value] of Object.entries(raw)){
        try{policy.draft(value);if(value.slug===key)clean[key]=value;}catch(_){}
      }
      return clean;
    }catch(_){return Object.create(null);}
  }
  function draftsSave(map) {try {localStorage.setItem(STORAGE,JSON.stringify(map));return true;} catch(e) {alert('Could not save local draft: '+e.message);return false;} }
  function remember() {if(!current)return;const d=draftsRead();d[current.slug]=current;draftsSave(d);}
  function serialize(blocks, collection='mathematical-notes', includeMeta=true) {
    return policy.serialize(blocks,collection,includeMeta);
  }
  function readLocalCollections() {
    try {
      const raw=JSON.parse(localStorage.getItem(COL_DRAFTS)||'{}'),clean=Object.create(null);
      for(const [key,value] of Object.entries(raw)){try{policy.collection(value);if(value.id===key)clean[key]=value;}catch(_){}}
      return clean;
    }catch(_){return Object.create(null);}
  }
  function saveLocalCollections(items) {try{localStorage.setItem(COL_DRAFTS,JSON.stringify(items));return true;}catch(e){alert('Не удалось сохранить раздел: '+e.message);return false;}}
  function allCollections(){return [...publishedCollections,...Object.values(readLocalCollections()).filter(c=>!publishedCollections.some(p=>p.id===c.id))];}
  function selectedCollection(){return current?.collection||$('meta[name="ml-collection"]')?.content||'mathematical-notes';}
  function hierarchyOptions(select, chooseRoot=false, selected=null){
    if(!select)return;
    const items=allCollections(),children=new Map();
    for(const c of items){const pid=c.parent||'';if(!children.has(pid))children.set(pid,[]);children.get(pid).push(c);}
    select.replaceChildren();
    if(chooseRoot){const o=document.createElement('option');o.value='';o.textContent='Верхний уровень';select.append(o);}
    const seen=new Set();
    function traverse(parent,depth){
      for(const c of children.get(parent)||[]){if(seen.has(c.id))continue;seen.add(c.id);
        const option=document.createElement('option');option.value=c.id;option.textContent='  '.repeat(depth)+c.title+(publishedCollections.some(x=>x.id===c.id)?'':' (локальный)');select.append(option);
        traverse(c.id,depth+1);
      }
    }
    traverse('',0);
    if(selected !== null && [...select.options].some(o=>o.value===selected))select.value=selected;
  }
  function shortCollectionTitle(id){return allCollections().find(c=>c.id===id)?.title||id;}
  function defaultArticleCollection(){return allCollections().some(c=>c.id===selectedCollection())?selectedCollection():'mathematical-notes';}

  function makeId() { return 'u'+(globalThis.crypto&&crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,12):String(Date.now())+Math.random().toString(36).slice(2,7)); }
  function currentIsDraft() {return !!(current && (draftSlug || (!dataEl)));}
  function basename(s) {return (s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');}
  function setStatus(id,s,error=false) {const e=$('#'+id);if(e){e.textContent=s||'';e.style.color=error?'#c84444':'';}}

  // Math is shielded BEFORE lightweight Markdown formatting. Otherwise an asterisk
  // in C_*(X;R) can accidentally open an italic span extending through paragraphs.
  // The final published article is still rendered by Pandoc, not by this preview.
  function liveHTML(source) {
    let s=String(source).trim(), cls='';
    const open=s.match(/^:::\s*\{\.([\w-]+)[^}]*\}\s*\n/);
    if(open) {cls=['theorem','lemma','proof','remark','insight'].includes(open[1])?open[1]:'';s=s.slice(open[0].length).replace(/\n:::\s*$/,'');}

    const math=[];
    const marker=(i)=>`MLMATHPLACEHOLDER${i}END`;
    const isEscaped=(text,index)=>{
      let n=0; for(let j=index-1;j>=0 && text[j]==='\\';j--)n++;
      return n%2===1;
    };
    let protectedText='';
    for(let i=0;i<s.length;) {
      let opening='',closing='',display=false;
      if(s.startsWith('\\[',i) && !isEscaped(s,i)) {opening='\\[';closing='\\]';display=true;}
      else if(s.startsWith('\\(',i) && !isEscaped(s,i)) {opening='\\(';closing='\\)';}
      else if(s.startsWith('$$',i) && !isEscaped(s,i)) {opening='$$';closing='$$';display=true;}
      else if(s[i]==='$' && !isEscaped(s,i)) {opening='$';closing='$';}
      if(!opening) {protectedText+=s[i++];continue;}
      let end=i+opening.length;
      while((end=s.indexOf(closing,end))!==-1 && isEscaped(s,end))end+=closing.length;
      if(end<0) {protectedText+=s[i++];continue;}
      const content=s.slice(i+opening.length,end);
      if(!content.trim()) {protectedText+=s[i++];continue;}
      const id=math.length;
      const tex=(display?'\\[':'\\(')+content+(display?'\\]':'\\)');
      math.push({display,html:escapeHTML(tex)});
      protectedText+=(display?'\n\n':'')+marker(id)+(display?'\n\n':'');
      i=end+closing.length;
    }

    function formatInline(p) {
      let h=escapeHTML(p);
      h=h.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
         .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g,'<em>$1</em>')
         .replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g,(original,label,url)=>{
           // Link previews must behave like the published article, but never
           // turn an untrusted javascript:/data: URI into an active link.
           const decoded=document.createElement('textarea');decoded.innerHTML=url;
           if(policy.safeHref(decoded.value)===null)return original;
           return '<a href="'+url+'">'+label+'</a>';
         });
      return h.replace(/MLMATHPLACEHOLDER(\d+)END/g, (token,n)=>{
        const m=math[Number(n)];
        if(!m)return token;
        return m.display?`<div class="math display">${m.html}</div>`:`<span class="math inline">${m.html}</span>`;
      });
    }
    const sections=protectedText.split(/\n\s*\n/).filter(x=>x.trim());
    const paragraphs=sections.map(text=>{
      const p=text.trim();
      if(/^MLMATHPLACEHOLDER\d+END$/.test(p))return formatInline(p);
      const heading=p.match(/^(#{1,5})\s+([^\n]*)/);
      if(heading)return `<h${heading[1].length}>${formatInline(heading[2])}</h${heading[1].length}>`;
      // Keep newlines in source as ordinary spaces, as in Markdown paragraphs.
      // Preserve the fenced-div class (theorem, proof, lemma, ...).
      return `<p>${formatInline(p.replace(/\n/g,' '))}</p>`;
    });
    return DOMPurify.sanitize(`<div class="${escapeHTML(cls)}">${paragraphs.join('')}</div>`,{
      ALLOWED_TAGS:['div','p','span','h1','h2','h3','h4','h5','strong','em','a'],
      ALLOWED_ATTR:['class','href'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false
    });
  }
  // MathJax typesetting requests must be serialized; rapid edits should not
  // start overlapping renders on the same preview DOM subtree.
  let mathQueue=Promise.resolve(), previewSeq=0;
  function renderMath(el) {
    if(!el) return Promise.resolve();
    mathQueue=mathQueue.catch(()=>{}).then(async()=>{
      if(!el.isConnected || !window.MathJax?.typesetPromise)return;
      window.MathJax.typesetClear?.([el]);
      await window.MathJax.typesetPromise([el]);
    }).catch(e=>{console.warn('MathJax preview:',e);});
    return mathQueue;
  }
  function updatePreview() {
    const el=$('#edit-preview');if(!el)return;
    const directive=foldDirective($('#edit-source').value);
    const html=directive?.kind==='start'
       ?'<div class="proof-fold-summary"><strong>'+escapeHTML(directive.title)+'</strong> — '+(directive.open?'раскрыта':'скрыта')+'</div>'
       :directive?.kind==='end'?'<p>Закрытие плашки</p>':liveHTML($('#edit-source').value);
    const seq=++previewSeq;
    mathQueue=mathQueue.catch(()=>{}).then(async()=>{
      if(seq!==previewSeq || !el.isConnected)return;
      window.MathJax?.typesetClear?.([el]);
      el.innerHTML=html;
      if(window.MathJax?.typesetPromise)await window.MathJax.typesetPromise([el]);
    }).catch(e=>{console.warn('MathJax preview:',e);});
  }
  let timer=0;
  $('#edit-source')?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(updatePreview,280);});

  // Every panel is represented by two ordinary source blocks (start / end).
  // Its content is independently editable, and rebuilding the article preserves
  // the panel rather than silently flattening it.
  function foldDirective(source) {
    const t=String(source).trim();
    if(t==='<!-- ml:fold-end -->') return {kind:'end'};
    const m=t.match(/^<!-- ml:fold-start title="([^"]+)" open="(true|false)" -->$/);
    if(m) return {kind:'start',title:m[1],open:m[2]==='true'};
    return null;
  }
  function foldStartSource(title,open) {
    // A double quote is excluded by the directive format; a single quote is fine.
    return '<!-- ml:fold-start title="'+String(title).replace(/"/g,'”').replace(/[\r\n]/g,' ').trim()+'" open="'+(open?'true':'false')+'" -->';
  }
  function checkFolds(blocks) {
    const stack=[];
    for(const b of blocks) {
      const fold=foldDirective(b.source);
      if(fold?.kind==='start') stack.push(b.id);
      else if(fold?.kind==='end') {
        if(!stack.length) return 'Обнаружено закрытие плашки без открытия.';
        stack.pop();
      }
    }
    if(stack.length) return 'У плашки отсутствует закрывающий маркер.';
    return '';
  }
  function upgradeLegacyProofPanels(article) {
    // v4-v6 grouped the first two proofs only during the HTML build. Earlier
    // browser drafts contain no panel metadata, so restore it before editing.
    if(article?.slug!=='coarse-group-cohomology' ||
       article.blocks.some(b=>foldDirective(b.source)?.kind==='start')) return false;
    const blocks=article.blocks;
    const positions=['b006','b040','b060'].map(id=>blocks.findIndex(b=>b.id===id));
    if(positions.some(x=>x<0)) return false;
    function after(id,newBlock) {blocks.splice(blocks.findIndex(b=>b.id===id)+1,0,newBlock);}
    function before(id,newBlock) {blocks.splice(blocks.findIndex(b=>b.id===id),0,newBlock);}
    after('b006',{id:'foldalg',source:foldStartSource('Алгебраическое доказательство',true)});
    before('b040',{id:'foldalgend',source:'<!-- ml:fold-end -->'});
    after('b040',{id:'foldgeo',source:foldStartSource('Геометрическое доказательство',true)});
    before('b060',{id:'foldgeoend',source:'<!-- ml:fold-end -->'});
    return true;
  }

  function loadDraftArticle() {
    if(draftSlug) {
      const d=draftsRead()[draftSlug];
      if(!d) {$('#article-content').innerHTML='<p>Этот черновик не найден на данном устройстве. Он хранится только в этом браузере, пока не опубликован.</p>';return;}
      current=structuredClone(d);

    } else if(current){
      const d=draftsRead()[current.slug];
      if(d) current=structuredClone(d);
    }
    if(current) {
      policy.draft(current); recoverBase(current);
      const migrated=upgradeLegacyProofPanels(current);
      if(migrated) remember();
      current.collection ||= 'mathematical-notes';
      current.sourceHasMeta ??= false;
      if(draftSlug || draftsRead()[current.slug])renderArticleBlocks();
    }
  }

  function makeFoldElement(b,info) {
    const details=document.createElement('details');
    details.className='proof-fold custom-fold';
    details.id='block-'+b.id;
    details.dataset.blockId=b.id;
    details.open=info.open;
    const summary=document.createElement('summary');
    summary.className='proof-fold-summary';
    summary.innerHTML='<span class="proof-fold-title">'+escapeHTML(info.title)+'</span>'+
      '<span class="proof-fold-toggle"><span class="when-open">Скрыть</span><span class="when-closed">Показать</span><span class="fold-chevron"></span></span>'+
      '<span class="fold-editor-control">'+
      '<button type="button" data-edit-block="'+escapeHTML(b.id)+'" title="Изменить название плашки">✎</button>'+
      '<button type="button" data-add-after="'+escapeHTML(b.id)+'" title="Добавить внутрь">＋</button>'+
      '<button type="button" data-copy-link="'+escapeHTML(b.id)+'" title="Ссылка на плашку">↗</button></span>';
    const body=document.createElement('div');body.className='proof-fold-body';
    details.append(summary,body);
    return {details,body};
  }
  function renderBlock(b) {
    const div=document.createElement('div');
    div.className='editable-block';div.dataset.blockId=b.id;div.id='block-'+b.id;
    div.innerHTML='<div class="block-tools"><button type="button" data-edit-block="'+escapeHTML(b.id)+'">✎ Изменить</button><button type="button" data-add-after="'+escapeHTML(b.id)+'">＋</button><button type="button" data-copy-link="'+escapeHTML(b.id)+'">↗</button></div><div class="article-live-block"></div>';
    const content=$('.article-live-block',div);
    const html=liveHTML(b.source);
    if(/^:::\s*\{\.proof(?:\s|\})/.test(b.source.trim())) {
      content.innerHTML='<details class="proof-fold lemma-fold" open><summary class="proof-fold-summary"><span class="proof-fold-title">Доказательство</span><span class="proof-fold-toggle"><span class="when-open">Скрыть доказательство</span><span class="when-closed">Показать доказательство</span><span class="fold-chevron"></span></span></summary><div class="proof-fold-body">'+html+'</div></details>';
    } else content.innerHTML=html;
    return div;
  }
  function renderArticleBlocks() {
    if(!current)return;
    const el=$('#article-content');if(!el)return;
    const foldError=checkFolds(current.blocks);
    if(foldError) { console.warn('Article panels:',foldError);return; }
    el.replaceChildren();
    const containers=[el];
    for(const b of current.blocks) {
      const fold=foldDirective(b.source);
      if(fold?.kind==='start') {
        const {details,body}=makeFoldElement(b,fold);
        containers[containers.length-1].append(details);
        containers.push(body);
      } else if(fold?.kind==='end') containers.pop();
      else containers[containers.length-1].append(renderBlock(b));
    }
    renderMath(el);
  }
  function updateBlockView(id) {
    const b=current?.blocks.find(x=>x.id===id);
    const el=document.getElementById('block-'+id);
    if(!b) return;
    if(el) { const content=$('.article-live-block',el);
      if(content) {content.innerHTML=liveHTML(b.source);renderMath(content);} else renderArticleBlocks();
    } else renderArticleBlocks();
  }

  function switchMode(on) {
    editing=!!on;document.documentElement.classList.toggle('ml-edit-mode',editing);
    const bar=$('#edit-toolbar');if(bar)bar.hidden=!editing;
    if(editing){renderDraftLinks();renderCollectionDrafts();}
    // Deep-link mode is bookmarkable; switching it off doesn't require any GitHub login.
  }
  function openDialog(name) {const e=$('#'+name);if(!e)return;if(!e.open)e.showModal();}
  function closeDialogs() {all('dialog[open]').forEach(d=>d.close());}

  function openEdit(id, add=false) {
    if(!current) return;
    const idx=current.blocks.findIndex(b=>b.id===id);
    if(idx<0) return;
    selected={id,add};
    $('#edit-dialog-title').textContent=add?'Добавить блок':'Редактировать блок';
    $('#edit-hint').textContent='Изменяется только выбранный фрагмент статьи. Плашки и соседние блоки сохраняются. Для создания нового блока используйте кнопку ＋.';
    $('#edit-source').value=add?'':current.blocks[idx].source;
    setStatus('edit-error','');openDialog('edit-dialog');updatePreview();$('#edit-source').focus();
  }
  function applyChange() {
    if(!selected||!current)return false;
    const content=$('#edit-source').value.trim();if(!content){setStatus('edit-error','Текст блока не может быть пустым.',true);return false;}
    const idx=current.blocks.findIndex(b=>b.id===selected.id);
    if(idx<0)return false;
    const next=structuredClone(current.blocks);
    if(selected.add){const b={id:makeId(),source:content};next.splice(idx+1,0,b);}
    else next[idx].source=content;
    let invalid=checkFolds(next);
    try{serialize(next,current.collection,true);}catch(e){invalid=e.message;}
    if(invalid){setStatus('edit-error',invalid,true);return false;}
    current.blocks=next;selected.add=false;
    remember();renderArticleBlocks();return true;
  }
  function openInsert(afterId) {
    if(!current?.blocks.some(b=>b.id===afterId))return;
    selected={id:afterId,add:true};
    $('#insert-type').value='text';
    $('#insert-title').value='Подробности';
    $('#insert-slug').value='';
    $('#insert-open').checked=false;
    updateInsertForm();setStatus('insert-error','');openDialog('insert-dialog');
  }
  function updateInsertForm() {
    const type=$('#insert-type')?.value;
    const opt=$('#insert-options');if(opt)opt.hidden=!['fold','link'].includes(type);
    const link=$('#insert-link-options');if(link)link.hidden=type!=='link';
    const openLabel=$('#insert-open-label');if(openLabel)openLabel.hidden=type!=='fold';
    const titleLabel=$('label[for="insert-title"]');
    if(titleLabel)titleLabel.textContent=type==='link'?'Текст ссылки':'Заголовок плашки';
    if(type==='link' && $('#insert-title').value==='Подробности')$('#insert-title').value='Полное доказательство';
  }
  $('#insert-type')?.addEventListener('change',updateInsertForm);
  function insertBlock() {
    if(!current||!selected)return;
    const type=$('#insert-type').value;
    const index=current.blocks.findIndex(b=>b.id===selected.id);
    if(index<0)return;
    let items=[];
    const id=()=>makeId();
    const title=$('#insert-title').value.trim();
    if(type==='fold') {
      if(!title){setStatus('insert-error','Введите заголовок.',true);return;}
      items=[
        {id:id(),source:foldStartSource(title,$('#insert-open').checked)},
        {id:id(),source:'Напишите здесь текст, определения, формулы или леммы.'},
        {id:id(),source:'<!-- ml:fold-end -->'}
      ];
    } else if(type==='link') {
      const slug=$('#insert-slug').value.trim().toLowerCase();
      if(!title || !/^[a-z0-9][a-z0-9-]*$/.test(slug)){
        setStatus('insert-error','Нужны текст ссылки и адрес статьи латиницей.',true);return;
      }
      items=[{id:id(),source:'**['+title.replace(/[\[\]]/g,'')+'](../articles/'+slug+'.html)**'}];
    } else {
      let source='Новый математический текст.';
      if(type==='theorem')source='::: {.theorem}\n**Теорема.** Сформулируйте утверждение.\n:::';
      if(type==='lemma')source='::: {.lemma}\n**Лемма.** Сформулируйте утверждение.\n:::';
      if(type==='proof')source='::: {.proof}\n**Доказательство.** Напишите доказательство.\n:::';
      items=[{id:id(),source}];
    }
    const next=structuredClone(current.blocks);
    next.splice(index+1,0,...items);
    let invalid=checkFolds(next);
    try{serialize(next,current.collection,true);}catch(e){invalid=e.message;}
    if(invalid){setStatus('insert-error',invalid,true);return;}
    current.blocks=next;
    remember();renderArticleBlocks();closeDialogs();
    // Immediately let the author write the newly inserted text.
    const target=type==='fold'?items[1].id:items[0].id;
    if(type!=='link')openEdit(target);
  }
  function deleteSelectedBlock() {
    if(!current||!selected||selected.add)return;
    const i=current.blocks.findIndex(b=>b.id===selected.id);
    if(i<0)return;
    const blocks=structuredClone(current.blocks);
    const d=foldDirective(blocks[i].source);
    if(d?.kind==='start') {
      let depth=0,close=-1;
      for(let j=i;j<blocks.length;j++){
        const t=foldDirective(blocks[j].source);
        if(t?.kind==='start')depth++;
        if(t?.kind==='end' && --depth===0){close=j;break;}
      }
      if(close<0)return;
      if(!confirm('Убрать плашку, но сохранить все её содержимое?'))return;
      blocks.splice(close,1);blocks.splice(i,1);
    } else {
      if(!confirm('Удалить выбранный блок?'))return;
      blocks.splice(i,1);
    }
    let invalid=checkFolds(blocks);
    try{serialize(blocks,current.collection,true);}catch(e){invalid=e.message;}
    if(invalid){setStatus('edit-error',invalid,true);return;}
    current.blocks=blocks;remember();renderArticleBlocks();closeDialogs();
  }

  function renderDraftLinks() {
    const target=$('#local-drafts');if(!target)return;
    const d=draftsRead();const localId=$('meta[name="ml-collection"]')?.content;
    const drafts=Object.values(d).filter(x=>!!x?.slug && (!localId || x.collection===localId));
    const prefix=location.pathname.includes('/collections/')?'../':'';
    target.innerHTML= drafts.length
      ?'<h2 class="drafts-heading">Черновики этого устройства</h2>'+drafts.map(x=>'<div class="draft-entry"><a href="'+prefix+'articles/draft.html?draft='+encodeURIComponent(x.slug)+'&edit=1">'+escapeHTML(x.title)+'</a><span>'+escapeHTML(shortCollectionTitle(x.collection||'mathematical-notes'))+' · только в этом браузере</span></div>').join('')
      :'';
  }
  function renderCollectionDrafts(){
    const target=$('#local-collections');if(!target)return;
    const arr=Object.values(readLocalCollections());
    target.innerHTML=arr.length?'<h2 class="drafts-heading">Неопубликованные разделы</h2>'+arr.map(c=>
      '<div class="draft-entry"><span><strong>'+escapeHTML(c.title)+'</strong> · '+escapeHTML(c.parent?shortCollectionTitle(c.parent):'Верхний уровень')+'</span>'+ 
      '<button type="button" data-action="publish-local-collection" data-collection-id="'+escapeHTML(c.id)+'">Опубликовать</button></div>'
    ).join(''):'';
  }
  function openNew() {
    $('#new-title').value='';$('#new-slug').value='';
    hierarchyOptions($('#new-category'),false,defaultArticleCollection());
    setStatus('new-error','');openDialog('new-dialog');$('#new-title').focus();
  }
  function openNewCollection(){
    $('#collection-title').value='';$('#collection-id').value='';$('#collection-description').value='';
    hierarchyOptions($('#collection-parent'),true,$('meta[name="ml-collection"]')?.content||'');
    setStatus('collection-error','');openDialog('collection-dialog');$('#collection-title').focus();
  }
  $('#collection-title')?.addEventListener('input',()=>{$('#collection-id').value=basename($('#collection-title').value);});
  function draftCollectionFromForm(){
    const title=$('#collection-title').value.trim(),id=$('#collection-id').value.trim().toLowerCase(),parent=$('#collection-parent').value||null;
    const description=$('#collection-description').value.trim();
    if(!title||!/^[a-z0-9][a-z0-9-]*$/.test(id)){setStatus('collection-error','Введите название и адрес латиницей.',true);return null;}
    if(allCollections().some(c=>c.id===id)){setStatus('collection-error','Раздел с таким адресом уже существует.',true);return null;}
    if(parent && !allCollections().some(c=>c.id===parent)){setStatus('collection-error','Родительский раздел не найден.',true);return null;}
    return {id,title,description,parent,order:100};
  }
  function createLocalCollection(){
    const c=draftCollectionFromForm();if(!c)return null;
    const all=readLocalCollections();all[c.id]=c;
    if(!saveLocalCollections(all))return null;
    renderCollectionDrafts();closeDialogs();return c;
  }
  function pendingCollections(id) {
    const local=readLocalCollections(),result=[],seen=new Set();
    function visit(cid){
      if(!cid || publishedCollections.some(c=>c.id===cid))return;
      if(seen.has(cid) || seen.size>12 || !local[cid])throw Error('Недопустимая структура локальных разделов.');
      seen.add(cid);visit(local[cid].parent);result.push(local[cid]);
    }
    visit(id);return result;
  }
  function markCollectionsPublished(items) {
    const local=readLocalCollections();
    for(const item of items){
      if(!publishedCollections.some(c=>c.id===item.id))publishedCollections.push(item);
      if(JSON.stringify(local[item.id])===JSON.stringify(item))delete local[item.id];
    }
    saveLocalCollections(local);renderCollectionDrafts();
  }
  async function publishCollection(c) {
    if(publishing)throw Error('Дождитесь завершения открытой публикации.');
    const items=pendingCollections(c.id);if(!items.length)return;
    publishing=true;
    try{await MLPublisher.open({kind:'collections',collections:items});markCollectionsPublished(items);}
    finally{publishing=false;}
  }
  async function createPublishedCollection(){
    const c=draftCollectionFromForm();if(!c)return;
    const local=readLocalCollections();local[c.id]=c;saveLocalCollections(local);
    closeDialogs();
    try{await publishCollection(c);alert('Раздел сохранён на GitHub. Он появится на сайте после сборки.');}
    catch(e){alert(e.message+' Черновик раздела сохранён локально.');}
  }
  async function retryPublishCollection(id){
    const c=readLocalCollections()[id];if(!c)return;
    try{await publishCollection(c);alert('Раздел опубликован; он появится после сборки.');}
    catch(e){alert(e.message);}
  }
  $('#new-title')?.addEventListener('input',()=>{$('#new-slug').value=basename($('#new-title').value);});
  function createArticle() {
    const title=$('#new-title').value.trim(),slug=$('#new-slug').value.trim().toLowerCase(),collection=$('#new-category').value;
    if(!title || !/^[a-z0-9][a-z0-9-]*$/.test(slug)){setStatus('new-error','Укажите название и адрес латинскими буквами, цифрами или дефисами.',true);return null;}
    if(draftsRead()[slug] || (publishedCollections.length && [...document.querySelectorAll('a[href]')].some(a=>a.getAttribute('href')==='articles/'+slug+'.html'))){setStatus('new-error','Черновик с таким адресом уже существует.',true);return null;}
    if(!allCollections().some(x=>x.id===collection)){setStatus('new-error','Выберите раздел.',true);return null;}
    const blocks=[{id:makeId(),source:'# '+title},{id:makeId(),source:'Новый математический текст.'},{id:makeId(),source:'## 1. Введение'}];
    try{policy.slug(slug);}catch(e){setStatus('new-error',e.message,true);return null;}
    const d={baseRevision:null,slug,title,collection,category:shortCollectionTitle(collection),sourceHasMeta:true,path:'notes/'+slug+'.md',blocks};
    const allDrafts=draftsRead();allDrafts[slug]=d;draftsSave(allDrafts);renderDraftLinks();
    return d;
  }

  function connectDialog() {
    try{MLPublisher.connect();}catch(e){alert(e.message);}
  }
  async function publishCurrent() {
    if(!current)return false;
    if(publishing)throw Error('Дождитесь завершения открытой публикации.');
    if(!Object.hasOwn(current,'baseRevision') || current.baseRevision===undefined)
      throw Error('У старого черновика не сохранилась исходная ревизия. Экспортируйте его, откройте актуальную статью и перенесите нужные изменения.');
    const article=current, items=pendingCollections(article.collection);
    const source=serialize(article.blocks,article.collection,true);
    const operation={kind:'article',slug:article.slug,base:article.baseRevision,collection:article.collection,blocks:structuredClone(article.blocks),collections:items};
    policy.operation(operation);publishing=true;
    try{
      const result=await MLPublisher.open(operation);
      article.baseRevision=result.base;article.sourceHasMeta=true;article.sourceExact=source;
      markCollectionsPublished(items);
      const map=draftsRead(),saved=map[article.slug];
      // Never delete edits made in this tab or another tab while review was open.
      const unchanged=current===article && serialize(article.blocks,article.collection,true)===source;
      if(unchanged && (!saved || serialize(saved.blocks,saved.collection,true)===source)){
        delete map[article.slug];draftsSave(map);
      } else if(current===article && (!saved || serialize(saved.blocks,saved.collection,true)===serialize(article.blocks,article.collection,true))) {
        remember();
      } else {
        alert('В другой вкладке сохранены новые правки. Они оставлены без изменений; перед следующей публикацией сравните версии.');
      }
      return true;
    }finally{publishing=false;}
  }
  function exportDraft() {
    if(!current)return;
    const url=URL.createObjectURL(new Blob([serialize(current.blocks,current.collection,true)],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=current.slug+'-draft.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function discardDraft() {
    if(!current || !dataEl)return;
    if(!confirm('Удалить локальный черновик и загрузить опубликованную статью? Сначала экспортируйте нужные правки.'))return;
    const map=draftsRead();delete map[current.slug];draftsSave(map);location.reload();
  }
  async function publishEdit() {
    if(!selected||!current)return;
    if(!$('#edit-source').value.trim()){setStatus('edit-error','Введите текст.',true);return;}
    if(!applyChange())return;
    setStatus('edit-error','Отправляю изменения в GitHub…');
    try {
      await publishCurrent();
      closeDialogs();alert('Изменения сохранены в GitHub. Сайт обновится после выполнения GitHub Actions.');
    } catch(e) {
      // Preserve the draft instead of losing what the user typed.
      setStatus('edit-error',e.message,true);
      // Do not roll back; the local draft is visibly kept.
    }
  }
  async function publishNew() {
    const d=createArticle();if(!d)return;
    try{
      current=d;await publishCurrent();
      closeDialogs();alert('Статья отправлена в GitHub. Она появится в библиотеке после сборки.');
      location.href=(location.pathname.includes('/articles/')||location.pathname.includes('/collections/'))?'../index.html':'index.html';
    } catch(e) {setStatus('new-error',e.message,true);}
  }

  document.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    const action=b.dataset.action;
    if(b.dataset.editBlock) {if(b.closest('summary'))e.preventDefault();return openEdit(b.dataset.editBlock);}
    if(b.dataset.addAfter) {if(b.closest('summary'))e.preventDefault();return openInsert(b.dataset.addAfter);}
    if(b.dataset.copyLink){if(b.closest('summary'))e.preventDefault();const link=location.origin+location.pathname+'#block-'+b.dataset.copyLink;try{await navigator.clipboard.writeText(link);alert('Ссылка на блок скопирована.');}catch(_){prompt('Скопируйте ссылку:',link);}return;}
    if(!action)return;
    if(action==='new-article')return openNew();
    if(action==='new-collection')return openNewCollection();
    if(action==='create-collection-local')return createLocalCollection();
    if(action==='create-collection-publish')return createPublishedCollection();
    if(action==='publish-local-collection')return retryPublishCollection(b.dataset.collectionId);
    if(action==='insert-block')return insertBlock();
    if(action==='delete-block')return deleteSelectedBlock();
    if(action==='connect')return connectDialog();
    if(action==='export-draft')return exportDraft();
    if(action==='discard-draft')return discardDraft();
    if(action==='publish-article'){try{await publishCurrent();alert('Коммит сохранён. Сайт обновится после сборки.');}catch(e){alert(e.message);}return;}
    if(action==='exit-edit')return switchMode(false);
    if(action==='close-dialog')return closeDialogs();
    if(action==='save-draft'){if(applyChange()){closeDialogs();alert('Черновик сохранён только в этом браузере. Для синхронизации между устройствами нужно опубликовать его в GitHub.');}return;}
    if(action==='publish')return publishEdit();
    if(action==='create-local'){const d=createArticle();if(d)location.href=(location.pathname.includes('/articles/')?'':location.pathname.includes('/collections/')?'../articles/':'articles/')+'draft.html?draft='+encodeURIComponent(d.slug)+'&edit=1';return;}
    if(action==='create-publish')return publishNew();
  });
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='e'){e.preventDefault();switchMode(!editing);}
  });
  window.addEventListener('hashchange',()=>{
    let hash;try{hash=decodeURIComponent(location.hash.slice(1));}catch(_){return;}
    const el=document.getElementById(hash);
    if(el) {if(el.tagName==='DETAILS')el.open=true;for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;}
  });
  try{loadDraftArticle();}catch(e){console.warn('Draft rejected:',e.message);}
  window.addEventListener('storage',e=>{if(e.key===STORAGE && editing)alert('Черновики изменились в другой вкладке. Перед публикацией проверьте, какая версия вам нужна.');});
  if(params.get('edit')==='1'||params.get('edit')==='true')switchMode(true);
})();
