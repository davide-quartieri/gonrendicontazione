/* Periodic work classification. Metadata only: no prices, billing or customer edits. */
(()=>{'use strict';
 const VERSION='gedit-packages-1.2.0', FOUR_PLUS='valseco_rif_4plus', PROGECO='Progeco', bindings=new Map();
 const api=()=>{try{return db}catch{return null}}, byId=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const programmed=m=>/PROGRAMMAT[OAIE]/i.test(m||'');
 const needsUnits=code=>code===FOUR_PLUS;
 const needsProgecoLots=(client,type,macro)=>client===PROGECO&&type==='Cantiere'&&/^Rilievo in campo/i.test(String(macro||''));
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
 function syncUnits(b){
  const show=needsUnits(b.select.value);
  b.unitsBox.hidden=!show;b.units.disabled=!show;b.units.required=show;
  if(!show)b.units.value='';
 }
 function syncProgecoLots(b){
  const show=needsProgecoLots(byId(b.client)?.value,byId(b.type)?.value,byId(b.macro)?.value);
  b.lotBox.hidden=!show;b.lot.disabled=!show;b.lot.required=show;
  if(!show)b.lot.value='';
 }
 function sync(b,fill=false){
  const cl=byId(b.client),ma=byId(b.macro),ty=byId(b.type);if(!cl||!ma||!ty)return;
  syncProgecoLots(b);
  const available=choices(cl.value,ma.value), sel=b.select,old=sel.value||b.initial||'';
  if(!ready){b.initial=old;return;}
  const signature=available.map(x=>x.code+'|'+x.label).join(';');
  if(b.signature!==signature){sel.replaceChildren(new Option('Seleziona la prestazione...',''));available.forEach(p=>sel.add(new Option(p.label,p.code)));b.signature=signature;}
  sel.value=available.some(x=>x.code===old)?old:available.length===1?available[0].code:'';
  b.initial='';b.box.hidden=available.length===0;sel.disabled=!available.length;
  if(fill&&sel.value){const p=available.find(x=>x.code===sel.value);putDescription(b,p.label);}
  if(!available.length&&fill&&b.generated)putDescription(b,'');
  if(!available.length)b.generated='';
  if(b.initialUnits!==null&&needsUnits(sel.value)&&!b.units.value)b.units.value=String(b.initialUnits);
  if(b.initialLots!==null&&needsProgecoLots(cl.value,ty.value,ma.value)&&!b.lot.value)b.lot.value=String(b.initialLots);
  b.initialUnits=null;b.initialLots=null;syncUnits(b);syncProgecoLots(b);
 }
 function syncAll(){for(const b of bindings.values())sync(b);}
 function attach(prefix,client,type,macro,desc,initial='',fill=false,initialUnits=null,initialLots=null){
  let b=bindings.get(prefix);
  if(!b||!b.box.isConnected){
   const anchor=byId(desc);if(!anchor)return null;
   const box=document.createElement('div');box.className='field gon-package-field';box.id='gonPackageBox-'+prefix;box.hidden=true;
   box.innerHTML='<label for="gonPackage-'+esc(prefix)+'">Prestazione programmata</label><select id="gonPackage-'+esc(prefix)+'" data-gedit-package><option value="">Seleziona la prestazione...</option></select><div class="gon-package-units" hidden><label for="gonPackageUnits-'+esc(prefix)+'">Numero lotti</label><input id="gonPackageUnits-'+esc(prefix)+'" type="number" min="4" max="100" step="1" inputmode="numeric"><p class="small">Obbligatorio solo per la voce 4 o più lotti.</p></div><p class="small">Le ore restano registrate nel dettaglio; la prestazione identifica il forfait corretto.</p>';
   const wrapper=anchor.closest('.field')||anchor;wrapper.insertAdjacentElement('beforebegin',box);
   const lotBox=document.createElement('div');lotBox.className='field gon-lot-field';lotBox.id='gonLotBox-'+prefix;lotBox.hidden=true;
   lotBox.innerHTML='<label for="gonLotCount-'+esc(prefix)+'">Numero lotti lavorati</label><input id="gonLotCount-'+esc(prefix)+'" type="number" min="1" max="100" step="1" inputmode="numeric"><p class="small">Obbligatorio per i rilievi in cantiere Progeco.</p>';
   box.insertAdjacentElement('afterend',lotBox);
   b={client,type,macro,desc,box,select:box.querySelector('select'),unitsBox:box.querySelector('.gon-package-units'),units:box.querySelector('input'),lotBox,lot:lotBox.querySelector('input'),generated:'',initial:'',initialUnits:null,initialLots:null,signature:null};bindings.set(prefix,b);
   b.select.addEventListener('change',()=>{const p=items.find(x=>x.code===b.select.value);if(p)putDescription(b,p.label);syncUnits(b);});
   for(const id of [client,type,macro])byId(id)?.addEventListener('change',()=>{b.initial='';b.initialUnits=null;b.initialLots=null;sync(b,true);});
  }
  b.initial=initial||'';b.initialUnits=initialUnits;b.initialLots=initialLots;b.select.value=initial||'';b.generated=items.find(x=>x.code===initial)?.label||'';sync(b,fill);return b;
 }
 async function refresh(force=false){
  if(!api())throw Error('Collegamento non disponibile: accedi al programma ore.');
  if(ready&&(!navigator.onLine||(!force&&Date.now()-last<30000)))return items;
  if(pending)return pending;
  const stamp=epoch;
  const task=(async()=>{const r=await api().from('gon_periodic_packages').select('code,site_client_id,label,active').order('code');if(r.error)throw r.error;if(stamp!==epoch)return items;
   if(!Array.isArray(r.data))throw Error('Catalogo prestazioni periodiche non valido.');items=r.data;ready=true;last=Date.now();syncAll();return items;
  })();pending=task;try{return await task;}finally{if(pending===task)pending=null;}
 }
 async function readMeta(prefix){
  const b=bindings.get(prefix);if(!b)return{code:null,units:null,lotCount:null};
  syncProgecoLots(b);
  let lotCount=null;
  if(needsProgecoLots(byId(b.client)?.value,byId(b.type)?.value,byId(b.macro)?.value)){
   lotCount=Number(b.lot.value);
   if(!Number.isInteger(lotCount)||lotCount<1||lotCount>100)throw Error('Indica il numero di lotti lavorati per il rilievo Progeco.');
  }
  if(!programmed(byId(b.macro)?.value))return{code:null,units:null,lotCount};
  await refresh();sync(b);
  const opts=choices(byId(b.client).value,byId(b.macro).value);
  if(!opts.length)return{code:null,units:null,lotCount};
  if(!b.select.value)throw Error('Scegli la prestazione programmata prima di salvare.');
  if(!opts.some(x=>x.code===b.select.value))throw Error('Prestazione non coerente con il cliente/cantiere.');
  let units=null;
  if(needsUnits(b.select.value)){units=Number(b.units.value);if(!Number.isInteger(units)||units<4||units>100)throw Error('Indica il numero effettivo di lotti (minimo 4).');}
  return{code:b.select.value,units,lotCount};
 }
 async function read(prefix){return (await readMeta(prefix)).code;}
 function resetMain(){const b=bindings.get('main');if(b){b.initial='';b.initialUnits=null;b.initialLots=null;b.select.value='';b.units.value='';b.lot.value='';b.generated='';sync(b,true);}}
 function ocrHtml(row,index){
  const opts=choices(row.client,row.macro);
  const lot=needsProgecoLots(row.client,row.type,row.macro)?'<label class="small">Lotti lavorati</label><input type="number" min="1" max="100" step="1" data-ocr-lot-count="'+index+'" value="'+esc(row.lot_count||'')+'">':'';
  if(!opts.length)return lot;
  if(!opts.some(x=>x.code===row.periodic_package_code))row.periodic_package_code=opts.length===1?opts[0].code:null;
  const unit=needsUnits(row.periodic_package_code)?'<label class="small">Numero lotti</label><input type="number" min="4" max="100" step="1" data-ocr-package-units="'+index+'" value="'+esc(row.periodic_units||'')+'">':'';
  return '<label class="small">Prestazione programmata</label><select data-ocr-package="'+index+'"><option value="">Seleziona prestazione...</option>'+opts.map(x=>'<option value="'+esc(x.code)+'" '+(x.code===row.periodic_package_code?'selected':'')+'>'+esc(x.label)+'</option>').join('')+'</select>'+unit+lot;
 }
 function bindOcr(rows,renderAgain){
  document.querySelectorAll('[data-ocr-package]').forEach(sel=>{sel.onchange=()=>{const r=rows[Number(sel.dataset.ocrPackage)],old=items.find(x=>x.code===r.periodic_package_code)?.label;r.periodic_package_code=sel.value||null;if(!needsUnits(r.periodic_package_code))r.periodic_units=null;const label=items.find(x=>x.code===sel.value)?.label;if(label)r.description=descriptionValue(r.description,old,label);renderAgain();};});
  document.querySelectorAll('[data-ocr-package-units]').forEach(inp=>{inp.oninput=()=>{rows[Number(inp.dataset.ocrPackageUnits)].periodic_units=inp.value?Number(inp.value):null;};});
  document.querySelectorAll('[data-ocr-lot-count]').forEach(inp=>{inp.oninput=()=>{rows[Number(inp.dataset.ocrLotCount)].lot_count=inp.value?Number(inp.value):null;};});
 }
 async function prepareRows(rows){
  if(rows.some(r=>programmed(r.macro)))await refresh();
  return rows.map(r=>{const opts=choices(r.client,r.macro);let code=r.periodic_package_code||null,units=r.periodic_units||null,lotCount=r.lot_count||null,out={...r};
   if(opts.length){
    if(!code&&opts.length===1)code=opts[0].code;
    if(!opts.some(x=>x.code===code))throw Error('Foglio: seleziona la prestazione programmata per ogni riga che la richiede.');
    if(needsUnits(code)){units=Number(units);if(!Number.isInteger(units)||units<4||units>100)throw Error('Foglio: indica il numero lotti (minimo 4) per Vals.eco.');}else units=null;
    out={...out,periodic_package_code:code,periodic_units:units,description:r.description||opts.find(x=>x.code===code).label};
   }else out={...out,periodic_package_code:null,periodic_units:null};
   if(needsProgecoLots(r.client,r.type,r.macro)){lotCount=Number(lotCount);if(!Number.isInteger(lotCount)||lotCount<1||lotCount>100)throw Error('Foglio: indica il numero di lotti lavorati per il rilievo Progeco.');out.lot_count=lotCount;}else out.lot_count=null;
   return out;
  });
 }
 async function legacyLoad(){
  if(legacyBusy)return;legacyBusy=true;const msg=byId('gonGeditLegacyMsg'),host=byId('gonGeditLegacyList');msg.textContent='Lettura delle attività da classificare...';host.replaceChildren();
  try{
   await refresh(true);let rows=[];
   for(let start=0;start<20000;start+=500){const r=await api().from('entries').select('id,date,employee,client,type,macro,description,hours,edit_version,needs_details,periodic_package_code,periodic_units').is('periodic_package_code',null).order('id').range(start,start+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)break;if(start===19500)throw Error('Troppe registrazioni: classificare le ore per gruppi prima di rileggere.');}
   rows=rows.filter(r=>!r.needs_details&&choices(r.client,r.macro).length).sort((a,b)=>a.date.localeCompare(b.date)||a.client.localeCompare(b.client));
   msg.textContent=rows.length+' attività PROGRAMMATE senza prestazione. Ore, date e descrizioni originali restano invariate.';
   for(const r of rows){const card=document.createElement('div');card.className='gon-gedit-legacy-row';const opts=choices(r.client,r.macro);card.innerHTML='<strong>'+esc(r.date.split('-').reverse().join('/'))+' / '+esc(r.client)+' / '+esc(r.employee)+'</strong><p>'+esc(r.type)+' - '+esc(r.macro)+' - '+esc(r.hours)+' h</p><p style="white-space:pre-wrap">'+esc(r.description)+'</p><label>Prestazione effettivamente eseguita<select><option value="">Seleziona prestazione...</option>'+opts.map(p=>'<option value="'+esc(p.code)+'">'+esc(p.label)+'</option>').join('')+'</select></label><label data-units-wrap hidden>Numero lotti<input type="number" min="4" max="100" step="1" data-units></label><button type="button" class="btn light">Salva classificazione</button><p role="status"></p>';
    const sel=card.querySelector('select'),unitsWrap=card.querySelector('[data-units-wrap]'),units=card.querySelector('[data-units]'),btn=card.querySelector('button'),note=card.querySelector('[role=status]');if(opts.length===1)sel.value=opts[0].code;
    const syncLegacyUnits=()=>{unitsWrap.hidden=!needsUnits(sel.value);if(unitsWrap.hidden)units.value='';};sel.onchange=syncLegacyUnits;syncLegacyUnits();
    btn.onclick=async()=>{if(!sel.value){note.textContent='Seleziona la prestazione.';return;}let count=null;if(needsUnits(sel.value)){count=Number(units.value);if(!Number.isInteger(count)||count<4||count>100){note.textContent='Indica il numero lotti (minimo 4).';return;}}btn.disabled=true;sel.disabled=true;units.disabled=true;
     try{const u=await api().auth.getUser();if(u.error||!u.data?.user)throw Error('Sessione scaduta.');const res=await api().rpc('gon_entry_with_package',{p_action:'classify',p_expected_user:u.data.user.id,p_payload:{entry_id:r.id,expected_version:r.edit_version,periodic_package_code:sel.value,periodic_units:count}});if(res.error)throw res.error;r.edit_version=res.data.edit_version;note.textContent='Classificazione salvata, senza modificare le ore.';btn.textContent='Salvata';}
     catch(e){note.textContent=(e.message||'Salvataggio non riuscito')+' Ricarica in caso di modifica contemporanea.';btn.disabled=false;sel.disabled=false;units.disabled=false;}
    };host.append(card);
   }
  }catch(e){msg.textContent=e.message||'Impossibile caricare le attività.';}finally{legacyBusy=false;}
 }
 function mountLegacy(){
  const target=byId('ore');if(!target||byId('gonGeditLegacy'))return;
  const box=document.createElement('details');box.className='card';box.id='gonGeditLegacy';box.innerHTML='<summary><strong>Classifica attività PROGRAMMATE già registrate</strong></summary><p class="small">Mostra solo le attività dei cantieri che richiedono una prestazione specifica e che non sono ancora classificate. Nessuna cancellazione.</p><button type="button" class="btn light">Carica attività da classificare</button><p id="gonGeditLegacyMsg" role="status"></p><div id="gonGeditLegacyList"></div>';box.querySelector('button').onclick=legacyLoad;target.append(box);
 }
 async function boot(){
  const style=document.createElement('style');style.textContent='.gon-package-field,.gon-lot-field{border:1px solid #bad8e9;background:#f1f8fc;padding:12px;border-radius:10px;margin:10px 0;grid-column:1/-1}.gon-package-field[hidden],.gon-package-units[hidden],.gon-lot-field[hidden],[data-units-wrap][hidden]{display:none!important}.gon-package-field select,.gon-package-field input,.gon-lot-field input{width:100%;box-sizing:border-box}.gon-package-units{margin-top:10px}.gon-gedit-legacy-row{border:1px solid #d9e2ec;border-radius:10px;padding:12px;margin:12px 0}.gon-gedit-legacy-row select,.gon-gedit-legacy-row input{display:block;width:100%;margin:8px 0}.gon-gedit-legacy-row p{overflow-wrap:anywhere}';document.head.append(style);
  attach('main','client','type','macro','desc');mountLegacy();
  if(!api())return;
  function changed(s){const next=s?.user||null;if(next?.id===actor?.id)return;epoch++;actor=next;ready=false;items=[];pending=null;last=0;syncAll();if(byId('gonGeditLegacyList'))byId('gonGeditLegacyList').replaceChildren();if(actor)setTimeout(()=>refresh().catch(()=>{}),0);}
  api().auth.onAuthStateChange((_e,s)=>changed(s));const r=await api().auth.getSession();changed(r.data?.session);
  document.addEventListener('gon:data-refreshed',()=>{syncAll();if(actor)refresh().catch(()=>{});});
  window.addEventListener('online',()=>{if(actor)refresh(true).catch(()=>{});});
 }
 window.GonGeditPackages=Object.freeze({version:VERSION,attach,read,readMeta,resetMain,refresh,ocrHtml,bindOcr,prepareRows,choices,descriptionValue,needsProgecoLots});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();