/* Cross-origin transport only. No GitHub credentials or privileged session tokens. */
(() => {
  'use strict';
  function origin() {
    const value=document.querySelector('meta[name="ml-publisher"]')?.content||'';
    let url;try{url=new URL(value);}catch{throw Error('Публикация ещё не настроена. Черновик сохранён на этом устройстве.');}
    if(url.protocol!=='https:' || url.origin!==value || url.origin===location.origin || url.username || url.password)throw Error('Неверный адрес публикации.');
    return value;
  }
  function connect() {window.open(origin()+'/publish','_blank','noopener,noreferrer');}
  function open(operation) {
    const target=origin();
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const channel=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    // Called synchronously from the click handler so popup blockers allow it.
    const popup=window.open(target+'/publish#channel='+channel,'_blank','popup,width=1080,height=850');
    if(!popup) return Promise.reject(Error('Разрешите окно публикации в браузере. Черновик сохранён.'));
    const snapshot=structuredClone(operation);
    return new Promise((resolve,reject)=>{
      let finished=false;
      function finish(error,result){if(finished)return;finished=true;clearInterval(poll);clearTimeout(timeout);window.removeEventListener('message',receive);error?reject(error):resolve(result);}
      function receive(e){
        if(e.origin!==target || e.source!==popup || e.data?.channel!==channel)return;
        if(e.data.type==='ml-publish-ready')popup.postMessage({type:'ml-publish-draft',channel,operation:snapshot},target);
        if(e.data.type==='ml-publish-done')finish(null,e.data.result);
        if(e.data.type==='ml-publish-error')finish(Error(e.data.error||'Публикация не подтверждена.'));
      }
      window.addEventListener('message',receive);
      const poll=setInterval(()=>{if(popup.closed)finish(Error('Окно публикации закрыто или связь прервана после входа. Черновик сохранён. При необходимости повторите публикацию после проверки истории GitHub.'));},1000);
      const timeout=setTimeout(()=>finish(Error('Истекло время ожидания. Проверьте окно публикации и историю GitHub; черновик сохранён.')),30*60*1000);
    });
  }
  globalThis.MLPublisher=Object.freeze({open,connect});
})();
