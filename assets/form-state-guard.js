/* GON form-state guard 1.1. Background refresh must never erase a draft. */
(() => {
  'use strict';
  const VERSION='form-state-guard-1.1.0';
  const IDS=['date','employee','client','type','macro','ore','desc','description'];
  const SELECT_IDS=['client','type','macro'];
  let dirty=false, lastSelect={};

  const get=id=>document.getElementById(id);
  const snapshot=()=>{
    const values={};
    IDS.forEach(id=>{const el=get(id);if(el)values[id]=el.value;});
    return values;
  };
  const rememberSelects=()=>{
    SELECT_IDS.forEach(id=>{const el=get(id);if(el&&el.value)lastSelect[id]=el.value;});
  };
  const looksReset=()=>{
    const ore=get('ore'), desc=get('desc')||get('description'), client=get('client');
    return Boolean(ore&&desc&&client && !String(ore.value||'').trim() && !String(desc.value||'').trim() && !String(client.value||'').trim());
  };
  const restore=values=>{
    Object.entries(values).forEach(([id,value])=>{
      const el=get(id);if(!el)return;
      if(el.tagName==='SELECT'){
        if([...el.options].some(o=>o.value===value))el.value=value;
      }else el.value=value;
    });
  };
  const restoreTracked=()=>{
    if(!dirty)return;
    if(looksReset()){
      dirty=false;lastSelect={};return;
    }
    SELECT_IDS.forEach(id=>{
      const el=get(id), wanted=lastSelect[id];
      if(el&&wanted&&el.value!==wanted&&[...el.options].some(o=>o.value===wanted))el.value=wanted;
    });
  };

  function installDraftTracking(){
    const root=get('ore')||document;
    root.addEventListener('input',e=>{
      if(!IDS.includes(e.target?.id))return;
      dirty=true;
      if(SELECT_IDS.includes(e.target.id)&&e.target.value)lastSelect[e.target.id]=e.target.value;
    },true);
    root.addEventListener('change',e=>{
      if(!IDS.includes(e.target?.id))return;
      dirty=true;
      if(SELECT_IDS.includes(e.target.id)&&e.target.value)lastSelect[e.target.id]=e.target.value;
    },true);
    rememberSelects();

    // Directly protects selects even when legacy refresh rebuilds their <option> list.
    const observer=new MutationObserver(()=>queueMicrotask(restoreTracked));
    SELECT_IDS.forEach(id=>{const el=get(id);if(el)observer.observe(el,{childList:true,subtree:true});});

    // Covers code that resets .value without mutating options.
    setInterval(restoreTracked,250);
  }

  function wrapLoad(){
    try{
      if(typeof load!=='function'||load.__gonFormGuard)return;
      const original=load;
      const guarded=async function(...args){
        const values=snapshot();
        if(dirty)rememberSelects();
        try{return await original.apply(this,args);}
        finally{
          if(dirty){
            restore(values);
            queueMicrotask(()=>{restore(values);restoreTracked();});
          }
          document.dispatchEvent(new CustomEvent('gon:data-refreshed'));
        }
      };
      guarded.__gonFormGuard=true;
      load=guarded;window.load=guarded;
    }catch(e){console.warn('GON form guard non installato',e);}
  }

  function boot(){
    installDraftTracking();
    wrapLoad();
    setTimeout(wrapLoad,0);
  }
  window.GonFormStateGuard=Object.freeze({version:VERSION});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();