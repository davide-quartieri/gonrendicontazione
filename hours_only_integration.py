"""Remove administration from the time-entry pages; retain shared read-only catalogs.
This final build stage has no database writes and fails closed on source drift.
"""
from pathlib import Path
from hashlib import sha256
import json, os, re, subprocess, tempfile

VERSION = 'hours-only-1.1.0'
DROP_SCRIPTS = ('registry-readonly.js', 'customer-registry-v2.js', 'commercial.js',
                'client-document.js', 'proforma-document-v3.js', 'excel-report.js')


def once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Hours-only marker mismatch: ' + old[:90])
    return text.replace(old, new, 1)


def replace_js_function(text, name, source):
    pattern = r'^(?:async )?function ' + re.escape(name) + r'\([^\n]*$'
    text, n = re.subn(pattern, source, text, count=1, flags=re.M)
    if n != 1:
        raise RuntimeError('Hours-only JS function marker mismatch: ' + name)
    return text


def transform(text):
    for ident in ('clienti', 'report'):
        text, n = re.subn(r'<section id="'+ident+r'"[^>]*>.*?</section>', '', text, flags=re.S)
        if n != 1: raise RuntimeError('Expected one administrative section: ' + ident)
        text, n = re.subn(r'<button\b[^>]*data-p="'+ident+r'"[^>]*>.*?</button>', '', text, flags=re.S)
        if n != 1: raise RuntimeError('Expected one administrative tab: ' + ident)
    for name in DROP_SCRIPTS:
        text = re.sub(r'<script\b[^>]*src="assets/'+re.escape(name)+r'[^\"]*"[^>]*>\s*</script>', '', text)
    # Old non-module functions must also disappear, not merely their buttons.
    for name in ('addClient', 'delClient', 'filtered', 'renderReport', 'exportExcel'):
        text, n = re.subn(r'^(?:async )?function '+name+r'\([^\n]+\n', '', text, flags=re.M)
        if n != 1: raise RuntimeError('Expected one legacy function: ' + name)
    text = once(text, "$('rclient').innerHTML='<option value=\"\">Tutti i clienti</option>'+clients.map(c=>`<option>${esc(c.display)}</option>`).join('');", '')
    text, n = re.subn(r"\$\('clist'\)\.innerHTML=.*?;renderReport\(\)", '', text)
    if n != 1: raise RuntimeError('Expected one old registry renderer')
    for old in ("$('cadd').onclick=addClient;", "$('refreshreport').onclick=renderReport;",
                "$('excel').onclick=exportExcel;", "$('rclient').onchange=renderReport;",
                "$('from').onchange=renderReport;", "$('to').onchange=renderReport;",
                "$('from').value=new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10);",
                "$('to').value=new Date().toISOString().slice(0,10);", 'window.delClient=delClient;'):
        text = once(text, old, '')
    text = once(text, "['tabs','luigi','clienti','report']", "['tabs','luigi']")
    text = once(text, "db.from('clients').select('*').order('display')", "db.from('clients').select('id,main,site,display,active').order('display')")
    # Foglio Luigi: retain detailed rows but organize review by billing client and operational site.
    # PROGRAMMATE remain recorded as hours; commercial valuation stays forfait.
    text = once(text,
        '<th></th><th>Data</th><th>Cliente</th><th>Tipo</th><th>Descrizione</th><th>Ore</th>',
        '<th></th><th>Data</th><th>Cliente</th><th>Cantiere</th><th>Tipo</th><th>Macroarea</th><th>Descrizione</th><th>Ore</th>')
    text = once(text, '<div class="scroll"><table class="suggest">',
        '<p class="small" id="ocrgroupnote">Le righe sono ordinate per cliente e cantiere. Le attività PROGRAMMATE sono separate: le ore restano registrate, ma la valorizzazione economica sarà a forfait.</p><div class="scroll"><table class="suggest">')

    ocr_parse = r'''function gonOcrProgrammed(m){return /PROGRAMMAT[OA]/i.test(m||'')}
function gonOcrMacroNames(){let x=(window.GonCatalog&&window.GonCatalog.names&&window.GonCatalog.names())||null;return x&&x.length?x:['Rilievo in campo','Elaborazione rilievo','Assistenza cliente','Attività amministrative','Corso','Varie','Rilievo in campo - PROGRAMMATO','Elaborazione rilievo - PROGRAMMATA']}
function gonOcrDefaultMacro(type,line){let s=String(line||'');if(/programmat/i.test(s)){if(/elaborazione/i.test(s)||type==='Ufficio')return 'Elaborazione rilievo - PROGRAMMATA';if(type==='Cantiere')return 'Rilievo in campo - PROGRAMMATO'}if(/assistenza/i.test(s))return 'Assistenza cliente';if(/amministrativ/i.test(s))return 'Attività amministrative';if(/corso|formazione/i.test(s))return 'Corso';if(/varie/i.test(s))return 'Varie';if(/elaborazione/i.test(s)||type==='Ufficio')return 'Elaborazione rilievo';if(/rilievo/i.test(s)||type==='Cantiere')return 'Rilievo in campo';return 'Varie'}
function gonOcrClient(display){return clients.find(c=>c.active!==false&&c.display===display)||null}
function gonOcrDate(m){if(!m||!m.length)return'';let y=m[3].length===2?'20'+m[3]:m[3];return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0')}
function ocrParse(txt){let current=$('date').value,res=[],active=clients.filter(c=>c.active!==false);String(txt||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).forEach(line=>{let dm=line.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);if(dm)current=gonOcrDate(dm);let tm=line.match(/\b(\d{1,2})(?:[:\.](\d{2}))?\s*(?:-|–|—|a)\s*(\d{1,2})(?:[:\.](\d{2}))?\b/i);if(!tm)return;let sh=+tm[1]+ +(tm[2]||0)/60,eh=+tm[3]+ +(tm[4]||0)/60,h=eh-sh;if(h>6.5)h-=1;if(!(h>0))return;let low=line.toLowerCase(),direct=active.map(c=>{let d=(c.display||'').toLowerCase(),s=(c.site||'').toLowerCase(),score=0;if(d&&low.includes(d))score=10000+d.length;else if(s&&low.includes(s))score=5000+s.length;return{c,score}}).filter(x=>x.score).sort((a,b)=>b.score-a.score),c=direct.length?direct[0].c:null;if(!c){let mains=[...new Set(active.filter(x=>x.main&&low.includes(x.main.toLowerCase())).map(x=>x.main))];if(mains.length===1){let same=active.filter(x=>x.main===mains[0]);if(same.length===1)c=same[0]}}let type=/\bV\b|viaggio|trasferta/i.test(line)?'Viaggio':/\bU\b|ufficio|disegno|relazione|calcoli|elaborazione/i.test(line)?'Ufficio':'Cantiere',macro=gonOcrDefaultMacro(type,line),description=line.replace(tm[0],'').replace(dm?dm[0]:'','').replace(/^\s*[-–—|:]+|[-–—|:]+\s*$/g,'').trim()||'Attività da verificare';res.push({date:current,client:c?c.display:'',type,macro,description,hours:Math.max(0,+h.toFixed(2)),selected:true})});return res.slice(0,100)}'''
    ocr_render = r'''function renderOcr(){const activeClients=clients.filter(c=>c.active!==false),macroNames=gonOcrMacroNames(),items=ocrRows.map((r,i)=>({r,i,c:gonOcrClient(r.client),p:gonOcrProgrammed(r.macro)}));items.sort((a,b)=>Number(a.p)-Number(b.p)||String(a.c?.main||'~').localeCompare(String(b.c?.main||'~'),'it')||String(a.c?.site||a.c?.display||'~').localeCompare(String(b.c?.site||b.c?.display||'~'),'it')||String(a.r.date||'').localeCompare(String(b.r.date||''))||a.i-b.i);let html='',section='',group='';for(const x of items){let sec=x.p?'PROGRAMMATE / FORFAIT':'ORE ORDINARIE';if(sec!==section){section=sec;group='';html+='<tr><td colspan="8" style="background:'+(x.p?'#fff4e5':'#eaf4fb')+';font-weight:800;color:#155f96">'+sec+(x.p?' — ore operative separate, valorizzazione economica a forfait':'')+'</td></tr>'}let main=x.c?.main||'Cliente da verificare',site=x.c?(x.c.site||x.c.display):'Cantiere da verificare',g=section+'|'+main+'|'+site;if(g!==group){group=g;html+='<tr><td colspan="8" style="background:#f7f9fc;font-weight:700">Cliente: '+esc(main)+' · Cantiere: '+esc(site)+'</td></tr>'}let r=x.r,i=x.i,names=macroNames.slice();if(r.macro&&!names.includes(r.macro))names.unshift(r.macro);let siteOptions='<option value=""></option>'+activeClients.map(c=>'<option value="'+esc(c.display)+'" '+(c.display===r.client?'selected':'')+'>'+esc(c.display)+'</option>').join(''),macroOptions=names.map(m=>'<option value="'+esc(m)+'" '+(m===r.macro?'selected':'')+'>'+esc(m)+'</option>').join('');html+='<tr><td><input type="checkbox" data-i="'+i+'" data-sel checked></td><td><input type="date" data-i="'+i+'" data-f="date" value="'+esc(r.date||'')+'"></td><td><span data-main>'+esc(main)+'</span></td><td><select data-i="'+i+'" data-f="client">'+siteOptions+'</select></td><td><select data-i="'+i+'" data-f="type">'+['Cantiere','Viaggio','Ufficio'].map(v=>'<option '+(v===r.type?'selected':'')+'>'+v+'</option>').join('')+'</select></td><td><select data-i="'+i+'" data-f="macro">'+macroOptions+'</select></td><td><input data-i="'+i+'" data-f="description" value="'+esc(r.description||'')+'"></td><td><input type="number" step=".25" min="0" data-i="'+i+'" data-f="hours" value="'+Number(r.hours||0)+'"></td></tr>'}if(!html)html='<tr><td colspan="8" class="small">Nessuna riga proposta.</td></tr>';$('ocrbody').innerHTML=html;$('ocrbody').querySelectorAll('[data-sel]').forEach(x=>{let i=+x.dataset.i;x.checked=ocrRows[i].selected!==false;x.onchange=e=>ocrRows[i].selected=e.target.checked});$('ocrbody').querySelectorAll('input[data-f]').forEach(x=>x.oninput=e=>{let i=+e.target.dataset.i,f=e.target.dataset.f;ocrRows[i][f]=f==='hours'?+e.target.value:e.target.value});$('ocrbody').querySelectorAll('select[data-f]').forEach(x=>x.onchange=e=>{let i=+e.target.dataset.i,f=e.target.dataset.f,v=e.target.value;ocrRows[i][f]=v;if(f==='macro'){if(v==='Rilievo in campo - PROGRAMMATO')ocrRows[i].type='Cantiere';if(v==='Elaborazione rilievo - PROGRAMMATA')ocrRows[i].type='Ufficio'}else if(f==='type'&&!gonOcrProgrammed(ocrRows[i].macro))ocrRows[i].macro=gonOcrDefaultMacro(v,ocrRows[i].description);renderOcr()})}'''
    ocr_run = r'''async function runOcr(){let f=$('ocrfile').files[0];if(!f)return alert('Carica una foto.');$('ocrstatus').textContent='Lettura in corso...';$('ocrimg').src=URL.createObjectURL(f);$('ocrimg').classList.remove('hide');try{if(window.GonCatalog&&window.GonCatalog.refresh)await window.GonCatalog.refresh().catch(()=>[]);let r=await Tesseract.recognize(f,'ita+eng');$('ocrtext').value=r.data.text||'';ocrRows=ocrParse(r.data.text||'');renderOcr();$('ocrstatus').textContent=ocrRows.length+' righe proposte, ordinate per cliente e cantiere. Le PROGRAMMATE sono separate.'}catch(e){console.warn(e);$('ocrstatus').textContent='OCR non riuscito.'}}'''
    ocr_save = r'''async function saveOcr(){let emp=$('employee').value.trim()||'Luigi',chosen=ocrRows.filter(r=>r.selected!==false),rows=chosen.filter(r=>r.client&&r.hours>0&&r.macro).map(r=>({id:uid('en'),date:r.date,employee:emp,client:r.client,type:r.type,macro:r.macro,description:r.description,hours:r.hours,created_by:currentUser.id}));if(!rows.length)return alert('Nessuna riga completa.');if(rows.some(r=>!clients.some(c=>c.active!==false&&c.display===r.client)))return alert('Cliente/cantiere non disponibile. Aggiorna l’elenco e correggi le righe prima di salvare.');if(rows.some(r=>!gonOcrMacroNames().includes(r.macro)))return alert('Macroarea non disponibile. Aggiorna il catalogo e correggi le righe prima di salvare.');let x=await db.from('entries').insert(rows);if(x.error)alert(x.error.message);else{ocrRows=[];renderOcr();load(true);toast('Righe salvate')}}'''
    text = replace_js_function(text, 'ocrParse', ocr_parse)
    text = replace_js_function(text, 'renderOcr', ocr_render)
    text = replace_js_function(text, 'runOcr', ocr_run)
    text = replace_js_function(text, 'saveOcr', ocr_save)

    text = once(text, "if(!o.date||!o.employee||!o.client||!o.description||!o.hours)return alert('Compila tutti i campi.');", "if(!o.date||!o.employee||!o.client||!o.description||!o.hours)return alert('Compila tutti i campi.');if(!clients.some(c=>c.active!==false&&c.display===o.client))return alert('Cliente/cantiere non disponibile. Aggiorna l\u2019elenco prima di salvare.');")
    # A refresh is a read, never an invitation to create a local customer here.
    text = once(text, '<select id="client"></select>', '<select id="client"></select><p class="small" id="client-source">Elenco operativo da GON Management. Per nuovi clienti o cantieri rivolgersi all\u2019amministrazione.</p><button id="refresh-clients" type="button" class="btn light" style="margin-top:6px">Aggiorna elenco</button>')
    text = once(text, "$('add').onclick=addEntry;", "$('add').onclick=addEntry;$('refresh-clients').onclick=async()=>{const b=$('refresh-clients');b.disabled=true;try{await load(false)}finally{b.disabled=false}};")
    # Remove public links and loaded code for the customer editor and billing.
    for forbidden in ('id="clienti"', 'id="report"', 'addClient(', 'delClient(', 'renderReport(',
                      'gestionale-clienti.html', 'registry-readonly.js', 'assets/commercial.js'):
        if forbidden in text: raise RuntimeError('Administrative surface remains: ' + forbidden)
    if "clients.filter(c=>c.active!==false).map" not in text: raise RuntimeError('Active-site selection lost')
    for marker in ('async function addEntry', 'async function load', 'personal-history.js', 'activity-timer.js', 'form-render-guard.js', 'setInterval(()=>load(true),15000)', 'PROGRAMMATE / FORFAIT', 'data-f="macro"'):
        if marker not in text: raise RuntimeError('Time-entry function lost: '+marker)
    return text


