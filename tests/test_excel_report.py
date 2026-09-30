"""Run after python build.py. Requires playwright, Chromium and openpyxl.
All test data is synthetic; no credentials, external requests or production writes.
"""
from pathlib import Path
import base64
import json
import math
import os
import tempfile
import zipfile
from xml.etree import ElementTree
from playwright.sync_api import sync_playwright
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
MODEL = json.loads((ROOT/'public/assets/report-template.json').read_text(encoding='utf-8'))
MACROS = json.loads((ROOT/'macroareas.json').read_text(encoding='utf-8'))
DATA = [dict(id=f'test_{i}',date=f'2026-09-{21+i:02}',employee='Utente dimostrativo',
             client=['Cliente Alfa','Cliente Beta'][i%2],type=['Cantiere','Viaggio','Ufficio'][i%3],macro=m,
             description='Dati fittizi: nessuna attivita reale',hours=[4,2,3.5,1,6,2.5,5,3][i],
             entry_source='manual',needs_details=False) for i,m in enumerate(MACROS)]
DATA += [dict(id='test_timer',date='2026-09-29',employee='Utente dimostrativo',client='',type='Cantiere',
              macro='Varie',description='Da completare',hours=0.000278,entry_source='timer',duration_seconds=1,needs_details=True),
         dict(id='test_special',date='2026-09-30',employee='Utente dimostrativo',client='Cliente * ? ~ & <>',type='Ufficio',
              macro=MACROS[-1],description='=WEBSERVICE("https://example.invalid")',hours=1.25,entry_source='manual',needs_details=False)]

with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page();page.set_content('<!doctype html><html><body></body></html>')
    page.add_script_tag(path=str(ROOT/'public/assets/excel-report.js'))
    for label,rows in [('sample',DATA),('empty',[])]:
        encoded=page.evaluate('''async ({template,rows}) => {
          const blob=GonExcelReport.createWorkbook(template,rows,{example:true,from:'2026-09-01',to:'2026-09-30'});
          const bytes=new Uint8Array(await blob.arrayBuffer());let s='';
          for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
          return btoa(s);
        }''',{'template':MODEL,'rows':rows})
        path=Path(tmp)/(label+'.xlsx');path.write_bytes(base64.b64decode(encoded))
        with zipfile.ZipFile(path) as z:
            assert z.testzip() is None
            for n in z.namelist():
                if n.endswith(('.xml','.rels')):ElementTree.fromstring(z.read(n))
        f=load_workbook(path,data_only=False);c=load_workbook(path,data_only=True)
        assert f.sheetnames==['Dashboard','Attivita','Macroaree','Clienti']
        assert len(f['Dashboard']._charts)==2
        assert all(len(sheet._images)==1 for sheet in f)
        assert c['Dashboard']['F11'].value==len(rows)
        assert math.isclose(c['Dashboard']['B11'].value,round(sum(x['hours'] for x in rows),6),abs_tol=1e-6)
        assert f['Attivita'].freeze_panes=='D9'
        for sheet in c:
            for row in sheet:
                for cell in row:assert cell.data_type!='e'
        if rows:
            assert c['Dashboard']['N11'].value==1
            assert c['Dashboard']['J11'].value==3
            assert f['Attivita']['F18'].data_type=='s'
            assert f['Attivita']['F18'].value.startswith('=WEBSERVICE')
            assert [c['Macroaree'][f'A{i}'].value for i in range(9,17)]==MACROS
        print('PASS',label,'ZIP/XML, 4 sheets, 2 charts, logo, totals, dates, literal strings and macroareas')
    browser.close()
