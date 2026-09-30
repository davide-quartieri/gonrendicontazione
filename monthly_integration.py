"""Post-build client-period billing. Validated legacy boundaries; no snapshot rewrite."""
from pathlib import Path
from hashlib import sha256
import json, re, os, subprocess
VERSION='monthly-vat-1.0.0'

def one(s,a,b):
    if s.count(a)!=1: raise RuntimeError('Monthly build marker: '+a[:100])
    return s.replace(a,b,1)

def function(s,name,new):
    pattern=r'\n (?:async )?function '+name+r'\([^\n]*[\s\S]*?(?=\n (?:async )?function |\n window\.GonCommercial)'
    s,n=re.subn(pattern,lambda _: '\n '+new.strip()+'\n',s,count=1)
    if n!=1: raise RuntimeError('Monthly function missing: '+name)
    return s

REFERENCES=r'''async function references(selected){
 const stamp=epoch,c=await list('clients','id,main,site,display,active');if(stamp!==epoch)return;
 clients=c;const select=$('gcProject'),prev=selected||select.value;select.replaceChildren(new Option('Seleziona cliente',''));
 c.sort((a,b)=>a.display.localeCompare(b.display)).forEach(c=>select.add(new Option(c.display,c.id)));
 if(c.some(c=>c.id===prev))select.value=prev;
}'''
OVERVIEW=r'''async function loadOverview(){
 const cid=$('gcProject').value;if(!cid){overview=null;renderOverview();return;}
 const filters={client_id:cid,from:$('gcFrom').value,to:$('gcTo').value},seq=++requestSequence;
 const data=await rpc('overview',filters);if(seq!==requestSequence||cid!==$('gcProject').value)return;
 overview={...data,filters};prepareRequest=null;renderOverview();say(data.entries.length+' attivita caricate dal cliente, senza assegnazioni.');
}'''
READY=r'''function ready(e){const rep=$('gcReplaces').value;return e&&!e.needs_details&&e.description.trim()&&(!e.billed_report_id||e.billed_report_id===rep);}'''
TERMS=r'''function makeTermsDialog(){
 termsDialog=makeDialog('gcTermsDialog','Condizioni economiche del cliente',`<form id="gcTermsForm">
 <p class="gc-note">Tariffe uguali per tutti gli operatori. Ogni salvataggio crea una versione con decorrenza; i documenti emessi non cambiano. Tutti i prezzi sono al netto IVA.</p>
 <div class="gc-grid"><div class="field"><label for="gcTFrom">Valide dal</label><input id="gcTFrom" type="date" required></div><div class="field"><label for="gcTTo">Valide fino al (facoltativo)</label><input id="gcTTo" type="date"></div>
 <div class="field"><label for="gcTRef">Accordo di riferimento</label><input id="gcTRef" maxlength="500"></div><div class="field"><label for="gcTNotes">Note interne</label><input id="gcTNotes" maxlength="4000"></div>
 <div class="field"><label for="gcBillingMode">Fatturazione mensile</label><select id="gcBillingMode"><option value="hourly">Oraria</option><option value="monthly_flat">Forfait mensile complessivo</option></select></div>
 <div class="field" id="gcFlatWrap" hidden><label for="gcMonthlyPrice">Importo mensile EUR, IVA esclusa</label><input id="gcMonthlyPrice" type="number" min="0" max="10000000" step="0.0001" placeholder="Da definire"></div>
 <div class="field"><label for="gcTVat">Aliquota IVA %</label><input id="gcTVat" type="number" min="0" max="100" step="0.0001" required></div>
 <div class="field"><label for="gcTVatNote">Trattamento IVA / nota (obbligatoria se 0%)</label><input id="gcTVatNote" maxlength="1000"></div></div>
 <p class="gc-banner">Forfait: una sola quota per cliente e mese intero, anche senza ore. Nessun doppio addebito per macroarea e nessun prorata automatico. IVA unica su prestazioni nette e spese imponibili. Verificare l'aliquota applicabile; regimi misti e anticipazioni fuori campo non sono gestiti in questa versione.</p>
 <div id="gcHourlyWrap" class="gc-scroll"><table class="gc-table"><thead><tr><th>Macroarea</th><th>Tipo ore</th><th>Tariffa EUR/h</th><th>Arrotondamento</th><th>Minuti</th></tr></thead><tbody id="gcRules"></tbody></table></div>
 <p id="gcTermsMessage" role="alert" class="gc-error"></p><div class="gc-actions"><button id="gcTCancel" type="button" class="btn light">Annulla</button><button id="gcTSave" type="submit" class="btn">Salva nuova versione</button></div></form>`);
 $('gcBillingMode').onchange=()=>{const flat=$('gcBillingMode').value==='monthly_flat';$('gcFlatWrap').hidden=!flat;$('gcHourlyWrap').hidden=flat;};
 $('gcTCancel').onclick=()=>termsDialog.close();$('gcTermsForm').onsubmit=e=>{e.preventDefault();action('gcTSave',async()=>{
 const rules=[...$('gcRules').children].map(tr=>({macro:tr.dataset.macro,type:tr.dataset.type,mode:'hour',price:tr.querySelector('[data-field=price]').value===''?null:Number(tr.querySelector('[data-field=price]').value),round_mode:tr.querySelector('[data-field=round_mode]').value,round_minutes:Number(tr.querySelector('[data-field=round_minutes]').value)}));
 await rpc('terms_save',{id:termsDialog.dataset.requestId,client_id:overview.client.id,expected_terms_id:termsDialog.dataset.current||null,valid_from:$('gcTFrom').value,valid_to:$('gcTTo').value||null,reference:$('gcTRef').value,notes:$('gcTNotes').value,billing_mode:$('gcBillingMode').value,monthly_price:$('gcMonthlyPrice').value===''?null:Number($('gcMonthlyPrice').value),vat_rate:Number($('gcTVat').value),vat_note:$('gcTVatNote').value,rules});
 termsDialog.close();await loadOverview();say('Condizioni cliente salvate. Nessuna bozza ricalcolata automaticamente.');
 });};
}'''
EDIT_TERMS=r'''function editTerms(){
 if(!overview)return say('Seleziona cliente e carica il periodo.',true);
 const t=overview.terms.find(t=>!t.superseded);termsDialog.dataset.current=t?.id||'';termsDialog.dataset.requestId=crypto.randomUUID();
 $('gcTFrom').value=t?.valid_from||$('gcFrom').value;$('gcTTo').value=t?.valid_to||'';$('gcTRef').value=t?.reference||'';$('gcTNotes').value=t?.notes||'';
 $('gcBillingMode').value=t?.billing_mode==='monthly_flat'?'monthly_flat':'hourly';$('gcMonthlyPrice').value=t?.monthly_price??'';$('gcTVat').value=t?.vat_rate??22;$('gcTVatNote').value=t?.vat_note||'';$('gcBillingMode').onchange();
 $('gcRules').replaceChildren();for(const macro of MACROS)for(const type of TYPES){const rule=t?.rules.find(r=>r.macro===macro&&r.type===type&&r.mode==='hour')||{};const tr=document.createElement('tr');tr.dataset.macro=macro;tr.dataset.type=type;
 tr.innerHTML='<td>'+esc(macro)+'</td><td>'+esc(type)+'</td><td><input data-field="price" type="number" min="0" max="10000000" step="0.0001" placeholder="Da definire"></td><td><select data-field="round_mode"><option value="none">Nessuno</option><option value="up">Per eccesso</option><option value="nearest">Al piu vicino</option></select></td><td><select data-field="round_minutes">'+[0,5,10,15,30,60].map(n=>'<option value="'+n+'">'+(n||'-')+'</option>').join('')+'</select></td>';
 tr.querySelector('[data-field=price]').value=rule.price??'';tr.querySelector('[data-field=round_mode]').value=rule.round_mode||'none';tr.querySelector('[data-field=round_minutes]').value=rule.round_minutes||0;$('gcRules').append(tr);
 }$('gcTermsMessage').textContent=t?.billing_mode==='legacy'?'Condizioni precedenti: conferma modalita, importi e IVA prima di riutilizzarle. Le vecchie quote non sono convertite automaticamente.':'';termsDialog.showModal();
}'''
PREPARE=r'''async function prepare(){
 if(!overview)throw new Error('Carica cliente e periodo.');const ids=selected();
 if(overview.filters.from!==$('gcFrom').value||overview.filters.to!==$('gcTo').value||overview.client.id!==$('gcProject').value)throw new Error('Filtri cambiati: ricarica il periodo.');
 if(ids.some(e=>!ready(e)))throw new Error('Seleziona solo attivita complete e non gia rendicontate.');
 if(!ids.length&&!confirm('Nessuna attivita selezionata. Preparare solo il forfait mensile concordato, se configurato?'))return;
 const payload={client_id:overview.client.id,from:$('gcFrom').value,to:$('gcTo').value,entry_ids:ids.map(e=>e.id),replaces_id:$('gcReplaces').value||null,header:{logo:document.querySelector('img.logo')?.src||'',issuer:'GON srl'}};
 const sig=JSON.stringify(payload);if(!prepareRequest||prepareRequest.sig!==sig)prepareRequest={sig,id:crypto.randomUUID()};
 const r=await rpc('report_prepare',{...payload,id:prepareRequest.id});prepareRequest=null;await loadOverview();showReport(r);say('Bozza creata: verifica imponibile, IVA e totale prima di emettere.');
}'''

