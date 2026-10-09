"""Final shared registry stage. No connections to business data during builds."""
from pathlib import Path
from hashlib import sha256
import json, os, re, subprocess
ROOT=Path(__file__).resolve().parent
VERSION='registry-1.0.0'
PAGE='''<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; connect-src https://sdlvcpxxgsmvoailtbtz.supabase.co; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'"><title>GON Management | Anagrafiche condivise</title><link rel="stylesheet" href="assets/registry.css?v=registry-1.0.0"></head><body class="gmr"><main class="gmr-standalone"><header class="gmr-head"><div class="gmr-bar"><div><strong>GON</strong><p>MANAGEMENT / Engineering + Topography</p></div><a href="pc.html">Torna alla rendicontazione</a></div><h1>Anagrafiche condivise</h1><p>Modulo amministrativo online. Clienti e siti reali, senza doppie registrazioni.</p></header><section class="gmr-card gmr-login" id="login-card"><h2>Accesso amministratore</h2><p>Usa le credenziali GON della rendicontazione. La sessione di questo modulo rimane soltanto in memoria.</p><form id="master-login" method="post"><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><label class="gmr-check"><input type="checkbox" required> Confermo l'accesso all'ARCHIVIO OPERATIVO GON. Non inseriro dati di prova.</label><button type="submit" class="primary">Accedi alle anagrafiche operative</button></form></section><div id="login-status" class="gmr-status" role="status"></div><section class="gmr-card" id="session-bar" hidden><div class="gmr-bar"><span id="session-email"></span><button id="master-logout" type="button">Esci dal modulo</button></div><p class="gmr-muted">Le modifiche riguardano soltanto l'anagrafica condivisa, non le ore o i documenti. Le copie nel gestionale locale si aggiornano da Anagrafiche condivise.</p></section><div id="master-root" hidden></div></main><script src="assets/registry-ui.js?v=registry-1.0.0"></script><script src="assets/registry-online.js?v=registry-1.0.0"></script></body></html>'''

def install_registry(out):
    out=Path(out);assets=out/'assets'
    names=('registry-ui.js','registry-online.js','registry-readonly.js','registry.css')
    for name in names:
        (assets/name).write_bytes((ROOT/'assets'/name).read_bytes())
        if name.endswith('.js'):subprocess.run(['node','--check',str(assets/name)],check=True)
    path=out/'pc.html';s=path.read_text(encoding='utf-8')
    pattern=r'<script\b[^>]*src="assets/customer-registry-v2\.js[^\"]*"[^>]*>\s*</script>'
    s,n=re.subn(pattern,'<script src="assets/registry-readonly.js?v='+VERSION+'"></script>',s)
    if n!=1:raise RuntimeError('Registry stage: expected exactly one old editor script')
    path.write_text(s,encoding='utf-8')
    active_filter={}
    for mode in ('pc','mobile'):
        text=(out/(mode+'.html')).read_text(encoding='utf-8')
        active_filter[mode]=bool(re.search(r"\.eq\(\s*['\"]active['\"]\s*,\s*true\s*\)",text))
        if not active_filter[mode]:raise RuntimeError('Active client filter not verified in '+mode+'; do not publish')
    (out/'gestionale-clienti.html').write_text(PAGE,encoding='utf-8')
    manifest={'version':VERSION,'commit':os.environ.get('RENDER_GIT_COMMIT',os.environ.get('GITHUB_SHA','')),'timesheet_registry_readonly':True,'active_client_filter':active_filter,'hashes':{name:sha256((assets/name).read_bytes()).hexdigest() for name in names}}
    (out/'registry-build.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('REGISTRY BUILD VERIFIED: '+json.dumps(manifest))
