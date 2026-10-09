/* GON Management: operational master. Authorization is enforced by the database. */
(()=>{'use strict';
 const BASE='https://sdlvcpxxgsmvoailtbtz.supabase.co',KEY='sb_publishable_TB5gydHYLJ0qSTevQ9FsOA_epidzwsT';
 let access='',user=null,expires=0,editor=null;
 const q=s=>document.querySelector(s),message=(s,error=false)=>{q('#login-status').textContent=s;q('#login-status').classList.toggle('gmr-error',error);};
 async function request(path,body,anonymous=false){
  if(!anonymous&&(!access||Date.now()>=expires))throw Error('Sessione scaduta. Accedi nuovamente senza creare un secondo cliente.');
  const headers={apikey:KEY,Accept:'application/json'};if(!anonymous)headers.Authorization='Bearer '+access;
  if(body!==undefined)headers['Content-Type']='application/json';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
  try{
   const r=await fetch(BASE+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'});
   const result=await r.json();if(!r.ok)throw Error(anonymous?'Accesso non riuscito. Verifica credenziali e conferma account.':String(result.message||'Operazione non consentita.').slice(0,700));return result;
  }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('Connessione interrotta. Un salvataggio potrebbe essere stato eseguito: riprova lo stesso pulsante senza creare un altro cliente.');throw e;}finally{clearTimeout(timeout);}
 }
 function rpc(action,payload={}){return request('/rest/v1/rpc/gon_management_registry',{p_action:action,p_payload:payload,p_expected_user:user.id});}
 function logout(){
  if(editor?.isBusy())return;if(editor?.isDirty()&&!confirm('Abbandonare le modifiche non salvate?'))return;
  if(editor)editor.dispose();editor=null;access='';user=null;expires=0;
  q('#master-root').replaceChildren();q('#master-root').hidden=true;q('#login-card').hidden=false;q('#session-bar').hidden=true;message('Sessione locale chiusa. Nessuna credenziale salvata dal modulo.');
 }
 q('#master-login').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;const b=f.querySelector('button');b.disabled=true;
  const email=f.elements.email.value.trim(),password=f.elements.password.value;f.elements.password.value='';message('Verifica accesso...');
  try{
   const r=await request('/auth/v1/token?grant_type=password',{email,password},true);
   if(typeof r.access_token!=='string')throw Error('Risposta accesso non valida.');access=r.access_token;expires=Date.now()+(Math.min(Number(r.expires_in)||3600,3600)-30)*1000;
   user=await request('/auth/v1/user');
   const profile=await request('/rest/v1/user_profiles?select=role,role_confirmed&user_id=eq.'+encodeURIComponent(user.id));
   if(profile.length!==1||profile[0].role!=='admin'||profile[0].role_confirmed!==true)throw Error('Modulo riservato agli amministratori GON confermati.');
   q('#login-card').hidden=true;q('#session-bar').hidden=false;q('#session-email').textContent=user.email;
   q('#master-root').hidden=false;editor=GonMasterUI.mount(q('#master-root'),{list:()=>rpc('list'),save:p=>rpc('save',p)});message('');
  }catch(err){access='';user=null;expires=0;message(err.message,true);}finally{b.disabled=false;}
 };
 q('#master-logout').onclick=logout;
 // No localStorage, cookies, refresh-token persistence, credentials in URLs, or sample data.
})();
