/* This trusted origin never renders Markdown, TeX or HTML from a draft. */
(async()=>{
  'use strict';
  const $=s=>document.querySelector(s), status=s=>{$('#status').textContent=s;};
  const config=await fetch('/config',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Publisher configuration failed');return r.json();});
  $('#repository').textContent=config.repository;
  $('#return').href=config.siteURL;
  const sender=window.opener;
  let saved;try{saved=JSON.parse(sessionStorage.getItem('ml-pending')||'null');}catch{}
  const fragment=new URLSearchParams(location.hash.slice(1));
  let channel=fragment.get('channel')||saved?.channel||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(channel))channel='';
  let operation=saved?.channel===channel?saved.operation:null;
  // Some identity-provider COOP policies sever window.opener. Do not approve
  // an orphaned request: keep the draft in its source tab and start a new bridge.
  if(!sender && operation){operation=null;channel='';sessionStorage.removeItem('ml-pending');}
  history.replaceState(null,'','/publish');
  let csrf='',review=null,preparing=false,done=false;
  function send(message) {try{sender?.postMessage({...message,channel},config.siteOrigin);}catch{}}
  async function api(path,body) {
    const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    if(!response.ok){if(response.status===401){csrf='';$('#login').hidden=false;$('#review').hidden=true;}throw Error(data.error||'Request failed');}
    return data;
  }
  function save() {try{sessionStorage.setItem('ml-pending',JSON.stringify({channel,operation}));}catch{status('Не удалось сохранить запрос для входа. После входа повторите публикацию из редактора.');}}
  function clear() {sessionStorage.removeItem('ml-pending');}
  function showReview(data) {
    review=data;$('#head').textContent='Проверяемая ревизия: '+data.head;
    const container=$('#changes');container.replaceChildren();
    for(const change of data.changes){
      const section=document.createElement('section');section.className='file';
      const title=document.createElement('h2');title.textContent=change.path;section.append(title);
      const columns=document.createElement('div');columns.className='columns';
      for(const [label,content] of [['Сейчас на GitHub',change.before],['После публикации',change.after]]){
        const column=document.createElement('div'),heading=document.createElement('h3'),pre=document.createElement('pre');
        heading.textContent=label;pre.textContent=content;column.append(heading,pre);columns.append(column);
      }
      section.append(columns);container.append(section);
    }
    $('#review').hidden=false;$('#confirm').checked=false;$('#publish').disabled=true;
    status('Проверьте изменения и подтвердите публикацию. Если исходная вкладка была изменена, этот запрос всё равно содержит показанную здесь версию.');
  }
  async function prepare() {
    if(!operation || !csrf || preparing || review || done)return;
    preparing=true;
    try{status('Получение актуальной версии с GitHub…');showReview(await api('/api/prepare',operation));}
    catch(e){status(e.message);}finally{preparing=false;}
  }
  window.addEventListener('message',e=>{
    if(e.origin!==config.siteOrigin || e.source!==sender || !channel || e.data?.channel!==channel || e.data?.type!=='ml-publish-draft' || operation || done)return;
    const value=e.data.operation;
    if(!value || !['article','collections'].includes(value.kind) || JSON.stringify(value).length>524288)return;
    operation=value;save();send({type:'ml-publish-received'});prepare();
  });
  // Repeat only the handshake; never repeat a publication request.
  const ready=()=>{if(!operation && channel)send({type:'ml-publish-ready'});};
  ready();const timer=setInterval(ready,700);setTimeout(()=>clearInterval(timer),30000);
  try{const s=await api('/api/session');csrf=s.csrf;$('#logout').hidden=false;status(operation?'Черновик получен.':'Вход выполнен. Вернитесь к редактору и нажмите «Опубликовать».');await prepare();}
  catch(e){status('Для публикации нужен вход владельца. Черновик не будет опубликован автоматически.');$('#login').hidden=false;}
  $('#confirm').addEventListener('change',()=>{$('#publish').disabled=!$('#confirm').checked || !review || done;});
  $('#publish').addEventListener('click',async()=>{
    if(!review || !$('#confirm').checked || done)return;
    done=true;$('#publish').disabled=true;$('#confirm').disabled=true;
    try{
      status('Сохранение коммита…');
      const result=await api('/api/publish',{id:review.id});clear();
      status('Коммит сохранён. GitHub Pages обновится после успешной сборки.');
      const link=document.createElement('a');link.textContent='Посмотреть коммит';link.href=result.url;link.rel='noopener noreferrer';link.target='_blank';$('#success').replaceChildren(link);
      send({type:'ml-publish-done',result});
    }catch(e){status(e.message+' Не повторяйте отправку вслепую: проверьте историю коммитов. Черновик сохранён в редакторе.');send({type:'ml-publish-error',error:e.message});}
  });
  $('#logout').addEventListener('click',async()=>{
    try{const result=await api('/api/logout',{});clear();csrf='';review=null;$('#review').hidden=true;$('#logout').hidden=true;$('#login').hidden=false;
      status(result.githubTokenRevoked?'Вы вышли. Токен GitHub отозван.':'Сессия завершена. GitHub не подтвердил отзыв токена: при необходимости отзовите авторизацию приложения в настройках GitHub.');
    }catch(e){status(e.message);}
  });
})().catch(()=>{document.querySelector('#status').textContent='Не удалось открыть публикацию. Черновик остаётся в редакторе.';});
