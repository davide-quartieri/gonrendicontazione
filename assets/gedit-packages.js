/* GEDIT work classification. Metadata only: no prices, billing or customer edits. */
(()=>{'use strict';
 const VERSION='gedit-packages-1.0.0', bindings=new Map();
 const api=()=>{try{return db}catch{return null}}, byId=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const programmed=m=>/PROGRAMMAT[OAIE]/i.test(m||'');
 let items=[],ready=false,pending=null,last=0,actor=null,epoch=0,legacyBusy=false;
 function localClients(){try{return clients||[]}catch{return []}}
 function choices(client,macro){if(!programmed(macro))return [];const c=localClients().find(c=>c.id===client||c.display===client);return c?items.filter(x=>x.active&&x.site_client_id===c.id):[];}
 function descriptionValue(value,previous,label){
  let text=String(value||'');
  if(previous&&(text===previous||text.startsWith(previous+'\n')))text=text.slice(previous.length).replace(/^\n+/,'');
  if(!label)return text;
  if(text===label||text.startsWith(label+'\n'))return text;
  return label+(text?'\n'+text:'');
 }
 function putDescription(b,label){const el=byId(b.desc);if(!el)return;el.value=descriptionValue(el.value,b.generated,label);b.generated=label;el.dispatchEvent(new Event('input',{bubbles:true}));}
 function sync(b,fill=false){
  const cl=byId(b.client),ma=byId(b.macro);if(!cl||!ma)return;
  const available=choices(cl.value,ma.value), sel=b.select,old=sel.value||b.initial||'';
  if(!ready){b.initial=old;return;}
  const signature=available.map(x=>x.code+'|'+x.label).join(';');
  if(b.signature!==signature){sel.replaceChildren(new Option('Seleziona il controllo...',''));available.forEach(p=>sel.add(new Option(p.label,p.code)));b.signature=signature;}
  sel.value=available.some(x=>x.code===old)?old:available.length===1?available[0].code:'';
  b.initial='';b.box.hidden=available.length===0;sel.disabled=!available.length;
  if(fill&&sel.value){const p=available.find(x=>x.code===sel.value);putDescription(b,p.label);}
  if(!available.length&&fill&&b.generated)putDescription(b,'');
  if(!available.length)b.generated='';
 }
 function syncAll(){for(const b of bindings.values())sync(b);}
 function attach(prefix,client,macro,desc,initial='',fill=false){
  let b=bindings.get(prefix);
  if(!b||!b.box.isConnected){
   const anchor=byId(desc);if(!anchor)return null;
   const box=document.createElement('div');box.className='field gon-package-field';box.id='gonPackageBox-'+prefix;box.hidden=true;
   box.innerHTML='<label for="gonPackage-'+esc(prefix)+'">Controllo periodico / pacchetto GEDIT</label><select id="gonPackage-'+esc(prefix)+'" data-gedit-package><option value="">Seleziona il controllo...</option></select><p class="small">Indica il lavoro effettivo. Le ore restano una sola registrazione; puoi aggiungere dettagli nella descrizione.</p>';
   const wrapper=anchor.closest('.field')||anchor;wrapper.insertAdjacentElement('beforebegin',box);
   b={client,macro,desc,box,select:box.querySelector('select'),generated:'',initial:'',signature:null};bindings.set(prefix,b);
   b.select.addEventListener('change',()=>{const p=items.find(x=>x.code===b.select.value);if(p)putDescription(b,p.label);});
   for(const id of [client,macro])byId(id)?.addEventListener('change',()=>{b.initial='';sync(b,true);});
  }
  b.initial=initial||'';b.select.value=initial||'';b.generated=items.find(x=>x.code===initial)?.label||'';sync(b,fill);return b;
 }
 async function refresh(force=false){
  if(!api())throw Error('Collegamento non disponibile: accedi al programma ore.');
  if(ready&&(!navigator.onLine||(!force&&Date.now()-last<30000)))return items;
  if(pending)return pending;
  const stamp=epoch;
  const task=(async()=>{const r=await api().from('gon_periodic_packages').select('code,site_client_id,label,active').order('code');if(r.error)throw r.error;if(stamp!==epoch)return items;
   if(!Array.isArray(r.data))throw Error('Catalogo controlli GEDIT non valido.');items=r.data;ready=true;last=Date.now();syncAll();return items;
  })();pending=task;try{return await task;}finally{if(pending===task)pending=null;}
 }
 async function read(prefix){
  const b=bindings.get(prefix);if(!b)return null;
  if(!programmed(byId(b.macro)?.value))return null;
  await refresh();sync(b);
  const opts=choices(byId(b.client).value,byId(b.macro).value);
  if(!opts.length)return null;
  if(!b.select.value)throw Error('Scegli il controllo periodico GEDIT prima di salvare: meta vasca 3 oppure vasche 1 e 2.');
  if(!opts.some(x=>x.code===b.select.value))throw Error('Pacchetto non coerente con il cantiere.');
  return b.select.value;
 }
 function resetMain(){const b=bindings.get('main');if(b){b.initial='';b.select.value='';b.generated='';sync(b,true);}}
 function ocrHtml(row,index){
  const opts=choices(row.client,row.macro);if(!opts.length)return '';
  if(!opts.some(x=>x.code===row.periodic_package_code))row.periodic_package_code=opts.length===1?opts[0].code:null;
  return '<label class="small">Controllo GEDIT</label><select data-ocr-package="'+index+'"><option value="">Seleziona controllo...</option>'+opts.map(x=>'<option value="'+esc(x.code)+'" '+(x.code===row.periodic_package_code?'selected':'')+'>'+esc(x.label)+'</option>').join('')+'</select>';
 }
 function bindOcr(rows,renderAgain){
  document.querySelectorAll('[data-ocr-package]').forEach(sel=>{sel.onchange=()=>{const r=rows[Number(sel.dataset.ocrPackage)],old=items.find(x=>x.code===r.periodic_package_code)?.label;r.periodic_package_code=sel.value||null;const label=items.find(x=>x.code===sel.value)?.label;if(label)r.description=descriptionValue(r.description,old,label);renderAgain();};});
 }
 async function prepareRows(rows){
  if(rows.some(r=>programmed(r.macro)))await refresh();
  return rows.map(r=>{const opts=choices(r.client,r.macro);let code=r.periodic_package_code||null;
   if(!opts.length)return {...r,periodic_package_code:null};
   if(!code&&opts.length===1)code=opts[0].code;
   if(!opts.some(x=>x.code===code))throw Error('Foglio: seleziona il controllo GEDIT per ogni riga PROGRAMMATA di Calcinato.');
   return {...r,periodic_package_code:code,description:r.description||opts.find(x=>x.code===code).label};
  });
 }
 async function legacyLoad(){
  if(legacyBusy)return;legacyBusy=true;const msg=byId('gonGeditLegacyMsg'),host=byId('gonGeditLegacyList');msg.textContent='Lettura delle attivita da classificare...';host.replaceChildren();
  try{
   await refresh(true);let rows=[];
   for(let start=0;start<20000;start+=500){const r=await api().from('entries').select('id,date,employee,client,type,macro,description,hours,edit_version,needs_details,periodic_package_code').is('periodic_package_code',null).order('id').range(start,start+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)break;if(start===19500)throw Error('Troppe registrazioni: classificare le ore per gruppi prima di rileggere.');}
   rows=rows.filter(r=>!r.needs_details&&choices(r.client,r.macro).length).sort((a,b)=>a.date.localeCompare(b.date)||a.client.localeCompare(b.client));
   msg.textContent=rows.length+' attivita GEDIT senza pacchetto. Salva la classificazione e poi reimporta nel gestionale. Ore, date e descrizioni originali restano invariate.';
   for(const r of rows){const card=document.createElement('div');card.className='gon-gedit-legacy-row';const opts=choices(r.client,r.macro);card.innerHTML='<strong>'+esc(r.date.split('-').reverse().join('/'))+' / '+esc(r.client)+' / '+esc(r.employee)+'</strong><p>'+esc(r.type)+' - '+esc(r.macro)+' - '+esc(r.hours)+' h</p><p style="white-space:pre-wrap">'+esc(r.description)+'</p><label>Controllo effettivamente eseguito<select><option value="">Seleziona controllo...</option>'+opts.map(p=>'<option value="'+esc(p.code)+'">'+esc(p.label)+'</option>').join('')+'</select></label><button type="button" class="btn light">Salva classificazione</button><p role="status"></p>';
    const sel=card.querySelector('select'),btn=card.querySelector('button'),note=card.querySelector('[role=status]');if(opts.length===1)sel.value=opts[0].code;
    btn.onclick=async()=>{if(!sel.value){note.textContent='Seleziona il controllo.';return;}btn.disabled=true;sel.disabled=true;
     try{const u=await api().auth.getUser();if(u.error||!u.data?.user)throw Error('Sessione scaduta.');const res=await api().rpc('gon_entry_with_package',{p_action:'classify',p_expected_user:u.data.user.id,p_payload:{entry_id:r.id,expected_version:r.edit_version,periodic_package_code:sel.value}});if(res.error)throw res.error;r.edit_version=res.data.edit_version;note.textContent='Classificazione salvata, senza modificare le ore. Rileggi o importa nel gestionale.';btn.textContent='Salvata';}
     catch(e){note.textContent=(e.message||'Salvataggio non riuscito')+' Ricarica in caso di modifica contemporanea.';btn.disabled=false;sel.disabled=false;}
    };host.append(card);
   }
  }catch(e){msg.textContent=e.message||'Impossibile caricare le attivita.';}finally{legacyBusy=false;}
 }
 function mountLegacy(){
  const target=byId('ore');if(!target||byId('gonGeditLegacy'))return;
  const box=document.createElement('details');box.className='card';box.id='gonGeditLegacy';box.innerHTML='<summary><strong>GEDIT - Classifica le attivita gia registrate</strong></summary><p class="small">Per le registrazioni precedenti senza indicazione della vasca. Mostra solo le attivita accessibili al tuo account; un amministratore vede quelle aziendali. Nessuna cancellazione.</p><button type="button" class="btn light">Carica PROGRAMMATE da classificare</button><p id="gonGeditLegacyMsg" role="status"></p><div id="gonGeditLegacyList"></div>';box.querySelector('button').onclick=legacyLoad;target.append(box);
 }
 async function boot(){
  const style=document.createElement('style');style.textContent='.gon-package-field{border:1px solid #bad8e9;background:#f1f8fc;padding:12px;border-radius:10px;margin:10px 0;grid-column:1/-1}.gon-package-field[hidden]{display:none!important}.gon-package-field select{width:100%}.gon-gedit-legacy-row{border:1px solid #d9e2ec;border-radius:10px;padding:12px;margin:12px 0}.gon-gedit-legacy-row select{display:block;width:100%;margin:8px 0}.gon-gedit-legacy-row p{overflow-wrap:anywhere}';document.head.append(style);
  attach('main','client','macro','desc');mountLegacy();
  if(!api())return;
  function changed(s){const next=s?.user||null;if(next?.id===actor?.id)return;epoch++;actor=next;ready=false;items=[];pending=null;last=0;syncAll();if(byId('gonGeditLegacyList'))byId('gonGeditLegacyList').replaceChildren();if(actor)setTimeout(()=>refresh().catch(()=>{}),0);}
  api().auth.onAuthStateChange((_e,s)=>changed(s));const r=await api().auth.getSession();changed(r.data?.session);
  document.addEventListener('gon:data-refreshed',()=>{syncAll();if(actor)refresh().catch(()=>{});});
  window.addEventListener('online',()=>{if(actor)refresh(true).catch(()=>{});});
 }
 window.GonGeditPackages=Object.freeze({version:VERSION,attach,read,resetMain,refresh,ocrHtml,bindOcr,prepareRows,choices,descriptionValue});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
