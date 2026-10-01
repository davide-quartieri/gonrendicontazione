(() => {
  'use strict';
  const VERSION='customer-registry-2.0.0';
  const FIELDS=[
    ['legal_name','Ragione sociale / nome e cognome'],['vat_number','Partita IVA'],['tax_code','Codice fiscale'],
    ['address','Indirizzo e numero civico'],['postcode','CAP'],['city','Comune'],['province','Provincia'],['country','Paese (IT, ...)'],
    ['pec','PEC'],['sdi_code','Codice destinatario'],['email','Email'],['phone','Telefono'],['contact','Referente cliente'],['payment_terms','Condizioni di pagamento']
  ];
  let root=null,list=[],editing=null,busy=false,mounted=false;
  const q=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function setMsg(text,error=false){const el=q('crMessage');if(!el)return;el.textContent=text||'';el.style.color=error?'#b42318':'#155f96';}
  async function actor(){
    if(typeof db==='undefined'||!db)throw new Error('Accedi prima di gestire i clienti.');
    const a=await db.auth.getUser();if(a.error||!a.data?.user)throw new Error('Sessione scaduta. Accedi nuovamente.');
    const p=await db.from('user_profiles').select('role').eq('user_id',a.data.user.id).maybeSingle();
    if(p.error||p.data?.role!=='admin')throw new Error('Gestione anagrafica riservata agli amministratori.');
    return a.data.user;
  }
  async function rpc(action,payload={}){
    const u=await actor();
    const r=await db.rpc('gon_customer_registry',{p_action:action,p_payload:payload,p_expected_user:u.id});
    if(r.error)throw r.error;return r.data;
  }
  function fieldHtml([k,label]){return `<div class="field"><label for="cr_${k}">${esc(label)}</label><input id="cr_${k}" maxlength="500"${k==='legal_name'?' required':''}></div>`;}
  function shell(){
    const section=document.getElementById('clienti');if(!section||mounted)return false;
    mounted=true;
    [...section.children].forEach(el=>el.classList.add('gon-registry-legacy-hidden'));
    const style=document.createElement('style');style.textContent=`
      .gon-registry-legacy-hidden{display:none!important}.cr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.cr-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.cr-sites{display:grid;gap:10px}.cr-site{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;padding:12px;border:1px solid #d5e1ed;border-radius:12px;background:#f8fbff}.cr-list{display:grid;gap:10px}.cr-card{border:1px solid #d5e1ed;border-radius:12px;padding:14px;background:#fff;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px}.cr-meta{color:#667085;font-size:13px;margin-top:4px;line-height:1.4}.cr-danger{background:#d92d20!important;color:#fff!important;border-color:#d92d20!important}.cr-card h3{margin:0;font-size:16px}.cr-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.cr-note{font-size:13px;color:#667085;margin:6px 0 0}.cr-card-buttons{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}.cr-sites-title{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:12px 0 8px}.cr-empty{padding:18px;border:1px dashed #c7d5e3;border-radius:12px;color:#667085;text-align:center}@media(max-width:900px){.cr-grid{grid-template-columns:1fr 1fr}.cr-card{grid-template-columns:1fr}}@media(max-width:620px){.cr-grid,.cr-site{grid-template-columns:1fr}.cr-site button{justify-self:start}}
    `;document.head.append(style);
    root=document.createElement('div');root.id='gonCustomerRegistryV2';root.innerHTML=`
      <div class="card">
        <div class="cr-head"><div><h2 id="crFormTitle">Nuovo cliente</h2><p class="cr-note">Gestisci qui l'intera anagrafica del cliente e le sedi/cantieri operativi. I dati salvati vengono usati automaticamente nelle proforme.</p></div><button id="crNew" class="btn light" type="button">Nuovo cliente</button></div>
        <form id="crForm">
          <div class="cr-grid"><div class="field"><label for="crMain">Cliente principale</label><input id="crMain" maxlength="200" required></div>${FIELDS.map(fieldHtml).join('')}<div class="field"><label for="crCassa">Cassa geometri %</label><input id="crCassa" type="number" min="0" max="100" step="0.0001" value="5" required></div><div class="field"><label style="display:flex;gap:8px;align-items:center"><input id="crCassaExpenses" type="checkbox" style="width:18px"> Spese imponibili soggette anche a Cassa</label></div></div>
          <div class="cr-sites-title"><div><strong>Sedi / cantieri operativi</strong><p class="cr-note">Il nome visualizzato è quello che gli operatori selezionano nell'inserimento ore.</p></div><button id="crAddSite" type="button" class="btn light">Aggiungi sede / cantiere</button></div>
          <div id="crSites" class="cr-sites"></div>
          <p id="crMessage" role="status"></p>
          <div class="cr-actions"><button id="crSave" class="btn" type="submit">Salva cliente</button><button id="crCancel" class="btn light" type="button" hidden>Annulla modifica</button></div>
        </form>
      </div>
      <div class="card"><div class="cr-head"><div><h2>Anagrafica clienti</h2><p class="cr-note">Elenco dei clienti principali con anagrafica completa e relativi cantieri.</p></div><button id="crReload" type="button" class="btn light">Aggiorna</button></div><div id="crList" class="cr-list"></div></div>`;
    section.prepend(root);
    q('crAddSite').onclick=()=>addSite({});q('crNew').onclick=reset;q('crCancel').onclick=reset;q('crReload').onclick=()=>load(true);
    q('crForm').onsubmit=e=>{e.preventDefault();save();};
    addSite({});
    return true;
  }
  function addSite(site={}){
    const host=q('crSites');if(!host)return;
    const row=document.createElement('div');row.className='cr-site';row.dataset.id=site.id||'';
    row.innerHTML=`<div class="field"><label>Sede / cantiere</label><input data-site maxlength="200" value="${esc(site.site||'')}"></div><div class="field"><label>Nome visualizzato</label><input data-display maxlength="250" required value="${esc(site.display||'')}"></div><button type="button" class="btn light cr-danger">Rimuovi</button>`;
    row.querySelector('button').onclick=()=>{if(host.children.length<=1){row.querySelector('[data-site]').value='';row.querySelector('[data-display]').value='';return;}row.remove();};host.append(row);
  }
  function reset(){
    editing=null;q('crFormTitle').textContent='Nuovo cliente';q('crMain').value='';FIELDS.forEach(([k])=>q('cr_'+k).value=k==='country'?'IT':'');q('crCassa').value='5';q('crCassaExpenses').checked=true;q('crSites').replaceChildren();addSite({});q('crCancel').hidden=true;setMsg('');
  }
  function edit(item){
    editing=item;q('crFormTitle').textContent='Modifica cliente';q('crMain').value=item.main||item.name||'';const legal=item.profile?.legal_data||{};FIELDS.forEach(([k])=>q('cr_'+k).value=legal[k]||'');q('crCassa').value=item.profile?.cassa_rate??5;q('crCassaExpenses').checked=item.profile?.cassa_on_expenses!==false;q('crSites').replaceChildren();(item.sites?.length?item.sites:[{id:item.id,site:item.site||'',display:item.display||item.main||''}]).forEach(addSite);q('crCancel').hidden=false;setMsg('Modifica in corso. I documenti già emessi conservano la propria copia anagrafica.');root.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function sitesPayload(){return [...q('crSites').children].map(row=>({id:row.dataset.id||null,site:row.querySelector('[data-site]').value.trim(),display:row.querySelector('[data-display]').value.trim()}));}
  async function save(){
    if(busy)return;busy=true;q('crSave').disabled=true;setMsg('Salvataggio...');
    try{
      const legal={};FIELDS.forEach(([k])=>legal[k]=q('cr_'+k).value.trim());
      const payload={client_id:editing?.id||null,profile_version:editing?.profile?.version||0,main:q('crMain').value.trim(),legal_data:legal,cassa_rate:Number(q('crCassa').value),cassa_on_expenses:q('crCassaExpenses').checked,sites:sitesPayload()};
      if(payload.sites.some(s=>!s.display))throw new Error('Indica il nome visualizzato di ogni sede/cantiere.');
      await rpc('save',payload);reset();await load(true);if(typeof window.load==='function')await window.load(true);setMsg('Cliente salvato.');
    }catch(e){setMsg(e.message||'Salvataggio non riuscito.',true);}finally{busy=false;q('crSave').disabled=false;}
  }
  async function remove(item){
    if(busy)return;if(!confirm('Eliminare definitivamente '+(item.main||item.display)+'? L’operazione è consentita solo se il cliente non è già usato in attività, condizioni economiche o proforme.'))return;
    busy=true;setMsg('Eliminazione...');try{await rpc('delete',{client_id:item.id});if(editing?.id===item.id)reset();await load(true);if(typeof window.load==='function')await window.load(true);setMsg('Cliente eliminato.');}catch(e){setMsg(e.message||'Eliminazione non riuscita.',true);}finally{busy=false;}
  }
  function render(){
    const host=q('crList');if(!host)return;host.replaceChildren();if(!list.length){const d=document.createElement('div');d.className='cr-empty';d.textContent='Nessun cliente presente. Inserisci il primo cliente dall’anagrafica qui sopra.';host.append(d);return;}
    for(const item of list){const p=item.profile?.legal_data||{},sites=item.sites||[];const card=document.createElement('div');card.className='cr-card';const usage=item.usage||{};const locality=[p.postcode,p.city,p.province].filter(Boolean).join(' ');card.innerHTML=`<div><h3>${esc(item.main||item.display)}</h3><div class="cr-meta">${esc(p.legal_name||'Anagrafica fiscale da completare')}${p.vat_number?' · P.IVA '+esc(p.vat_number):''}${p.tax_code?' · CF '+esc(p.tax_code):''}${locality?' · '+esc(locality):''}</div><div class="cr-meta">${sites.length?sites.map(s=>esc(s.display)+(s.site?' ('+esc(s.site)+')':'')).join(' · '):'Nessuna sede/cantiere'}</div><div class="cr-meta">Uso: ${Number(usage.entries||0)} attività · ${Number(usage.terms||0)} condizioni · ${Number(usage.reports||0)} proforme/rendiconti</div></div><div class="cr-card-buttons"><button type="button" class="btn light" data-edit>Modifica</button><button type="button" class="btn light cr-danger" data-delete>Elimina</button></div>`;card.querySelector('[data-edit]').onclick=()=>edit(item);card.querySelector('[data-delete]').onclick=()=>remove(item);host.append(card);}
  }
  async function load(force=false){
    if(!root||busy)return;try{const data=await rpc('list',{});list=Array.isArray(data)?data:[];render();if(force)setMsg('Elenco aggiornato.');}catch(e){setMsg(e.message||'Impossibile caricare l’anagrafica.',true);}
  }
  async function boot(){if(!shell())return;reset();try{await load();}catch(e){}document.addEventListener('gon:data-refreshed',()=>load().catch(()=>{}));}
  window.GonCustomerRegistry=Object.freeze({version:VERSION,refresh:()=>load(true)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();