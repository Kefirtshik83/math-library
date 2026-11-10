/* Owner publishing transport: same-page first, safe popup fallback when cookies are blocked. */
(() => {
  'use strict';
  function origin() {
    const value=document.querySelector('meta[name="ml-publisher"]')?.content||'';
    let url;try{url=new URL(value);}catch{throw Error('Сервис публикации не настроен.');}
    if(url.protocol!=='https:'||url.origin!==value||url.origin===location.origin||url.username||url.password)throw Error('Неверный адрес публикации.');
    return value;
  }
  let session=null;
  async function check() {
    try {
      const response=await fetch(origin()+'/api/session',{credentials:'include',mode:'cors',cache:'no-store',redirect:'error'});
      if(!response.ok){session=null;return false;}
      const data=await response.json();
      if(typeof data.csrf!=='string'||!Number.isFinite(data.expires)){session=null;return false;}
      session=data;return true;
    } catch {session=null;return false;}
  }
  async function request(path,body,csrf) {
    let response;
    try {response=await fetch(origin()+path,{method:'POST',mode:'cors',credentials:'include',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});}
    catch {throw Error('Нет соединения с сервисом публикации. Черновик сохранён; повторять отправку автоматически нельзя.');}
    let data;try{data=await response.json();}catch{throw Error('Сервис не вернул подтверждение. Проверьте историю коммитов.');}
    if(!response.ok)throw Error(data.error||'GitHub не подтвердил запрос.');
    return data;
  }
  async function directPublish(operation) {
    // The user deliberately clicked Publish in the source editor. The Worker
    // still validates the whole operation and requires a fresh review ID.
    const token=session?.csrf;
    if(!token)throw Error('Сессия истекла. Войдите через GitHub снова.');
    const review=await request('/api/prepare',operation,token);
    // Do not retry a possibly submitted commit under any circumstances.
    const result=await request('/api/publish',{id:review.id},token);
    if(!/^[a-f0-9]{40}$/.test(result.commit||''))throw Error('GitHub не подтвердил коммит. Проверьте историю.');
    return result;
  }
  function reserve() {
    if(session && session.expires>Date.now()+30000)return null;
    // Reserve synchronously while the user's click gesture is active: the
    // editor may await MathJax verification before committing.
    return window.open('about:blank','_blank','popup,width=670,height=650');
  }
  function cancelReservation(popup) {if(popup&&!popup.closed)try{popup.close();}catch{}}
  function popupPublish(operation,reserved) {
    const target=origin();
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const channel=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const popup=reserved||window.open(target+'/publish#channel='+channel+'&quick=1','_blank','popup,width=670,height=650');
    if(reserved && !popup.closed)popup.location.replace(target+'/publish#channel='+channel+'&quick=1');
    if(!popup)return Promise.reject(Error('Разрешите всплывающее окно публикации в браузере.'));
    const snapshot=structuredClone(operation);
    return new Promise((resolve,reject)=>{
      let finished=false;
      function finish(error,result){if(finished)return;finished=true;clearInterval(poll);clearTimeout(timeout);window.removeEventListener('message',receive);error?reject(error):resolve(result);}
      function receive(e){
        if(e.origin!==target||e.source!==popup||e.data?.channel!==channel)return;
        if(e.data.type==='ml-publish-ready')popup.postMessage({type:'ml-publish-draft',channel,operation:snapshot},target);
        if(e.data.type==='ml-publish-done')finish(null,e.data.result);
        if(e.data.type==='ml-publish-error')finish(Error(e.data.error||'Публикация не подтверждена.'));
      }
      window.addEventListener('message',receive);
      const poll=setInterval(()=>{if(popup.closed)finish(Error('Окно закрыто. Проверьте историю GitHub перед повторной публикацией.'));},1000);
      const timeout=setTimeout(()=>finish(Error('Время ожидания истекло. Проверьте историю GitHub.')),15*60*1000);
    });
  }
  function open(operation,reserved=null) {
    // This remains synchronous so the fallback popup isn't blocked.
    if(session && session.expires>Date.now()+30000){cancelReservation(reserved);return directPublish(structuredClone(operation));}
    return popupPublish(operation,reserved);
  }
  function connect() {window.open(origin()+'/publish','_blank','noopener,noreferrer');}
  window.addEventListener('focus',()=>{check().catch(()=>{});});
  // The call may fail on browsers blocking third-party cookies. That is fine:
  // the popup is the fallback, and no credentials are ever exposed in this page.
  check().catch(()=>{});
  globalThis.MLPublisher=Object.freeze({open,connect,check,reserve,cancelReservation});
})();
