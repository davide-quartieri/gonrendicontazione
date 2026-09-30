/* Preserve manual activity form values across background cloud refreshes. */
(() => {
  'use strict';
  const VERSION='form-state-guard-1.0.0';
  const ids=['date','employee','client','type','macro','ore','desc','description'];
  const snapshot=()=>{
    const values={};
    ids.forEach(id=>{const el=document.getElementById(id);if(el)values[id]=el.value;});
    return values;
  };
  const restore=values=>{
    Object.entries(values).forEach(([id,value])=>{
      const el=document.getElementById(id);if(!el)return;
      if(el.tagName==='SELECT'){
        const has=[...el.options].some(o=>o.value===value);
        if(has)el.value=value;
      }else el.value=value;
    });
  };
  function wrapLoad(){
    try{
      if(typeof load!=='function'||load.__gonFormGuard)return;
      const original=load;
      const guarded=async function(...args){
        const values=snapshot();
        try{return await original.apply(this,args);}
        finally{
          // Let render/options replacement finish, then restore the user's in-progress form.
          restore(values);
          queueMicrotask(()=>restore(values));
          document.dispatchEvent(new CustomEvent('gon:data-refreshed'));
        }
      };
      guarded.__gonFormGuard=true;
      load=guarded;
      window.load=guarded;
    }catch(e){console.warn('GON form guard non installato',e);}
  }
  function wrapAdd(){
    try{
      if(typeof addEntry!=='function'||addEntry.__gonFormGuard)return;
      const original=addEntry;
      const wrapped=async function(...args){
        const before=snapshot();
        const result=await original.apply(this,args);
        // If the base app cleared the form after a successful save, keep it cleared.
        const after=snapshot();
        if(Object.keys(after).some(k=>after[k]!==before[k])) {
          // no-op: future refresh snapshots the new state
        }
        return result;
      };
      wrapped.__gonFormGuard=true;
      addEntry=wrapped;window.addEntry=wrapped;
    }catch(e){}
  }
  function boot(){wrapLoad();wrapAdd();setTimeout(()=>{wrapLoad();wrapAdd();},0);}
  window.GonFormStateGuard=Object.freeze({version:VERSION});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();