/* Mathematical Library browser editor. No secrets are embedded in public pages.
 * A GitHub fine-grained token is held ONLY in JS memory (not stored).
 */
(() => {
  'use strict';
  const $ = (s, scope=document) => scope.querySelector(s);
  const all = (s, scope=document) => [...scope.querySelectorAll(s)];
  const dataEl = $('#ml-article-data');
  const draftSlug = new URL(location.href).searchParams.get('draft');
  const params = new URL(location.href).searchParams;
  const STORAGE = 'ml-editor-drafts-v1';
  const CONF = 'ml-gh-settings-v1';
  let current = dataEl ? JSON.parse(dataEl.textContent) : null;
  let publishedBase = current ? serialize(current.blocks) : null;
  let selected = null, editing = false, token = '';
  let gh = {owner:'',repo:'math-library',branch:'main'};
  try { gh = {...gh,...JSON.parse(localStorage.getItem(CONF)||'{}')}; } catch(_) {}

  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function draftsRead() { try {return JSON.parse(localStorage.getItem(STORAGE)||'{}');} catch(_) {return {};} }
  function draftsSave(map) {try {localStorage.setItem(STORAGE,JSON.stringify(map));return true;} catch(e) {alert('Could not save local draft: '+e.message);return false;} }
  function remember() {if(!current)return;const d=draftsRead();d[current.slug]=current;draftsSave(d);}
  function serialize(blocks) { return blocks.map(b=>'<!-- ml:block:'+b.id+' -->\n'+b.source.trim()+'\n\n').join(''); }
  function makeId() { return 'u'+(globalThis.crypto&&crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,12):String(Date.now())+Math.random().toString(36).slice(2,7)); }
  function currentIsDraft() {return !!(current && (draftSlug || (!dataEl)));}
  function basename(s) {return (s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');}
  function setStatus(id,s,error=false) {const e=$('#'+id);if(e){e.textContent=s||'';e.style.color=error?'#c84444':'';}}

  // Preview is deliberately a limited Markdown approximation; Pandoc is the source of truth.
  function liveHTML(src) {
    let s=src.trim();let cls='';
    const open=s.match(/^:::\s*\{\.([\w-]+)[^}]*\}\s*\n/);
    if(open) {cls=open[1];s=s.slice(open[0].length).replace(/\n:::\s*$/,'');}
    s=escapeHTML(s);
    s=s.replace(/\*\*(.+?)\*\*/gs,'<strong>$1</strong>')
       .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g,'<em>$1</em>');
    const paragraphs=s.split(/\n\s*\n/).map(p=>{
      if(/^#{1,5}\s+/.test(p)){const m=p.match(/^(#{1,5})\s+([\s\S]*)/);return `<h${m[1].length}>${m[2]}</h${m[1].length}>`;}
      if(/^\$\$/.test(p)) return `<div class="math display">${p}</div>`;
      if(/^\d+\.\s+/.test(p)) return '<p>'+p.replace(/\n/g,'<br>')+'</p>';
      return '<p>'+p.replace(/\n/g,' ')+'</p>';
    });
    return `<div class="${escapeHTML(cls)}">${paragraphs.join('')}</div>`;
  }
  let previewSeq=0;
  async function renderMath(el) {
    if(!el) return;
    try { if (window.MathJax?.typesetPromise) {window.MathJax.typesetClear?.([el]);await window.MathJax.typesetPromise([el]);} } catch(e) {console.warn('MathJax preview:',e);}
  }
  function updatePreview() {
    const el=$('#edit-preview');if(!el)return;
    el.innerHTML=liveHTML($('#edit-source').value);
    const seq=++previewSeq;
    if (window.MathJax?.typesetPromise) renderMath(el).then(()=>{if(seq!==previewSeq){} });
  }
  let timer=0;
  $('#edit-source')?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(updatePreview,280);});

  function loadDraftArticle() {
    if(draftSlug) {
      const d=draftsRead()[draftSlug];
      if(!d) {$('#article-content').innerHTML='<p>Этот черновик не найден на данном устройстве. Он хранится только в этом браузере, пока не опубликован.</p>';return;}
      current=structuredClone(d);
      publishedBase=null;
    } else if(current){
      const d=draftsRead()[current.slug];
      if(d) current=structuredClone(d);
    }
    if(current && (draftSlug || draftsRead()[current.slug])) renderArticleBlocks();
  }

  function renderBlock(b) {
    const div=document.createElement('div');
    div.className='editable-block';div.dataset.blockId=b.id;div.id='block-'+b.id;
    div.innerHTML='<div class="block-tools"><button type="button" data-edit-block="'+b.id+'">✎ Изменить</button><button type="button" data-add-after="'+b.id+'">＋</button><button type="button" data-copy-link="'+b.id+'">↗</button></div><div class="article-live-block"></div>';
    $('.article-live-block',div).innerHTML=liveHTML(b.source);
    return div;
  }
  function renderArticleBlocks() {
    if(!current)return;
    const el=$('#article-content');if(!el)return;
    el.innerHTML='';
    for(const b of current.blocks)el.append(renderBlock(b));
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
    if(editing) renderDraftLinks();
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
    $('#edit-hint').textContent=add?'Новый блок будет расположен сразу после выбранного. Можно писать обычный Markdown, LaTeX, или ::: {.theorem} ... :::':'Изменяется только выбранный фрагмент статьи. Остальные фрагменты сохраняются.';
    $('#edit-source').value=add?'':current.blocks[idx].source;
    setStatus('edit-error','');openDialog('edit-dialog');updatePreview();$('#edit-source').focus();
  }
  function applyChange() {
    if(!selected||!current)return false;
    const content=$('#edit-source').value.trim();if(!content){setStatus('edit-error','Текст блока не может быть пустым.',true);return false;}
    const idx=current.blocks.findIndex(b=>b.id===selected.id);
    if(idx<0)return false;
    if(selected.add){const b={id:makeId(),source:content};current.blocks.splice(idx+1,0,b);}
    else current.blocks[idx].source=content;
    remember();renderArticleBlocks();return true;
  }
  function renderDraftLinks() {
    const target=$('#local-drafts');if(!target)return;
    const d=draftsRead();
    const drafts=Object.values(d).filter(x=>!!x && !!x.slug);
    target.innerHTML='<h2 class="drafts-heading">Черновики этого устройства</h2>'+(drafts.length?drafts.map(x=>`<div class="draft-entry"><a href="articles/draft.html?draft=${encodeURIComponent(x.slug)}&edit=1">${escapeHTML(x.title)}</a><span>только в этом браузере</span></div>`).join(''):'<p class="rail-muted">Черновиков пока нет.</p>');
  }

  function openNew() {
    $('#new-title').value='';$('#new-slug').value='';$('#new-category').value='Mathematics';setStatus('new-error','');openDialog('new-dialog');$('#new-title').focus();
  }
  $('#new-title')?.addEventListener('input',()=>{$('#new-slug').value=basename($('#new-title').value);});
  function createArticle() {
    const title=$('#new-title').value.trim(),slug=$('#new-slug').value.trim().toLowerCase(),category=$('#new-category').value.trim();
    if(!title || !/^[a-z0-9][a-z0-9-]*$/.test(slug)){setStatus('new-error','Укажите название и адрес латинскими буквами, цифрами или дефисами.',true);return null;}
    if(draftsRead()[slug]){setStatus('new-error','Черновик с таким адресом уже существует.',true);return null;}
    const blocks=[{id:makeId(),source:'# '+title},{id:makeId(),source:'Новый математический текст.'},{id:makeId(),source:'## 1. Введение'}];
    const d={slug,title,category:category||'Mathematics',path:'notes/'+slug+'.md',blocks};
    const allDrafts=draftsRead();allDrafts[slug]=d;draftsSave(allDrafts);renderDraftLinks();
    return d;
  }

  function connectDialog() {
    $('#gh-owner').value=gh.owner;$('#gh-repo').value=gh.repo;$('#gh-branch').value=gh.branch;$('#gh-token').value='';setStatus('connect-error','');openDialog('connect-dialog');
  }
  function saveConnection() {
    const owner=$('#gh-owner').value.trim(), repo=$('#gh-repo').value.trim(), branch=$('#gh-branch').value.trim(),t=$('#gh-token').value.trim();
    if(!/^[\w-]+$/.test(owner)||!/^[\w.-]+$/.test(repo)||!branch||!t){setStatus('connect-error','Укажите username, repository, branch и token.',true);return;}
    gh={owner,repo,branch};token=t;
    try{localStorage.setItem(CONF,JSON.stringify(gh));}catch(_){}
    $('#gh-token').value='';closeDialogs();
    alert('Подключено. Token хранится только в памяти вкладки и пропадёт после её перезагрузки.');
  }
  function url(path) {return 'https://api.github.com/repos/'+encodeURIComponent(gh.owner)+'/'+encodeURIComponent(gh.repo)+'/contents/'+path.split('/').map(encodeURIComponent).join('/');}
  async function ghRequest(path,method,body) {
    if(!token) throw new Error('Сначала подключите GitHub в режиме редактирования.');
    const res=await fetch(url(path)+(method==='GET'?'?ref='+encodeURIComponent(gh.branch):''),{
      method,headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    let response;
    try{response=await res.json();}catch(_){response={};}
    if(!res.ok && !(method==='GET' && res.status===404))throw new Error('GitHub: '+res.status+' '+(response.message||'request failed'));
    if(res.status===404)return null;
    return response;
  }
  function b64(str) {const bytes=new TextEncoder().encode(str);let chars='';for(let i=0;i<bytes.length;i+=8192)chars+=String.fromCharCode(...bytes.slice(i,i+8192));return btoa(chars);}
  function from64(str) {const bin=atob(str.replace(/\s+/g,''));const bs=Uint8Array.from(bin,c=>c.charCodeAt(0));return new TextDecoder().decode(bs);}
  async function publishCurrent() {
    if(!current)return false;
    if(!token){connectDialog();throw new Error('Подключите GitHub и затем нажмите «Опубликовать» ещё раз.');}
    const remote=await ghRequest(current.path,'GET');
    if(remote && publishedBase!==null && from64(remote.content)!==publishedBase)
      throw new Error('Версия статьи на GitHub изменилась. Перезагрузите страницу, чтобы не перезаписать чужие или предыдущие изменения. Сохранённый локальный черновик останется.');
    if(remote && publishedBase===null)
      throw new Error('Статья с таким адресом уже существует на GitHub; выберите другой адрес.');
    const source=serialize(current.blocks);
    await ghRequest(current.path,'PUT',{message:'Update mathematical article: '+current.title,content:b64(source),...(remote?{sha:remote.sha}:{}),branch:gh.branch});
    publishedBase=source;
    const map=draftsRead();delete map[current.slug];draftsSave(map);
    return true;
  }
  async function publishEdit() {
    if(!selected||!current)return;
    if(!$('#edit-source').value.trim()){setStatus('edit-error','Введите текст.',true);return;}
    const old=structuredClone(current.blocks);
    if(!applyChange())return;
    setStatus('edit-error','Отправляю изменения в GitHub…');
    try {
      await publishCurrent();
      closeDialogs();alert('Изменения сохранены в GitHub. Сайт обновится после выполнения GitHub Actions.');
    } catch(e) {
      // Preserve the draft instead of losing what the user typed.
      setStatus('edit-error',e.message,true);
      // Do not roll back; the local draft is visibly kept.
      if(!token)connectDialog();
    }
  }
  async function publishNew() {
    const d=createArticle();if(!d)return;
    if(!token){closeDialogs();connectDialog();alert('Черновик сохранён в этом браузере. Подключите GitHub, затем откройте черновик и нажмите «Опубликовать».');return;}
    try{
      current=d;publishedBase=null;await publishCurrent();
      closeDialogs();alert('Статья отправлена в GitHub. Она появится в библиотеке после сборки.');
      location.href=location.pathname.includes('/articles/')?'../index.html':'index.html';
    } catch(e) {setStatus('new-error',e.message,true);}
  }

  document.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    const action=b.dataset.action;
    if(b.dataset.editBlock) return openEdit(b.dataset.editBlock);
    if(b.dataset.addAfter) return openEdit(b.dataset.addAfter,true);
    if(b.dataset.copyLink){const link=location.origin+location.pathname+'#block-'+b.dataset.copyLink;try{await navigator.clipboard.writeText(link);alert('Ссылка на блок скопирована.');}catch(_){prompt('Скопируйте ссылку:',link);}return;}
    if(!action)return;
    if(action==='new-article')return openNew();
    if(action==='connect')return connectDialog();
    if(action==='exit-edit')return switchMode(false);
    if(action==='close-dialog')return closeDialogs();
    if(action==='save-connection')return saveConnection();
    if(action==='clear-token'){token='';$('#gh-token').value='';setStatus('connect-error','Token отключён.');return;}
    if(action==='save-draft'){if(applyChange()){closeDialogs();alert('Черновик сохранён только в этом браузере. Для синхронизации между устройствами нужно опубликовать его в GitHub.');}return;}
    if(action==='publish')return publishEdit();
    if(action==='create-local'){const d=createArticle();if(d)location.href=(location.pathname.includes('/articles/')?'':'articles/')+'draft.html?draft='+encodeURIComponent(d.slug)+'&edit=1';return;}
    if(action==='create-publish')return publishNew();
  });
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='e'){e.preventDefault();switchMode(!editing);}
  });
  window.addEventListener('hashchange',()=>{
    const el=document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if(el)for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
  });
  loadDraftArticle();
  if(params.get('edit')==='1'||params.get('edit')==='true')switchMode(true);
})();
