/* v12: owner-login handoff; GitHub credentials stay on the Worker. */
(() => {
  'use strict';
  const VERSION='site-v12-20261111';
  function origin() {
    const value=document.querySelector('meta[name="ml-publisher"]')?.content||'';
    let url;try{url=new URL(value);}catch{throw Error('Сервис публикации не настроен.');}
    if(url.protocol!=='https:'||url.origin!==value||url.origin===location.origin||url.username||url.password)
      throw Error('Неверный адрес публикации.');
    return value;
  }
  let authorization=null;
  const valid=()=>!!(authorization && authorization.expires>Date.now()+30000);
  function check(){if(!valid())authorization=null;return Promise.resolve(valid());}
  async function request(path,body){
    if(!valid())throw Error('Вход для редактирования истёк. Нажмите «Войти» снова.');
    let response;
    try {
      response=await fetch(origin()+path,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+authorization.credential,
          'X-CSRF-Token':authorization.csrf},body:JSON.stringify(body)});
    }catch{throw Error('Нет соединения с сервисом публикации. Черновик сохранён; повторная отправка коммита запрещена.');}
    let result;try{result=await response.json();}catch{throw Error('Не удалось получить ответ сервиса. Проверьте историю коммитов.');}
    if(!response.ok){if(response.status===401)authorization=null;throw Error(result.error||'GitHub не подтвердил публикацию.');}
    return result;
  }
  async function directPublish(operation){
    // One explicit Publish click. The server validates the edit, checks the
    // remote revision, then applies a single atomic GitHub commit.
    const review=await request('/api/prepare',structuredClone(operation));
    const result=await request('/api/publish',{id:review.id});
    if(!/^[a-f0-9]{40}$/.test(result.commit||''))
      throw Error('GitHub не подтвердил коммит. Проверьте историю изменений.');
    return result;
  }
  function reserve(){
    if(valid())return null;
    // Preserve the browser's user gesture while mathematical validation runs.
    return window.open('about:blank','_blank','popup,width=570,height=520');
  }
  function cancelReservation(popup){if(popup&&!popup.closed)try{popup.close();}catch{}}
  function authorize(reserved){
    if(valid()){cancelReservation(reserved);return Promise.resolve(true);}
    const target=origin();
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const channel=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const popup=reserved||window.open('about:blank','_blank','popup,width=570,height=520');
    if(!popup)return Promise.reject(Error('Разрешите всплывающее окно для входа через GitHub.'));
    const promise=new Promise((resolve,reject)=>{
      let finished=false;
      function finish(error){
        if(finished)return;finished=true;
        clearInterval(poll);clearTimeout(timeout);window.removeEventListener('message',receive);
        if(error)reject(error);else resolve(true);
      }
      function receive(event){
        if(event.origin!==target||event.source!==popup||event.data?.channel!==channel)return;
        if(event.data.type==='ml-auth-ready'){
          popup.postMessage({type:'ml-auth-init',channel},target);
        } else if(event.data.type==='ml-auth-granted'){
          const d=event.data;
          if(!/^[A-Za-z0-9_-]{43}$/.test(d.credential||'') ||
             !/^[A-Za-z0-9_-]{43}$/.test(d.csrf||'') ||
             !Number.isFinite(d.expires)||d.expires<=Date.now()+1000||
             d.expires>Date.now()+13*60*1000 || d.version!=='publisher-v12-20261111'){
            finish(Error('Сервис публикации вернул неверные данные. Проверьте версию Worker.'));return;
          }
          // A short-lived, content-only publishing permission. Never store
          // in localStorage, URL, repository, or an HTML element.
          authorization={credential:d.credential,csrf:d.csrf,expires:d.expires};
          cancelReservation(popup);finish(null);
        } else if(event.data.type==='ml-auth-error'){
          finish(Error(event.data.error||'Не удалось подключить редактор.'));
        }
      }
      window.addEventListener('message',receive);
      const poll=setInterval(()=>{
        if(popup.closed)finish(Error('Окно входа закрыто. Черновик сохранён. Повторите вход.'));
      },700);
      const timeout=setTimeout(()=>finish(Error('Связь между окнами не установлена. Закройте окно входа и повторите попытку.')),120000);
    });
    try{popup.location.replace(target+'/publish#channel='+channel+'&connect=1');}
    catch(e){cancelReservation(popup);return Promise.reject(Error('Не удалось открыть окно авторизации.'));}
    return promise;
  }
  async function open(operation,reserved=null){
    if(valid())cancelReservation(reserved);
    else await authorize(reserved);
    return directPublish(operation);
  }
  function connect(){return authorize();}
  globalThis.MLPublisher=Object.freeze({open,connect,check,reserve,cancelReservation,version:VERSION});
})();
