"""Integrate timer, form-state protection, and personal-history assets."""
from hashlib import sha256
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import tempfile

VERSION = 'timer-1.1.1'
FORM_GUARD_VERSION = 'form-state-guard-1.1.0'
HISTORY_VERSION = 'personal-history-1.0.0'


def _script_tag(filename: str, version: str) -> str:
    return f'<script src="assets/{filename}?v={version}"></script>\n'


def _install_tag(html: str, filename: str, version: str) -> str:
    tag = _script_tag(filename, version)
    if filename in html:
        pattern = rf'<script\b[^>]*\bsrc=["\x27][^"\x27]*{re.escape(filename)}[^"\x27]*["\x27][^>]*>\s*</script>'
        html, count = re.subn(pattern, lambda _: tag, html, flags=re.IGNORECASE)
        if count != 1:
            raise RuntimeError(f'Expected exactly one {filename} asset tag')
        return html
    return html.replace('</body>', tag + '</body>', 1)


def patch_page(html: str) -> str:
    for token in ('id="ore"', 'async function loadCurrentProfile()', '</body>'):
        if token not in html:
            raise RuntimeError(f'Integration: required base marker missing: {token}')
    html = html.replace('created_by:user.id', 'created_by:currentUser.id')
    html = _install_tag(html, 'form-state-guard.js', FORM_GUARD_VERSION)
    html = _install_tag(html, 'personal-history.js', HISTORY_VERSION)
    html = _install_tag(html, 'activity-timer.js', VERSION)
    return html


def validate_js(html: str, label: str) -> None:
    node = shutil.which('node')
    if not node:
        print(f'BUILD: node unavailable; inline syntax check skipped for {label}')
        return
    scripts = re.findall(r'<script\b([^>]*)>([\s\S]*?)</script>', html, re.IGNORECASE)
    inline = '\n'.join(code for attrs, code in scripts if not re.search(r'\bsrc\s*=', attrs, re.I))
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / f'{label}.js'
        path.write_text(inline, encoding='utf-8')
        result = subprocess.run([node, '--check', str(path)], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(f'JavaScript check failed for {label}: {result.stderr}')


def install_timer(out: Path) -> None:
    asset_specs = {
        'activity-timer.js': (VERSION, f"const VERSION = '{VERSION}'"),
        'form-state-guard.js': (FORM_GUARD_VERSION, f"const VERSION='{FORM_GUARD_VERSION}'"),
        'personal-history.js': (HISTORY_VERSION, f"const VERSION='{HISTORY_VERSION}'"),
    }
    root = Path(__file__).resolve().parent
    target = out / 'assets'
    target.mkdir(parents=True, exist_ok=True)
    node = shutil.which('node')
    hashes = {}
    for name, (_version, marker) in asset_specs.items():
        source = root / 'assets' / name
        if not source.is_file():
            raise RuntimeError(f'Asset missing from repository: {name}')
        js = source.read_text(encoding='utf-8')
        if marker not in js:
            raise RuntimeError(f'JavaScript version mismatch for {name}')
        if node:
            subprocess.run([node, '--check', str(source)], check=True)
        shutil.copy2(source, target / name)
        hashes[name] = sha256(source.read_bytes()).hexdigest()
    for mode in ('pc', 'mobile'):
        path = out / f'{mode}.html'
        html = patch_page(path.read_text(encoding='utf-8'))
        validate_js(html, mode)
        path.write_text(html, encoding='utf-8')
    manifest = {
        'feature': 'gon-ui-integrations',
        'commit': os.environ.get('RENDER_GIT_COMMIT', ''),
        'timer_version': VERSION,
        'form_guard_version': FORM_GUARD_VERSION,
        'personal_history_version': HISTORY_VERSION,
        'hashes': hashes,
        'inline_syntax_checked': bool(node),
        'recorder_pages': ['mobile.html'],
        'timer_management_pages': ['pc.html', 'mobile.html'],
        'personal_history_pages': ['pc.html', 'mobile.html'],
        'form_state_guard_pages': ['pc.html', 'mobile.html'],
        'supports_incomplete_timer_deletion': True,
    }
    (out / 'timer-build.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('GON UI BUILD: ' + json.dumps(manifest))
    from report_integration import install_reports
    install_reports(out)
    from commercial_integration import install_commercial
    install_commercial(out)
