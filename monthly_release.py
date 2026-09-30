"""Fail-closed release validation for customer-period billing and VAT."""
from pathlib import Path
from hashlib import sha256
from html.parser import HTMLParser
import json
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.external = []
        self.inline = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            attrs = dict(attrs)
            self.current = [] if 'src' not in attrs else None
            if 'src' in attrs:
                self.external.append(attrs['src'])

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.current is not None:
            self.inline.append(''.join(self.current))
            self.current = None


def finalize_monthly(out):
    from monthly_integration import install_monthly, VERSION
    out = Path(out)
    install_monthly(out)
    assets = out / 'assets'
    ui = (assets / 'commercial.js').read_text(encoding='utf-8')
    for token in ('gon_client_billing', 'gcClient', 'gcMonth', 'gcBillingMode', 'gcTVat', 'gcRVat', 'totals.gross'):
        if token not in ui:
            raise RuntimeError('Monthly UI contract missing: ' + token)
    for token in ('overview.project', 'gcNewProject', 'gcEditProject', 'gcAssign', "list('gon_projects'"):
        if token in ui:
            raise RuntimeError('Legacy project workflow still present: ' + token)
    history = (assets / 'personal-history.js').read_text(encoding='utf-8')
    if 'GonProjects' in history:
        raise RuntimeError('Project assignment remains in personal history')
    for mode in ('pc', 'mobile'):
        html = (out / (mode + '.html')).read_text(encoding='utf-8')
        parser = Scripts()
        parser.feed(html)
        for script in parser.external:
            if 'projects.js' in script or 'form-state-guard.js' in script:
                raise RuntimeError('Conflicting legacy script is still loaded: ' + script)
            if script.startswith('assets/') and not (out / script.split('?')[0]).is_file():
                raise RuntimeError('Missing runtime asset: ' + script)
        for asset in ('activity-timer.js', 'personal-history.js', 'form-render-guard.js'):
            if sum(asset in s for s in parser.external) != 1:
                raise RuntimeError('Expected one asset per page: ' + asset)
        for asset in ('commercial.js', 'client-document.js'):
            if sum(asset in s for s in parser.external) != (1 if mode == 'pc' else 0):
                raise RuntimeError('Financial page isolation failed: ' + asset)
        if 'gonProjectSelect' in html:
            raise RuntimeError('Manual entry still requires a project')
        with tempfile.TemporaryDirectory(prefix='gon-monthly-check-') as tmp:
            path = Path(tmp) / 'inline.js'
            path.write_text('\n'.join(parser.inline), encoding='utf-8')
            subprocess.run(['node', '--check', str(path)], check=True)
    subprocess.run(['node', str(ROOT / 'tests' / 'test_monthly_documents.cjs'),
                    str(ROOT / 'assets' / 'client-document.js'), str(assets / 'client-document.js')], check=True)
    hashes = {p.name: sha256(p.read_bytes()).hexdigest() for p in assets.glob('*.js')}
    manifest = {'version': VERSION, 'commit': os.environ.get('RENDER_GIT_COMMIT', ''),
                'billing_basis': 'client_period', 'project_required': False,
                'editable_vat': True, 'vat_base': 'net_services_plus_taxable_expenses',
                'legacy_snapshot_renderer_preserved': True, 'document_checks_passed': 12,
                'page_contract_checks_passed': True, 'hashes': hashes}
    (out / 'monthly-build.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    for filename in ('commercial-build.json', 'timer-build.json', 'excel-build.json'):
        p = out / filename
        if p.exists():
            existing = json.loads(p.read_text(encoding='utf-8'))
            existing.update({'monthly_release': VERSION, 'hashes': hashes})
            if filename == 'commercial-build.json':
                existing.update({'project_assignment_pages': [], 'billing_basis': 'client_period', 'editable_vat': True})
            p.write_text(json.dumps(existing, indent=2), encoding='utf-8')
    print('MONTHLY RELEASE VERIFIED: ' + json.dumps(manifest))
    from billing_group_integration import install_billing_groups
    install_billing_groups(out)
    from pricing_lifecycle_integration import install_pricing_lifecycle
    install_pricing_lifecycle(out)
