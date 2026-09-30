"""Last build stage: compact tariffs and explicit removal of historical reports.
No stored tariffs, operational entries or issued snapshots are rewritten.
"""
from pathlib import Path
from hashlib import sha256
import json
import os
import re
import subprocess

VERSION = 'pricing-lifecycle-1.0.0'
ROOT = Path(__file__).resolve().parent
CATALOG = [
    ['Rilievo in campo', 'Cantiere', 'hour'],
    ['Rilievo in campo', 'Viaggio', 'hour'],
    ['Elaborazione rilievo', 'Ufficio', 'hour'],
    ['Assistenza cliente', 'Cantiere', 'hour'],
    ['Assistenza cliente', 'Viaggio', 'hour'],
    ['Assistenza cliente', 'Ufficio', 'hour'],
    ['Attività amministrative', 'Ufficio', 'hour'],
    ['Corso', 'Ufficio', 'hour'],
    ['Varie', 'Ufficio', 'hour'],
    ['Rilievo in campo - PROGRAMMATO', 'Cantiere', 'monthly'],
    ['Elaborazione rilievo - PROGRAMMATA', 'Ufficio', 'monthly'],
]


def one(s, old, new):
    if s.count(old) != 1:
        raise RuntimeError('Pricing lifecycle marker mismatch: ' + old[:120])
    return s.replace(old, new, 1)


def replace_function(s, name, replacement):
    pattern = r'\n (?:async )?function ' + re.escape(name) + r'\([^\n]*[\s\S]*?(?=\n (?:async )?function |\n window\.GonCommercial)'
    s, n = re.subn(pattern, lambda _: '\n ' + replacement.strip() + '\n', s, count=1)
    if n != 1:
        raise RuntimeError('Pricing function missing: ' + name)
    return s


HELPERS = r'''
 function tariffSeed(terms,macro,type,mode){
  const old=terms?.rules?.find(r=>r.macro===macro&&r.type===type);
  // Never reinterpret a historical hourly amount as a monthly flat fee.
  const compatible=old?.mode===mode;
  return {price:compatible?(old.price??''):'',round_mode:mode==='hour'&&compatible?(old.round_mode||'none'):'none',round_minutes:mode==='hour'&&compatible?(old.round_minutes||0):0};
 }
 async function removeReport(r){
  if(!allowed||!r)throw new Error('Accesso amministratore richiesto.');
  if(editorDirty&&currentReport?.id===r.id)throw new Error('Salva o annulla prima le modifiche della bozza.');
  const label=(r.number||'Bozza')+' | Rev. '+r.revision;
  const draft=r.state==='draft';
  const effect=draft
   ? 'La bozza viene cancellata. Le attivita originali non vengono eliminate.'
   : r.state==='superseded'
    ? 'La vecchia revisione viene rimossa dallo storico ordinario. La revisione successiva resta valida.'
    : 'Il rendiconto viene ANNULLATO e rimosso dallo storico ordinario. Le sue attivita e quote tornano rendicontabili. Restano conservati numero, copia interna e motivo. Non vengono annullate eventuali fatture o email gia inviate.';
  if(!confirm('Eliminare '+label+'?\n\n'+effect))return;
  let reason='';
  if(!draft){
   reason=prompt('Motivo dell\'eliminazione / annullamento (obbligatorio):','');
   if(reason===null)return;
   reason=reason.trim();if(reason.length<3||reason.length>1000)throw new Error('Indica un motivo da 3 a 1000 caratteri.');
  }
  const result=await rpc('report_remove',{id:r.id,version:r.version,reason});
  if(!result?.removed)throw new Error('Il server non ha confermato l\'eliminazione. Aggiorna lo storico.');
  if(currentReport?.id===r.id){editorDirty=false;currentReport=null;reportDialog.close();}
  await loadOverview();
  say(draft?'Bozza eliminata. Le attivita sono conservate.':'Rendiconto rimosso dallo storico ordinario; traccia interna conservata.');
 }
'''

