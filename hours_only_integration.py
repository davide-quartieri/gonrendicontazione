"""Remove administration from the time-entry pages; retain shared read-only catalogs.
This final build stage has no database writes and fails closed on source drift.
"""
from pathlib import Path
from hashlib import sha256
import json, os, re, subprocess, tempfile

VERSION = 'hours-only-1.0.0'
DROP_SCRIPTS = ('registry-readonly.js', 'customer-registry-v2.js', 'commercial.js',
                'client-document.js', 'proforma-document-v3.js', 'excel-report.js')


def once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Hours-only marker mismatch: ' + old[:90])
    return text.replace(old, new, 1)


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
    # Bulk manual/OCR entry can select only active operational sites, not hidden history.
    text = once(text, 'function renderOcr(){', 'function renderOcr(){const activeClients=clients.filter(c=>c.active!==false);')
    lines=text.splitlines()
    for i,line in enumerate(lines):
        if line.startswith('function renderOcr()'): lines[i]=line.replace('clients.map(', 'activeClients.map(')
    text='\n'.join(lines)+'\n'
    text = once(text, "if(!rows.length)return alert('Nessuna riga completa.');", "if(!rows.length)return alert('Nessuna riga completa.');if(rows.some(r=>!clients.some(c=>c.active!==false&&c.display===r.client)))return alert('Cliente/cantiere non disponibile. Aggiorna l\u2019elenco e correggi le righe prima di salvare.');")
    text = once(text, "if(!o.date||!o.employee||!o.client||!o.description||!o.hours)return alert('Compila tutti i campi.');", "if(!o.date||!o.employee||!o.client||!o.description||!o.hours)return alert('Compila tutti i campi.');if(!clients.some(c=>c.active!==false&&c.display===o.client))return alert('Cliente/cantiere non disponibile. Aggiorna l\u2019elenco prima di salvare.');")
    # A refresh is a read, never an invitation to create a local customer here.
    text = once(text, '<select id="client"></select>', '<select id="client"></select><p class="small" id="client-source">Elenco operativo da GON Management. Per nuovi clienti o cantieri rivolgersi all\u2019amministrazione.</p><button id="refresh-clients" type="button" class="btn light" style="margin-top:6px">Aggiorna elenco</button>')
    text = once(text, "$('add').onclick=addEntry;", "$('add').onclick=addEntry;$('refresh-clients').onclick=async()=>{const b=$('refresh-clients');b.disabled=true;try{await load(false)}finally{b.disabled=false}};")
    # Remove public links and loaded code for the customer editor and billing.
    for forbidden in ('id="clienti"', 'id="report"', 'addClient(', 'delClient(', 'renderReport(',
                      'gestionale-clienti.html', 'registry-readonly.js', 'assets/commercial.js'):
        if forbidden in text: raise RuntimeError('Administrative surface remains: ' + forbidden)
    if "clients.filter(c=>c.active!==false).map" not in text: raise RuntimeError('Active-site selection lost')
    for marker in ('async function addEntry', 'async function load', 'personal-history.js', 'activity-timer.js', 'form-render-guard.js', 'setInterval(()=>load(true),15000)'):
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
              'historical_records_deleted':False,'hashes':hashes}
    (out/'hours-only-build.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('HOURS ONLY BUILD VERIFIED: '+json.dumps(manifest))

if __name__=='__main__':
    import sys
    install_hours_only(Path(sys.argv[1] if len(sys.argv)>1 else 'public'))
