"""Post-build integration: Excel export, canonical macroareas and template checks."""
from pathlib import Path
from hashlib import sha256
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

VERSION = 'excel-report-1.0.0'
MACRO_VERSION = 'macroareas-20260930'
ROOT = Path(__file__).resolve().parent


def replace_macros(text: str, macros: list[str], label: str) -> str:
    pattern = r'(\bMACROS\s*=\s*)\[[^\]]*\]'
    result, count = re.subn(pattern, lambda m: m.group(1) + json.dumps(macros, ensure_ascii=False), text)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one macroarea catalog, got {count}')
    return result


def install_reports(out: Path) -> None:
    macros = json.loads((ROOT / 'macroareas.json').read_text(encoding='utf-8'))
    if len(macros) != 8 or len(set(macros)) != 8:
        raise RuntimeError('Expected eight distinct macroareas')
    assets = out / 'assets'
    assets.mkdir(parents=True, exist_ok=True)
    for filename in ('activity-timer.js', 'personal-history.js'):
        path = assets / filename
        path.write_text(replace_macros(path.read_text(encoding='utf-8'), macros, filename), encoding='utf-8')
    shutil.copy2(ROOT / 'assets' / 'excel-report.js', assets / 'excel-report.js')
    p = assets / 'excel-report.js'
    p.write_text(replace_macros(p.read_text(encoding='utf-8'), macros, p.name), encoding='utf-8')
    for mode in ('pc', 'mobile'):
        p = out / f'{mode}.html'
        html = replace_macros(p.read_text(encoding='utf-8'), macros, p.name)
        for filename in ('activity-timer.js', 'personal-history.js'):
            html = re.sub(rf'({re.escape(filename)}\?v=[^"\s<]+)', lambda m: m.group(1) + '-' + MACRO_VERSION, html)
        if mode == 'pc':
            if 'id="excel"' not in html or 'excel-report.js' in html:
                raise RuntimeError('Unexpected Excel button/script structure')
            html = html.replace('</body>', f'<script src="assets/excel-report.js?v={VERSION}"></script>\n</body>', 1)
        p.write_text(html, encoding='utf-8')
    # Dependencies are needed only to build a static, data-free workbook template.
    env = os.environ.copy()
    with tempfile.TemporaryDirectory(prefix='gon-excel-build-') as deps:
        if not (importlib.util.find_spec('openpyxl') and importlib.util.find_spec('PIL')):
            subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--only-binary=:all:', '--target', deps,
                            'openpyxl==3.1.5', 'Pillow==12.0.0'], check=True)
            env['PYTHONPATH'] = deps + os.pathsep + env.get('PYTHONPATH', '')
        subprocess.run([sys.executable, str(ROOT / 'excel_template.py'), str(out.resolve())], check=True, env=env)
    template = json.loads((assets / 'report-template.json').read_text(encoding='utf-8'))
    parts = template['parts']
    if template['version'] != VERSION or len([n for n in parts if re.match(r'xl/charts/chart\d+\.xml$', n)]) != 2:
        raise RuntimeError('Invalid chart/template manifest')
    if not all(f'xl/worksheets/sheet{i}.xml' in parts for i in range(1, 5)):
        raise RuntimeError('Missing Excel worksheet')
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node is required for syntax validation before publication')
    for p in assets.glob('*.js'):
        subprocess.run([node, '--check', str(p)], check=True)
    for mode in ('pc','mobile'):
        html = (out / f'{mode}.html').read_text(encoding='utf-8')
        scripts = re.findall(r'<script\b([^>]*)>([\s\S]*?)</script>', html, re.I)
        inline = '\n'.join(s for attrs,s in scripts if not re.search(r'\bsrc\s*=', attrs, re.I))
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'inline.js';p.write_text(inline,encoding='utf-8')
            subprocess.run([node,'--check',str(p)],check=True)
    hashes={p.name:sha256(p.read_bytes()).hexdigest() for p in assets.glob('*.js')}
    manifest={'version':VERSION,'commit':os.environ.get('RENDER_GIT_COMMIT',''),'macroareas':macros,'sheets':['Dashboard','Attivita','Macroaree','Clienti'],'native_charts':2,'logo_from_application':True,'client_side_export':True,'hashes':hashes}
    (out/'excel-build.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    timer_path=out/'timer-build.json'
    if timer_path.exists():
        timer_manifest=json.loads(timer_path.read_text());timer_manifest['macroarea_catalog']=MACRO_VERSION;timer_manifest['hashes']=hashes
        timer_path.write_text(json.dumps(timer_manifest,indent=2),encoding='utf-8')
    print('EXCEL BUILD: '+json.dumps(manifest,ensure_ascii=False))