TERMS = r'''
 function makeTermsDialog(){
  termsDialog=makeDialog('gcTermsDialog','Condizioni economiche del cliente',`<form id="gcTermsForm">
   <p class="gc-note">Tariffe uguali per tutti gli operatori. Ogni salvataggio crea una versione con decorrenza; i documenti emessi non cambiano. Prezzo vuoto = da definire, non zero.</p>
   <div class="gc-grid"><div class="field"><label for="gcTFrom">Valide dal</label><input id="gcTFrom" type="date" required></div><div class="field"><label for="gcTTo">Valide fino al (facoltativo)</label><input id="gcTTo" type="date"></div>
   <div class="field"><label for="gcTRef">Accordo di riferimento</label><input id="gcTRef" maxlength="500"></div><div class="field"><label for="gcTNotes">Note interne</label><input id="gcTNotes" maxlength="4000"></div>
   <div class="field"><label for="gcBillingMode">Fatturazione mensile</label><select id="gcBillingMode"><option value="hourly">Oraria + forfait attivita programmate</option><option value="monthly_flat">Forfait mensile complessivo</option></select></div>
   <div class="field" id="gcFlatWrap" hidden><label for="gcMonthlyPrice">Importo mensile complessivo EUR, IVA esclusa</label><input id="gcMonthlyPrice" type="number" min="0" max="10000000" step="0.0001" placeholder="Da definire"></div>
   <div class="field"><label for="gcTVat">Aliquota IVA %</label><input id="gcTVat" type="number" min="0" max="100" step="0.0001" required></div>
   <div class="field"><label for="gcTVatNote">Trattamento IVA / nota (obbligatoria se 0%)</label><input id="gcTVatNote" maxlength="1000"></div></div>
   <p class="gc-banner">PROGRAMMATO / PROGRAMMATA: sempre a forfait, una quota per cliente, macroarea e mese con attivita selezionate, indipendente dal numero di ore o cantieri. Nessun arrotondamento o prorata automatico. Con forfait mensile complessivo queste prestazioni sono gia incluse, senza aggiungere altre quote. IVA unica su prestazioni nette e spese imponibili.</p>
   <div id="gcHourlyWrap" class="gc-scroll"><table class="gc-table"><thead><tr><th>Macroarea</th><th>Tipo ore</th><th>Modalita</th><th>Tariffa / importo EUR<br><small>IVA esclusa</small></th><th>Arrotondamento</th><th>Minuti</th></tr></thead><tbody id="gcRules"></tbody></table></div>
   <p id="gcTermsMessage" role="alert" class="gc-error"></p><div class="gc-actions"><button id="gcTCancel" type="button" class="btn light">Annulla</button><button id="gcTSave" type="submit" class="btn">Salva nuova versione</button></div></form>`);
  $('gcBillingMode').onchange=()=>{const flat=$('gcBillingMode').value==='monthly_flat';$('gcFlatWrap').hidden=!flat;$('gcHourlyWrap').hidden=flat;};
  $('gcTCancel').onclick=()=>termsDialog.close();
  $('gcTermsForm').onsubmit=e=>{e.preventDefault();action('gcTSave',async()=>{
   const rules=[...$('gcRules').children].map(tr=>{
    const mode=tr.dataset.mode,rm=mode==='monthly'?'none':tr.querySelector('[data-field=round_mode]').value;
    const raw=tr.querySelector('[data-field=price]').value;
    return {macro:tr.dataset.macro,type:tr.dataset.type,mode,price:raw===''?null:Number(raw),round_mode:rm,round_minutes:rm==='none'?0:Number(tr.querySelector('[data-field=round_minutes]').value)};
   });
   await rpc('terms_save',{id:termsDialog.dataset.requestId,client_id:termsDialog.dataset.clientId,expected_terms_id:termsDialog.dataset.current||null,valid_from:$('gcTFrom').value,valid_to:$('gcTTo').value||null,reference:$('gcTRef').value,notes:$('gcTNotes').value,billing_mode:$('gcBillingMode').value,monthly_price:$('gcMonthlyPrice').value===''?null:Number($('gcMonthlyPrice').value),vat_rate:Number($('gcTVat').value),vat_note:$('gcTVatNote').value,rules});
   termsDialog.close();await loadOverview();say('Condizioni salvate. Le bozze e le copie emesse non sono state ricalcolate.');
  });};
 }
'''