def patch_ui(js):
    js=one(js,"const VERSION='commercial-1.0.0';","const VERSION='"+VERSION+"';")
    js=one(js,"rpc('gon_commercial',","rpc('gon_client_billing',")
    for name,code in [('references',REFERENCES),('loadOverview',OVERVIEW),('ready',READY),('makeTermsDialog',TERMS),('editTerms',EDIT_TERMS),('prepare',PREPARE),('assignSelected',''),('makeProjectDialog',''),('editProject','')]: js=function(js,name,code)
    js=one(js,'makeProjectDialog();makeTermsDialog();','makeTermsDialog();')
    js=re.sub(r"  \$\('gcNewProject'\)\.onclick=.*?\$\('gcTerms'\)\.onclick", "  $('gcTerms').onclick",js,count=1)
    js=one(js,"$('gcAssign').onclick=()=>action('gcAssign',assignSelected);",'')
    js=one(js,'<div class="gc-tools"><div class="field"><label for="gcProject">Cliente / commessa</label><select id="gcProject"></select></div><button id="gcNewProject" type="button" class="btn">Nuova commessa</button><button id="gcEditProject" type="button" class="btn light">Modifica commessa</button></div>', '<div class="gc-tools"><div class="field"><label for="gcProject">Cliente / cantiere</label><select id="gcProject"></select></div><div class="field"><label for="gcMonth">Mese di riferimento</label><input id="gcMonth" type="month"></div></div>')
    js=one(js,'<button id="gcAssign" class="btn light" type="button">Assegna selezionate alla commessa</button>','')
    js=one(js,"$('gcFrom').value=today().slice(0,8)+'01';$('gcTo').value=today();", "$('gcMonth').value=today().slice(0,7);$('gcMonth').onchange=()=>{const [y,m]=$('gcMonth').value.split('-').map(Number);if(!y||!m)return;$('gcFrom').value=$('gcMonth').value+'-01';$('gcTo').value=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};$('gcMonth').onchange();")
    js=one(js,"const status=(e.project_id?'Assegnata':'Da assegnare')+(e.needs_details?' / incompleta':'')+(e.billed_report_id?' / '+e.billed_number:'');", "const status=(e.needs_details?'Incompleta':'Completa')+(e.billed_report_id?' / '+e.billed_number:' / da rendicontare');sel.disabled=!ready(e);")
    js=one(js,"d.append(box);$('gcTermsHistory').append(d);", "if(t.billing_mode==='monthly_flat')box.textContent='Forfait mensile: '+money(t.monthly_price)+' + IVA '+num(t.vat_rate)+'%';const tax=document.createElement('p');tax.className='gc-note';tax.textContent=t.billing_mode==='legacy'?'Condizioni precedenti da verificare e confermare.':'IVA '+num(t.vat_rate)+'% | '+(t.vat_note||'Aliquota unica');d.append(box,tax);$('gcTermsHistory').append(d);")
    js=one(js,"+' | '+d.project.code+' | '+", "+' | '+")
    js=js.replace('Commesse e rendiconti clienti','Rendiconti mensili clienti').replace('Commesse e rendiconti','Rendiconti clienti').replace('operatori della commessa','operatori del cliente').replace('Ultimi 100 documenti della commessa','Ultimi 100 documenti del cliente')
    js=one(js,'Crea la prima commessa e collega le condizioni concordate. Non sono state assegnate tariffe automatiche.','Seleziona un cliente esistente e il mese. Nessuna commessa da creare.')
    js=one(js,'Sono mostrate quelle della commessa e quelle ancora da assegnare. Seleziona le righe da associare o includere. Le incomplete non possono entrare in un rendiconto.','Tutte le attivita del cliente nel periodo, senza assegnazioni. Seleziona le complete non ancora rendicontate.')
    js=one(js,'Importi in EUR; IVA e altri oneri non calcolati.','Importi in EUR. Tariffe e spese al netto IVA; imponibile, IVA e totale separati.')
    js=one(js,'<h3>Spese concordate</h3>','<h3>Spese imponibili concordate, IVA esclusa</h3>')
    js=one(js,'<p id="gcTotals" class="gc-total"></p>', '<div class="gc-grid"><div class="field"><label for="gcRVat">Aliquota IVA % del rendiconto</label><input id="gcRVat" type="number" min="0" max="100" step="0.0001"></div><div class="field"><label for="gcRVatNote">Trattamento IVA / nota</label><input id="gcRVatNote" maxlength="1000"></div></div><p id="gcTotals" class="gc-total"></p>')
    js=one(js,'IVA e altri oneri non sono inclusi; questo rendiconto non sostituisce la fattura.','IVA calcolata su prestazioni al netto dello sconto e spese imponibili. Aliquota unica modificabile. Regimi misti e oneri ulteriori non gestiti; non sostituisce la fattura.')
    js=one(js,"$('gcTotals').textContent='Corrispettivo salvato: '+money(d.totals.net)+(d.totals.missing_rates?' | '+d.totals.missing_rates+' tariffe da definire':'');", "$('gcRVat').value=d.vat_rate??'';$('gcRVatNote').value=d.vat_note||'';$('gcRVat').disabled=$('gcRVatNote').disabled=!draft;$('gcTotals').textContent='Imponibile: '+money(d.totals.net)+' | IVA: '+money(d.totals.vat)+' | Totale IVA inclusa: '+money(d.totals.gross)+(d.totals.missing_rates?' | Tariffe da definire':'')+(!('vat_rate' in d)?' | Documento precedente senza calcolo IVA':'');")
    js=one(js,"discount_percent:Number($('gcDiscount').value)}", "discount_percent:Number($('gcDiscount').value),vat_rate:$('gcRVat').value===''?null:Number($('gcRVat').value),vat_note:$('gcRVatNote').value}")
    js=js.replace('money(currentReport.document.totals.net)', "money(currentReport.document.totals.gross??currentReport.document.totals.net)")
    js=one(js,'currentReport.document.totals.missing_rates>0;', "(currentReport.document.totals.missing_rates>0||currentReport.document.totals.missing_vat===true);")
    js=js.replace("money(r.totals?.net)","money(r.totals?.gross??r.totals?.net)").replace('<th>Corrispettivo</th>','<th>Totale IVA inclusa*</th>')
    js=one(js,'Le copie emesse non cambiano quando si modificano attivit\\u00e0 o tariffe.', 'Le copie emesse non cambiano quando si modificano attivit\\u00e0 o tariffe. * Per documenti precedenti senza IVA e mostrato il netto storico.')
    js=js.replace('gcProject','gcClient')
    return js