def install_hours_only(out):
    out=Path(out)
    hashes={}
    for mode in ('pc','mobile'):
        path=out/(mode+'.html');text=transform(path.read_text(encoding='utf-8'))
        path.write_text(text,encoding='utf-8');hashes[path.name]=sha256(path.read_bytes()).hexdigest()
        # Check every inline JavaScript block, not only added snippets.
        for i,block in enumerate(re.findall(r'<script\b(?![^>]*\bsrc=)[^>]*>(.*?)</script>',text,re.S)):
            if not block.strip(): continue
            with tempfile.TemporaryDirectory() as temp:
                js=Path(temp)/('inline-'+str(i)+'.js');js.write_text(block,encoding='utf-8')
                subprocess.run(['node','--check',str(js)],check=True)
    # Retire the old stand-alone editor URL without deleting customer records.
    (out/'gestionale-clienti.html').write_text('<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anagrafiche trasferite in GON Management</title></head><body><main><h1>Anagrafiche gestite in GON Management</h1><p>Questa applicazione serve soltanto per registrare le ore. Per creare o modificare clienti e cantieri apri Anagrafiche nel gestionale GON Management versione 0.4.2 o successiva.</p><p>I clienti e le ore esistenti sono conservati. Il programma ore legge l’elenco operativo salvato dal gestionale.</p><p><a href="pc.html">Torna all’inserimento ore</a></p></main></body></html>',encoding='utf-8')
    for name in (*DROP_SCRIPTS, 'registry-ui.js', 'registry-online.js'):
        (out/'assets'/name).unlink(missing_ok=True)
    registry_manifest=out/'registry-build.json'
    if registry_manifest.exists():
        r=json.loads(registry_manifest.read_text());r.update({'superseded_by':VERSION,'standalone_editor_retired':True,'hashes':{}})
        registry_manifest.write_text(json.dumps(r,indent=2),encoding='utf-8')
    manifest={'version':VERSION,'commit':os.environ.get('RENDER_GIT_COMMIT',os.environ.get('GITHUB_SHA','')),
              'pages':['pc.html','mobile.html'],'customer_editor':False,'billing_ui':False,
              'catalog_source':'GON Management operational registry / public.clients (read only)',
              'catalog_fields':['id','main','site','display','active'],
              'historical_records_deleted':False,'luigi_import_grouping':'client_then_site','programmed_hours_separate':True,'ocr_macro_editable':True,'hashes':hashes}
    (out/'hours-only-build.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('HOURS ONLY BUILD VERIFIED: '+json.dumps(manifest))

if __name__=='__main__':
    import sys
    install_hours_only(Path(sys.argv[1] if len(sys.argv)>1 else 'public'))
