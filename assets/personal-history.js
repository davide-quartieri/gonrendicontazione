/* Own-account history and editing. */
(() => {
  'use strict';
  const VERSION='personal-history-1.0.0', PAGE=25;
  const TYPES=['Cantiere','Viaggio','Ufficio'];
  const MACROS=['Rilievo in campo','Elaborazione rilievo','Assistenza cliente','Attività amministrative','Corso','Varie'];
  const $=id=>document.getElementById(id);
  const api=()=>{try{return typeof db!=='undefined'?db:null}catch{return null}};
  let actor=null,page=0,total=0,rows=[],panel=null,dialog=null,editing=null,busy=false,epoch=0;
  const fields='id,date,employee,client,type,macro,description,hours,created_by,entry_source,needs_details,edit_version,updated_at,timer_started_at,timer_stopped_at,duration_seconds';
  const dateLabel=s=>s?String(s).split('-').reverse().join('/'):'';
  function say(t,e=false){const p=$('gonHistoryMsg');if(p){p.textContent=t;p.style.color=e?'#b42318':'#667085';}}
  function make(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
  function mount(){
    const ore=$('ore');if(!ore||$('gonPersonalHistory'))return false;
    const style=make('style');style.textContent=`
      .gon-history-list{display:grid;gap:10px}.gon-history-row{border:1px solid #d9e2ec;border-radius:12px;padding:12px}
      .gon-history-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.gon-history-row p{margin:6px 0;white-space:pre-wrap}
      .gon-history-meta{font-size:13px;color:#667085}.gon-history-pages{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px}
      .gon-history-dialog{width:min(580px,calc(100% - 24px));max-height:90dvh;border:0;border-radius:18px;padding:22px}.gon-history-dialog::backdrop{background:#10182899}
      .gon-history-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gon-history-dialog .field{margin:10px 0}.gon-history-dialog input,.gon-history-dialog select,.gon-history-dialog textarea{width:100%;box-sizing:border-box}
      .gon-history-dialog textarea{min-height:100px}.gon-history-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:12px}
      @media(max-width:760px){.gon-history-grid{grid-template-columns:1fr}.gon-history-actions button{flex:1}.gon-history-pages button{width:auto}}
    `;document.head.append(style);
    panel=make('section',undefined,'card');panel.id='gonPersonalHistory';panel.hidden=true;
    panel.innerHTML='<h2>Il mio storico</h2><p class="gon-history-meta">Puoi vedere e modificare le attività inserite dal tuo account.</p><p id="gonHistoryMsg" class="gon-history-meta" role="status"></p><div id="gonHistoryList" class="gon-history-list"></div><div class="gon-history-pages"><button id="gonHistoryPrev" class="btn light" type="button">Precedenti</button><span id="gonHistoryPage"></span><button id="gonHistoryNext" class="btn light" type="button">Successive</button></div>';
    ore.append(panel);
    $('gonHistoryPrev').onclick=()=>{if(page>0){page--;refresh()}};
    $('gonHistoryNext').onclick=()=>{if((page+1)*PAGE<total){page++;refresh()}};
    dialog=document.createElement('dialog');dialog.className='gon-history-dialog';dialog.id='gonHistoryDialog';
    dialog.innerHTML=`<form id="gonHistoryForm"><h2>Modifica attività</h2><p id="gonHistoryEmployee" class="gon-history-meta"></p>
      <div class="gon-history-grid"><div class="field"><label>Data</label><input id="gonEditDate" type="date" required></div><div class="field"><label>Ore</label><input id="gonEditHours" type="number" step="any" min="0.000001" max="744" required></div></div>
      <div class="field"><label>Cliente / cantiere</label><select id="gonEditClient" required></select></div>
      <div class="gon-history-grid"><div class="field"><label>Tipo ore</label><select id="gonEditType" required></select></div><div class="field"><label>Macro area</label><select id="gonEditMacro" required></select></div></div>
      <div class="field"><label>Descrizione</label><textarea id="gonEditDescription" maxlength="4000" required></textarea></div>
      <p id="gonHistoryEditMsg" class="gon-history-meta"></p><div class="gon-history-actions"><button id="gonHistoryCancel" type="button" class="btn light">Annulla</button><button id="gonHistorySave" type="submit" class="btn ok">Salva modifiche</button></div></form>`;
    document.body.append(dialog);
    TYPES.forEach(x=>$('gonEditType').add(new Option(x,x)));MACROS.forEach(x=>$('gonEditMacro').add(new Option(x,x)));
    $('gonHistoryCancel').onclick=()=>{if(!busy)dialog.close()};$('gonHistoryForm').onsubmit=save;
    return true;
  }
  async function refresh(){
    if(!actor||!api()||!navigator.onLine)return;
    const stamp=epoch,user=actor.id;say('Aggiornamento storico...');
    try{
      const r=await api().from('entries').select(fields,{count:'exact'}).eq('created_by',user).order('date',{ascending:false}).order('created_at',{ascending:false}).range(page*PAGE,(page+1)*PAGE-1);
      if(stamp!==epoch)return;if(r.error)throw r.error;rows=r.data||[];total=r.count||0;render();say('');
    }catch(e){if(stamp===epoch)say(e.message||'Impossibile aggiornare lo storico.',true)}
  }
  function render(){
    if(!panel)return;panel.hidden=!actor;if(!actor)return;
    const list=$('gonHistoryList');list.replaceChildren();
    rows.forEach(row=>{
      const card=make('article',undefined,'gon-history-row'),head=make('div',undefined,'gon-history-head');
      head.append(make('strong',dateLabel(row.date)+' · '+(row.client||'Cliente da indicare')),make('strong',Number(row.hours).toLocaleString('it-IT',{maximumFractionDigits:4})+' h'));
      card.append(head,make('p',row.type+' · '+row.macro+' · '+(row.entry_source==='timer'?'Timer':'Manuale'),'gon-history-meta'),make('p',row.description));
      const b=make('button','Modifica','btn light');b.type='button';b.onclick=()=>open(row.id);card.append(b);list.append(card);
    });
    if(!rows.length)list.append(make('p','Nessuna attività trovata.','gon-history-meta'));
    $('gonHistoryPage').textContent='Pagina '+(page+1)+' di '+Math.max(1,Math.ceil(total/PAGE))+' · '+total+' attività';
    $('gonHistoryPrev').disabled=page===0;$('gonHistoryNext').disabled=(page+1)*PAGE>=total;
  }
  async function open(id){
    if(!actor||!api()||!navigator.onLine){say('Per modificare occorre la connessione.',true);return}
    const stamp=epoch,user=actor.id;
    try{
      const [r,c]=await Promise.all([api().from('entries').select(fields).eq('id',id).eq('created_by',user).single(),api().from('clients').select('display').eq('active',true).order('display')]);
      if(stamp!==epoch)return;if(r.error||c.error)throw r.error||c.error;editing=r.data;
      $('gonHistoryEmployee').textContent='Inserita da: '+editing.employee;
      $('gonEditDate').value=editing.date;$('gonEditHours').value=editing.hours;$('gonEditType').value=editing.type;$('gonEditMacro').value=editing.macro;$('gonEditDescription').value=editing.description;
      const sel=$('gonEditClient');sel.replaceChildren(new Option('Seleziona cliente',''));const vals=(c.data||[]).map(x=>x.display);vals.forEach(v=>sel.add(new Option(v,v)));
      if(editing.client&&!vals.includes(editing.client))sel.add(new Option(editing.client+' (storico)',editing.client));sel.value=editing.client||'';
      $('gonHistoryEditMsg').textContent='';dialog.showModal();
    }catch(e){say(e.message||'Attività non disponibile.',true)}
  }
  async function save(e){
    e.preventDefault();if(busy||!editing||!actor)return;if(!navigator.onLine){$('gonHistoryEditMsg').textContent='Connessione assente.';return}
    busy=true;$('gonHistorySave').disabled=$('gonHistoryCancel').disabled=true;
    try{
      const r=await api().rpc('gon_update_my_entry',{p_entry_id:editing.id,p_expected_user:actor.id,p_expected_version:editing.edit_version,p_date:$('gonEditDate').value,p_client:$('gonEditClient').value,p_type:$('gonEditType').value,p_macro:$('gonEditMacro').value,p_description:$('gonEditDescription').value.trim(),p_hours:Number($('gonEditHours').value)});
      if(r.error)throw r.error;dialog.close();editing=null;await refresh();if(typeof load==='function'){try{await load(true)}catch{}}
    }catch(err){$('gonHistoryEditMsg').textContent=err.code==='40001'?'La voce è stata modificata nel frattempo. Chiudi e riaprila prima di salvare di nuovo.':(err.message||'Modifica non salvata.')}
    finally{busy=false;$('gonHistorySave').disabled=$('gonHistoryCancel').disabled=false}
  }
  function session(session){
    const next=session?.user||null;if(next?.id===actor?.id)return;epoch++;actor=next;page=0;total=0;rows=[];editing=null;if(dialog?.open)dialog.close();render();if(actor)setTimeout(refresh,0);
  }
  async function boot(){
    if(!mount()||!api())return;api().auth.onAuthStateChange((_e,s)=>session(s));const r=await api().auth.getSession();session(r.data?.session);
    document.addEventListener('gon:data-refreshed',()=>{if(actor)refresh()});window.addEventListener('online',()=>{if(actor)refresh()});
  }
  window.GonPersonalHistory=Object.freeze({version:VERSION});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();