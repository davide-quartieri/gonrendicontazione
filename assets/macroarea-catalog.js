/* Live, nonfinancial macroarea catalog. No form reset and no credentials persisted. */
(() => {
 'use strict';
 let actor=null,epoch=0,items=[],pending=null,last=0;
 const api=()=>{try{return db;}catch{return null;}};
 const ids=['macro','gonEditMacro','gonTimerDetailMacro'];
 function sync(){
  for(const id of ids){const el=document.getElementById(id);if(!el||el.tagName!=='SELECT')continue;const selected=el.value;
   for(const row of items){let option=[...el.options].find(o=>o.value===row.name);if(!option){option=new Option(row.name,row.name);option.dataset.gonCatalog='true';el.add(option);}delete option.dataset.unavailable;}
   if(selected)el.value=selected;
   if(items.some(x=>x.name===el.value))el.setCustomValidity('');
  }
 }
 async function refresh(force=false){
  if(!actor||!api())return items.slice();if(!force&&items.length&&Date.now()-last<15000){sync();return items.slice();}if(pending)return pending;
  const stamp=epoch,owner=actor.id;
  const task=(async()=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);try{
   const r=await api().rpc('gon_catalog',{p_action:'list',p_payload:{},p_expected_user:owner}).abortSignal(controller.signal);
   if(stamp!==epoch)return items.slice();if(r.error)throw r.error;if(!Array.isArray(r.data))throw new Error('Catalogo non disponibile.');
   items=r.data;last=Date.now();sync();document.dispatchEvent(new CustomEvent('gon:catalog-updated',{detail:items.slice()}));return items.slice();
  }finally{clearTimeout(timeout);}})();pending=task;try{return await task;}finally{if(pending===task)pending=null;}
 }
 function changed(session){const next=session?.user||null;if(next?.id===actor?.id)return;epoch++;actor=next;items=[];pending=null;last=0;
  if(!actor){document.querySelectorAll('option[data-gon-catalog]').forEach(e=>e.remove());document.dispatchEvent(new CustomEvent('gon:catalog-updated',{detail:[]}));}
  else setTimeout(()=>refresh(true).catch(console.warn),0);
 }
 // Add custom options synchronously before the existing guard restores a selection.
 if(typeof render==='function'){const original=render;render=function(...args){try{return original.apply(this,args);}finally{sync();}};}
 const observer=new MutationObserver(()=>sync());
 function observe(){ids.forEach(id=>{const el=document.getElementById(id);if(el)observer.observe(el,{childList:true});});sync();}
 async function boot(){
  for(let i=0;i<200&&!api();i++)await new Promise(r=>setTimeout(r,100));if(!api())return;
  api().auth.onAuthStateChange((_e,s)=>changed(s));const r=await api().auth.getSession();changed(r.data?.session);observe();
  const docObserver=new MutationObserver(ms=>{if(ms.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&(n.id==='gonHistoryDialog'||n.id==='gonTimerDetailDialog'))))observe();});docObserver.observe(document.body,{childList:true});
  document.addEventListener('gon:data-refreshed',()=>refresh().catch(console.warn));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true).catch(console.warn);});
  window.addEventListener('online',()=>refresh(true).catch(console.warn));
 }
 window.GonCatalog=Object.freeze({refresh,sync,names:()=>items.length?items.map(x=>x.name):null,items:()=>items.slice()});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
