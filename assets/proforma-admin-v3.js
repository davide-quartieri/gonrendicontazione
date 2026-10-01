/* Injected inside the existing commercial module after diagnostics, before boot. */
 let v3MacroDialog=null;
 function v3Catalog(items){if(!Array.isArray(items)||!items.length)return;TARIFF_CATALOG.splice(0,TARIFF_CATALOG.length,...items.flatMap(m=>m.allowed_types.map(t=>[m.name,t,m.billing_kind])));}
 document.addEventListener('gon:catalog-updated',e=>v3Catalog(e.detail));
 const v3OriginalRpc=rpc;
 rpc=async function(name,payload){
  if(name==='terms_save')await window.GonCatalog.refresh();
  if(name==='report_save'&&Number(currentReport?.document?.proforma_schema)===3){const raw=$('gvCassa').value;if(raw==='')throw new Error('Indica la percentuale Cassa.');payload={...payload,cassa_rate:Number(raw),cassa_on_expenses:$('gvCassaExpenses').checked};}
  return v3OriginalRpc(name,payload);
 };
 const v3OriginalReferences=references;
 references=async function(selected){await window.GonCatalog.refresh();v3Catalog(window.GonCatalog.items());return v3OriginalReferences(selected);};
 function v3Error(e){say(e.message||'Operazione non riuscita.',true);if(v3MacroDialog?.open)$('gvMacroError').textContent=e.message;}
 function v3Ready(){if(!allowed||!actor)throw new Error('Accesso amministratore richiesto.');if(editorDirty)throw new Error('Salva prima le modifiche alla bozza.');}
 function v3MakeSettings(){
  const tools=document.createElement('div');tools.className='gc-actions';
  const mb=document.createElement('button');mb.id='gvMacros';mb.type='button';mb.className='btn light';mb.textContent='Nuova macroarea';mb.onclick=()=>{if(allowed){$('gvMacroError').textContent='';v3MacroDialog.showModal();}};
  tools.append(mb);root.querySelector('.card').append(tools);
  v3MacroDialog=makeDialog('gvMacroDialog','Crea nuova macroarea',`<form id="gvMacroForm"><div class="field"><label for="gvMacroName">Nome</label><input id="gvMacroName" required maxlength="120"></div><div class="field"><label for="gvMacroKind">Valorizzazione</label><select id="gvMacroKind"><option value="hour">Oraria</option><option value="monthly">Forfait mensile con attivita</option></select></div><p>Tipi di ore ammessi nel tariffario</p>${TYPES.map(t=>'<label style="display:inline-flex;gap:8px;margin:8px"><input type="checkbox" name="gvMacroType" value="'+t+'" checked style="width:18px"> '+t+'</label>').join('')}<p class="gc-note">Dopo la creazione configura le tariffe di ciascun cliente. Nessun prezzo viene inventato; le macroaree programmate restano a forfait.</p><p id="gvMacroError" class="gc-error" role="alert"></p><div class="gc-actions"><button id="gvMSave" class="btn" type="submit">Crea macroarea</button><button id="gvMCancel" class="btn light" type="button">Annulla</button></div></form>`);
  $('gvMCancel').onclick=()=>v3MacroDialog.close();$('gvMacroForm').onsubmit=async e=>{e.preventDefault();if(!allowed||!actor)return;const b=$('gvMSave');if(b.disabled)return;b.disabled=true;const stamp=epoch,owner=actor.id,abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),15000);try{
   const types=[...v3MacroDialog.querySelectorAll('input[name=gvMacroType]:checked')].map(x=>x.value);if(!types.length)throw new Error('Seleziona almeno un tipo di ore.');
   const r=await api().rpc('gon_catalog',{p_action:'create',p_payload:{name:$('gvMacroName').value.trim(),billing_kind:$('gvMacroKind').value,allowed_types:types},p_expected_user:owner}).abortSignal(abort.signal);if(stamp!==epoch)return;if(r.error)throw r.error;
   await window.GonCatalog.refresh(true);v3Catalog(window.GonCatalog.items());v3MacroDialog.close();$('gvMacroName').value='';say('Macroarea creata: disponibile per PC, mobile, storico e timer. Configura il prezzo nelle condizioni cliente.');
  }catch(err){if(stamp===epoch)v3Error(err);}finally{clearTimeout(timeout);b.disabled=false;}};
 }
 const v3OriginalMount=mount;
 mount=function(){const ok=v3OriginalMount();if(ok){v3MakeSettings();button.textContent='Rendiconti / Proforma';root.querySelector('h2').textContent='Rendiconti e fatture proforma';}return ok;};
 const v3OriginalMakeReport=makeReportDialog;
 makeReportDialog=function(){
  v3OriginalMakeReport();reportDialog.querySelector('h2').textContent='Rendiconto / Fattura proforma';
  const extras=document.createElement('div');extras.id='gvReportExtras';extras.innerHTML='<p class="gc-banner">FATTURA PROFORMA - Documento non valido ai fini fiscali. Il documento viene dettagliato per giorno; i forfait non duplicano le ore addebitate.</p><p id="gvPartySnapshot" class="gc-note"></p><div class="gc-actions"><button id="gvRefreshParty" class="btn light" type="button">Aggiorna anagrafica nella bozza</button><button id="gvUpgrade" class="btn light" type="button">Aggiorna bozza a proforma con Cassa</button></div>';
  reportDialog.querySelector('#gcReportTitle').after(extras);
  const cassa=document.createElement('div');cassa.id='gvCassaWrap';cassa.className='gc-grid';cassa.innerHTML='<div class="field"><label for="gvCassa">Cassa geometri %</label><input id="gvCassa" type="number" min="0" max="100" step="0.0001"></div><div class="field"><label><input id="gvCassaExpenses" type="checkbox" style="width:18px"> Spese imponibili soggette anche a Cassa</label></div>';$('gcTotals').before(cassa);
  const teams=document.createElement('div');teams.id='gvTeams';$('gcReportForm').after(teams);
  $('gvRefreshParty').onclick=()=>action('gvRefreshParty',async()=>{v3Ready();if(confirm('Aggiornare soltanto i dati del cliente nella bozza? Gli importi restano invariati.'))showReport(await rpc('report_profile_refresh',{id:currentReport.id,version:currentReport.version}));});
  $('gvUpgrade').onclick=()=>action('gvUpgrade',async()=>{v3Ready();if(confirm('Aggiornare questa bozza al nuovo modello con Cassa, date e anagrafica? Verranno rilette attivita e tariffe; le rettifiche delle righe saranno sostituite. Il documento non viene emesso.'))showReport(await rpc('report_upgrade',{id:currentReport.id,version:currentReport.version}));});
  $('gcRPreview').textContent='Proforma / Stampa PDF';$('gcRHtml').textContent='Scarica proforma';$('gcRExcel').textContent='Excel proforma';$('gcRIssue').textContent='Approva ed emetti proforma';
 };
 function v3PartyComplete(d){const p=d?.client?.legal||{};return ['legal_name','address','postcode','city','country'].every(k=>String(p[k]||'').trim())&&(p.vat_number||p.tax_code);}
 const v3OriginalButtons=updateEditorButtons;
 updateEditorButtons=function(){v3OriginalButtons();if(Number(currentReport?.document?.proforma_schema)===3&&$('gcRIssue'))$('gcRIssue').disabled=$('gcRIssue').disabled||!!currentReport.document.team_pending?.length||!v3PartyComplete(currentReport.document);};
 const v3OriginalShow=showReport;
 showReport=function(r){
  v3OriginalShow(r);const d=r.document,newDoc=Number(d.proforma_schema)===3,draft=r.state==='draft',p=d.client.legal||{};
  $('gvCassaWrap').hidden=!newDoc;$('gvUpgrade').hidden=!draft||newDoc;$('gvRefreshParty').hidden=!draft||!newDoc;
  $('gvCassa').value=d.cassa_rate??5;$('gvCassa').disabled=!draft;$('gvCassaExpenses').checked=d.cassa_on_expenses!==false;$('gvCassaExpenses').disabled=!draft;
  $('gvPartySnapshot').textContent=newDoc?[p.legal_name||d.client.name,p.address,[p.postcode,p.city,p.province,p.country].filter(Boolean).join(' '),p.vat_number?'P. IVA '+p.vat_number:'',p.tax_code?'CF '+p.tax_code:'',!v3PartyComplete(d)?'Completa anagrafica e aggiornala nella bozza prima di emettere.':''].filter(Boolean).join(' | '):'Documento precedente: importi e formato originali restano invariati. Aggiorna esplicitamente la bozza per adottare il nuovo modello.';
  if(newDoc){const t=d.totals;$('gcTotals').textContent='Compensi e spese: '+money(t.net)+' | Cassa: '+money(t.cassa)+' | Imponibile IVA: '+money(t.taxable)+' | IVA: '+money(t.vat)+' | Totale: '+money(t.gross);
   [...$('gcReportLines').children].forEach((tr,i)=>{const l=d.lines[i],small=tr.querySelector('small');if(small)small.textContent=(l.dates||[]).map(date).join(', ')+' | '+(l.site||'')+' | '+small.textContent;});
  }
  v3RenderTeams(r);updateEditorButtons();
 };
 function v3Btn(label,fn){const b=document.createElement('button');b.type='button';b.className='btn light';b.textContent=label;b.onclick=()=>action('gvTeamsAction',fn);return b;}
 function v3RenderTeams(r){
  const host=$('gvTeams');host.replaceChildren();const d=r.document;if(Number(d.proforma_schema)!==3)return;
  const heading=document.createElement('h3');heading.textContent='Interventi con due tecnici';host.append(heading);
  const note=document.createElement('p');note.className='gc-note';note.textContent='Stessa data, stesso cantiere e stessa macroarea: conferma la stessa attivita. Mezza giornata 450 EUR; giornata intera 900 EUR, prima di Cassa e IVA. Nessuna soglia ore automatica. Le attivita gia a forfait non ricevono un secondo addebito.';host.append(note);
  for(const candidate of d.team_pending||[]){const row=document.createElement('div');row.className='gc-banner';const title=document.createElement('p');title.textContent=date(candidate.date)+' | '+candidate.site+' | '+candidate.description+' | '+candidate.operators.join(' / ');row.append(title);
   if(r.state==='draft')row.append(v3Btn('Mezza giornata - 450 EUR',()=>v3ApplyTeam(candidate.entry_ids,'half')),v3Btn('Giornata intera - 900 EUR',()=>v3ApplyTeam(candidate.entry_ids,'full')),v3Btn('Interventi distinti',()=>v3ApplyTeam(candidate.entry_ids,'separate')));host.append(row);
  }
  (d.team_decisions||[]).forEach((decision,i)=>{const p=document.createElement('div');p.className='gc-note';p.textContent='Scelta salvata: '+({half:'2 tecnici, mezza giornata',full:'2 tecnici, giornata intera',separate:'Interventi distinti'}[decision.duration])+' | '+decision.entry_ids.length+' registrazioni ';if(r.state==='draft')p.append(v3Btn('Rimuovi scelta',async()=>{v3Ready();if(!confirm('Rimuovere la scelta e ricostruire le righe economiche? Le rettifiche alle righe saranno sostituite.'))return;showReport(await rpc('report_teams',{id:r.id,version:r.version,decisions:d.team_decisions.filter((_,j)=>i!==j)}));}));host.append(p);});
  if(r.state!=='draft')return;
  const details=document.createElement('details'),sum=document.createElement('summary');sum.textContent='Accorpa righe con descrizioni differenti (conferma manuale)';details.append(sum);
  const select=document.createElement('select');select.id='gvTeamEntries';select.multiple=true;select.size=6;select.style.width='100%';
  const eligible=d.activities.filter(a=>a.type==='Cantiere'&&d.standard_lines?.some(l=>l.mode==='hour'&&l.entry_ids.includes(a.id)));
  eligible.forEach(a=>select.add(new Option(date(a.date)+' | '+(a.site||a.client)+' | '+a.employee+' | '+a.description,a.id)));details.append(select,v3Btn('Mezza giornata',()=>v3ApplyTeam([...select.selectedOptions].map(o=>o.value),'half')),v3Btn('Giornata intera',()=>v3ApplyTeam([...select.selectedOptions].map(o=>o.value),'full')));host.append(details);
 }
 async function v3ApplyTeam(ids,duration){
  v3Ready();if(ids.length<2)throw new Error('Seleziona le registrazioni dei due tecnici.');
  let reason='';if(duration==='separate'){reason=prompt('Motivo: perche non e lo stesso intervento?','');if(reason===null)return;if(reason.trim().length<3)throw new Error('Indica il motivo.');}
  if(!confirm('Confermare '+({half:'2 tecnici, mezza giornata: 450 EUR',full:'2 tecnici, giornata intera: 900 EUR',separate:'interventi distinti'}[duration])+'? Le ore originali restano; le righe economiche e le eventuali rettifiche vengono ricostruite.'))return;
  const decisions=(currentReport.document.team_decisions||[]).filter(x=>!x.entry_ids.some(id=>ids.includes(id)));decisions.push({entry_ids:ids,duration,reason});
  showReport(await rpc('report_teams',{id:currentReport.id,version:currentReport.version,decisions}));await loadOverview();
 }
 const v3OriginalHide=hide;
 hide=function(){v3OriginalHide();for(const dialog of [v3MacroDialog]){if(dialog?.open)dialog.close();dialog?.querySelectorAll('input').forEach(x=>{if(x.type!=='checkbox')x.value='';});}$('gvPartySnapshot')?.replaceChildren();$('gvTeams')?.replaceChildren();};
