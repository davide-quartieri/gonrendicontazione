"""Integrate the mobile recorder and PC/mobile timer activity management.
Fail on structural drift instead of publishing a silently incomplete build.
"""
from hashlib import sha256
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import tempfile

VERSION = 'timer-1.1.0'


def patch_page(html: str) -> str:
    for token in ('id="ore"', 'async function loadCurrentProfile()', '</body>'):
        if token not in html:
            raise RuntimeError(f'Timer integration: required base marker missing: {token}')
    # The role-aware enter() initializes currentUser, not the legacy user variable.
    html = html.replace('created_by:user.id', 'created_by:currentUser.id')
    script = f'<script src="assets/activity-timer.js?v={VERSION}"></script>\n'
    if 'activity-timer.js' in html:
        pattern = r'<script\b[^>]*\bsrc=[\"\x27][^\"\x27]*activity-timer\.js[^\"\x27]*[\"\x27][^>]*>\s*</script>'
        html, count = re.subn(pattern, lambda _: script, html, flags=re.IGNORECASE)
        if count != 1:
            raise RuntimeError('Expected exactly one timer asset tag')
        return html
    return html.replace('</body>', script + '</body>', 1)


def validate_js(html: str, label: str) -> None:
    node = shutil.which('node')
    if not node:
        print(f'TIMER: node unavailable; inline syntax check skipped for {label}')
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
    source = Path(__file__).resolve().parent / 'assets' / 'activity-timer.js'
    if not source.is_file():
        raise RuntimeError('Timer asset missing from repository')
    js = source.read_text(encoding='utf-8')
    if f"const VERSION = '{VERSION}';" not in js:
        raise RuntimeError('Timer JavaScript version does not match integration version')
    target = out / 'assets'
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target / source.name)
    node = shutil.which('node')
    if node:
        subprocess.run([node, '--check', str(source)], check=True)
    for mode in ('pc', 'mobile'):
        path = out / f'{mode}.html'
        html = patch_page(path.read_text(encoding='utf-8'))
        validate_js(html, mode)
        path.write_text(html, encoding='utf-8')
    manifest = {
        'feature': 'optional-activity-timer',
        'version': VERSION,
        'commit': os.environ.get('RENDER_GIT_COMMIT', ''),
        'asset_sha256': sha256(source.read_bytes()).hexdigest(),
        'inline_syntax_checked': bool(node),
        'recorder_pages': ['mobile.html'],
        'management_pages': ['pc.html', 'mobile.html'],
        'supports_incomplete_deletion': True,
        'pages': ['pc.html', 'mobile.html'],
    }
    (out / 'timer-build.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('TIMER BUILD: ' + json.dumps(manifest))
