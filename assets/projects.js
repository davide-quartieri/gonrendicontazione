/* Nonfinancial project assignment. No price or report data is loaded here. */
(() => {
 'use strict';
 const VERSION='commercial-1.0.0', $=id=>document.getElementById(id);
 let actor=null,epoch=0,projects=[],customers=[],dialog=null,editing=null,busy=false;
 const api=()=>{try{return typeof db!=='undefined'?db:null;}catch{return null;}};
 const text=(s)=>String(s??'');
 async function paginate(table,columns){
  const out=[];for(let i=0;;i+=500){const r=await api().from(table).select(columns).order('id').range(i,i+499);if(r.error)throw r.error;out.push(...r.data);if(r.data.length<500)return out;if(out.length>10000)throw new Error('Archivio troppo ampio.');}
 }
 function fillSelect(){
  const el=$('gonProjectSelect');if(!el)return;
  const display=$('client')?.value||'',c=customers.find(x=>x.display===display);
  const available=projects.filter(p=>p.active&&p.client_id===c?.id);
  const prev=el.value,oldClient=el.dataset.client,label=el.selectedOptions[0]?.textContent||prev,signature=JSON.stringify([c?.id,available.map(p=>[p.id,p.code,p.name])]);
  if(el.dataset.source===signature)return;
  el.dataset.source=signature;el.dataset.client=c?.id||'';el.setCustomValidity('');el.replaceChildren(new Option('Da assegnare successivamente',''));
  for(const p of available)el.add(new Option(p.code+' - '+p.name,p.id));
  if(available.some(p=>p.id===prev))el.value=prev;else if(prev&&oldClient===(c?.id||'')){const opt=new Option(label+' (non disponibile)',prev);opt.dataset.unavailable='true';el.add(opt);el.value=prev;el.setCustomValidity('Commessa non piu disponibile. Scegli un altra commessa.');}
 }
 async function reload(){
  if(!actor||!api()||!navigator.onLine)return;
  const stamp=epoch;
  try{
   const [p,c]=await Promise.all([paginate('gon_projects','id,client_id,code,name,active,order_ref,version'),paginate('clients','id,main,site,display,active')]);
   if(stamp!==epoch)return;projects=p;customers=c;fillSelect();document.dispatchEvent(new Event('gon:projects-ready'));
  }catch(e){console.warn('Commesse: '+e.message);}
 }
 async function editAssignment(id){
  if(!actor||!navigator.onLine)return alert('Accedi con una connessione attiva per assegnare la commessa.');
  const stamp=epoch;
  try{
   await reload();
   const q=await api().from('entries').select('id,client,description,project_id,created_by,edit_version').eq('id',id).single();
   if(stamp!==epoch)return;if(q.error)throw q.error;editing=q.data;
   const c=customers.find(x=>x.display===editing.client),el=$('gonAssignChoice');
   el.replaceChildren(new Option('Nessuna commessa',''));
   projects.filter(p=>p.client_id===c?.id&&(p.active||p.id===editing.project_id)).forEach(p=>el.add(new Option(p.code+' - '+p.name+(p.active?'':' (chiusa)'),p.id)));
   el.value=editing.project_id||'';$('gonAssignActivity').textContent=editing.client+' | '+editing.description;$('gonAssignError').textContent='';dialog.showModal();
  }catch(e){alert(e.message||'Attivita non disponibile.');}
 }
 async function saveAssignment(e){
  e.preventDefault();if(!actor||!editing||busy)return;
  const stamp=epoch;busy=true;$('gonAssignSave').disabled=true;
  try{
   const r=await api().rpc('gon_assign_projects',{p_expected_user:actor.id,p_links:[{id:editing.id,version:editing.edit_version,project_id:$('gonAssignChoice').value||null}]});
   if(stamp!==epoch)return;if(r.error)throw r.error;dialog.close();editing=null;document.dispatchEvent(new Event('gon:data-refreshed'));
  }catch(e){if(stamp===epoch)$('gonAssignError').textContent=e.message||'Assegnazione non salvata.';}
  finally{busy=false;$('gonAssignSave').disabled=false;}
 }
 function mount(){
  const field=$('client')?.closest('.field');if(!field||$('gonProjectSelect'))return;
  const div=document.createElement('div');div.className='field';
  div.innerHTML='<label for="gonProjectSelect">Commessa</label><select id="gonProjectSelect"><option value="">Da assegnare successivamente</option></select>';
  field.insertAdjacentElement('afterend',div);$('client').addEventListener('change',fillSelect);$('gonProjectSelect').addEventListener('change',e=>{if(e.target.selectedOptions[0]?.dataset.unavailable!=='true')e.target.setCustomValidity('');});$('add')?.addEventListener('click',e=>{const el=$('gonProjectSelect');if(el&&!el.checkValidity()){e.stopImmediatePropagation();e.preventDefault();el.reportValidity();}},true);
  dialog=document.createElement('dialog');dialog.style.cssText='width:min(540px,calc(100% - 24px));border:0;border-radius:18px;padding:24px;max-height:90vh';
  dialog.innerHTML='<form id="gonAssignForm"><h2>Assegna commessa</h2><p id="gonAssignActivity"></p><div class="field"><label for="gonAssignChoice">Commessa del cliente</label><select id="gonAssignChoice"></select></div><p id="gonAssignError" style="color:#b42318" role="alert"></p><div class="row"><button id="gonAssignCancel" class="btn light" type="button">Annulla</button><button id="gonAssignSave" class="btn" type="submit">Salva commessa</button></div></form>';
  document.body.append(dialog);$('gonAssignCancel').onclick=()=>{if(!busy)dialog.close();};$('gonAssignForm').onsubmit=saveAssignment;
 }
 function session(s){const next=s?.user||null;if(next?.id===actor?.id)return;epoch++;actor=next;projects=[];customers=[];editing=null;if(dialog?.open)dialog.close();fillSelect();if(actor)setTimeout(reload,0);}
 async function boot(){
  mount();for(let i=0;i<200&&!api();i++)await new Promise(r=>setTimeout(r,100));if(!api())return;
  api().auth.onAuthStateChange((_e,s)=>session(s));const r=await api().auth.getSession();session(r.data?.session);
  document.addEventListener('gon:data-refreshed',fillSelect);window.addEventListener('online',reload);setInterval(()=>{if(actor&&!document.hidden)reload();},60000);
 }
 window.GonProjects=Object.freeze({version:VERSION,editAssignment,reload,label:id=>{const p=projects.find(x=>x.id===id);return p?text(p.code+' - '+p.name):'Da assegnare';}});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
