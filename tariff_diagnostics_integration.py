"""Explain missing prices without changing rates, validity or report snapshots."""
from pathlib import Path
from hashlib import sha256
import json
import os
import re
import subprocess

VERSION = 'tariff-diagnostics-1.0.0'
ROOT = Path(__file__).resolve().parent
HELPERS = r'''
 function rateDateLabel(value){return value?String(value).slice(0,10).split('-').reverse().join('/'):'non indicata';}
 function rateTermsAt(terms,day){
  return (terms||[]).filter(t=>!t.superseded&&t.valid_from<=day&&(!t.valid_to||t.valid_to>=day))
   .slice().sort((a,b)=>String(b.valid_from).localeCompare(String(a.valid_from))||Number(b.version)-Number(a.version))[0]||null;
 }
 function rateCheck(entry,terms){
  const active=(terms||[]).filter(t=>!t.superseded),day=entry.date;
  const fail=(code,message)=>({ok:false,code,message});
  if(!active.length)return fail('no_terms','Nessuna condizione economica salvata per questo cliente.');
  if(!day)return fail('missing_date','Data della registrazione non disponibile.');
  const t=rateTermsAt(active,day);
  if(!t){
   const first=active.map(t=>t.valid_from).sort()[0];
   return day<first?fail('before_start','Condizioni valide dal '+rateDateLabel(first)+': non coprono questa attivit\u00e0 del '+rateDateLabel(day)+'.')
    :fail('date_gap','Nessuna condizione valida il '+rateDateLabel(day)+': controlla decorrenza e scadenza.');
  }
  if(t.billing_mode==='legacy')return fail('legacy','Condizioni precedenti da confermare nella nuova gestione cliente.');
  if(t.billing_mode==='monthly_flat')return t.monthly_price==null?fail('missing_flat','Importo del forfait mensile da definire.'):{ok:true,code:'monthly',terms_id:t.id};
  const kind=TARIFF_CATALOG.find(([m,y])=>m===entry.macro&&y===entry.type)?.[2];
  if(!kind)return fail('removed','Combinazione macroarea / tipo ore rimossa: verificare la classificazione.');
  const r=(t.rules||[]).find(r=>r.macro===entry.macro&&r.type===entry.type);
  if(!r)return fail('missing_rule','Manca la voce '+entry.macro+' / '+entry.type+' nelle condizioni applicabili.');
  if(r.mode!==kind)return fail('wrong_mode','Modalit\u00e0 tariffaria da confermare; le attivit\u00e0 programmate sono a forfait.');
  if(r.price==null||r.price==='')return fail('missing_price','Prezzo non compilato per '+entry.macro+' / '+entry.type+'.');
  return {ok:true,code:'matched',terms_id:t.id};
 }
 function savedRateLabel(line){
  if(line.price==null||line.price==='')return line.terms_id?'Importo da definire nelle condizioni applicate':'Nessuna tariffa applicata alla copia: verifica date e condizioni';
  const reference=String(line.terms_reference||'').trim();
  if(!line.terms_id)return 'Tariffa impostata nella bozza'+(reference?' | '+reference:'');
  return 'Condizioni'+(line.terms_version!=null?' v'+line.terms_version:'')+(reference?' | '+reference:' | riferimento accordo non indicato');
 }
 function rateCoverageMessages(entries,terms){
  const messages=[];
  for(const e of entries||[]){const r=rateCheck(e,terms);if(!r.ok){const m=rateDateLabel(e.date)+' | '+e.macro+' / '+e.type+': '+r.message;if(!messages.includes(m))messages.push(m);}}
  return messages;
 }
 function reportRateMessages(report,data){
  const d=report?.document,messages=[];
  if(!d||report.state!=='draft')return messages;
  if(!data||data.client?.id!==d.client?.id)return ['Per verificare le condizioni correnti, carica il cliente di questa bozza. Nessun importo viene aggiornato automaticamente.'];
  const missing=(d.lines||[]).filter(l=>l.price==null||l.price==='');
  if(missing.length){
   const ids=new Set(missing.flatMap(l=>l.entry_ids||[])),refs=new Set(missing.flatMap(l=>l.refs||[]).map(String));
   const acts=(d.activities||[]).filter(a=>ids.has(a.id)||refs.has(String(a.ref)));
   messages.push(...rateCoverageMessages(acts,data.terms));
   if(acts.length&&!messages.length)messages.push('Le condizioni attuali contengono le tariffe mancanti in questa copia. Usa "Aggiorna da attivit\u00e0 e listino" per rileggerle: il comando sostituisce le rettifiche delle righe, non aggiorna i documenti emessi.');
   if(!acts.length)messages.push('Importo salvato non definito: verifica le condizioni del forfait e aggiorna esplicitamente la bozza.');
  }
  if(d.vat_rate==null)messages.push('IVA della copia da indicare o confermare nel campo dedicato. Il ricalcolo conserva l\'IVA gi\u00e0 salvata, anche quando non definita.');
  return messages;
 }
 function rateNotice(id,host,messages){
  const previous=$(id);if(previous)previous.remove();
  if(!host||!messages.length)return;
  const box=document.createElement('div');box.id=id;box.className='gc-banner';box.setAttribute('role','status');
  const title=document.createElement('strong');title.textContent='Verifica tariffe e decorrenza';box.append(title);
  messages.slice(0,8).forEach(text=>{const p=document.createElement('p');p.textContent=text;box.append(p);});
  if(messages.length>8){const p=document.createElement('p');p.textContent='Altre '+(messages.length-8)+' segnalazioni: controlla le attivit\u00e0 e le condizioni del periodo.';box.append(p);}
  host.prepend(box);
 }
 function showRateCoverage(){
  const messages=overview?rateCoverageMessages((overview.entries||[]).filter(e=>!e.billed_report_id&&!e.needs_details),overview.terms):[];
  if(overview&&!(overview.terms||[]).some(t=>!t.superseded)&&!messages.length)messages.push('Nessuna condizione economica salvata per questo cliente.');
  rateNotice('gcRateCoverage',$('gcTermsHistory'),messages);
 }
 function showTermsCoverage(){
  if(!overview||!termsDialog?.open)return;
  const from=$('gcTFrom').value,to=$('gcTTo').value,messages=[];
  const uncovered=(overview.entries||[]).filter(e=>!e.billed_report_id&&((from&&e.date<from)||(to&&e.date>to)));
  if(uncovered.length)messages.push(uncovered.length+' attivit\u00e0 del periodo sono fuori dalle date impostate. Le nuove condizioni non verranno applicate a queste date; eventuali versioni precedenti restano soggette alla propria validit\u00e0.');
  const current=(overview.terms||[]).find(t=>t.id===termsDialog.dataset.current);
  if(current&&from&&from<current.valid_from)messages.push('La decorrenza precede l\'ultima versione: il salvataggio ordinario la blocca. Serve una rettifica esplicita della decorrenza, non una modifica dei prezzi o dei documenti emessi.');
  rateNotice('gcTermsCoverage',$('gcHourlyWrap')?.parentElement,messages);
 }
 const rateOriginalOverview=renderOverview;
 renderOverview=function(){rateOriginalOverview();showRateCoverage();};
 const rateOriginalShow=showReport;
 showReport=function(r){rateOriginalShow(r);rateNotice('gcReportCoverage',$('gcReportLines')?.closest('.gc-scroll')?.parentElement,reportRateMessages(r,overview));};
 const rateOriginalEdit=editTerms;
 editTerms=function(){rateOriginalEdit();showTermsCoverage();['gcTFrom','gcTTo'].forEach(id=>{const input=$(id);if(input&&!input.dataset.rateCoverageBound){input.addEventListener('input',showTermsCoverage);input.dataset.rateCoverageBound='true';}});};
 const rateOriginalHide=hide;
 hide=function(){rateOriginalHide();['gcRateCoverage','gcReportCoverage','gcTermsCoverage'].forEach(id=>$(id)?.remove());};
'''


