from pathlib import Path
from urllib.request import Request, urlopen
import re

BASE = 'https://sdlvcpxxgsmvoailtbtz.supabase.co/storage/v1/object/public/gon-rendicontazione-web'
OUT = Path('public')
OUT.mkdir(exist_ok=True)

REMEMBER_HTML = '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:#475467"><input id="remember" type="checkbox" checked style="width:18px;height:18px;min-width:18px;padding:0"> Ricorda accesso su questo dispositivo</label>'

USER_STATUS_HTML = '''<div id="userStatus" class="head-user" title="Utente connesso">
  <span id="statusDot" class="status-dot syncing" aria-hidden="true"></span>
  <div class="head-user-copy">
    <strong id="userName">Utente</strong>
    <small id="userRole">User</small>
  </div>
</div>'''

STATUS_CSS = r'''
.head{position:relative}
.head-user{margin-left:auto;display:flex;align-items:center;gap:9px;min-width:0;color:#fff;text-align:left}\n.head-user.floating-user-status{position:fixed;top:12px;right:12px;z-index:9999;background:#155f96;padding:8px 10px;border-radius:12px;box-shadow:0 8px 24px #0003}
.head-user-copy{display:flex;flex-direction:column;min-width:0;line-height:1.15}
.head-user-copy strong{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.head-user-copy small{font-size:11px;opacity:.82;margin-top:2px}
.status-dot{width:10px;height:10px;min-width:10px;border-radius:50%;display:inline-block;animation:gonBlink 1.15s ease-in-out infinite;box-shadow:0 0 0 3px rgba(255,255,255,.12)}
.status-dot.online{background:#35d07f}
.status-dot.syncing{background:#ffd24a}
.status-dot.offline{background:#ff5b62}
.admin-only.role-hidden{display:none!important}
@keyframes gonBlink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.78)}}
@media(max-width:760px){
  .head{padding-top:54px!important}
  .head-user{position:absolute;right:13px;top:12px;max-width:calc(100% - 26px)}
  .head-user-copy strong{max-width:190px;font-size:12px}
  .head-user-copy small{font-size:10px}
}
'''

RUNTIME_HELPERS = r'''
let currentUser=null,currentRole='user';
function setConnectionStatus(state,label){
  const dot=$('statusDot'),sync=$('sync');
  if(dot){dot.classList.remove('online','syncing','offline');dot.classList.add(state)}
  if(sync&&label)sync.textContent=label;
}
function gonDisplayName(user,profile){
  const p=(profile&&profile.display_name||'').trim();
  if(p)return p;
  const m=user&&user.user_metadata||{};
  return (m.full_name||m.name||m.display_name||(user&&user.email?user.email.split('@')[0]:'Utente')).trim();
}
function applyRoleUI(){
  const admin=currentRole==='admin';
  document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('role-hidden',!admin));
  if(typeof MODE!=='undefined' && MODE==='pc'){
    ['stats','tabs','luigi','clienti','report'].forEach(id=>{
      const el=$(id); if(el) el.classList.toggle('role-hidden',!admin);
    });
    document.querySelectorAll('h2').forEach(h=>{
      if((h.textContent||'').trim()==='Ultime attività'){
        const card=h.closest('.card'); if(card) card.classList.toggle('role-hidden',!admin);
      }
    });
  }
  if(typeof MODE!=='undefined' && MODE==='mobile'){
    const stats=$('stats'); if(stats) stats.style.setProperty('display','none','important');
  }
  const role=$('userRole');if(role)role.textContent=admin?'Amministratore':'User';
}
function updateUserStatus(profile){
  const name=$('userName');
  if(name){name.textContent=gonDisplayName(currentUser,profile);name.title=currentUser&&currentUser.email||''}
  applyRoleUI();
}
async function loadCurrentProfile(){
  const result=await db.auth.getUser();
  currentUser=result&&result.data&&result.data.user||null;
  if(!currentUser){currentRole='user';updateUserStatus(null);return}
  let profile=null;
  try{
    const q=await db.from('user_profiles').select('display_name,role').eq('user_id',currentUser.id).maybeSingle();
    if(!q.error&&q.data){profile=q.data}
    else if(!q.error&&!q.data){
      const display=gonDisplayName(currentUser,null);
      const ins=await db.from('user_profiles').insert({user_id:currentUser.id,display_name:display,role:'user'}).select('display_name,role').maybeSingle();
      if(!ins.error&&ins.data)profile=ins.data;
    }
  }catch(e){console.warn('Profilo utente non disponibile',e)}
  currentRole=profile&&profile.role==='admin'?'admin':'user';
  updateUserStatus(profile);
}
window.addEventListener('online',()=>{setConnectionStatus('syncing','Riconnessione...');if(db)load(true)});
window.addEventListener('offline',()=>setConnectionStatus('offline','Offline'));
'''

