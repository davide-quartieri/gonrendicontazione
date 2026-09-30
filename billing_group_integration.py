"""Explicit billing groups, applied after the monthly/VAT build.
Operational client/site selectors are deliberately left unchanged.
"""
from pathlib import Path
from hashlib import sha256
import json
import os
import re
import subprocess
import tempfile

VERSION = 'billing-groups-1.0.0'
ROOT = Path(__file__).resolve().parent


def one(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Billing groups: expected one marker: ' + old[:100])
    return text.replace(old, new, 1)


REFERENCES = r'''async function references(selected){
 const stamp=epoch,owner=actor?.id;
 if(!allowed||!owner)throw new Error('Accesso amministratore richiesto.');
 const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),15000);
 try{
  const r=await api().rpc('gon_billing_customers',{p_expected_user:owner}).abortSignal(abort.signal);
  if(stamp!==epoch||actor?.id!==owner)return;
  if(r.error)throw r.error;
  if(!Array.isArray(r.data))throw new Error('Elenco clienti di fatturazione non valido.');
  clients=r.data;
  const select=$('gcClient'),previous=selected||select.value;
  select.replaceChildren(new Option('Seleziona cliente',''));
  clients.forEach(c=>select.add(new Option(c.display,c.id)));
  if(clients.some(c=>c.id===previous))select.value=previous;
 }finally{clearTimeout(timeout);}
}'''


WORKBOOK_SITES = r'''
  if(d.client.billing_grouped){
   X.utils.sheet_add_aoa(acts,[['Cantiere'],...d.activities.map(a=>[String(a.site||a.client||'')])],{origin:'G3'});
   acts['!cols'].push({wch:28});
   if(d.activities.length)acts['!autofilter']={ref:'A3:G'+(d.activities.length+3)};
   X.utils.sheet_add_aoa(summary,[['Cantieri inclusi',(d.client.sites||[]).map(s=>s.site||s.display).join(' / ')]],{origin:'A16'});
  }
  X.utils.book_append_sheet(wb,acts,'Attivita');return wb;'''


def patch_ui(ui):
    pattern = r'\n async function references\(selected\)\{[\s\S]*?(?=\n function panelOpen\()'
    ui, count = re.subn(pattern, lambda _: '\n ' + REFERENCES + '\n', ui)
    if count != 1:
        raise RuntimeError('Missing monthly references function')
    ui = one(ui, '<label for="gcClient">Cliente / cantiere</label>',
             '<label for="gcClient">Cliente di fatturazione</label>')
    ui = one(ui, '<th>Data / operatore</th>', '<th>Data / operatore / cantiere</th>')
    ui = one(ui, "date(e.date)+' | '+e.employee", "date(e.date)+' | '+e.employee+' | '+e.client")
    ui = one(ui, "say(data.entries.length+' attivita caricate dal cliente, senza assegnazioni.');",
             "say(data.entries.length+' attivita del cliente '+data.client.display+' nel periodo.'+(data.client.billing_grouped?' Cantieri inclusi: '+data.client.site+'. Un unico destinatario e un unico forfait mensile, se concordato.':''));")
    return ui


def patch_document(js):
    # Change the VAT renderer only, retaining all legacy rendering byte-for-byte.
    start = js.index(' function monthlyBuildHtml(report){')
    end = js.index('\n function downloadBlob(', start)
    body = js[start:end]
    body = one(body, 'date(a.date),a.description,a.macro',
               "date(a.date),(d.client.billing_grouped?'['+(a.site||a.client||'Cantiere')+'] ':'')+a.description,a.macro")
    body = one(body, '<b>Cantiere / sede</b>',
               "<b>${d.client.billing_grouped?'Cantieri inclusi':'Cantiere / sede'}</b>")
    js = js[:start] + body + js[end:]
    js = one(js, "X.utils.book_append_sheet(wb,acts,'Attivita');return wb;", WORKBOOK_SITES.strip())
    return js


def install_billing_groups(out):
    out = Path(out)
    assets = out / 'assets'
    ui = patch_ui((assets / 'commercial.js').read_text(encoding='utf-8'))
    old_document = (assets / 'client-document.js').read_text(encoding='utf-8')
    document = patch_document(old_document)
    (assets / 'commercial.js').write_text(ui, encoding='utf-8')
    (assets / 'client-document.js').write_text(document, encoding='utf-8')
    for filename in ('commercial.js', 'client-document.js'):
        subprocess.run(['node', '--check', str(assets / filename)], check=True)
    path = out / 'pc.html'
    html = path.read_text(encoding='utf-8')
    for name in ('commercial.js', 'client-document.js'):
        pattern = '(' + re.escape(name) + r'\?v=[^"\s]+)'
        html, count = re.subn(pattern, lambda m: m.group(1) + '-' + VERSION, html)
        if count != 1:
            raise RuntimeError('Billing groups: expected one script tag for ' + name)
    path.write_text(html, encoding='utf-8')
    with tempfile.TemporaryDirectory(prefix='gon-billing-tests-') as tmp:
        base = Path(tmp) / 'monthly-before.js'
        base.write_text(old_document, encoding='utf-8')
        subprocess.run(['node', str(ROOT / 'tests' / 'test_billing_groups.cjs'), str(base),
                        str(assets / 'client-document.js'), str(assets / 'commercial.js')], check=True)
    subprocess.run(['node', str(ROOT / 'tests' / 'test_monthly_documents.cjs'),
                    str(ROOT / 'assets' / 'client-document.js'), str(assets / 'client-document.js')], check=True)
    hashes = {p.name: sha256(p.read_bytes()).hexdigest() for p in assets.glob('*.js')}
    manifest = {'version': VERSION, 'commit': os.environ.get('RENDER_GIT_COMMIT', ''),
                'billing_groups': True, 'operational_sites_preserved': True,
                'grouped_document_site_details': True, 'single_monthly_fee_per_group': True,
                'old_documents_not_rewritten': True, 'hashes': hashes}
    (out / 'billing-groups-build.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    for name in ('monthly-build.json', 'commercial-build.json', 'excel-build.json', 'timer-build.json'):
        path = out / name
        if path.exists():
            data = json.loads(path.read_text(encoding='utf-8'))
            data.update({'billing_group_release': VERSION, 'hashes': hashes})
            path.write_text(json.dumps(data, indent=2), encoding='utf-8')
    print('BILLING GROUPS VERIFIED: ' + json.dumps(manifest))
