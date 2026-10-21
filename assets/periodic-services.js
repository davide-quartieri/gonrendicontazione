/* Periodic service selector for Gedit/Systema operational sites. */
(() => {
  'use strict';
  const VERSION='periodic-services-1.0.0';
  const CACHE='gon.periodicPackages.v1';
  const FOUR_PLUS='valseco_rif_4plus';
  let packages=[],mounted=false;

  const el=id=>document.getElementById(id);
  const api=()=>{try{return typeof db!=='undefined'?db:null}catch{return null}};
  const clientRows=()=>{try{return typeof clients!=='undefined'&&Array.isArray(clients)?clients:[]}catch{return []}};
  const isProgrammed=m=>/PROGRAMMAT[OAIE]/i.test(String(m||''));
  const programmedMacro=type=>type==='Ufficio'?'Elaborazione rilievo - PROGRAMMATA':'Rilievo in campo - PROGRAMMATO';

  function clientByDisplay(display){return clientRows().find(c=>c.display===display)||null}
  function forClient(display){
    const c=clientByDisplay(display); if(!c)return [];
    return packages.filter(p=>p.active!==false&&p.site_client_id===c.id);
  }
  function loadCache(){
    try{const x=JSON.parse(localStorage.getItem(CACHE)||'[]');if(Array.isArray(x))packages=x}catch{}
  }
  async function refreshPackages(){
    const c=api(); if(!c)return packages;
    try{
      const r=await c.from('gon_periodic_packages').select('code,site_client_id,label,active').eq('active',true).order('label');
      if(r.error)throw r.error; packages=r.data||[];localStorage.setItem(CACHE,JSON.stringify(packages));
    }catch(e){console.warn('Prestazioni periodiche non aggiornate',e)}
    syncManual();syncTimer();
    return packages;
  }
  function fillSelect(select,items,current){
    select.replaceChildren(new Option('Seleziona prestazione',''));
    items.forEach(p=>select.add(new Option(p.label,p.code)));
    if(items.some(p=>p.code===current))select.value=current;
  }
  function syncUnits(select,box,input){
    const show=select.value===FOUR_PLUS;box.hidden=!show;input.required=show;if(!show)input.value='';
  }
  function ensureProgrammed(type,macro,service){
    if(!service.value)return;
    if(!isProgrammed(macro.value))macro.value=programmedMacro(type.value);
  }
  function validate(display,macro,service,units){
    const items=forClient(display);
    if(items.length&&isProgrammed(macro)&&!service)throw new Error('Seleziona la prestazione programmata per questo cliente/cantiere.');
    if(service===FOUR_PLUS){
      const n=Number(units);
      if(!Number.isInteger(n)||n<4||n>100)throw new Error('Indica il numero effettivo di lotti (minimo 4).');
    }
  }

  function mountManual(){
    const client=el('client'),type=el('type'),macro=el('macro'),add=el('add');
    if(!client||!type||!macro||!add||el('gonPeriodicService'))return false;
    const wrap=document.createElement('div');wrap.className='field';wrap.id='gonPeriodicServiceField';wrap.hidden=true;
    wrap.innerHTML='<label for="gonPeriodicService">Prestazione programmata</label><select id="gonPeriodicService"></select><p class="small">Per le attività a forfait seleziona la prestazione specifica del cantiere.</p>';
    client.closest('.field')?.insertAdjacentElement('afterend',wrap);
    const units=document.createElement('div');units.className='field';units.id='gonPeriodicUnitsField';units.hidden=true;
    units.innerHTML='<label for="gonPeriodicUnits">Numero lotti</label><input id="gonPeriodicUnits" type="number" min="4" max="100" step="1" inputmode="numeric"><p class="small">Obbligatorio solo per 4 o più lotti.</p>';
    wrap.insertAdjacentElement('afterend',units);

    client.addEventListener('change',syncManual);
    type.addEventListener('change',()=>{ensureProgrammed(type,macro,el('gonPeriodicService'));syncManual()});
    macro.addEventListener('change',()=>{if(!isProgrammed(macro.value)){el('gonPeriodicService').value='';syncUnits(el('gonPeriodicService'),units,el('gonPeriodicUnits'))}});
    el('gonPeriodicService').addEventListener('change',()=>{ensureProgrammed(type,macro,el('gonPeriodicService'));syncUnits(el('gonPeriodicService'),units,el('gonPeriodicUnits'))});

    add.onclick=saveManual;
    return true;
  }
  function syncManual(){
    const client=el('client'),service=el('gonPeriodicService'),field=el('gonPeriodicServiceField'),unitsField=el('gonPeriodicUnitsField'),units=el('gonPeriodicUnits');
    if(!client||!service||!field||!unitsField||!units)return;
    const current=service.value,items=forClient(client.value);
    field.hidden=!items.length;fillSelect(service,items,current);
    if(!items.length){service.value='';unitsField.hidden=true;units.value='';return}
    syncUnits(service,unitsField,units);
  }
  async function saveManual(){
    const c=api();if(!c)return alert('Connessione non disponibile.');
    const o={id:uid('en'),date:el('date').value,employee:el('employee').value.trim(),client:el('client').value,type:el('type').value,macro:el('macro').value,description:el('desc').value.trim(),hours:+el('hours').value,created_by:currentUser.id};
    if(!o.date||!o.employee||!o.client||!o.description||!o.hours)return alert('Compila tutti i campi.');
    if(!clientRows().some(x=>x.active!==false&&x.display===o.client))return alert('Cliente/cantiere non disponibile. Aggiorna l’elenco prima di salvare.');
    const service=el('gonPeriodicService')?.value||'',units=el('gonPeriodicUnits')?.value||'';
    try{validate(o.client,o.macro,service,units)}catch(e){return alert(e.message)}
    if(service)o.periodic_package_code=service;
    if(service===FOUR_PLUS)o.periodic_units=Number(units);
    localStorage.setItem('gon_employee',o.employee);
    if(!navigator.onLine&&MODE==='mobile'){
      const q=JSON.parse(localStorage.getItem('gon_queue')||'[]');q.push(o);localStorage.setItem('gon_queue',JSON.stringify(q));
      el('desc').value='';el('hours').value='';el('gonPeriodicService').value='';el('gonPeriodicUnits').value='';syncManual();return toast('Salvato offline.');
    }
    setConnectionStatus('syncing','Salvataggio...');
    const r=await c.from('entries').insert(o);
    if(r.error)return alert(r.error.message);
    el('desc').value='';el('hours').value='';el('gonPeriodicService').value='';el('gonPeriodicUnits').value='';syncManual();
    await load(true);toast('Attività salvata');
  }

  function mountTimer(){
    const dialog=el('gonTimerDetailDialog'),form=el('gonTimerDetailForm'),client=el('gonTimerDetailClient'),type=el('gonTimerDetailType'),macro=el('gonTimerDetailMacro');
    if(!dialog||!form||!client||!type||!macro||el('gonTimerPeriodicService'))return false;
    const field=document.createElement('div');field.className='field';field.id='gonTimerPeriodicServiceField';field.hidden=true;
    field.innerHTML='<label for="gonTimerPeriodicService">Prestazione programmata</label><select id="gonTimerPeriodicService"></select>';
    client.closest('.field')?.insertAdjacentElement('afterend',field);
    const unitsField=document.createElement('div');unitsField.className='field';unitsField.id='gonTimerPeriodicUnitsField';unitsField.hidden=true;
    unitsField.innerHTML='<label for="gonTimerPeriodicUnits">Numero lotti</label><input id="gonTimerPeriodicUnits" type="number" min="4" max="100" step="1">';
    field.insertAdjacentElement('afterend',unitsField);

    client.addEventListener('change',syncTimer);
    type.addEventListener('change',()=>{ensureProgrammed(type,macro,el('gonTimerPeriodicService'));syncTimer()});
    macro.addEventListener('change',()=>{if(!isProgrammed(macro.value)){el('gonTimerPeriodicService').value='';syncTimer()}});
    el('gonTimerPeriodicService').addEventListener('change',()=>{ensureProgrammed(type,macro,el('gonTimerPeriodicService'));syncUnits(el('gonTimerPeriodicService'),unitsField,el('gonTimerPeriodicUnits'))});
    new MutationObserver(()=>{if(dialog.open)syncTimer()}).observe(dialog,{attributes:true,attributeFilter:['open']});

    form.addEventListener('submit',saveTimer,true);
    return true;
  }
  function syncTimer(){
    const client=el('gonTimerDetailClient'),service=el('gonTimerPeriodicService'),field=el('gonTimerPeriodicServiceField'),unitsField=el('gonTimerPeriodicUnitsField'),units=el('gonTimerPeriodicUnits');
    if(!client||!service||!field||!unitsField||!units)return;
    const current=service.value,items=forClient(client.value);
    field.hidden=!items.length;fillSelect(service,items,current);
    if(!items.length){service.value='';unitsField.hidden=true;units.value='';return}
    syncUnits(service,unitsField,units);
  }
  async function saveTimer(e){
    e.preventDefault();e.stopImmediatePropagation();
    const dialog=el('gonTimerDetailDialog'),error=el('gonTimerDetailError'),save=el('gonTimerDetailSave');
    const client=el('gonTimerDetailClient').value,type=el('gonTimerDetailType').value,macro=el('gonTimerDetailMacro').value,description=el('gonTimerDetailText').value.trim();
    const service=el('gonTimerPeriodicService')?.value||'',units=el('gonTimerPeriodicUnits')?.value||'';
    try{
      validate(client,macro,service,units);
      const a=await api().auth.getUser();const user=a.data?.user;if(a.error||!user)throw new Error('Sessione scaduta.');
      save.disabled=true;
      const payload={entry_id:dialog.dataset.entryId,client,type,macro,description,periodic_package_code:service||null,periodic_units:service===FOUR_PLUS?Number(units):null};
      const r=await api().rpc('gon_entry_with_package',{p_action:'complete',p_payload:payload,p_expected_user:user.id});
      if(r.error)throw r.error;dialog.close();if(typeof load==='function')await load(true);window.dispatchEvent(new Event('pageshow'));
    }catch(err){if(error)error.textContent=err.message||'Dettagli non salvati.'}
    finally{save.disabled=false}
  }

  function boot(){
    loadCache();mountManual();
    const timerWait=new MutationObserver(()=>{if(mountTimer())timerWait.disconnect()});
    timerWait.observe(document.body,{childList:true,subtree:true});mountTimer();
    const client=el('client');if(client)new MutationObserver(syncManual).observe(client,{childList:true});
    refreshPackages();
  }
  window.GonPeriodicServices=Object.freeze({version:VERSION,refresh:refreshPackages});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();