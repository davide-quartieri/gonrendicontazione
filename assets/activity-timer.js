/* GON optional activity timer v1. No manual-entry workflow is replaced.
 * Started/stopped timestamps, not background interval ticks, are authoritative.
 * A per-user durable outbox is written BEFORE any network request.
 */
(() => {
  'use strict';
  const VERSION = 'timer-1.0.0';
  const PREFIX = 'gon.activityTimer.v1.';
  const TYPES = ['Cantiere', 'Viaggio', 'Ufficio'];
  const MACROS = ['Rilievo in campo', 'Elaborazione rilievo', 'Assistenza cliente', 'Attivit\u00e0 amministrative', 'Corso', 'Varie'];
  let actor = null, generation = 0, rpcBusy = 0, sending = false, fetching = false;
  let remoteRows = [], customerRows = [], lastError = '', root, drafts, dialog;
  let authSubscription, lastConnection = {state: 'syncing', label: 'Verifica connessione...'};
  const byId = id => document.getElementById(id);
  const api = () => { try { return typeof db !== 'undefined' ? db : null; } catch { return null; } };
  const key = id => PREFIX + id;
  const emptyState = () => ({version: 1, active: null, queue: []});
  const formatDuration = seconds => {
    const s = Math.max(0, Math.floor(seconds));
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
  };
  const timeLabel = iso => new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso));

  function readState(id) {
    const raw = localStorage.getItem(key(id));
    if (!raw) return emptyState();
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.queue)) throw new Error('Dati timer locali non leggibili. Non cancellare i dati del browser.');
    return value;
  }
  function writeState(id, value) {
    const raw = JSON.stringify(value);
    localStorage.setItem(key(id), raw);
    if (localStorage.getItem(key(id)) !== raw) throw new Error('Impossibile conservare il timer su questo dispositivo.');
  }
  // Web Locks coordinate PC/mobile tabs opened in the same browser/origin.
  async function locked(id, callback) {
    if (navigator.locks) return navigator.locks.request(key(id), callback);
    return callback(); // Server idempotency still protects repeated saves.
  }
  function notice(text, error = false) {
    const target = byId('gonTimerMessage');
    if (target) { target.textContent = text; target.classList.toggle('timer-error', error); }
  }
  function updateConnection() {
    if (!window.gonTimerOriginalStatus) return;
    let state = lastConnection.state, label = lastConnection.label;
    if (!navigator.onLine) { state = 'offline'; label = 'Offline'; }
    else if (rpcBusy) { state = 'syncing'; label = 'Sincronizzazione timer...'; }
    else if (actor) {
      try {
        if (readState(actor.id).queue.length) { state = 'offline'; label = 'Timer in attesa di sincronizzazione'; }
      } catch { state = 'offline'; label = 'Errore memoria locale timer'; }
    }
    window.gonTimerOriginalStatus(state, label);
  }
  function installConnectionHook() {
    if (typeof setConnectionStatus !== 'function') return;
    window.gonTimerOriginalStatus = setConnectionStatus;
    setConnectionStatus = function(state, label) {
      lastConnection = {state, label}; updateConnection();
    };
  }
  async function callRpc(name, args) {
    const c = api();
    if (!c || !actor) throw new Error('Accedi per salvare il timer.');
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    rpcBusy++; updateConnection();
    try {
      const result = await c.rpc(name, args).abortSignal(abort.signal);
      if (result.error) throw result.error;
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row || !row.id) throw new Error('Il server non ha confermato il salvataggio.');
      return row;
    } finally { clearTimeout(timeout); rpcBusy--; updateConnection(); }
  }
  function errorMessage(e) {
    if (e && e.code === 'PGRST202') return 'Aggiornamento timer del database non disponibile. Riprova pi\u00f9 tardi.';
    if (e && e.code === '42501') return 'Accesso non autorizzato o sessione scaduta. Esci e accedi con lo stesso account.';
    return e?.message || 'Connessione interrotta: il timer resta salvato su questo dispositivo.';
  }
  function mount() {
    const ore = byId('ore');
    if (!ore || byId('gonActivityTimer')) return;
    const css = document.createElement('style');
    css.textContent = `
      .gon-timer{border-left:4px solid #155f96!important}
      .gon-timer .timer-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
      .gon-timer h2{margin:0!important}.timer-optional{font-size:12px;color:#667085}
      .timer-clock{font:700 40px/1.3 ui-monospace,monospace;letter-spacing:1px;margin:10px 0}
      .timer-fields{display:grid;grid-template-columns:1fr 2fr;gap:10px;margin:12px 0}
      .timer-buttons{display:flex;gap:10px;flex-wrap:wrap}.timer-buttons button{flex:1;min-height:46px}
      .timer-note{font-size:13px;color:#667085;margin:9px 0 0}.timer-error{color:#b42318!important}
      .timer-running{color:#155f96}.timer-row{border:1px solid #d9e2ec;border-radius:12px;padding:12px;margin-top:10px}
      .timer-row-top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-weight:700}
      .timer-row p{font-size:13px;margin:6px 0;color:#475467}.timer-row button{margin-top:6px}
      .timer-dialog{width:min(540px,calc(100% - 24px));max-height:90dvh;border:0;border-radius:18px;padding:22px;color:#182232}
      .timer-dialog::backdrop{background:#10182899}.timer-dialog .field{margin-bottom:12px}
      .timer-dialog select,.timer-dialog textarea{width:100%}.timer-dialog h2{margin:0 0 12px}
      .timer-dialog .timer-buttons button{width:auto}.timer-dialog textarea{min-height:100px}
      .gon-timer button:disabled,.timer-dialog button:disabled{opacity:.55;cursor:wait}
      @media(max-width:760px){.timer-fields{grid-template-columns:1fr}.timer-clock{font-size:36px}.timer-row button{width:100%}}
      @media(prefers-reduced-motion:reduce){.status-dot{animation:none!important}}
    `;
    document.head.append(css);
    root = document.createElement('div'); root.id = 'gonActivityTimer'; root.className = 'card gon-timer';
    root.innerHTML = `
      <div class="timer-top"><h2>Timer attivit\u00e0</h2><span class="timer-optional">Facoltativo</span></div>
      <div id="gonTimerClock" class="timer-clock" role="timer" aria-label="Tempo trascorso">00:00:00</div>
      <p id="gonTimerStarted" class="timer-note">Avvia il timer solo quando vuoi registrare il tempo automaticamente.</p>
      <div class="timer-fields">
        <div class="field"><label for="gonTimerType">Tipo ore</label><select id="gonTimerType"></select></div>
        <div class="field"><label for="gonTimerClient">Cliente / cantiere (facoltativo)</label><select id="gonTimerClient"><option value="">Lo indicher\u00f2 dopo</option></select></div>
      </div>
      <div class="timer-buttons"><button id="gonTimerStart" class="btn ok" type="button">Avvia timer</button><button id="gonTimerStop" class="btn danger" type="button" hidden>Ferma e crea attivit\u00e0</button></div>
      <p id="gonTimerMessage" class="timer-note" role="status" aria-live="polite"></p>
      <p class="timer-note">Alla fine viene creata un'attivit\u00e0 da completare. Per cambiare tra viaggio e lavoro, ferma il timer e avviane uno nuovo. Nessuna pausa viene sottratta automaticamente.</p>`;
    TYPES.forEach(t => byIdFrom(root, 'gonTimerType').add(new Option(t, t)));
    drafts = document.createElement('div'); drafts.id = 'gonTimerDrafts'; drafts.className = 'card'; drafts.hidden = true;
    drafts.innerHTML = '<h2>Attivit\u00e0 da timer da completare</h2><div id="gonTimerDraftList"></div><button id="gonTimerRetry" class="btn light" type="button" hidden>Riprova sincronizzazione</button>';
    ore.prepend(drafts); ore.prepend(root);
    byId('gonTimerStart').addEventListener('click', startTimer);
    byId('gonTimerStop').addEventListener('click', stopTimer);
    byId('gonTimerRetry').addEventListener('click', () => syncQueue());
    createDialog();
  }
  function byIdFrom(parent, id) { return parent.querySelector('#' + id); }
  function setOptions(el, rows, placeholder, current) {
    el.replaceChildren(new Option(placeholder, ''));
    rows.forEach(value => el.add(new Option(value, value)));
    if (rows.includes(current)) el.value = current;
  }
  function renderClock() {
    if (!root) return;
    root.hidden = !actor;
    if (!actor) { drafts.hidden = true; return; }
    try {
      const state = readState(actor.id), active = state.active;
      byId('gonTimerStart').hidden = Boolean(active);
      byId('gonTimerStop').hidden = !active;
      byId('gonTimerType').disabled = Boolean(active);
      byId('gonTimerClient').disabled = Boolean(active);
      if (active) {
        const elapsed = Math.floor((Date.now() - Date.parse(active.started_at)) / 1000);
        byId('gonTimerClock').textContent = formatDuration(elapsed);
        byId('gonTimerClock').classList.add('timer-running');
        byId('gonTimerType').value = active.type;
        byId('gonTimerStarted').textContent = `Iniziato il ${timeLabel(active.started_at)} \u00b7 ${active.type}${active.client ? ' \u00b7 ' + active.client : ''}${elapsed > 43200 ? ' \u2014 Controlla: timer attivo da oltre 12 ore.' : ''}`;
      } else {
        byId('gonTimerClock').textContent = '00:00:00';
        byId('gonTimerClock').classList.remove('timer-running');
        byId('gonTimerStarted').textContent = 'Timer fermo. L\u2019inserimento manuale rimane indipendente.';
      }
    } catch (e) { notice(errorMessage(e), true); byId('gonTimerStart').disabled = true; }
  }
  async function startTimer() {
    if (!actor) return;
    const owner = actor.id;
    const btn = byId('gonTimerStart'); btn.disabled = true;
    try {
      await locked(owner, () => {
        if (actor?.id !== owner) throw new Error('Account cambiato. Riapri il timer con lo stesso account.');
        const state = readState(owner);
        if (state.active) return;
        if (!crypto.randomUUID) throw new Error('Apri il sito HTTPS con un browser aggiornato.');
        state.active = {timer_id: crypto.randomUUID(), started_at: new Date(Math.floor(Date.now()/1000)*1000).toISOString(),
          type: byId('gonTimerType').value, client: byId('gonTimerClient').value};
        writeState(owner, state);
      });
      notice('Timer avviato. Puoi bloccare lo schermo o chiudere questa pagina: riaprila nello stesso browser e con lo stesso account per fermarlo.');
    } catch (e) { notice(errorMessage(e), true); }
    finally { btn.disabled = false; renderClock(); }
  }
  async function stopTimer() {
    if (!actor) return;
    const owner = actor.id, btn = byId('gonTimerStop'); btn.disabled = true;
    try {
      await locked(owner, () => {
        if (actor?.id !== owner) throw new Error('Account cambiato. Riapri il timer con lo stesso account.');
        const state = readState(owner);
        if (!state.active) return;
        const start = Date.parse(state.active.started_at), now = Date.now();
        if (now < start) throw new Error('L\u2019orologio del dispositivo \u00e8 arretrato. Correggilo prima di fermare il timer.');
        const stopped = {...state.active, stopped_at: new Date(Math.max(start+1000,Math.floor(now/1000)*1000)).toISOString()};
        if (!state.queue.some(item => item.timer_id === stopped.timer_id)) state.queue.push(stopped);
        state.active = null;
        writeState(owner, state); // Atomic local transition. Do not clear before storage succeeds.
      });
      renderClock(); renderDrafts();
      notice(navigator.onLine ? 'Timer fermato. Salvataggio dell\u2019attivit\u00e0...' : 'Timer fermato e salvato su questo dispositivo. Sar\u00e0 inviato al ritorno della connessione.');
      await syncQueue();
    } catch (e) { notice(errorMessage(e), true); }
    finally { btn.disabled = false; renderClock(); }
  }
  async function syncQueue() {
    if (sending || !actor || !navigator.onLine) { updateConnection(); return; }
    const owner = actor.id, stamp = generation;
    sending = true;
    try {
      const queued = readState(owner).queue.slice();
      for (const item of queued) {
        if (stamp !== generation || !actor || actor.id !== owner) break;
        await callRpc('gon_save_timer', {p_timer_id: item.timer_id, p_started_at: item.started_at,
          p_stopped_at: item.stopped_at, p_expected_user: owner, p_type: item.type, p_client: item.client || ''});
        await locked(owner, () => {
          const state = readState(owner);
          state.queue = state.queue.filter(x => x.timer_id !== item.timer_id);
          writeState(owner, state);
        });
        if (stamp === generation) { lastError = ''; notice('Attivit\u00e0 creata. Puoi completarne i dettagli adesso o pi\u00f9 tardi.'); }
      }
      if (stamp === generation) await refreshDrafts();
    } catch (e) {
      if (stamp === generation) { lastError = errorMessage(e); notice('Invio non completato. Il timer \u00e8 conservato sul dispositivo. ' + lastError, true); }
    } finally {
      sending = false;
      if (stamp === generation) { renderDrafts(); updateConnection(); }
    }
  }
  async function refreshDrafts() {
    if (fetching || !actor || !navigator.onLine || !api()) return;
    const stamp = generation; fetching = true;
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(),15000);
    try {
      const [r,c] = await Promise.all([
        api().from('entries').select('id,date,employee,client,type,macro,description,hours,created_by,entry_source,timer_started_at,timer_stopped_at,duration_seconds,needs_details')
          .eq('entry_source','timer').eq('needs_details',true).order('date',{ascending:false}).limit(250).abortSignal(abort.signal),
        api().from('clients').select('display').eq('active',true).order('display').abortSignal(abort.signal)
      ]);
      if (r.error || c.error) throw r.error || c.error;
      if (stamp !== generation) return;
      remoteRows = r.data || []; customerRows = (c.data || []).map(x => x.display);
      const selected = byId('gonTimerClient').value;
      setOptions(byId('gonTimerClient'), customerRows, 'Lo indicher\u00f2 dopo', selected);
      lastConnection = {state:'online',label:'Cloud sincronizzato'};
      renderDrafts(); updateConnection();
    } catch (e) {
      if (stamp === generation) { lastConnection = {state:'offline',label:'Cloud non raggiungibile'}; updateConnection(); }
    } finally { clearTimeout(timeout); fetching = false; }
  }
  function rowElement(title, subtitle, label, action) {
    const row = document.createElement('div'); row.className = 'timer-row';
    const top = document.createElement('div'); top.className = 'timer-row-top'; top.textContent = title;
    const p = document.createElement('p'); p.textContent = subtitle;
    row.append(top,p);
    if (action) { const b = document.createElement('button'); b.type='button'; b.className='btn light'; b.textContent=label; b.onclick=action; row.append(b); }
    return row;
  }
  function renderDrafts() {
    if (!drafts || !actor) return;
    let queue;
    try { queue = readState(actor.id).queue; } catch(e) { notice(errorMessage(e),true); return; }
    const list = byId('gonTimerDraftList'); list.replaceChildren();
    const pendingIds = new Set(queue.map(x => 'timer_' + x.timer_id));
    queue.forEach(x => {
      const seconds = (Date.parse(x.stopped_at)-Date.parse(x.started_at))/1000;
      list.append(rowElement(`${timeLabel(x.started_at)} \u00b7 ${formatDuration(seconds)}`, `${x.type} \u00b7 ${x.client || 'Cliente da indicare'} \u2014 In attesa di sincronizzazione`, '', null));
    });
    remoteRows.filter(x => !pendingIds.has(x.id)).forEach(x => {
      list.append(rowElement(`${timeLabel(x.timer_started_at)} \u00b7 ${formatDuration(x.duration_seconds)}`,
        `${x.employee} \u00b7 ${x.type} \u00b7 ${x.client || 'Cliente da indicare'} \u2014 Da completare`, 'Completa dettagli', () => openDetails(x)));
    });
    drafts.hidden = !list.childElementCount;
    byId('gonTimerRetry').hidden = !queue.length;
    if (lastError && queue.length) { const p=document.createElement('p');p.className='timer-note timer-error';p.textContent=lastError;list.append(p); }
  }
  function createDialog() {
    dialog=document.createElement('dialog'); dialog.className='timer-dialog'; dialog.id='gonTimerDetailDialog';
    dialog.innerHTML=`<form id="gonTimerDetailForm"><h2>Completa attivit\u00e0 da timer</h2><p id="gonTimerDetailPeriod" class="timer-note"></p>
      <div class="field"><label for="gonTimerDetailClient">Cliente / cantiere</label><select id="gonTimerDetailClient" required></select></div>
      <div class="field"><label for="gonTimerDetailType">Tipo ore</label><select id="gonTimerDetailType" required></select></div>
      <div class="field"><label for="gonTimerDetailMacro">Macro area</label><select id="gonTimerDetailMacro" required></select></div>
      <div class="field"><label for="gonTimerDetailText">Descrizione attivit\u00e0</label><textarea id="gonTimerDetailText" required maxlength="4000"></textarea></div>
      <p id="gonTimerDetailError" class="timer-note timer-error" role="alert"></p><div class="timer-buttons">
      <button id="gonTimerDetailLater" type="button" class="btn light">Pi\u00f9 tardi</button><button id="gonTimerDetailSave" type="submit" class="btn ok">Salva dettagli</button></div></form>`;
    document.body.append(dialog);
    TYPES.forEach(x => byId('gonTimerDetailType').add(new Option(x,x)));
    MACROS.forEach(x => byId('gonTimerDetailMacro').add(new Option(x,x)));
    byId('gonTimerDetailLater').onclick=()=>dialog.close();
    byId('gonTimerDetailForm').onsubmit=saveDetails;
  }
  function openDetails(row) {
    if (!actor) return;
    dialog.dataset.entryId=row.id;
    byId('gonTimerDetailPeriod').textContent=`${timeLabel(row.timer_started_at)} \u2192 ${timeLabel(row.timer_stopped_at)} \u00b7 ${formatDuration(row.duration_seconds)}. Il tempo misurato non viene modificato.`;
    setOptions(byId('gonTimerDetailClient'),customerRows,'Seleziona cliente',row.client);
    byId('gonTimerDetailType').value=row.type;
    byId('gonTimerDetailMacro').value=row.macro;
    byId('gonTimerDetailText').value='';
    byId('gonTimerDetailError').textContent='';
    dialog.showModal();
  }
  async function saveDetails(event) {
    event.preventDefault();
    if (!actor || !navigator.onLine) { byId('gonTimerDetailError').textContent='Per salvare i dettagli occorre la connessione. Il tempo registrato resta conservato.'; return; }
    const stamp=generation, btn=byId('gonTimerDetailSave'); btn.disabled=true;
    byId('gonTimerDetailError').textContent='';
    try {
      await callRpc('gon_complete_timer',{p_entry_id:dialog.dataset.entryId,p_expected_user:actor.id,p_client:byId('gonTimerDetailClient').value,
        p_type:byId('gonTimerDetailType').value,p_macro:byId('gonTimerDetailMacro').value,p_description:byId('gonTimerDetailText').value.trim()});
      if (stamp !== generation) return;
      dialog.close(); notice('Dettagli salvati. L\u2019attivit\u00e0 \u00e8 completa.');
      await refreshDrafts();
      if (typeof load === 'function') { try { await load(true); } catch {} }
    } catch(e) { if(stamp===generation) byId('gonTimerDetailError').textContent=errorMessage(e); }
    finally { btn.disabled=false; }
  }
  function sessionChanged(session) {
    const next=session?.user || null;
    if (next?.id === actor?.id) return;
    generation++; actor=next; remoteRows=[]; customerRows=[]; lastError='';
    if(dialog?.open)dialog.close();
    renderClock(); renderDrafts();
    if(actor)setTimeout(()=>syncQueue(),0); // Do not await Supabase calls inside auth callbacks.
  }
  async function boot() {
    mount(); installConnectionHook(); renderClock();
    const c=api(); if(!c || !root) return;
    const subscription=c.auth.onAuthStateChange((_event,session)=>sessionChanged(session));
    authSubscription=subscription.data.subscription;
    try { const {data}=await c.auth.getSession();sessionChanged(data.session); } catch(e) { notice(errorMessage(e),true); }
    setInterval(renderClock,1000);
    setInterval(()=>{if(actor){syncQueue();}},15000);
    window.addEventListener('online',()=>syncQueue());
    window.addEventListener('offline',()=>{updateConnection();renderClock();});
    window.addEventListener('storage',e=>{if(actor&&e.key===key(actor.id)){renderClock();renderDrafts();updateConnection();}});
    window.addEventListener('pageshow',()=>{renderClock();if(actor)syncQueue();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderClock();if(actor)syncQueue();}});
  }
  window.GonActivityTimer=Object.freeze({version:VERSION});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