def install_monthly(out):
    out=Path(out);assets=out/'assets'
    ui=patch_ui((assets/'commercial.js').read_text(encoding='utf-8'))
    (assets/'commercial.js').write_text(ui,encoding='utf-8')
    from monthly_document import patch_document
    doc=patch_document((assets/'client-document.js').read_text(encoding='utf-8'))
    (assets/'client-document.js').write_text(doc,encoding='utf-8')
    history=assets/'personal-history.js';h=history.read_text(encoding='utf-8')
    extra="const pb=make('button','Commessa','btn light');pb.type='button';pb.style.marginLeft='8px';pb.onclick=()=>window.GonProjects.editAssignment(row.id);card.append(pb,make('p',window.GonProjects?.label(row.project_id)||'Commessa da assegnare','gon-history-meta'));"
    h=one(h,extra,'');history.write_text(h,encoding='utf-8')
    for mode in ('pc','mobile'):
        p=out/(mode+'.html');s=p.read_text(encoding='utf-8')
        s,n=re.subn(r'<script\b[^>]*src="assets/projects\.js[^\"]*"[^>]*>\s*</script>','',s)
        if n!=1:raise RuntimeError('Expected one projects script')
        s=one(s,",project_id:(document.getElementById('gonProjectSelect')?.value||null)",'')
        for name in ('commercial.js','client-document.js','personal-history.js'):
            s=re.sub(r'('+re.escape(name)+r'\?v=[^"\s]+)',lambda m:m.group(1)+'-'+VERSION,s)
        if 'gonProjectSelect' in s or 'projects.js?' in s:raise RuntimeError('Old project UI remains')
        p.write_text(s,encoding='utf-8')
    for p in assets.glob('*.js'):subprocess.run(['node','--check',str(p)],check=True)
    manifest={'version':VERSION,'commit':os.environ.get('RENDER_GIT_COMMIT',''),'billing_basis':'client_period','project_required':False,'editable_vat':True,'vat_base':'net_services_plus_taxable_expenses','hashes':{p.name:sha256(p.read_bytes()).hexdigest() for p in assets.glob('*.js')}}
    (out/'monthly-build.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('MONTHLY BUILD: '+json.dumps(manifest))
