/* Administration: versioned commercial conditions and issued report snapshots. */
(() => {
 'use strict';
 const VERSION='commercial-1.0.0';
 const MACROS = [];
 const TYPES=['Cantiere','Viaggio','Ufficio'];
 const $=id=>document.getElementById(id), api=()=>{try{return db;}catch{return null;}};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>n===null||n===undefined?'Da definire':Number(n).toLocaleString('it-IT',{style:'currency',currency:'EUR'});
 const num=n=>Number(n||0).toLocaleString('it-IT',{maximumFractionDigits:4});
 const date=s=>s?String(s).slice(0,10).split('-').reverse().join('/'):'senza scadenza';
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const names={draft:'Bozza',issued:'Emesso',sent:'Inviato',superseded:'Sostituito'};
 const modes={hour:'A ore',fixed:'Forfait unico',monthly:'Canone mensile'};
 let actor=null,allowed=false,epoch=0,projects=[],clients=[],overview=null,currentReport=null,editorDirty=false;
 let root,button,projectDialog,termsDialog,reportDialog,requestSequence=0,prepareRequest=null;
 const busy=new Set();
 function say(message,error=false){const p=$('gcMessage');if(p){p.textContent=message;p.classList.toggle('gc-error',error);}}
 function hide(){allowed=false;overview=null;currentReport=null;prepareRequest=null;projects=[];clients=[];if(button)button.hidden=true;if(root){root.hidden=true;root.classList.remove('active');$('gcEntries').replaceChildren();$('gcArchive').replaceChildren();$('gcTermsHistory').replaceChildren();}for(const d of [projectDialog,termsDialog,reportDialog])if(d?.open)d.close();for(const id of ['gcRules','gcReportLines','gcExpenses'])$(id)?.replaceChildren();for(const id of ['gcTotals','gcReportTitle','gcReportAlert','gcReportMessage','gcTermsMessage']){const el=$(id);if(el)el.textContent='';}document.querySelectorAll('#gcReportDialog input,#gcReportDialog textarea,#gcTermsDialog input').forEach(el=>el.value='');}
 async function rpc(action,payload){
  if(!allowed||!actor)throw new Error('Accesso amministratore richiesto.');
  if(!navigator.onLine)throw new Error('Serve una connessione attiva. I campi compilati non vengono cancellati.');
  const owner=actor.id,stamp=epoch,abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),30000);
  try{
   const r=await api().rpc('gon_commercial',{p_action:action,p_payload:payload,p_expected_user:owner}).abortSignal(abort.signal);
   if(stamp!==epoch)throw new Error('Account cambiato: operazione interrotta.');
   if(r.error){if(r.error.code==='42501')hide();throw r.error;}return r.data;
  }finally{clearTimeout(timeout);}
 }
 async function action(id,fn){
  if(busy.has(id))return;busy.add(id);const b=$(id);if(b)b.disabled=true;
  try{await fn();}catch(e){say(e.message||'Operazione non completata.',true);if(reportDialog?.open)$('gcReportMessage').textContent=e.message||'Operazione non completata.';if(termsDialog?.open)$('gcTermsMessage').textContent=e.message;if(projectDialog?.open)$('gcProjectMessage').textContent=e.message;}
  finally{busy.delete(id);if(b)b.disabled=false;updateEditorButtons();}
 }
 async function list(table,fields){const rows=[];for(let i=0;;i+=500){const r=await api().from(table).select(fields).order('id').range(i,i+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;if(rows.length>=10000)throw new Error('Archivio troppo ampio.');}}
 async function references(selected){
  const stamp=epoch;const [p,c]=await Promise.all([list('gon_projects','*'),list('clients','id,main,site,display,active')]);if(stamp!==epoch)return;
  projects=p;clients=c;const select=$('gcProject'),prev=selected||select.value;select.replaceChildren(new Option('Seleziona una commessa',''));
  projects.sort((a,b)=>a.code.localeCompare(b.code)).forEach(p=>{const c=clients.find(c=>c.id===p.client_id);select.add(new Option((c?.display||'Cliente')+' | '+p.code+' - '+p.name+(p.active?'':' (chiusa)'),p.id));});
  if(projects.some(p=>p.id===prev))select.value=prev;
 }
 function panelOpen(){
  if(!allowed)return;document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.tab').forEach(p=>p.classList.remove('active'));
  root.hidden=false;root.classList.add('active');button.classList.add('active');
  action('gcOpen',async()=>{await references();if($('gcProject').value)await loadOverview();else say('Crea la prima commessa e collega le condizioni concordate. Non sono state assegnate tariffe automatiche.');});
 }
 function makeDialog(id,title,body){const d=document.createElement('dialog');d.id=id;d.className='gc-dialog';d.innerHTML='<h2>'+title+'</h2>'+body;document.body.append(d);return d;}
 function mount(){
  if(typeof MODE==='undefined'||MODE!=='pc'||!$('tabs'))return false;
  const style=document.createElement('style');style.textContent=`
   .gc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.gc-tools{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:12px 0}.gc-tools .field{flex:1;min-width:155px}
   .gc-note{color:#667085;font-size:13px;line-height:1.5}.gc-error{color:#b42318!important}.gc-scroll{overflow:auto}.gc-table{min-width:760px}.gc-table td{vertical-align:middle}
   .gc-table input[type=checkbox]{width:18px;height:18px;padding:0}.gc-table .gc-small{font-size:12px;color:#667085}.gc-table textarea{min-height:54px;min-width:200px}
   .gc-table input[type=number]{width:120px}.gc-table input[type=text]{min-width:160px}.gc-dialog{width:min(1120px,calc(100% - 24px));max-height:92dvh;border:0;border-radius:18px;padding:24px;color:#182232}
   .gc-dialog::backdrop{background:#10182899}.gc-dialog .field{margin:8px 0}.gc-dialog h2{margin-top:0}.gc-dialog input,.gc-dialog textarea,.gc-dialog select{max-width:100%;box-sizing:border-box}
   .gc-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.gc-dialog button:disabled{opacity:.5;cursor:not-allowed}.gc-total{font-size:24px;font-weight:700;color:#155f96}.gc-tag{display:inline-block;background:#eef4fa;padding:4px 8px;border-radius:12px}
   .gc-banner{padding:12px;background:#fff4df;color:#815516;border-radius:10px;margin:10px 0}.gc-dialog details{margin:10px 0}.gc-term-label{max-width:220px}.gc-issued input,.gc-issued textarea{background:#f5f7fa}
   @media(max-width:760px){.gc-grid{grid-template-columns:1fr}.gc-dialog{padding:16px}.gc-actions button{width:auto}.gc-tools button{width:auto}}
  `;document.head.append(style);
  button=document.createElement('button');button.id='gcOpen';button.className='tab admin-only';button.textContent='Commesse e rendiconti';button.hidden=true;button.onclick=panelOpen;$('tabs').append(button);
  root=document.createElement('section');root.id='gonCommercialPanel';root.className='panel admin-only';root.hidden=true;
  root.innerHTML=`<div class="card"><h2>Commesse e rendiconti clienti</h2><p class="gc-note">Condizioni riservate all'amministrazione, uguali per tutti gli operatori della commessa. Importi in EUR; IVA e altri oneri non calcolati.</p>
   <div class="gc-tools"><div class="field"><label for="gcProject">Cliente / commessa</label><select id="gcProject"></select></div><button id="gcNewProject" type="button" class="btn">Nuova commessa</button><button id="gcEditProject" type="button" class="btn light">Modifica commessa</button></div>
   <div class="gc-tools"><div class="field"><label for="gcFrom">Dal</label><input id="gcFrom" type="date"></div><div class="field"><label for="gcTo">Al</label><input id="gcTo" type="date"></div><button id="gcLoad" type="button" class="btn">Carica periodo</button><button id="gcTerms" type="button" class="btn light">Condizioni economiche</button></div>
   <p id="gcMessage" role="status" class="gc-note"></p><div id="gcTermsHistory"></div></div>
   <div class="card"><h2>Attivit\u00e0 del cliente nel periodo</h2><p class="gc-note">Sono mostrate quelle della commessa e quelle ancora da assegnare. Seleziona le righe da associare o includere. Le incomplete non possono entrare in un rendiconto.</p>
   <div class="gc-actions"><button id="gcSelectEligible" class="btn light" type="button">Seleziona pronte</button><button id="gcAssign" class="btn light" type="button">Assegna selezionate alla commessa</button><button id="gcPrepare" class="btn ok" type="button">Prepara bozza</button></div>
   <div class="field"><label for="gcReplaces">Documento da sostituire (solo per una revisione)</label><select id="gcReplaces"><option value="">Nuovo rendiconto</option></select></div>
   <div class="gc-scroll"><table class="gc-table"><thead><tr><th></th><th>Data / operatore</th><th>Attivit\u00e0</th><th>Tipo / macroarea</th><th>Ore</th><th>Stato</th></tr></thead><tbody id="gcEntries"></tbody></table></div></div>
   <div class="card"><h2>Archivio rendiconti</h2><p class="gc-note">Ultimi 100 documenti della commessa. Le copie emesse non cambiano quando si modificano attivit\u00e0 o tariffe.</p><div class="gc-scroll"><table class="gc-table"><thead><tr><th>Documento</th><th>Periodo</th><th>Stato</th><th>Corrispettivo</th><th>Controllo fonti</th><th></th></tr></thead><tbody id="gcArchive"></tbody></table></div></div>`;
  $('ore').parentElement.append(root);$('gcFrom').value=today().slice(0,8)+'01';$('gcTo').value=today();
  $('gcProject').onchange=()=>action('gcLoad',loadOverview);$('gcLoad').onclick=()=>action('gcLoad',loadOverview);
  $('gcNewProject').onclick=()=>editProject(null);$('gcEditProject').onclick=()=>editProject(projects.find(p=>p.id===$('gcProject').value));$('gcTerms').onclick=()=>editTerms();
  $('gcReplaces').onchange=renderEntries;$('gcSelectEligible').onclick=()=>{if(!overview)return;root.querySelectorAll('input[data-entry]').forEach(b=>{const e=overview.entries.find(e=>e.id===b.dataset.entry);b.checked=ready(e);});};
  $('gcAssign').onclick=()=>action('gcAssign',assignSelected);$('gcPrepare').onclick=()=>action('gcPrepare',prepare);
  makeProjectDialog();makeTermsDialog();makeReportDialog();return true;
 }
 async function loadOverview(){
  const pid=$('gcProject').value;if(!pid){overview=null;renderOverview();return;}
  const seq=++requestSequence;const data=await rpc('overview',{project_id:pid,from:$('gcFrom').value,to:$('gcTo').value});
  if(seq!==requestSequence||pid!==$('gcProject').value)return;overview=data;prepareRequest=null;renderOverview();say(data.entries.length+' attivita caricate. Nessun dato e stato modificato.');
 }
 function ready(e){const rep=$('gcReplaces').value;return e.project_id===overview?.project.id&&!e.needs_details&&(!e.billed_report_id||e.billed_report_id===rep);}
 function renderOverview(){
  $('gcTermsHistory').replaceChildren();$('gcArchive').replaceChildren();$('gcReplaces').replaceChildren(new Option('Nuovo rendiconto',''));
  if(!overview){$('gcEntries').replaceChildren();return;}
  for(const t of overview.terms){
   const d=document.createElement('details'),sum=document.createElement('summary');sum.textContent='Condizioni v'+t.version+' | dal '+date(t.valid_from)+' al '+date(t.valid_to)+(t.superseded?' | sostituite':'')+' | '+(t.reference||'riferimento non indicato');d.append(sum);
   const box=document.createElement('div');box.className='gc-scroll';box.innerHTML='<table><thead><tr><th>Prestazione</th><th>Tipo</th><th>Modalita</th><th>Tariffa</th></tr></thead><tbody>'+t.rules.map(r=>'<tr><td>'+esc(r.macro)+'</td><td>'+esc(r.type)+'</td><td>'+esc(modes[r.mode])+'</td><td>'+esc(money(r.price))+'</td></tr>').join('')+'</tbody></table>';
   d.append(box);$('gcTermsHistory').append(d);
  }
  if(!overview.terms.length)$('gcTermsHistory').textContent='Nessuna condizione economica: configura le tariffe concordate.';
  for(const r of overview.reports){
   if(['issued','sent'].includes(r.state))$('gcReplaces').add(new Option(r.number+' | Rev. '+r.revision,r.id));
   const tr=document.createElement('tr');tr.innerHTML='<td>'+esc(r.number||'Bozza')+'<br>Rev. '+r.revision+'</td><td>'+date(r.from)+' - '+date(r.to)+'</td><td>'+esc(names[r.state])+'</td><td>'+esc(money(r.totals?.net))+'</td><td>'+esc(r.source_changes?r.source_changes+' attivita modificate dopo la copia':'Allineate alla copia')+'</td><td></td>';
   const b=document.createElement('button');b.className='btn light';b.type='button';b.textContent='Apri';b.onclick=()=>action('gcReportOpen',()=>openReport(r.id));tr.lastElementChild.append(b);$('gcArchive').append(tr);
  }renderEntries();
 }
 function renderEntries(){
  const body=$('gcEntries');body.replaceChildren();if(!overview)return;
  for(const e of overview.entries){const row=document.createElement('tr'),sel=document.createElement('input');sel.type='checkbox';sel.dataset.entry=e.id;
   const td=document.createElement('td');td.append(sel);row.append(td);
   const status=(e.project_id?'Assegnata':'Da assegnare')+(e.needs_details?' / incompleta':'')+(e.billed_report_id?' / '+e.billed_number:'');
   for(const [value,cls] of [[date(e.date)+' | '+e.employee,''],[e.description,''],[e.type+' / '+e.macro,'gc-small'],[num(e.hours),''],[status,'gc-small']]){const cell=document.createElement('td');cell.textContent=value;cell.className=cls;row.append(cell);}
   body.append(row);
  }
 }
 function selected(){return [...root.querySelectorAll('input[data-entry]:checked')].map(b=>overview.entries.find(e=>e.id===b.dataset.entry));}
 async function assignSelected(){
  if(!overview)throw new Error('Seleziona una commessa.');const items=selected();if(!items.length)throw new Error('Seleziona almeno una attivita.');
  if(!confirm('Assegnare '+items.length+' attivita alla commessa '+overview.project.code+'?'))return;
  const stamp=epoch;const result=await api().rpc('gon_assign_projects',{p_expected_user:actor.id,p_links:items.map(e=>({id:e.id,version:e.edit_version,project_id:overview.project.id}))});
  if(stamp!==epoch)return;if(result.error)throw result.error;await loadOverview();document.dispatchEvent(new Event('gon:data-refreshed'));say('Commesse assegnate.');
 }
 function makeProjectDialog(){
  projectDialog=makeDialog('gcProjectDialog','Commessa',`<form id="gcProjectForm"><div class="gc-grid"><div class="field"><label for="gcPClient">Cliente / cantiere</label><select id="gcPClient" required></select></div><div class="field"><label for="gcPCode">Codice univoco</label><input id="gcPCode" required maxlength="64"></div><div class="field"><label for="gcPName">Descrizione commessa</label><input id="gcPName" required maxlength="180"></div><div class="field"><label for="gcPOrder">Offerta / ordine</label><input id="gcPOrder" maxlength="500"></div></div><label><input id="gcPActive" type="checkbox"> Commessa attiva</label><p id="gcProjectMessage" class="gc-error" role="alert"></p><div class="gc-actions"><button type="button" id="gcPCancel" class="btn light">Annulla</button><button type="submit" id="gcPSave" class="btn">Salva commessa</button></div></form>`);
  $('gcPCancel').onclick=()=>projectDialog.close();$('gcProjectForm').onsubmit=e=>{e.preventDefault();action('gcPSave',async()=>{
   const p=JSON.parse(projectDialog.dataset.project||'null');const result=await rpc('project_save',{id:p?.id||crypto.randomUUID(),version:p?.version,client_id:$('gcPClient').value,code:$('gcPCode').value.trim(),name:$('gcPName').value.trim(),order_ref:$('gcPOrder').value.trim(),active:$('gcPActive').checked});
   projectDialog.close();await references(result.id);await loadOverview();window.GonProjects?.reload();say('Commessa salvata.');
  });};
 }
 function editProject(p){
  if(!allowed)return;if(p===undefined)return say('Seleziona la commessa da modificare.',true);
  projectDialog.dataset.project=JSON.stringify(p);const el=$('gcPClient');el.replaceChildren(new Option('Seleziona cliente',''));clients.forEach(c=>el.add(new Option(c.display,c.id)));el.value=p?.client_id||'';
  $('gcPCode').value=p?.code||'';$('gcPName').value=p?.name||'';$('gcPOrder').value=p?.order_ref||'';$('gcPActive').checked=p?.active??true;$('gcProjectMessage').textContent='';projectDialog.showModal();
 }
 function makeTermsDialog(){
  termsDialog=makeDialog('gcTermsDialog','Condizioni economiche della commessa',`<form id="gcTermsForm"><p class="gc-note">Ogni salvataggio crea una versione. A parita di decorrenza sostituisce la versione attiva, senza modificare le copie gia emesse. Prezzo vuoto = da definire, NON zero.</p><div class="gc-grid"><div class="field"><label for="gcTFrom">Valide dal</label><input id="gcTFrom" type="date" required></div><div class="field"><label for="gcTTo">Valide fino al (facoltativo)</label><input id="gcTTo" type="date"></div><div class="field"><label for="gcTRef">Offerta / accordo di riferimento</label><input id="gcTRef" maxlength="500"></div><div class="field"><label for="gcTNotes">Note interne all'accordo</label><input id="gcTNotes" maxlength="4000"></div></div>
   <div class="gc-banner">Forfait: una quota per macroarea e tipo ore nella commessa. Canone: una quota per mese con attivita selezionate, senza prorata automatico. Le quote gia rendicontate richiedono una revisione. L'arrotondamento orario, se scelto, si applica a ogni registrazione.</div>
   <div class="gc-scroll"><table class="gc-table"><thead><tr><th>Macroarea</th><th>Tipo ore</th><th>Modalita</th><th>Tariffa EUR / unita</th><th>Arrotondamento</th><th>Minuti</th></tr></thead><tbody id="gcRules"></tbody></table></div><p id="gcTermsMessage" class="gc-error" role="alert"></p><div class="gc-actions"><button id="gcTCancel" type="button" class="btn light">Annulla</button><button id="gcTSave" type="submit" class="btn">Salva nuova versione</button></div></form>`);
  $('gcTCancel').onclick=()=>termsDialog.close();$('gcTermsForm').onsubmit=e=>{e.preventDefault();action('gcTSave',async()=>{
   const rules=[...$('gcRules').children].map(tr=>({macro:tr.dataset.macro,type:tr.dataset.type,mode:tr.querySelector('[data-field=mode]').value,price:tr.querySelector('[data-field=price]').value===''?null:Number(tr.querySelector('[data-field=price]').value),round_mode:tr.querySelector('[data-field=round_mode]').value,round_minutes:Number(tr.querySelector('[data-field=round_minutes]').value)}));
   await rpc('terms_save',{id:termsDialog.dataset.requestId,project_id:overview.project.id,expected_terms_id:termsDialog.dataset.current||null,valid_from:$('gcTFrom').value,valid_to:$('gcTTo').value||null,reference:$('gcTRef').value,notes:$('gcTNotes').value,rules});
   termsDialog.close();await loadOverview();say('Nuova versione delle condizioni salvata. Le bozze esistenti non sono state ricalcolate.');
  });};
 }
 function editTerms(){
  if(!overview)return say('Carica una commessa prima di configurare le tariffe.',true);
  const t=overview.terms.find(t=>!t.superseded);termsDialog.dataset.current=t?.id||'';termsDialog.dataset.requestId=crypto.randomUUID();
  $('gcTFrom').value=t?.valid_from>today()?t.valid_from:today();$('gcTTo').value='';$('gcTRef').value=t?.reference||overview.project.order_ref||'';$('gcTNotes').value=t?.notes||'';
  $('gcRules').replaceChildren();for(const macro of MACROS)for(const type of TYPES){const rule=t?.rules.find(r=>r.macro===macro&&r.type===type)||{};const tr=document.createElement('tr');tr.dataset.macro=macro;tr.dataset.type=type;
   tr.innerHTML='<td class="gc-term-label">'+esc(macro)+'</td><td>'+esc(type)+'</td><td><select data-field="mode">'+Object.entries(modes).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></td><td><input data-field="price" type="number" min="0" max="10000000" step="0.0001" placeholder="Da definire"></td><td><select data-field="round_mode"><option value="none">Nessuno</option><option value="up">Per eccesso</option><option value="nearest">Al piu vicino</option></select></td><td><select data-field="round_minutes">'+[0,5,10,15,30,60].map(n=>'<option value="'+n+'">'+(n||'-')+'</option>').join('')+'</select></td>';
   tr.querySelector('[data-field=mode]').value=rule.mode||'hour';tr.querySelector('[data-field=price]').value=rule.price??'';tr.querySelector('[data-field=round_mode]').value=rule.round_mode||'none';tr.querySelector('[data-field=round_minutes]').value=rule.round_minutes||0;$('gcRules').append(tr);
  }$('gcTermsMessage').textContent='';termsDialog.showModal();
 }
 async function prepare(){
  if(!overview)throw new Error('Carica una commessa.');const ids=selected();if(!ids.length||ids.some(e=>!ready(e)))throw new Error('Seleziona solo attivita complete, assegnate e non gia rendicontate (oppure quelle del documento da revisionare).');
  const payload={project_id:overview.project.id,from:$('gcFrom').value,to:$('gcTo').value,entry_ids:ids.map(e=>e.id),replaces_id:$('gcReplaces').value||null,header:{logo:document.querySelector('img.logo')?.src||'',issuer:'GON srl'}};
  const sig=JSON.stringify(payload);if(!prepareRequest||prepareRequest.sig!==sig)prepareRequest={sig,id:crypto.randomUUID()};
  const r=await rpc('report_prepare',{...payload,id:prepareRequest.id});prepareRequest=null;await loadOverview();showReport(r);say('Bozza creata. Completa sintesi e condizioni prima di emetterla.');
 }
 function makeReportDialog(){
  reportDialog=makeDialog('gcReportDialog','Rendiconto cliente',`<div id="gcReportTitle" class="gc-note"></div><p id="gcReportAlert" class="gc-banner" hidden></p><form id="gcReportForm"><div class="gc-grid"><div class="field"><label for="gcRSummary">Sintesi delle attivita (obbligatoria per emissione)</label><textarea id="gcRSummary" data-header="summary" maxlength="4000"></textarea></div><div class="field"><label for="gcRDeliverables">Elaborati / riferimenti di consegna</label><textarea id="gcRDeliverables" data-header="deliverables" maxlength="4000"></textarea></div><div class="field"><label for="gcRContact">Referente GON / contatto</label><input id="gcRContact" data-header="contact" maxlength="500"></div><div class="field"><label for="gcRRecipient">Referente cliente</label><input id="gcRRecipient" data-header="recipient_contact" maxlength="500"></div><div class="field"><label for="gcRAddress">Indirizzo destinatario</label><input id="gcRAddress" data-header="recipient_address" maxlength="1000"></div><div class="field"><label for="gcRIssuer">Dati emittente</label><input id="gcRIssuer" data-header="issuer" maxlength="1000"></div></div><div class="field"><label for="gcRNotes">Note e criteri da mostrare al cliente</label><textarea id="gcRNotes" data-header="notes" maxlength="4000"></textarea></div>
   <h3>Prestazioni valorizzate</h3><p class="gc-note">Le rettifiche qui valgono solo per questo documento. Ore operative, timer e listino restano invariati. Per cambiare quantita o tariffa indicare il motivo.</p><div class="gc-scroll"><table class="gc-table"><thead><tr><th>Rif. / descrizione cliente</th><th>U.M.</th><th>Quantita</th><th>Tariffa EUR</th><th>Importo salvato</th><th>Motivo rettifica (interno)</th></tr></thead><tbody id="gcReportLines"></tbody></table></div>
   <h3>Spese concordate</h3><div id="gcExpenses"></div><button id="gcAddExpense" type="button" class="btn light">Aggiungi spesa</button><div class="field"><label for="gcDiscount">Sconto percentuale sulle sole prestazioni</label><input id="gcDiscount" type="number" min="0" max="100" step="0.0001" value="0"></div>
   <p id="gcTotals" class="gc-total"></p><p class="gc-note">Salva per ricalcolare gli importi sul server. IVA e altri oneri non sono inclusi; questo rendiconto non sostituisce la fattura.</p><p id="gcReportMessage" role="status" class="gc-error"></p>
   <div class="gc-actions"><button id="gcRSave" type="submit" class="btn">Salva e ricalcola importi</button><button id="gcRRecalc" type="button" class="btn light">Aggiorna da attivita e listino</button><button id="gcRIssue" type="button" class="btn ok">Approva ed emetti</button><button id="gcRDiscard" type="button" class="btn danger">Elimina bozza</button></div></form>
   <div class="gc-actions"><button id="gcRPreview" type="button" class="btn light">Anteprima / Stampa PDF</button><button id="gcRHtml" type="button" class="btn light">Scarica copia documento</button><button id="gcRExcel" type="button" class="btn light">Excel economico</button><button id="gcRRevision" type="button" class="btn light">Crea revisione</button><button id="gcRSent" type="button" class="btn light">Registra invio effettuato</button><button id="gcRClose" type="button" class="btn light">Chiudi</button></div>`);
  reportDialog.addEventListener('input',()=>{editorDirty=true;updateEditorButtons();});reportDialog.addEventListener('change',()=>{editorDirty=true;updateEditorButtons();});
  reportDialog.addEventListener('cancel',e=>{if(editorDirty&&!confirm('Chiudere senza salvare le modifiche?'))e.preventDefault();});
  $('gcRClose').onclick=()=>{if(!editorDirty||confirm('Chiudere senza salvare le modifiche?'))reportDialog.close();};
  $('gcReportForm').onsubmit=e=>{e.preventDefault();action('gcRSave',saveReport);};
  $('gcAddExpense').onclick=()=>{addExpense({});editorDirty=true;updateEditorButtons();};
  $('gcRIssue').onclick=()=>action('gcRIssue',async()=>{if(editorDirty)throw new Error('Salva prima le modifiche.');if(confirm('Approvare ed emettere '+money(currentReport.document.totals.net)+'? Dopo l emissione saranno consentite solo revisioni.')){showReport(await rpc('report_issue',{id:currentReport.id,version:currentReport.version}));await loadOverview();}});
  $('gcRRecalc').onclick=()=>action('gcRRecalc',async()=>{if(confirm('Rileggere attivita e tariffe applicabili? Le rettifiche alle righe saranno azzerate. Sconto, spese e intestazione gia salvati restano.'))showReport(await rpc('report_recalculate',{id:currentReport.id,version:currentReport.version}));});
  $('gcRDiscard').onclick=()=>action('gcRDiscard',async()=>{if(confirm('Eliminare questa bozza? Le attivita originali non saranno cancellate.')){await rpc('report_discard',{id:currentReport.id,version:currentReport.version});reportDialog.close();await loadOverview();}});
  $('gcRRevision').onclick=()=>action('gcRRevision',async()=>{if(confirm('Creare una revisione della copia emessa? Dati e prezzi restano quelli emessi finche non scegli esplicitamente di aggiornarli.')){showReport(await rpc('report_revise',{id:currentReport.id,new_id:crypto.randomUUID()}));await loadOverview();}});
  $('gcRSent').onclick=()=>action('gcRSent',async()=>{const dest=prompt('Registra un invio gia effettuato. Questa funzione NON spedisce email. Destinatario:',currentReport.sent_to||'');if(dest?.trim()){showReport(await rpc('report_sent',{id:currentReport.id,version:currentReport.version,sent_to:dest.trim()}));await loadOverview();}});
  $('gcRPreview').onclick=()=>{if(!editorDirty)window.GonClientDocument.open(currentReport);};$('gcRHtml').onclick=()=>{if(!editorDirty)window.GonClientDocument.download(currentReport);};$('gcRExcel').onclick=()=>{if(!editorDirty)window.GonClientDocument.excel(currentReport);};
 }
 function updateEditorButtons(){if(!currentReport||!reportDialog)return;const draft=currentReport.state==='draft';for(const id of ['gcRIssue','gcRPreview','gcRHtml','gcRExcel'])if($(id))$(id).disabled=editorDirty||busy.has(id);if($('gcRIssue'))$('gcRIssue').disabled=$('gcRIssue').disabled||!draft||currentReport.document.totals.missing_rates>0;}
 async function openReport(id){showReport(await rpc('report_get',{id}));}
 function showReport(r){
  currentReport=r;editorDirty=false;const d=r.document,draft=r.state==='draft';
  $('gcReportTitle').textContent=(r.number||'BOZZA')+' | Rev. '+r.revision+' | '+names[r.state]+' | '+d.client.display+' | '+d.project.code+' | '+date(r.period_from)+' - '+date(r.period_to);
  $('gcReportAlert').hidden=!(r.source_changes||d.revision_snapshot);$('gcReportAlert').textContent=d.revision_snapshot?'Revisione basata sulla copia emessa: le attivita originali potrebbero essere cambiate. Aggiornamento solo su richiesta esplicita.':(r.source_changes||0)+' attivita sono cambiate dopo la copia. Verifica prima dell emissione.';
  reportDialog.querySelectorAll('[data-header]').forEach(el=>{el.value=d.header[el.dataset.header]||'';el.disabled=!draft;});
  $('gcReportLines').replaceChildren();for(const line of d.lines){const tr=document.createElement('tr');tr.dataset.id=line.id;
   tr.innerHTML='<td><small>Rif. '+esc(line.refs.join(', '))+' | '+esc(line.terms_reference||'Tariffa non definita')+'</small><textarea data-field="description" maxlength="4000" required></textarea></td><td>'+esc(line.unit)+'</td><td><input data-field="quantity" type="number" min="0" max="1000000" step="any" required></td><td><input data-field="price" type="number" min="0" max="10000000" step="0.0001" placeholder="Da definire"></td><td>'+esc(money(line.amount))+'</td><td><input data-field="reason" type="text" maxlength="1000" placeholder="Motivo della rettifica"></td>';
   for(const k of ['description','quantity','price','reason']){const input=tr.querySelector('[data-field='+k+']');input.value=line[k]??'';input.disabled=!draft;}$('gcReportLines').append(tr);
  }
  $('gcExpenses').replaceChildren();for(const ex of d.expenses)addExpense(ex,!draft);$('gcDiscount').value=d.discount_percent;$('gcDiscount').disabled=!draft;
  $('gcTotals').textContent='Corrispettivo salvato: '+money(d.totals.net)+(d.totals.missing_rates?' | '+d.totals.missing_rates+' tariffe da definire':'');$('gcReportMessage').textContent='';
  for(const id of ['gcRSave','gcRRecalc','gcRIssue','gcRDiscard','gcAddExpense'])$(id).hidden=!draft;
  $('gcRRevision').hidden=!['issued','sent'].includes(r.state);$('gcRSent').hidden=!['issued','sent'].includes(r.state);
  updateEditorButtons();if(!reportDialog.open)reportDialog.showModal();
 }
 function addExpense(ex,disabled=false){const div=document.createElement('div');div.className='gc-tools';div.dataset.expense='true';div.innerHTML='<div class="field"><label>Descrizione spesa</label><input data-field="description" maxlength="1000" required></div><div class="field"><label>Giustificativo</label><input data-field="reference" maxlength="500"></div><div class="field"><label>Importo EUR</label><input data-field="amount" type="number" min="0" max="10000000" step="0.01" required></div>';
  for(const k of ['description','reference','amount']){const el=div.querySelector('[data-field='+k+']');el.value=ex[k]??'';el.disabled=disabled;}
  if(!disabled){const b=document.createElement('button');b.type='button';b.className='btn light';b.textContent='Rimuovi';b.onclick=()=>{div.remove();editorDirty=true;updateEditorButtons();};div.append(b);}$('gcExpenses').append(div);
 }
 async function saveReport(){
  const header={};reportDialog.querySelectorAll('[data-header]').forEach(el=>header[el.dataset.header]=el.value);
  const lines=[...$('gcReportLines').children].map(tr=>({id:tr.dataset.id,description:tr.querySelector('[data-field=description]').value,quantity:Number(tr.querySelector('[data-field=quantity]').value),price:tr.querySelector('[data-field=price]').value===''?null:Number(tr.querySelector('[data-field=price]').value),reason:tr.querySelector('[data-field=reason]').value}));
  const expenses=[...$('gcExpenses').children].map(div=>({description:div.querySelector('[data-field=description]').value,reference:div.querySelector('[data-field=reference]').value,amount:Number(div.querySelector('[data-field=amount]').value)}));
  showReport(await rpc('report_save',{id:currentReport.id,version:currentReport.version,header,lines,expenses,discount_percent:Number($('gcDiscount').value)}));await loadOverview();$('gcReportMessage').textContent='Bozza salvata e importi ricalcolati.';
 }
 function changedSession(session){const next=session?.user||null;if(next?.id===actor?.id)return;epoch++;hide();actor=next;if(!actor)return;const stamp=epoch;setTimeout(async()=>{try{const q=await api().from('user_profiles').select('role').eq('user_id',actor.id).single();if(stamp!==epoch)return;allowed=!q.error&&q.data?.role==='admin';button.hidden=!allowed;}catch{hide();}},0);}
 async function boot(){if(!mount())return;for(let i=0;i<200&&!api();i++)await new Promise(r=>setTimeout(r,100));if(!api())return;api().auth.onAuthStateChange((_e,s)=>changedSession(s));const r=await api().auth.getSession();changedSession(r.data?.session);}
 window.GonCommercial=Object.freeze({version:VERSION});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
