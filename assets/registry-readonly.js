/* Preserve legacy DOM references used by the base timesheet renderer. */
(()=>{'use strict';
 let root=null,busy=false;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function refresh(){
  if(!root||busy)return;
  if(typeof db==='undefined'||!db||typeof currentRole==='undefined'||currentRole!=='admin'){root.querySelector('[data-list]').replaceChildren();return;}
  busy=true;const status=root.querySelector('[data-status]');status.textContent='Aggiornamento elenco...';
  try{const r=await db.from('clients').select('id,main,site,display,active').order('main').order('display');if(r.error)throw r.error;
   if(currentRole!=='admin'){root.querySelector('[data-list]').replaceChildren();return;}
   root.querySelector('[data-list]').innerHTML=(r.data||[]).map(c=>`<div style="padding:12px 0;border-top:1px solid #d5e1ed"><strong>${esc(c.display)}</strong><span style="float:right">${c.active?'Disponibile':'Disattivato'}</span><div style="color:#64748b;font-size:13px">${esc(c.main)}${c.site?' / '+esc(c.site):''}</div></div>`).join('')||'<p>Nessun sito presente.</p>';
   status.textContent='Elenco condiviso aggiornato. Per inserire o modificare clienti e cantieri apri GON Management.';
  }catch(e){status.textContent=e.message||'Elenco non disponibile. Riprovare.';}finally{busy=false;}
 }
 function boot(){
  const section=document.getElementById('clienti');if(!section)return;
  // Do not remove old inputs: the existing application still reads their IDs.
  for(const child of section.children){child.hidden=true;child.style.setProperty('display','none','important');child.setAttribute('aria-hidden','true');}
  root=document.createElement('div');root.className='card';root.id='gonManagementRegistryLink';
  root.innerHTML='<h2>Anagrafiche condivise</h2><p>Clienti e cantieri si gestiscono nel modulo anagrafiche di <strong>GON Management</strong>. La rendicontazione utilizza questo elenco per il campo Cliente / Cantiere.</p><p><a class="btn" href="gestionale-clienti.html" target="_blank" rel="noopener noreferrer">Apri anagrafiche in GON Management</a> <button type="button" class="btn light" data-refresh>Aggiorna elenco</button></p><p data-status role="status" style="color:#64748b;font-size:13px">Accedi come amministratore per consultare la lista.</p><div data-list></div><p style="font-size:13px;color:#64748b">I siti disattivati restano nello storico. Per aggiornare il campo Cliente / Cantiere, attendi la sincronizzazione o ricarica la pagina dopo aver salvato eventuali ore in compilazione.</p>';
  section.prepend(root);root.querySelector('[data-refresh]').onclick=refresh;refresh();
  document.addEventListener('gon:data-refreshed',refresh);
 }
 window.GonCustomerRegistry=Object.freeze({version:'management-readonly-1.0.0',refresh});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
