/* GON timer 1.1: mobile recorder; PC/mobile management. Manual entry is unchanged.
 * Compatible with the v1 per-account outbox. Deletion intents are durable and
 * server tombstones prevent late uploads from recreating deleted activities.
 */
(() => {
  'use strict';
  const VERSION = 'timer-1.1.0';
  const MOBILE = typeof MODE !== 'undefined' && MODE === 'mobile';
  const PREFIX = 'gon.activityTimer.v1.';
  const TYPES = ['Cantiere', 'Viaggio', 'Ufficio'];
  const MACROS = ['Rilievo in campo', 'Elaborazione rilievo', 'Assistenza cliente', 'Attivit\u00e0 amministrative', 'Corso', 'Varie'];
  const $ = id => document.getElementById(id);
  const client = () => { try { return typeof db !== 'undefined' ? db : null; } catch { return null; } };
  let actor=null, epoch=0, syncing=false, fetching=false, rpcBusy=0;
  let root=null, panel=null, dialog=null, rows=[], customers=[];
  let message='', isError=false, lastConnection={state:'syncing',label:'Verifica connessione...'};
  const duration = n => { const s=Math.max(0,Math.floor(n));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':'); };
  const stamp = s => new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(s));
  const key = id => PREFIX+id;
  function read(id) {
    const raw=localStorage.getItem(key(id));
    const s=raw?JSON.parse(raw):{version:1,active:null,queue:[],deletions:[]};
    if(s.version!==1 || !Array.isArray(s.queue))throw new Error('Dati timer locali non leggibili. Non cancellare i dati del browser.');
    if(s.deletions===undefined)s.deletions=[];
    if(!Array.isArray(s.deletions))throw new Error('Coda eliminazioni non leggibile.');
    return s;
  }
  function write(id,s) { const raw=JSON.stringify(s);localStorage.setItem(key(id),raw);if(localStorage.getItem(key(id))!==raw)throw new Error('Salvataggio locale non riuscito.'); }
  async function lock(id,fn) { return navigator.locks?navigator.locks.request(key(id),fn):fn(); }
  async function change(id,fn) { await lock(id,()=>{const s=read(id);fn(s);write(id,s);}); }
  function errorText(e) { return e?.message || 'Connessione interrotta. Le operazioni restano sul dispositivo.'; }
  function notice(text,error=false) { message=text;isError=error;renderNotice(); }
  function renderNotice() {
    const el=$('gonTimerMessage');if(el){el.textContent=message;el.classList.toggle('timer-error',isError);}
    if(panel)panel.hidden=!actor || (!rows.length && !message && !hasPending());
  }
  function hasPending() { try { const s=actor?read(actor.id):null;return Boolean(s&&(s.queue.length||s.deletions.length)); }catch{return false;} }
  function connection() {
    if(!window.gonTimerOriginalStatus)return;
    let {state,label}=lastConnection;
    if(!navigator.onLine){state='offline';label='Offline';}
    else if(rpcBusy){state='syncing';label='Sincronizzazione timer...';}
    else if(hasPending()){state='offline';label='Operazioni timer da sincronizzare';}
    window.gonTimerOriginalStatus(state,label);
  }
  async function rpc(name,args) {
    if(!actor||!client())throw new Error('Accesso richiesto.');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    rpcBusy++;connection();
    try {
      const r=await client().rpc(name,args).abortSignal(controller.signal);if(r.error)throw r.error;
      const value=Array.isArray(r.data)?r.data[0]:r.data;
      if(!value?.id)throw new Error('Salvataggio non confermato dal server.');
      return value;
    }finally{clearTimeout(timeout);rpcBusy--;connection();}
  }
  function button(text,action,danger=false) {
    const b=document.createElement('button');b.type='button';b.className=danger?'btn danger':'btn light';b.textContent=text;b.onclick=action;return b;
  }
  function options(el,items,placeholder,value) {
    el.replaceChildren();if(placeholder!==null)el.add(new Option(placeholder,''));
    items.forEach(x=>el.add(new Option(x,x)));if(items.includes(value))el.value=value;
  }
  function mount() {
    const section=$('ore');if(!section||$('gonTimerDrafts'))return false;
    const style=document.createElement('style');style.textContent=`
      .gon-timer{border-left:4px solid #155f96!important}.timer-clock{font:700 36px/1.3 ui-monospace,monospace;margin:10px 0}
      .timer-top{display:flex;justify-content:space-between;gap:12px}.timer-top h2{margin:0!important}
      .timer-fields{display:grid;grid-template-columns:1fr 2fr;gap:12px;margin:12px 0}
      .timer-buttons,.timer-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}.timer-buttons button{flex:1;min-height:44px}
      .timer-note{font-size:13px;color:#667085;margin:8px 0}.timer-error{color:#b42318!important}
      .timer-row{border:1px solid #d9e2ec;border-radius:12px;padding:12px;margin:10px 0}.timer-row p{margin:6px 0;font-size:13px;color:#475467}
      .timer-dialog{width:min(540px,calc(100% - 24px));max-height:90dvh;border:0;border-radius:18px;padding:22px;color:#182232}
      .timer-dialog::backdrop{background:#10182899}.timer-dialog .field{margin:12px 0}.timer-dialog select,.timer-dialog textarea{width:100%}
      .timer-dialog textarea{min-height:100px}.timer-actions button:disabled,.gon-timer button:disabled{opacity:.55;cursor:wait}
      @media(max-width:760px){.timer-fields{grid-template-columns:1fr}.timer-actions button{width:auto;flex:1}}
      @media(prefers-reduced-motion:reduce){.status-dot{animation:none!important}}
    `;document.head.append(style);
    panel=document.createElement('div');panel.id='gonTimerDrafts';panel.className='card';panel.hidden=true;
    panel.innerHTML='<h2>Attivit\u00e0 registrate con timer</h2><p class="timer-note">Ultime 250 attivit\u00e0: puoi eliminare anche quelle non ancora completate.</p><p id="gonTimerMessage" class="timer-note" role="status" aria-live="polite"></p><div id="gonTimerDraftList"></div><button id="gonTimerRetry" class="btn light" type="button" hidden>Riprova sincronizzazione</button>';
    section.prepend(panel);$('gonTimerRetry').onclick=()=>sync();
    // No timer clock, start or stop controls are mounted on PC.
    if(MOBILE){
      root=document.createElement('div');root.id='gonActivityTimer';root.className='card gon-timer';root.hidden=true;
      root.innerHTML=`<div class="timer-top"><h2>Timer attivit\u00e0</h2><span class="timer-note">Facoltativo</span></div>
        <div id="gonTimerClock" class="timer-clock" role="timer">00:00:00</div><p id="gonTimerStarted" class="timer-note"></p>
        <div class="timer-fields"><div class="field"><label for="gonTimerType">Tipo ore</label><select id="gonTimerType"></select></div>
        <div class="field"><label for="gonTimerClient">Cliente / cantiere (facoltativo)</label><select id="gonTimerClient"></select></div></div>
        <div class="timer-buttons"><button id="gonTimerStart" type="button" class="btn ok">Avvia timer</button><button id="gonTimerStop" type="button" class="btn danger" hidden>Ferma e crea attivit\u00e0</button></div>
        <p class="timer-note">Nessuna registrazione automatica senza avvio. Per separare viaggio e lavoro, ferma il timer e avviane uno nuovo. Nessuna pausa viene sottratta.</p>`;
      section.prepend(root);options($('gonTimerType'),TYPES,null,'Cantiere');options($('gonTimerClient'),[],'Lo indicher\u00f2 dopo','');
      $('gonTimerStart').onclick=start;$('gonTimerStop').onclick=stop;
    }
    makeDialog();return true;
  }
  function renderClock() {
    if(!root)return;root.hidden=!actor;if(!actor)return;
    try {
      const a=read(actor.id).active;
      $('gonTimerStart').hidden=Boolean(a);$('gonTimerStop').hidden=!a;
      $('gonTimerType').disabled=$('gonTimerClient').disabled=Boolean(a);
      $('gonTimerClock').textContent=a?duration((Date.now()-Date.parse(a.started_at))/1000):'00:00:00';
      $('gonTimerStarted').textContent=a?`Iniziato il ${stamp(a.started_at)} \u00b7 ${a.type}${a.client?' \u00b7 '+a.client:''}`:'Timer fermo. L\u2019inserimento manuale resta indipendente.';
      if(a)$('gonTimerType').value=a.type;
    }catch(e){notice(errorText(e),true);$('gonTimerStart').disabled=true;}
  }
  async function start() {
    if(!MOBILE||!actor)return;
    const owner=actor.id,b=$('gonTimerStart');b.disabled=true;
    try {
      await change(owner,s=>{
        if(actor?.id!==owner)throw new Error('Account cambiato.');
        if(s.active)return;
        s.active={timer_id:crypto.randomUUID(),started_at:new Date(Math.floor(Date.now()/1000)*1000).toISOString(),type:$('gonTimerType').value,client:$('gonTimerClient').value};
      });
      notice('Timer avviato. Puoi bloccare lo schermo: riapri nello stesso browser e con lo stesso account per fermarlo.');
    }catch(e){notice(errorText(e),true);}finally{b.disabled=false;renderClock();}
  }
  async function stop() {
    if(!MOBILE||!actor)return;
    const owner=actor.id,b=$('gonTimerStop');b.disabled=true;
    try {
      await change(owner,s=>{
        if(actor?.id!==owner)throw new Error('Account cambiato.');if(!s.active)return;
        const a=Date.parse(s.active.started_at),now=Date.now();if(now<a)throw new Error('Controlla l\u2019orologio del telefono.');
        const stopped={...s.active,stopped_at:new Date(Math.max(a+1000,Math.floor(now/1000)*1000)).toISOString()};
        if(!s.queue.some(x=>x.timer_id===stopped.timer_id))s.queue.push(stopped);
        s.active=null;
      });
      notice('Timer fermato e conservato sul dispositivo.');render();await sync();
    }catch(e){notice(errorText(e),true);}finally{b.disabled=false;renderClock();}
  }
  async function requestDelete(entryId) {
    if(!actor)return;
    if(!confirm('Eliminare questa attivit\u00e0 da timer? Anche se incompleta, verranno eliminati il tempo registrato e gli eventuali dettagli.'))return;
    const owner=actor.id,version=epoch;
    try {
      await change(owner,s=>{
        if(actor?.id!==owner)throw new Error('Account cambiato.');
        if(!s.deletions.some(x=>x.id===entryId))s.deletions.push({id:entryId});
        s.queue=s.queue.filter(x=>'timer_'+x.timer_id!==entryId);
      });
      if(version!==epoch)return;
      if(dialog.open&&dialog.dataset.entryId===entryId)dialog.close();
      notice(navigator.onLine?'Eliminazione in corso...':'Eliminazione conservata sul dispositivo: verr\u00e0 sincronizzata alla riconnessione.');
      render();await sync();
    }catch(e){if(version===epoch)notice(errorText(e),true);}
  }
  async function sync() {
    if(syncing||!actor||!navigator.onLine){connection();return;}
    const owner=actor.id,version=epoch,valid=()=>actor?.id===owner&&epoch===version;
    syncing=true;
    let changed=false;
    async function deletions() {
      for(const item of read(owner).deletions.slice()){
        if(!valid())return;
        await rpc('gon_delete_timer',{p_entry_id:item.id,p_expected_user:owner});
        await change(owner,s=>{s.deletions=s.deletions.filter(x=>x.id!==item.id);s.queue=s.queue.filter(x=>'timer_'+x.timer_id!==item.id);});
        if(valid()){rows=rows.filter(x=>x.id!==item.id);notice('Attivit\u00e0 da timer eliminata.');changed=true;}
      }
    }
    try {
      await deletions();
      for(const item of read(owner).queue.slice()){
        if(!valid())break;
        const current=read(owner);
        if(current.deletions.some(x=>x.id==='timer_'+item.timer_id)||!current.queue.some(x=>x.timer_id===item.timer_id))continue;
        let cancelled=false;
        try {
          await rpc('gon_save_timer',{p_timer_id:item.timer_id,p_started_at:item.started_at,p_stopped_at:item.stopped_at,p_expected_user:owner,p_type:item.type,p_client:item.client||''});
        }catch(e){if(e?.code==='P0002'&&String(e.message).includes('GON_TIMER_DELETED'))cancelled=true;else throw e;}
        await change(owner,s=>{s.queue=s.queue.filter(x=>x.timer_id!==item.timer_id);});
        if(valid()){changed=true;if(!read(owner).deletions.length)notice(cancelled?'Attivit\u00e0 gi\u00e0 eliminata: non verr\u00e0 ricreata.':'Attivit\u00e0 creata. Puoi completare i dettagli pi\u00f9 tardi.');}
      }
      // A delete can arrive while a save is in flight. Always drain it afterwards.
      await deletions();
      if(valid()){await refresh();if(changed&&typeof load==='function'){try{await load(true);}catch{}}}
    }catch(e){if(valid())notice('Sincronizzazione non completata. Operazioni conservate. '+errorText(e),true);}
    finally{syncing=false;if(valid()){render();connection();}}
  }
  async function refresh() {
    if(fetching||!actor||!client()||!navigator.onLine)return;
    const version=epoch;fetching=true;const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),15000);
    try {
      const [r,c]=await Promise.all([
        client().from('entries').select('id,date,employee,client,type,macro,description,hours,created_by,entry_source,timer_started_at,timer_stopped_at,duration_seconds,needs_details').eq('entry_source','timer').order('date',{ascending:false}).order('timer_started_at',{ascending:false}).limit(250).abortSignal(abort.signal),
        client().from('clients').select('display').eq('active',true).order('display').abortSignal(abort.signal)]);
      if(r.error||c.error)throw r.error||c.error;if(version!==epoch)return;
      rows=r.data||[];customers=(c.data||[]).map(x=>x.display);
      if(root){const selected=$('gonTimerClient').value;options($('gonTimerClient'),customers,'Lo indicher\u00f2 dopo',selected);}
      lastConnection={state:'online',label:'Cloud sincronizzato'};render();connection();
    }catch(e){if(version===epoch){lastConnection={state:'offline',label:'Cloud non raggiungibile'};connection();}}
    finally{clearTimeout(timeout);fetching=false;}
  }
  function render() {
    renderClock();if(!panel)return;if(!actor){panel.hidden=true;return;}
    try {
      const s=read(actor.id),list=$('gonTimerDraftList'),deleting=new Set(s.deletions.map(x=>x.id));list.replaceChildren();
      const queued=new Set(s.queue.map(x=>'timer_'+x.timer_id));
      const addRow=(id,title,detail,canComplete,row)=>{
        const el=document.createElement('div');el.className='timer-row';el.dataset.entryId=id;
        const h=document.createElement('strong');h.textContent=title;const p=document.createElement('p');p.textContent=detail;el.append(h,p);
        const actions=document.createElement('div');actions.className='timer-actions';
        if(canComplete)actions.append(button('Completa dettagli',()=>openDetails(row)));
        actions.append(button('Elimina',()=>requestDelete(id),true));el.append(actions);list.append(el);
      };
      s.queue.filter(x=>!deleting.has('timer_'+x.timer_id)).forEach(x=>addRow('timer_'+x.timer_id,`${stamp(x.started_at)} \u00b7 ${duration((Date.parse(x.stopped_at)-Date.parse(x.started_at))/1000)}`,`${x.type} \u00b7 ${x.client||'Cliente da indicare'} \u2014 Da sincronizzare`,false,null));
      rows.filter(x=>!deleting.has(x.id)&&!queued.has(x.id)).forEach(x=>addRow(x.id,`${stamp(x.timer_started_at)} \u00b7 ${duration(x.duration_seconds)}`,`${x.employee} \u00b7 ${x.type} \u00b7 ${x.client||'Cliente da indicare'} \u2014 ${x.needs_details?'Da completare':'Completata'}`,x.needs_details,x));
      if(s.deletions.length){const p=document.createElement('p');p.className='timer-note';p.textContent=`${s.deletions.length} eliminazioni da sincronizzare. Le attivit\u00e0 non saranno reinviate.`;list.append(p);}
      $('gonTimerRetry').hidden=!(s.queue.length||s.deletions.length);renderNotice();
    }catch(e){notice(errorText(e),true);}
  }
  function makeDialog() {
    dialog=document.createElement('dialog');dialog.id='gonTimerDetailDialog';dialog.className='timer-dialog';
    dialog.innerHTML=`<form id="gonTimerDetailForm"><h2>Completa attivit\u00e0 da timer</h2><p id="gonTimerDetailPeriod" class="timer-note"></p>
      <div class="field"><label for="gonTimerDetailClient">Cliente / cantiere</label><select id="gonTimerDetailClient" required></select></div>
      <div class="field"><label for="gonTimerDetailType">Tipo ore</label><select id="gonTimerDetailType" required></select></div>
      <div class="field"><label for="gonTimerDetailMacro">Macro area</label><select id="gonTimerDetailMacro" required></select></div>
      <div class="field"><label for="gonTimerDetailText">Descrizione</label><textarea id="gonTimerDetailText" required maxlength="4000"></textarea></div>
      <p id="gonTimerDetailError" class="timer-note timer-error" role="alert"></p><div class="timer-buttons"><button id="gonTimerDetailLater" type="button" class="btn light">Pi\u00f9 tardi</button><button id="gonTimerDetailSave" type="submit" class="btn ok">Salva dettagli</button></div></form>`;
    document.body.append(dialog);options($('gonTimerDetailType'),TYPES,null,'Cantiere');options($('gonTimerDetailMacro'),MACROS,null,'Varie');
    $('gonTimerDetailLater').onclick=()=>dialog.close();$('gonTimerDetailForm').onsubmit=saveDetails;
  }
  function openDetails(row) {
    if(!actor)return;dialog.dataset.entryId=row.id;
    $('gonTimerDetailPeriod').textContent=`${stamp(row.timer_started_at)} \u2192 ${stamp(row.timer_stopped_at)} \u00b7 ${duration(row.duration_seconds)}. Il tempo misurato resta invariato.`;
    options($('gonTimerDetailClient'),customers,'Seleziona cliente',row.client);$('gonTimerDetailType').value=row.type;$('gonTimerDetailMacro').value=row.macro;$('gonTimerDetailText').value='';$('gonTimerDetailError').textContent='';dialog.showModal();
  }
  async function saveDetails(e) {
    e.preventDefault();if(!actor||!navigator.onLine){$('gonTimerDetailError').textContent='Per salvare i dettagli occorre la connessione.';return;}
    const version=epoch,b=$('gonTimerDetailSave');b.disabled=true;
    try {
      await rpc('gon_complete_timer',{p_entry_id:dialog.dataset.entryId,p_expected_user:actor.id,p_client:$('gonTimerDetailClient').value,p_type:$('gonTimerDetailType').value,p_macro:$('gonTimerDetailMacro').value,p_description:$('gonTimerDetailText').value.trim()});
      if(version!==epoch)return;dialog.close();notice('Dettagli salvati.');await refresh();if(typeof load==='function'){try{await load(true);}catch{}}
    }catch(e){if(version===epoch)$('gonTimerDetailError').textContent=errorText(e);}finally{b.disabled=false;}
  }
  function changedSession(session) {
    const next=session?.user||null;if(next?.id===actor?.id)return;
    epoch++;actor=next;rows=[];customers=[];message='';isError=false;if(dialog?.open)dialog.close();render();connection();
    if(actor)setTimeout(()=>sync(),0);
  }
  async function boot() {
    if(!mount())return;
    if(typeof setConnectionStatus==='function'){window.gonTimerOriginalStatus=setConnectionStatus;setConnectionStatus=function(state,label){lastConnection={state,label};connection();};}
    // Route timer deletions in the legacy register to the same safe operation.
    if(typeof delEntry==='function'){
      const originalDelete=delEntry;
      delEntry=async function(id){if(/^timer_[0-9a-f-]{36}$/.test(id))return requestDelete(id);return originalDelete(id);};window.delEntry=delEntry;
    }
    const c=client();if(!c)return;
    c.auth.onAuthStateChange((_event,session)=>changedSession(session));
    try{const r=await c.auth.getSession();changedSession(r.data.session);}catch(e){notice(errorText(e),true);}
    if(MOBILE)setInterval(renderClock,1000);
    setInterval(()=>{if(actor)sync();},15000);
    window.addEventListener('online',()=>sync());window.addEventListener('offline',connection);
    window.addEventListener('storage',e=>{if(actor&&e.key===key(actor.id)){render();connection();}});
    window.addEventListener('pageshow',()=>{render();if(actor)sync();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();if(actor)sync();}});
  }
  window.GonActivityTimer=Object.freeze({version:VERSION,mobileRecorder:MOBILE});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
