/* Synchronous rendering guard: never replay stale values across network awaits. */
(() => {
 'use strict';
 const VERSION='form-render-guard-2.0.0';
 function snapshot(){return ['client','macro','type','rclient'].map(id=>{const e=document.getElementById(id);return e?.tagName==='SELECT'?{e,value:e.value,label:e.selectedOptions[0]?.textContent||e.value,had:e.options.length>0}:null;}).filter(Boolean);}
 function restore(ss){for(const s of ss){if(!s.had)continue;const e=s.e;if(![...e.options].some(o=>o.value===s.value)&&s.value){const o=new Option(s.label,s.value);o.dataset.unavailable='true';e.add(o);}e.value=s.value;const invalid=e.selectedOptions[0]?.dataset.unavailable==='true'&&e.id!=='rclient';e.setCustomValidity(invalid?'La voce selezionata non e piu disponibile. Scegli un cliente attivo.':'');}}
 function boot(){
  if(typeof render==='function'){const original=render;render=function(...args){const s=snapshot();try{return original.apply(this,args);}finally{restore(s);}};}
  if(typeof load==='function'){const original=load;load=async function(...args){const r=await original.apply(this,args);document.dispatchEvent(new Event('gon:data-refreshed'));return r;};}
  document.getElementById('add')?.addEventListener('click',e=>{for(const id of ['client','macro']){const el=document.getElementById(id);if(el&&!el.checkValidity()){e.stopImmediatePropagation();e.preventDefault();el.reportValidity();break;}}},true);
  document.getElementById('client')?.addEventListener('change',e=>{if(e.target.selectedOptions[0]?.dataset.unavailable!=='true')e.target.setCustomValidity('');});
 }
 window.GonFormRenderGuard=Object.freeze({version:VERSION});
 // The base script is before this tag. Install immediately, not after an awaited fetch.
 boot();
})();
