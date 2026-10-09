"""Final additive proforma stage; all pre-existing regression stages remain enabled."""
from pathlib import Path
from hashlib import sha256
import json, re, os, subprocess
ROOT=Path(__file__).resolve().parent
VERSION='proforma-v3.1.0'


def one(s,a,b):
    if s.count(a)!=1: raise RuntimeError('Proforma v3 marker mismatch: '+a[:100])
    return s.replace(a,b,1)


def install_proforma_v3(out):
    out=Path(out);assets=out/'assets'
    ui=(assets/'commercial.js').read_text(encoding='utf-8')
    ui=one(ui,"api().rpc('gon_client_billing',","api().rpc('gon_proforma_v3',")
    hook=(ROOT/'assets/proforma-admin-v3.js').read_text(encoding='utf-8')
    # Selecting an uncommitted grouping command is not editing the pricing form.
    hook=one(hook,"select.id='gvTeamEntries';","select.id='gvTeamEntries';select.oninput=select.onchange=e=>e.stopPropagation();")
    ui=one(ui,' window.GonCommercial=Object.freeze({version:VERSION});',hook+'\n window.GonCommercial=Object.freeze({version:VERSION,proformaVersion:"'+VERSION+'"});')
    (assets/'commercial.js').write_text(ui,encoding='utf-8')
    for name in ('macroarea-catalog.js','proforma-document-v3.js','customer-registry-v2.js'):
        (assets/name).write_text((ROOT/'assets'/name).read_text(encoding='utf-8'),encoding='utf-8')
    path=assets/'personal-history.js';s=path.read_text(encoding='utf-8')
    s=one(s,'async function open(id){','async function open(id){\n    await window.GonCatalog.refresh().catch(()=>[]);window.GonCatalog.sync();')
    path.write_text(s,encoding='utf-8')
    path=assets/'activity-timer.js';s=path.read_text(encoding='utf-8')
    s=one(s,'function openDetails(row) {','function openDetails(row) {\n    window.GonCatalog.sync();')
    path.write_text(s,encoding='utf-8')
    for mode in ('pc','mobile'):
        path=out/(mode+'.html');s=path.read_text(encoding='utf-8')
        pattern=r'(<script\b[^>]*src="assets/form-render-guard\.js[^\"]*"[^>]*>\s*</script>)'
        s,n=re.subn(pattern,lambda m:'<script src="assets/macroarea-catalog.js?v='+VERSION+'"></script>\n'+m.group(1),s)
        if n!=1:raise RuntimeError('Expected one synchronous form guard: '+mode)
        if mode=='pc':
            pattern=r'(<script\b[^>]*src="assets/client-document\.js[^\"]*"[^>]*>\s*</script>)'
            s,n=re.subn(pattern,lambda m:m.group(1)+'\n<script src="assets/proforma-document-v3.js?v='+VERSION+'"></script>',s)
            if n!=1:raise RuntimeError('Expected one existing document renderer')
            s=s.replace('</body>','<script src="assets/customer-registry-v2.js?v='+VERSION+'"></script>\n</body>',1)
        for name in ('commercial.js','personal-history.js','activity-timer.js'):
            s=re.sub('('+re.escape(name)+r'\?v=[^"\s]+)',lambda m:m.group(1)+'-'+VERSION,s)
        path.write_text(s,encoding='utf-8')
    for name in ('commercial.js','personal-history.js','activity-timer.js','macroarea-catalog.js','proforma-document-v3.js','customer-registry-v2.js'):
        subprocess.run(['node','--check',str(assets/name)],check=True)
    subprocess.run(['node',str(ROOT/'tests/test_proforma_v3.cjs'),str(assets/'proforma-document-v3.js'),str(assets/'commercial.js'),str(assets/'customer-registry-v2.js')],check=True)
    manifest={'version':VERSION,'commit':os.environ.get('RENDER_GIT_COMMIT',''),'cassa_before_vat':True,'daily_details':True,'customer_legal_snapshot':True,'admin_dynamic_macroareas':True,'team_rates':[450,900],'team_duration_requires_confirmation':True,'existing_snapshots_not_rewritten':True,'customer_registry_page':True,'proforma_profile_editor':False,'hashes':{p.name:sha256(p.read_bytes()).hexdigest() for p in assets.glob('*.js')}}
    (out/'proforma-v3-build.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('PROFORMA V3 VERIFIED: '+json.dumps(manifest))
    from registry_integration import install_registry
    install_registry(out)
