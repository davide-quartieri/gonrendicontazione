/* Shared admin editor used by the local and online GON Management modules. */
(()=>{'use strict';
const FIELDS=[['legal_name','Ragione sociale'],['vat_number','Partita IVA'],['tax_code','Codice fiscale'],['address','Indirizzo e numero civico'],['postcode','CAP'],['city','Comune'],['province','Provincia'],['country','Paese (IT, ES, ...)'],['pec','PEC'],['sdi_code','Codice destinatario'],['email','Email'],['phone','Telefono'],['contact','Referente cliente'],['payment_terms','Condizioni di pagamento']];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function mount(host,adapter){
 let rows=[],editing=null,dirty=false,busy=false,request=null,disposed=false;
 host.classList.add('gmr');
 host.innerHTML=`<div class="gmr-alert"><div class="gmr-tag">Archivio operativo condiviso</div><strong>Qui lavori sui clienti reali di GON.</strong><br>Le modifiche confermate diventano disponibili nella rendicontazione. Per inserimenti fittizi usa solo le anagrafiche locali di prova.</div><div class="gmr-status" data-msg role="status" aria-live="polite"></div><section class="gmr-card gmr-editor" data-editor hidden><form data-form><fieldset data-fields><div class="gmr-bar"><h2 data-title>Cliente</h2><button type="button" data-cancel>Chiudi modifica</button></div><p class="gmr-muted">Un cliente, piu siti. I dati amministrativi non sono visibili agli operatori. I documenti gia generati conservano la loro copia.</p><div class="gmr-grid"><label>Nome breve cliente<input name="main" maxlength="200" required></label>${FIELDS.map(([k,t])=>`<label>${t}<input name="${k}" maxlength="${k==='country'?2:500}" ${k==='legal_name'?'required':''}></label>`).join('')}<label>Cassa geometri (%)<input name="cassa_rate" type="number" min="0" max="100" step="0.0001" required></label><label class="gmr-check"><input name="cassa_on_expenses" type="checkbox"> Spese soggette anche a Cassa</label></div><div class="gmr-bar gmr-split"><h3>Siti / cantieri</h3><button type="button" data-add>Aggiungi sito</button></div><p class="gmr-muted">Il nome visualizzato compare nel campo Cliente / Cantiere. Disattivare un sito lo esclude dalle nuove selezioni senza cancellare le ore. I siti gia utilizzati non vengono rinominati automaticamente.</p><div data-sites></div><button type="submit" class="primary">Salva nell'archivio operativo</button></fieldset></form></section><section class="gmr-card"><div class="gmr-bar"><div><h2>Anagrafiche condivise</h2><p class="gmr-muted" data-count></p></div><div class="gmr-actions"><button type="button" data-refresh>Aggiorna elenco</button><button type="button" class="primary" data-new>Nuovo cliente operativo</button></div></div><input class="gmr-search" data-search placeholder="Cerca cliente, partita IVA o sito" aria-label="Cerca anagrafiche"><div data-list></div></section>`;
 const q=s=>host.querySelector(s), form=q('[data-form]');
 const msg=(s,error=false)=>{q('[data-msg]').textContent=s;q('[data-msg]').classList.toggle('gmr-error',error);};
 const changed=()=>{dirty=true;request=null;};
 const before=e=>{if(dirty){e.preventDefault();e.returnValue='';}};
 window.addEventListener('beforeunload',before);
 function allowDiscard(){return !dirty||confirm('Abbandonare le modifiche non salvate?');}
 function reset(){editing=null;dirty=false;request=null;q('[data-editor]').hidden=true;form.reset();q('[data-sites]').replaceChildren();}
 function autoDisplay(row){if(row.dataset.auto==='1')row.querySelector('[data-display]').value=[form.elements.main.value.trim(),row.querySelector('[data-site]').value.trim()].filter(Boolean).join(' - ');}
 function addSite(site={}){
  const row=document.createElement('div');row.className='gmr-site';row.dataset.id=site.id||'';row.dataset.auto=site.id||site.display?'0':'1';
  row.innerHTML=`<label>Sito / cantiere<input data-site maxlength="200" value="${esc(site.site||'')}"></label><label>Nome visualizzato<input data-display maxlength="250" value="${esc(site.display||'')}" required></label><div><label class="gmr-check"><input type="checkbox" data-active ${site.active!==false?'checked':''}> Disponibile nella rendicontazione</label>${site.id?'<span class="gmr-muted">Identificativo esistente conservato</span>':'<button type="button" data-remove>Rimuovi riga nuova</button>'}</div>`;
  row.querySelector('[data-site]').oninput=()=>autoDisplay(row);
  row.querySelector('[data-display]').oninput=()=>{row.dataset.auto='0';};
  const remove=row.querySelector('[data-remove]');if(remove)remove.onclick=()=>{if(q('[data-sites]').children.length<=1)return msg('Serve almeno un sito/cantiere.',true);row.remove();changed();};
  q('[data-sites]').append(row);autoDisplay(row);
 }
 function edit(item){
  if(busy||!allowDiscard())return;
  reset();editing=item;q('[data-editor]').hidden=false;
  q('[data-title]').textContent=item?'Modifica cliente operativo':'Nuovo cliente operativo';
  const legal=item?.profile?.legal_data||{};
  form.elements.main.value=item?.main||'';
  FIELDS.forEach(([k])=>{form.elements[k].value=legal[k]||(k==='country'?'IT':'');});
  form.elements.cassa_rate.value=item?.profile?.cassa_rate??5;
  form.elements.cassa_on_expenses.checked=item?.profile?.cassa_on_expenses!==false;
  (item?.sites?.length?item.sites:[{}]).forEach(addSite);
  dirty=false;msg(item?'Stai modificando un cliente gia presente. Nessuna modifica finche non confermi il salvataggio.':'Nuovo cliente nell\'ambiente operativo: non inserire dati di prova.');
  q('[data-editor]').scrollIntoView({block:'start',behavior:'smooth'});form.elements.main.focus();
 }
 function render(){
  const term=q('[data-search]').value.toLowerCase();const list=q('[data-list]');list.replaceChildren();
  const filtered=rows.filter(r=>JSON.stringify([r.main,r.profile?.legal_data?.vat_number,r.sites]).toLowerCase().includes(term));
  q('[data-count]').textContent=`${rows.length} clienti / ${rows.reduce((n,r)=>n+r.sites.length,0)} siti totali. Seleziona un cliente per modificarlo.`;
  if(!filtered.length){list.innerHTML='<p class="gmr-muted">Nessun cliente da mostrare.</p>';return;}
  for(const item of filtered){
   const d=document.createElement('article');d.className='gmr-row';const p=item.profile?.legal_data||{};
   d.innerHTML=`<div class="gmr-bar"><div><h3>${esc(item.main||item.display)}</h3><div class="gmr-muted">${esc(p.legal_name||'')}${p.vat_number?' / P.IVA '+esc(p.vat_number):''}</div></div><div class="gmr-actions"><button type="button" data-edit>Modifica</button>${adapter.onImport?'<button type="button" data-import>Usa / aggiorna nel gestionale</button>':''}</div></div><ul class="gmr-list-sites">${item.sites.map(s=>`<li><span class="gmr-break">${esc(s.display)}</span><span class="gmr-pill ${s.active?'':'inactive'}">${s.active?'Disponibile':'Disattivato'}</span></li>`).join('')}</ul>`;
   d.querySelector('[data-edit]').onclick=()=>edit(item);
   const imp=d.querySelector('[data-import]');if(imp)imp.onclick=async()=>{if(busy)return;try{await adapter.onImport(item);}catch(e){msg(e.message,true);}};
   list.append(d);
  }
 }
 async function refresh(discard=false){
  if(busy||disposed)return;if(discard&&!allowDiscard())return;
  if(discard)reset();busy=true;msg('Lettura dell\'archivio condiviso...');
  try{const result=await adapter.list();if(!Array.isArray(result)||result.some(r=>!Array.isArray(r.sites)||!r.registry_token))throw Error('Formato anagrafica non riconosciuto.');rows=result;if(disposed)return;render();msg('Elenco aggiornato. Nessuna anagrafica locale e stata pubblicata automaticamente.');}
  catch(e){msg(e.message||'Collegamento non riuscito.',true);}finally{busy=false;}
 }
 form.oninput=()=>{changed();q('[data-sites]').querySelectorAll('.gmr-site').forEach(autoDisplay);};
 form.onsubmit=async e=>{
  e.preventDefault();if(busy||!form.reportValidity())return;
  const legal={};FIELDS.forEach(([k])=>legal[k]=form.elements[k].value.trim());legal.country=legal.country.toUpperCase();
  const sites=[...q('[data-sites]').children].map(r=>({id:r.dataset.id||null,site:r.querySelector('[data-site]').value.trim(),display:r.querySelector('[data-display]').value.trim(),active:r.querySelector('[data-active]').checked}));
  if(sites.some(s=>!s.display))return msg('Nome visualizzato obbligatorio per ogni sito.',true);
  if(new Set(sites.map(s=>s.display.toLowerCase())).size!==sites.length)return msg('Due siti non possono avere lo stesso nome visualizzato.',true);
  const payload={client_id:editing?.id||null,profile_version:editing?.profile?.version||0,registry_token:editing?.registry_token||null,main:form.elements.main.value.trim(),legal_data:legal,cassa_rate:Number(form.elements.cassa_rate.value),cassa_on_expenses:form.elements.cassa_on_expenses.checked,sites};
  if(!confirm(`Confermare ${editing?'la modifica':'la creazione'} di ${payload.main} nell'ARCHIVIO OPERATIVO GON?\n${sites.filter(s=>s.active).length} siti disponibili nella rendicontazione. Nessuna ora o fattura viene creata.`))return;
  if(!request)request=crypto.randomUUID();payload.request_id=request;
  busy=true;q('[data-fields]').disabled=true;msg('Salvataggio operativo in corso...');
  try{
   const saved=await adapter.save(payload);dirty=false;request=null;reset();busy=false;
   await refresh();msg('Cliente salvato nell\'archivio condiviso. Aggiorna la rendicontazione per visualizzare le voci disponibili.');
   if(adapter.onSaved)await adapter.onSaved(saved);
  }catch(err){msg((err.message||'Salvataggio non confermato.')+'\nLe modifiche restano nel modulo. In caso di errore di rete, riprova lo stesso salvataggio senza creare un altro cliente.',true);}
  finally{busy=false;q('[data-fields]').disabled=false;}
 };
 q('[data-new]').onclick=()=>edit(null);q('[data-cancel]').onclick=()=>{if(allowDiscard())reset();};
 q('[data-add]').onclick=()=>{if(q('[data-sites]').children.length>=50)return msg('Massimo 50 siti per cliente.',true);addSite();changed();};
 q('[data-refresh]').onclick=()=>refresh(true);q('[data-search]').oninput=render;
 refresh();
 return {refresh:()=>refresh(true),isDirty:()=>dirty,isBusy:()=>busy,dispose:()=>{disposed=true;window.removeEventListener('beforeunload',before);}};
}
window.GonMasterUI=Object.freeze({version:'registry-1.0.0',mount,fields:FIELDS,escape:esc});
})();