def patch_ui(ui):
    old = "esc(line.terms_reference||'Tariffa non definita')"
    if ui.count(old) != 1:
        raise RuntimeError('Expected one saved tariff reference label')
    ui = ui.replace(old, 'esc(savedRateLabel(line))', 1)
    marker = ' window.GonCommercial=Object.freeze({version:VERSION});'
    if ui.count(marker) != 1:
        raise RuntimeError('Commercial module export missing or repeated')
    return ui.replace(marker, HELPERS + '\n' + marker, 1)


def install_tariff_diagnostics(out):
    out = Path(out)
    ui_path = out / 'assets/commercial.js'
    ui_path.write_text(patch_ui(ui_path.read_text(encoding='utf-8')), encoding='utf-8')
    subprocess.run(['node', '--check', str(ui_path)], check=True)
    subprocess.run(['node', str(ROOT / 'tests/test_tariff_diagnostics.cjs'), str(ui_path)], check=True)
    # No changes to report generation, financial functions, or operational pages.
    path = out / 'pc.html'
    html, count = re.subn(r'(commercial\.js\?v=[^"\s]+)', lambda m: m.group(1) + '-' + VERSION, path.read_text(encoding='utf-8'))
    if count != 1:
        raise RuntimeError('Expected one commercial.js script on PC')
    path.write_text(html, encoding='utf-8')
    manifest = {'version': VERSION, 'commit': os.environ.get('RENDER_GIT_COMMIT', ''),
                'diagnostics_only': True, 'rates_changed': False, 'reports_recalculated': False,
                'label_uses_price_not_reference': True,
                'commercial_sha256': sha256(ui_path.read_bytes()).hexdigest()}
    (out / 'tariff-diagnostics-build.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('TARIFF DIAGNOSTICS VERIFIED: ' + json.dumps(manifest))
