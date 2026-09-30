"""Integrate isolated commercial/assignment modules after the existing export build."""
from pathlib import Path
from hashlib import sha256
from html.parser import HTMLParser
import json
import os
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
VERSION = 'commercial-1.0.0'


def replace_one(source, old, new, label):
    if source.count(old) != 1:
        raise RuntimeError(f'{label}: expected one known base marker, got {source.count(old)}')
    return source.replace(old, new, 1)


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.external = []
        self.inline = []
        self.in_script = False
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'script':
            a = dict(attrs)
            self.in_script = True
            self.current = [] if 'src' not in a else None
            if 'src' in a:
                self.external.append(a['src'])

    def handle_data(self, data):
        if self.in_script and self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == 'script':
            if self.current is not None:
                self.inline.append(''.join(self.current))
            self.in_script = False
            self.current = None


def install_commercial(out):
    out = Path(out)
    assets = out / 'assets'
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node required for commercial integration checks')
    macros = json.loads((ROOT / 'macroareas.json').read_text(encoding='utf-8'))
    if len(macros) != 8 or len(set(macros)) != 8:
        raise RuntimeError('Unexpected macroarea catalog')
    for filename in ('projects.js', 'commercial.js', 'client-document.js', 'form-render-guard.js'):
        js = (ROOT / 'assets' / filename).read_text(encoding='utf-8')
        if filename == 'commercial.js':
            js = replace_one(js, 'const MACROS = [];', 'const MACROS = ' + json.dumps(macros, ensure_ascii=False) + ';', filename)
        path = assets / filename
        path.write_text(js, encoding='utf-8')
        subprocess.run([node, '--check', str(path)], check=True)
    history = assets / 'personal-history.js'
    js = history.read_text(encoding='utf-8')
    js = replace_one(js, "id,date,employee,client,type", "id,date,employee,client,project_id,type", 'history fields')
    js = replace_one(js, 'card.append(b);list.append(card);',
                     "card.append(b);const pb=make('button','Commessa','btn light');pb.type='button';pb.style.marginLeft='8px';pb.onclick=()=>window.GonProjects.editAssignment(row.id);card.append(pb,make('p',window.GonProjects?.label(row.project_id)||'Commessa da assegnare','gon-history-meta'));list.append(card);",
                     'history assignment action')
    history.write_text(js, encoding='utf-8')
    subprocess.run([node, '--check', str(history)], check=True)
    for mode in ('pc', 'mobile'):
        path = out / f'{mode}.html'
        html = path.read_text(encoding='utf-8')
        # Add only operational project_id to the existing manual-entry payload.
        needle = "hours:+$('hours').value"
        html = replace_one(html, needle, needle + ",project_id:(document.getElementById('gonProjectSelect')?.value||null)", f'{mode} manual entry')
        pattern = r'<script\b[^>]*\bsrc="[^"\n]*form-state-guard\.js[^"\n]*"[^>]*>\s*</script>'
        html, count = re.subn(pattern, '<script src="assets/form-render-guard.js?v=' + VERSION + '"></script>', html)
        if count != 1:
            raise RuntimeError(f'{mode}: old asynchronous draft guard not removed')
        html, count = re.subn(r'(personal-history\.js\?v=[^"\s]+)', lambda m: m.group(1) + '-' + VERSION, html)
        if count != 1:
            raise RuntimeError('History tag not found')
        tags = f'<script src="assets/projects.js?v={VERSION}"></script>\n'
        if mode == 'pc':
            tags += f'<script src="assets/client-document.js?v={VERSION}"></script>\n<script src="assets/commercial.js?v={VERSION}"></script>\n'
        html = replace_one(html, '</body>', tags + '</body>', f'{mode} closing body')
        parser = Scripts()
        parser.feed(html)
        if any('form-state-guard.js' in x for x in parser.external):
            raise RuntimeError('Conflicting draft guard still loaded')
        for src in parser.external:
            if src.startswith('assets/') and not (out / src.split('?')[0]).is_file():
                raise RuntimeError('Missing asset: ' + src)
        with tempfile.TemporaryDirectory() as temp:
            check = Path(temp) / 'inline.js'
            check.write_text('\n'.join(parser.inline), encoding='utf-8')
            subprocess.run([node, '--check', str(check)], check=True)
        path.write_text(html, encoding='utf-8')
    manifest = {'version': VERSION, 'commit': os.environ.get('RENDER_GIT_COMMIT', ''),
                'admin_pages': ['pc.html'], 'project_assignment_pages': ['pc.html', 'mobile.html'],
                'financial_storage': 'private', 'demo_rates': False,
                'html_snapshot_print': True, 'xlsx_economic_copy': True,
                'hashes': {p.name: sha256(p.read_bytes()).hexdigest() for p in assets.glob('*.js')}}
    (out / 'commercial-build.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('COMMERCIAL BUILD: ' + json.dumps(manifest))
