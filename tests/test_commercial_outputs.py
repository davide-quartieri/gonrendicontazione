"""No real users or network. Tests build boundaries and browser workbook models.
Run: python tests/test_commercial_outputs.py (requires Node, Chromium, Playwright).
The SheetJS adapter captures a workbook model; it is not a desktop Excel E2E test.
"""
from pathlib import Path
import importlib.util
import json
import tempfile
import shutil
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
MACROS = ['Rilievo in campo','Elaborazione rilievo','Assistenza cliente','Attivit\u00e0 amministrative','Corso','Varie','Rilievo in campo - PROGRAMMATO','Elaborazione rilievo - PROGRAMMATA']
spec=importlib.util.spec_from_file_location('commercial_integration', ROOT/'commercial_integration.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as tmp:
    base=Path(tmp);out=base/'public';assets=out/'assets';assets.mkdir(parents=True)
    shutil.copytree(ROOT/'assets',base/'assets')
    (base/'macroareas.json').write_text(json.dumps(MACROS))
    module.ROOT=base
    (assets/'personal-history.js').write_text("const fields='id,date,employee,client,type';function render(){card.append(b);list.append(card);}")
    (assets/'activity-timer.js').write_text('/* Existing recorder untouched */')
    original='''<!doctype html><html><body><section id="ore"></section><script>async function loadCurrentProfile(){};function manual(){return {hours:+$('hours').value};}</script><script src="assets/form-state-guard.js?v=1"></script><script src="assets/personal-history.js?v=1"></script><script src="assets/activity-timer.js?v=1"></script></body></html>'''
    for mode in ('pc','mobile'):(out/f'{mode}.html').write_text(original)
    module.install_commercial(out)
    pc=(out/'pc.html').read_text();mobile=(out/'mobile.html').read_text()
    assert 'project_id:' in pc and 'project_id:' in mobile
    assert 'assets/commercial.js' in pc and 'assets/commercial.js' not in mobile
    assert 'assets/client-document.js' in pc and 'assets/client-document.js' not in mobile
    assert 'assets/projects.js' in mobile and 'activity-timer.js?v=1' in mobile
    assert 'form-state-guard.js' not in pc and 'form-render-guard.js' in pc
    assert 'project_id' in (assets/'personal-history.js').read_text()
    print('PASS: PC/mobile build separation, recorder preservation, history assignment, legacy guard removal')

ADAPTER=r'''
window.alert=s=>{throw new Error(s)};
const letter=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
function add(ws,rows,origin='A1'){
 const m=origin.match(/^([A-Z]+)(\d+)$/);let sc=0;for(const c of m[1])sc=sc*26+c.charCodeAt(0)-64;sc--;
 rows.forEach((row,ri)=>row.forEach((v,ci)=>{if(v!==null&&v!==undefined)ws[letter(sc+ci)+(Number(m[2])+ri)]={t:typeof v==='number'?'n':'s',v};}));return ws;
}
window.XLSX={utils:{book_new:()=>({SheetNames:[],Sheets:{}}),aoa_to_sheet:a=>add({},a),sheet_add_aoa:(w,a,o)=>add(w,a,o.origin),book_append_sheet:(w,s,n)=>{w.SheetNames.push(n);w.Sheets[n]=s;}},writeFile:(w,name)=>{window.captured={w,name};}};
'''
report={'id':'test-report-id','number':'RC-TEST-0001','revision':0,'state':'issued','document':{
 'number':'RC-TEST-0001','revision':0,'issued_at':'2026-09-30T12:00:00Z',
 'client':{'name':'Cliente TEST','site':'Sito TEST','display':'Cliente TEST'},
 'project':{'code':'TEST-01','name':'Commessa dimostrativa','order_ref':'TEST-OFF'},
 'period_from':'2026-09-01','period_to':'2026-09-30',
 'header':{'issuer':'GON srl','summary':'TEST ONLY','notes':'','contact':'','recipient_contact':'','recipient_address':'','deliverables':'','logo':''},
 'activities':[{'id':'e1','ref':1,'date':'2026-09-10','description':'=FORMULA_LIKE_TEXT','macro':'Rilievo in campo','type':'Cantiere','hours':2.25}],
 'lines':[{'id':'l1','refs':[1],'description':'=FORMULA_LIKE_TEXT','quantity':2.25,'unit':'h','price':60,'amount':135,'mode':'hour','terms_reference':'TEST-OFF','round_minutes':0,'round_mode':'none','reason':'INTERNAL_REASON_SECRET'}],
 'expenses':[{'description':'TEST EXPENSE','reference':'TEST','amount':10}],
 'discount_percent':5,'totals':{'services':135,'discount':6.75,'expenses':10,'net':138.25,'missing_rates':0}}}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox'])
    page=browser.new_page()
    code=(ROOT/'assets/client-document.js').read_text()
    page.set_content('<html><body><script>'+ADAPTER+'</script><script>'+code+'</script></body></html>')
    page.evaluate('r=>GonClientDocument.excel(r)',report)
    data=page.evaluate('captured')
    assert data['w']['SheetNames']==['Sintesi','Valorizzazione','Attivita']
    s=data['w']['Sheets']['Valorizzazione']
    assert s['F5']=={'t':'n','f':'ROUND(D5*E5,2)','v':135,'z':'#,##0.00'}
    assert s['F7']['f']=='SUM(F5:F5)' and s['F9']['v']==6.75
    assert s['F11']['v']==138.25 and s['F11']['f']=='F7-F9+F10'
    assert s['B5']['t']=='s' and 'f' not in s['B5']
    html=page.evaluate('r=>GonClientDocument.buildHtml(r)',report)
    assert 'INTERNAL_REASON_SECRET' not in html and html.count('class="sheet"')==3
    report['document']['header']['summary']='<img src=x onerror=BAD()>'
    html=page.evaluate('r=>GonClientDocument.buildHtml(r)',report)
    assert '&lt;img' in html and '<img src=x' not in html
    report['document']['totals']['net']=None
    report['document']['lines'][0]['price']=None
    report['document']['lines'][0]['amount']=None
    page.evaluate('r=>GonClientDocument.excel(r)',report)
    data=page.evaluate('captured')
    assert data['w']['Sheets']['Sintesi']['B6']['v']=='Da definire'
    assert 'F5' not in data['w']['Sheets']['Valorizzazione']
    browser.close()
print('PASS: three workbook models, cached formulas/decimals, missing rates, strings not formulas, HTML escaping, no internal edit reasons')
