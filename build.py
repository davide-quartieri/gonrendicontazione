from pathlib import Path
from urllib.request import Request, urlopen

BASE = 'https://sdlvcpxxgsmvoailtbtz.supabase.co/storage/v1/object/public/gon-rendicontazione-web'
OUT = Path('public')
OUT.mkdir(exist_ok=True)

REMEMBER_HTML = '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:#475467"><input id="remember" type="checkbox" checked style="width:18px;height:18px;min-width:18px;padding:0"> Ricorda accesso su questo dispositivo</label>'

PATCH = r'''<script>
(function(){
  function setupRemember(){
    const cb=document.getElementById('remember'), em=document.getElementById('email'), pw=document.getElementById('pass'), li=document.getElementById('login'), su=document.getElementById('signup');
    if(!cb||!em||!pw||!li||!su) return;
    const keep=localStorage.getItem('gon_remember')!=='0';
    cb.checked=keep;
    if(keep && localStorage.getItem('gon_email')) em.value=localStorage.getItem('gon_email');
    async function savePreference(){
      if(cb.checked){
        localStorage.setItem('gon_remember','1');
        localStorage.setItem('gon_email',em.value.trim());
        try{
          if('credentials' in navigator && window.PasswordCredential && pw.value){
            await navigator.credentials.store(new PasswordCredential({id:em.value.trim(),password:pw.value,name:em.value.trim()}));
          }
        }catch(e){}
      }else{
        localStorage.setItem('gon_remember','0');
        localStorage.removeItem('gon_email');
      }
    }
    li.addEventListener('click',savePreference,true);
    su.addEventListener('click',savePreference,true);
    if(keep && 'credentials' in navigator){
      navigator.credentials.get({password:true,mediation:'optional'}).then(c=>{
        if(c){ em.value=c.id||em.value; if(c.password) pw.value=c.password; }
      }).catch(()=>{});
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',setupRemember); else setupRemember();
})();
</script>'''

def download(name):
    req=Request(f'{BASE}/{name}', headers={'User-Agent':'GON-Render-Build/1.0'})
    with urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8')

def patch(html, mode):
    html=html.replace(f"const MODE='{mode}',URL=", f"const MODE='{mode}',SUPABASE_URL=")
    html=html.replace('supabase.createClient(URL,KEY,', 'supabase.createClient(SUPABASE_URL,KEY,')
    html=html.replace('<input id="email" type="email" autocomplete="username"', '<input id="email" name="username" type="email" autocomplete="username"')
    html=html.replace('<input id="pass" type="password" autocomplete="current-password">', '<input id="pass" name="password" type="password" autocomplete="current-password">'+REMEMBER_HTML)
    html=html.replace('</body>', PATCH+'</body>')
    return html

for mode in ('pc','mobile'):
    html=patch(download(f'{mode}.html'), mode)
    (OUT/f'{mode}.html').write_text(html, encoding='utf-8')

Path('public/index.html').write_text(Path('index.html').read_text(encoding='utf-8'), encoding='utf-8')
print('GON Rendicontazione build completata')