REMEMBER_PATCH = r'''<script>
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
    req=Request(f'{BASE}/{name}', headers={'User-Agent':'GON-Render-Build/2.0'})
    with urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8')

def patch_common(html, mode):
    html=html.replace(f"const MODE='{mode}',URL=", f"const MODE='{mode}',SUPABASE_URL=")
    html=html.replace('supabase.createClient(URL,KEY,', 'supabase.createClient(SUPABASE_URL,KEY,')

    html=html.replace('<input id="email" type="email" autocomplete="username"', '<input id="email" name="username" type="email" autocomplete="username"')
    html=html.replace('<input id="pass" type="password" autocomplete="current-password">', '<input id="pass" name="password" type="password" autocomplete="current-password">'+REMEMBER_HTML)

    if 'id="userStatus"' not in html:
        if '</header>' in html:
            html=html.replace('</header>', USER_STATUS_HTML+'</header>', 1)
        else:
            floating=USER_STATUS_HTML.replace('class="head-user"', 'class="head-user floating-user-status"')
            html=html.replace('<body>', '<body>'+floating, 1)
    if 'status-dot' not in html.split('</style>',1)[0]:
        html=html.replace('</style>', STATUS_CSS+'</style>', 1)

    if 'currentRole=' not in html:
        marker="let db,clients=[],entries=[],ocrRows=[],timer;"
        if marker in html:
            html=html.replace(marker, marker+'\n'+RUNTIME_HELPERS, 1)
        else:
            html=html.replace('async function enter(){', RUNTIME_HELPERS+'\nasync function enter(){', 1)

    old_enter="async function enter(){showAuth(false);$('employee').value=localStorage.getItem('gon_employee')||'';await load();clearInterval(timer);timer=setInterval(()=>load(true),15000)}"
    new_enter="async function enter(){showAuth(false);await loadCurrentProfile();$('employee').value=localStorage.getItem('gon_employee')||gonDisplayName(currentUser,null)||'';setConnectionStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'Sincronizzazione...':'Offline');await load();clearInterval(timer);timer=setInterval(()=>load(true),15000)}"
    if old_enter in html:
        html=html.replace(old_enter,new_enter,1)
    else:
        html=re.sub(r"async function enter\(\)\{showAuth\(false\);.*?timer=setInterval\(\(\)=>load\(true\),15000\)\}",new_enter,html,count=1,flags=re.S)

    html=html.replace("$('sync').textContent='Sincronizzazione...'", "setConnectionStatus('syncing','Sincronizzazione...')")
    html=html.replace("$('sync').textContent='Errore connessione'", "setConnectionStatus('offline','Errore connessione')")
    html=html.replace("$('sync').textContent='Cloud sincronizzato'", "setConnectionStatus('online','Cloud sincronizzato')")
    html=html.replace('async function addEntry(){', "async function addEntry(){setConnectionStatus('syncing','Salvataggio...');", 1)
    html=html.replace('async function flush(){', "async function flush(){setConnectionStatus('syncing','Sincronizzazione...');", 1)
    html=html.replace('async function addClient(){', "async function addClient(){setConnectionStatus('syncing','Salvataggio...');", 1)

    html=html.replace('</body>', REMEMBER_PATCH+'</body>')
    return html

def patch_pc(html):
    html=html.replace('<div id="stats" class="stats"></div>', '<div id="stats" class="stats admin-only"></div>', 1)
    html=html.replace('<nav id="tabs" class="tabs pc-only">', '<nav id="tabs" class="tabs pc-only admin-only">', 1)
    html=html.replace('<section id="luigi" class="panel pc-only">', '<section id="luigi" class="panel pc-only admin-only">', 1)
    html=html.replace('<section id="clienti" class="panel pc-only">', '<section id="clienti" class="panel pc-only admin-only">', 1)
    html=html.replace('<section id="report" class="panel pc-only">', '<section id="report" class="panel pc-only admin-only">', 1)
    html=html.replace('<div class="card"><h2>Ultime attività</h2>', '<div class="card admin-only"><h2>Ultime attività</h2>', 1)
    return html

def patch_mobile(html):
    html=html.replace('<div id="stats" class="stats"></div>', '<div id="stats" class="stats" style="display:none!important"></div>', 1)
    return html

def patch(html, mode):
    html=patch_common(html,mode)
    return patch_pc(html) if mode=='pc' else patch_mobile(html)

for mode in ('pc','mobile'):
    html=patch(download(f'{mode}.html'), mode)
    (OUT/f'{mode}.html').write_text(html, encoding='utf-8')

Path('public/index.html').write_text(Path('index.html').read_text(encoding='utf-8'), encoding='utf-8')
print('GON Rendicontazione build v2 completata')