EDIT = r'''
 function editTerms(){
  if(!overview)return say('Seleziona cliente e carica il periodo.',true);
  const t=overview.terms.find(t=>!t.superseded);
  termsDialog.dataset.clientId=overview.client.id;
  termsDialog.dataset.current=t?.id||'';termsDialog.dataset.requestId=crypto.randomUUID();
  $('gcTFrom').value=t?.valid_from||$('gcFrom').value;$('gcTTo').value=t?.valid_to||'';$('gcTRef').value=t?.reference||'';$('gcTNotes').value=t?.notes||'';
  $('gcBillingMode').value=t?.billing_mode==='monthly_flat'?'monthly_flat':'hourly';$('gcMonthlyPrice').value=t?.monthly_price??'';$('gcTVat').value=t?.vat_rate??22;$('gcTVatNote').value=t?.vat_note||'';$('gcBillingMode').onchange();
  $('gcRules').replaceChildren();
  for(const [macro,type,mode] of TARIFF_CATALOG){
   const seed=tariffSeed(t,macro,type,mode),tr=document.createElement('tr');tr.dataset.macro=macro;tr.dataset.type=type;tr.dataset.mode=mode;
   const roundCells=mode==='monthly'?'<td>Non applicabile</td><td>-</td>':'<td><select data-field="round_mode"><option value="none">Nessuno</option><option value="up">Per eccesso</option><option value="nearest">Al piu vicino</option></select></td><td><select data-field="round_minutes">'+[0,5,10,15,30,60].map(n=>'<option value="'+n+'">'+(n||'-')+'</option>').join('')+'</select></td>';
   tr.innerHTML='<td>'+esc(macro)+'</td><td>'+esc(type)+'</td><td><strong>'+(mode==='monthly'?'Forfait / mese':'Oraria')+'</strong></td><td><input data-field="price" aria-label="'+esc(macro+' '+type+(mode==='monthly'?' EUR al mese':' EUR ora'))+'" type="number" min="0" max="10000000" step="0.0001" placeholder="Da definire"><small class="gc-note">'+(mode==='monthly'?'EUR / mese':'EUR / h')+'</small></td>'+roundCells;
   tr.querySelector('[data-field=price]').value=seed.price;
   if(mode==='hour'){
    const rm=tr.querySelector('[data-field=round_mode]'),mins=tr.querySelector('[data-field=round_minutes]');
    rm.value=seed.round_mode;mins.value=seed.round_minutes;
    rm.onchange=()=>{mins.disabled=rm.value==='none';if(mins.disabled)mins.value='0';else if(mins.value==='0')mins.value='5';};rm.onchange();
   }
   $('gcRules').append(tr);
  }
  const oldProgrammed=t?.rules?.some(r=>TARIFF_CATALOG.some(([m,t,k])=>m===r.macro&&t===r.type&&k==='monthly')&&r.mode!=='monthly');
  $('gcTermsMessage').textContent=t?.billing_mode==='legacy'?'Condizioni precedenti: conferma modalita, importi e IVA.':oldProgrammed?'Gli importi orari precedenti delle attivita programmate NON sono stati convertiti in forfait: indica gli importi mensili concordati.':'';
  termsDialog.showModal();
 }
'''


