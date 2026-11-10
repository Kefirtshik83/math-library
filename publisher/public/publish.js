/* Owner-only publishing review. Drafts and untrusted text are never interpreted as HTML. */
(async()=>{
  'use strict';
  const $=s=>document.querySelector(s);
  const status=s=>{ $('#status').textContent=s; $('#action-status').textContent=s; };
  const config=await fetch('/config',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Publisher configuration failed');return r.json();});
  $('#repository').textContent=config.repository;
  $('#return').href=config.siteURL;
  const historyURL='https://github.com/'+encodeURIComponent(config.repository.split('/')[0])+'/'+encodeURIComponent(config.repository.split('/')[1])+'/commits/';
  const sender=window.opener;
  let saved;try{saved=JSON.parse(sessionStorage.getItem('ml-pending')||'null');}catch{}
  const fragment=new URLSearchParams(location.hash.slice(1));
  const quick=fragment.get('quick')==='1' && !!sender;
  const bridgeChannel=fragment.get('connect')==='1'?fragment.get('channel'):'';
  if(bridgeChannel && /^[A-Za-z0-9_-]{43}$/.test(bridgeChannel)) {
    sessionStorage.setItem('ml-auth-bridge',bridgeChannel);
  }
  const activeBridge=sessionStorage.getItem('ml-auth-bridge')||'';
  const bridgeMode=/^[A-Za-z0-9_-]{43}$/.test(activeBridge);
  let bridgeApproved=bridgeMode && sessionStorage.getItem('ml-auth-approved')===activeBridge;
  let granting=false,granted=false;
  if(bridgeMode){
    document.querySelector('h1').textContent='Вход для редактирования';
    document.querySelector('main > p:not(.eyebrow)')?.replaceChildren(document.createTextNode('Авторизация нужна только для публикации ваших заметок.'));
  }
  let channel=fragment.get('channel')||saved?.channel||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(channel))channel='';
  let operation=saved?.channel===channel?saved.operation:null;
  // Some identity-provider COOP policies sever window.opener. Do not approve
  // an orphaned request: keep the draft in its source tab and start a new bridge.
  if(!sender && operation){operation=null;channel='';sessionStorage.removeItem('ml-pending');}
  history.replaceState(null,'','/publish');
  let csrf='',review=null,preparing=false,done=false,submitting=false;
  function send(message){try{sender?.postMessage({...message,channel},config.siteOrigin);}catch{}}
  async function api(path,body){
    const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    if(!response.ok){if(response.status===401){csrf='';$('#login').hidden=false;$('#review').hidden=true;}throw Error(data.error||'Request failed');}
    return data;
  }
  function save(){try{sessionStorage.setItem('ml-pending',JSON.stringify({channel,operation}));}catch{status('Не удалось сохранить запрос для входа. Вернитесь к редактору и повторите публикацию.');}}
  function clear(){sessionStorage.removeItem('ml-pending');}
  function lineDiff(before,after){
    // A compact LCS-based line diff; no raw HTML from either version is used.
    const a=before.split('\n'),b=after.split('\n'),n=a.length,m=b.length;
    if(n*m>800000){
      let p=0,s=0;while(p<n && p<m && a[p]===b[p])p++;
      while(s<n-p && s<m-p && a[n-s-1]===b[m-s-1])s++;
      return [...(p?[['ellipsis',p+' unchanged leading lines']]:[]),...a.slice(p,n-s).map(x=>['removed',x]),...b.slice(p,m-s).map(x=>['added',x]),...(s?[['ellipsis',s+' unchanged trailing lines']]:[])];
    }
    const dp=Array.from({length:n+1},()=>new Uint32Array(m+1));
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
      dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
    const lines=[];let i=0,j=0;
    while(i<n||j<m){
      if(i<n&&j<m&&a[i]===b[j]){lines.push(['context',a[i]]);i++;j++;}
      else if(j<m&&(i===n||dp[i][j+1]>dp[i+1][j])){lines.push(['added',b[j++]]);}
      else {lines.push(['removed',a[i++]]);}
    }
    const out=[];let k=0;
    while(k<lines.length){
      if(lines[k][0]!=='context'){out.push(lines[k++]);continue;}
      let end=k;while(end<lines.length&&lines[end][0]==='context')end++;
      const span=end-k;
      if(span>6){
        if(k===0){out.push(...lines.slice(k,k+2));out.push(['ellipsis',(span-4)+' unchanged lines']);out.push(...lines.slice(end-2,end));}
        else if(end===lines.length){out.push(...lines.slice(k,k+2));out.push(['ellipsis',(span-4)+' unchanged lines']);out.push(...lines.slice(end-2,end));}
        else {out.push(...lines.slice(k,k+2));out.push(['ellipsis',(span-4)+' unchanged lines']);out.push(...lines.slice(end-2,end));}
      } else out.push(...lines.slice(k,end));
      k=end;
    }
    return out;
  }
  async function showReview(data){
    review=data;
    if(quick){
      // A fresh authenticated message from our exact site origin is the owner's
      // explicit Publish click. No second source-code comparison is required.
      $('#review').hidden=false;
      $('#changes').replaceChildren();
      status('Проверяю и сохраняю изменения в GitHub…');
      await submitReview(true);return;
    }
    $('#head').textContent='Проверяемая ревизия: '+data.head;
    const container=$('#changes');container.replaceChildren();
    for(const change of data.changes){
      const section=document.createElement('section');section.className='file';
      const title=document.createElement('h2');title.textContent=change.path;section.append(title);
      const lines=lineDiff(change.before,change.after),removed=lines.filter(x=>x[0]==='removed').length,added=lines.filter(x=>x[0]==='added').length;
      const summary=document.createElement('p');summary.className='file-summary';summary.textContent='Изменено: '+added+' добавленных и '+removed+' удалённых строк. Показаны только изменения и соседние строки.';section.append(summary);
      const diff=document.createElement('div');diff.className='diff';
      for(const [kind,value] of lines){
        const line=document.createElement('div');line.className='diff-row '+kind;
        line.textContent=(kind==='added'?'+ ':kind==='removed'?'− ':kind==='context'?'  ':'  … ')+value;
        diff.append(line);
      }
      section.append(diff);
      const details=document.createElement('details'),expander=document.createElement('summary');expander.textContent='Показать полные исходники (необязательно)';details.append(expander);
      const columns=document.createElement('div');columns.className='columns';
      for(const [label,content] of [['Сейчас на GitHub',change.before],['После публикации',change.after]]){
        const column=document.createElement('div'),heading=document.createElement('h3'),pre=document.createElement('pre');
        heading.textContent=label;pre.textContent=content;column.append(heading,pre);columns.append(column);
      }
      details.append(columns);section.append(details);container.append(section);
    }
    $('#review').hidden=false;$('#retry').hidden=true;$('#confirm').disabled=false;$('#confirm').checked=false;$('#publish').disabled=true;
    status('Это точные изменения, которые будут отправлены на GitHub. Проверьте их и нажмите «Подтвердить публикацию».');
  }
  async function prepare(){
    if(!operation||!csrf||preparing||review||done)return;
    preparing=true;
    try{status('Получение актуальной версии с GitHub…');await showReview(await api('/api/prepare',operation));}
    catch(e){status('Не удалось подготовить изменения: '+e.message);$('#retry').hidden=false;}
    finally{preparing=false;}
  }
  async function sendBridgeGrant() {
    if(!bridgeMode||!bridgeApproved||!sender||!csrf||granting||granted)return;
    granting=true;
    try {
      status('Подключаем редактор…');
      const data=await api('/api/grant',{});
      if(!/^[A-Za-z0-9_-]{43}$/.test(data.credential)||!/^[A-Za-z0-9_-]{43}$/.test(data.csrf)||
         !Number.isFinite(data.expires)||data.expires<=Date.now()||data.expires>Date.now()+13*60*1000)throw Error('Неверный ответ авторизации.');
      sender.postMessage({type:'ml-auth-granted',channel:activeBridge,credential:data.credential,csrf:data.csrf,expires:data.expires,version:data.version},config.siteOrigin);
      granted=true;sessionStorage.removeItem('ml-auth-bridge');sessionStorage.removeItem('ml-auth-approved');
      status('Редактор подключён. Вернитесь к статье.');
      setTimeout(()=>window.close(),300);
    } catch(e){status('Не удалось подключить редактор: '+e.message+' Вернитесь к статье и повторите вход.');}
    finally {granting=false;}
  }
  // The exact owner-site origin AND a random tab-specific challenge are checked
  // before any scoped writing capability is handed to the opener.
  window.addEventListener('message',e=>{
    if(!bridgeMode||!sender||e.source!==sender||e.origin!==config.siteOrigin||
       e.data?.type!=='ml-auth-init'||e.data?.channel!==activeBridge)return;
    bridgeApproved=true;sessionStorage.setItem('ml-auth-approved',activeBridge);
    if(csrf)void sendBridgeGrant();
  });
  if(bridgeMode) {
    const signal=()=>{if(sender&&!granted)sender.postMessage({type:'ml-auth-ready',channel:activeBridge},config.siteOrigin);};
    signal();const signalTimer=setInterval(signal,400);setTimeout(()=>clearInterval(signalTimer),30000);
  }
  window.addEventListener('message',e=>{
    if(e.origin!==config.siteOrigin||e.source!==sender||!channel||e.data?.channel!==channel||e.data?.type!=='ml-publish-draft'||operation||done)return;
    const value=e.data.operation;
    if(!value||!['article','collections'].includes(value.kind)||JSON.stringify(value).length>524288)return;
    operation=value;save();send({type:'ml-publish-received'});prepare();
  });
  const ready=()=>{if(!operation&&channel)send({type:'ml-publish-ready'});};
  if(!bridgeMode){ready();const timer=setInterval(ready,700);setTimeout(()=>clearInterval(timer),30000);}
  try{const s=await api('/api/session');csrf=s.csrf;$('#logout').hidden=false;
    status(bridgeMode?(sender?'Вход выполнен. Подключаем редактор…':'Вход выполнен, но браузер разорвал связь между окнами. Закройте это окно и нажмите «Войти» на сайте ещё раз.'):
      operation?'Черновик получен.':'Вход выполнен. Вернитесь к редактору и нажмите «Опубликовать».');
    if(bridgeMode)await sendBridgeGrant(); else await prepare();}
  catch(e){status(bridgeMode?'Войдите через GitHub, чтобы подключить редактор.':'Для публикации нужен вход владельца. Черновик не будет опубликован автоматически.');$('#login').hidden=false;}
  $('#confirm').addEventListener('change',()=>{$('#publish').disabled=!$('#confirm').checked||!review||done||submitting;});
  async function submitReview(quickMode=false){
    if(!review||done||submitting||(!quickMode&&!$('#confirm').checked))return;
    submitting=true;$('#publish').disabled=true;$('#confirm').disabled=true;$('#retry').hidden=true;
    try{
      status('Отправка коммита в GitHub…');
      const result=await api('/api/publish',{id:review.id});
      done=true;clear();
      status('Коммит сохранён. GitHub Pages обновится после сборки.');
      const link=document.createElement('a');link.textContent='Посмотреть коммит';link.href=result.url;link.rel='noopener noreferrer';link.target='_blank';$('#success').replaceChildren(link);
      send({type:'ml-publish-done',result});
      if(sender)setTimeout(()=>window.close(),350);
    }catch(e){
      const link=document.createElement('a');link.textContent='Проверить историю GitHub';link.href=historyURL;link.target='_blank';link.rel='noopener noreferrer';$('#success').replaceChildren(link);
      status('Публикация не подтверждена: '+e.message+'. Не повторяйте вслепую; проверьте историю коммитов.');
      send({type:'ml-publish-error',error:e.message});
      if(!quickMode)$('#retry').hidden=false;
    }finally{submitting=false;}
  }
  $('#publish').addEventListener('click',()=>submitReview(false));
  $('#retry').addEventListener('click',async()=>{
    if(preparing||submitting||done)return;
    if(!window.confirm('Перед повтором проверьте историю коммитов GitHub, чтобы не публиковать один и тот же запрос дважды. Вы проверили её?'))return;
    review=null;$('#review').hidden=true;$('#success').replaceChildren();
    await prepare();
  });
  $('#logout').addEventListener('click',async()=>{
    try{const result=await api('/api/logout',{});clear();csrf='';review=null;$('#review').hidden=true;$('#logout').hidden=true;$('#login').hidden=false;
      status(result.githubTokenRevoked?'Вы вышли. Токен GitHub отозван.':'Сессия завершена. GitHub не подтвердил отзыв токена: при необходимости отзовите авторизацию приложения в настройках GitHub.');
    }catch(e){status(e.message);}
  });
})().catch(()=>{document.querySelector('#status').textContent='Не удалось открыть публикацию. Черновик остаётся в редакторе.';});