def patch_ui(ui):
    catalog = ' const TARIFF_CATALOG = ' + json.dumps(CATALOG, ensure_ascii=False) + ';\n'
    ui = one(ui, " const TYPES=['Cantiere','Viaggio','Ufficio'];", " const TYPES=['Cantiere','Viaggio','Ufficio'];\n" + catalog + HELPERS)
    ui = replace_function(ui, 'makeTermsDialog', TERMS)
    ui = replace_function(ui, 'editTerms', EDIT)
    ui = one(ui, "tr.lastElementChild.append(b);$('gcArchive').append(tr);",
             "const del=document.createElement('button');del.id='gcRemove-'+r.id;del.type='button';del.className='btn danger';del.textContent='Elimina';del.style.marginLeft='8px';del.onclick=()=>action(del.id,()=>removeReport(r));tr.lastElementChild.append(b,del);$('gcArchive').append(tr);")
    ui = one(ui, "$('gcRDiscard').onclick=()=>action('gcRDiscard',async()=>{if(confirm('Eliminare questa bozza? Le attivita originali non saranno cancellate.')){await rpc('report_discard',{id:currentReport.id,version:currentReport.version});reportDialog.close();await loadOverview();}});",
             "$('gcRDiscard').onclick=()=>action('gcRDiscard',()=>removeReport(currentReport));")
    ui = one(ui, "for(const id of ['gcRSave','gcRRecalc','gcRIssue','gcRDiscard','gcAddExpense'])$(id).hidden=!draft;",
             "for(const id of ['gcRSave','gcRRecalc','gcRIssue','gcAddExpense'])$(id).hidden=!draft;$('gcRDiscard').hidden=false;$('gcRDiscard').textContent=draft?'Elimina bozza':'Elimina dallo storico';")
    ui = one(ui, "t.rules.map(r=>'<tr>", "t.rules.filter(r=>TARIFF_CATALOG.some(([m,t])=>m===r.macro&&t===r.type)).map(r=>'<tr>")
    ui = one(ui, "const modes={hour:'A ore',fixed:'Forfait unico',monthly:'Canone mensile'};",
             "const modes={hour:'A ore',fixed:'Forfait unico',monthly:'Forfait mensile'};")
    ui = one(ui, '<h2>Archivio rendiconti</h2>', '<h2>Archivio rendiconti</h2><p class="gc-note">Elimina rimuove la bozza. Per i documenti emessi o inviati richiede un motivo, annulla il rendiconto e conserva una traccia interna. Non elimina attivita, fatture o email gia inviate.</p>')
    return ui


def install_pricing_lifecycle(out):
    out = Path(out)
    assets = out / 'assets'
    ui = patch_ui((assets / 'commercial.js').read_text(encoding='utf-8'))
    (assets / 'commercial.js').write_text(ui, encoding='utf-8')
    subprocess.run(['node', '--check', str(assets / 'commercial.js')], check=True)
    subprocess.run(['node', str(ROOT / 'tests/test_pricing_lifecycle.cjs'), str(assets / 'commercial.js')], check=True)
    html_path = out / 'pc.html'
    html = html_path.read_text(encoding='utf-8')
    html, n = re.subn(r'(commercial\.js\?v=[^"\s]+)', lambda m: m.group(1) + '-' + VERSION, html)
    if n != 1:
        raise RuntimeError('Expected one commercial script on PC')
    html_path.write_text(html, encoding='utf-8')
    hashes = {p.name: sha256(p.read_bytes()).hexdigest() for p in assets.glob('*.js')}
    manifest = {'version': VERSION, 'commit': os.environ.get('RENDER_GIT_COMMIT', ''),
                'tariff_rows': len(CATALOG), 'ordinary_hourly_rows': 9, 'programmed_flat_rows': 2,
                'programmed_unit': 'one_per_customer_macroarea_calendar_month_with_selected_activity',
                'admin_report_removal': True, 'issued_removal': 'cancel_and_hide_keep_snapshot_and_audit',
                'actual_records_removed_by_build': False, 'hashes': hashes}
    (out / 'pricing-lifecycle-build.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    for name in ('monthly-build.json','billing-groups-build.json','commercial-build.json'):
        path = out / name
        if path.exists():
            data = json.loads(path.read_text(encoding='utf-8'))
            data.update({'pricing_lifecycle_release': VERSION, 'hashes': hashes})
            path.write_text(json.dumps(data, indent=2), encoding='utf-8')
    print('PRICING LIFECYCLE VERIFIED: ' + json.dumps(manifest))
