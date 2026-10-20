/* Compact archive presentation for manual and timer activity history. */
(() => {
  'use strict';
  const VERSION='history-organizer-1.0.0';
  const $=id=>document.getElementById(id);
  let historyObserver=null,timerObserver=null,rootObserver=null,historyBusy=false,timerBusy=false,historyScheduled=false,timerScheduled=false;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function styles(){
    if($('gonHistoryOrganizerStyle'))return;
    const style=document.createElement('style');style.id='gonHistoryOrganizerStyle';style.textContent=`
      #gonPersonalHistory.gon-archive{padding:0!important;overflow:hidden}
      .gon-archive-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px}.gon-archive-head h2{margin:0!important}.gon-archive-head-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .gon-archive-count{font-size:12px;font-weight:800;color:#155f96;background:#eaf3fa;border-radius:999px;padding:5px 9px}.gon-archive-body{border-top:1px solid #d9e2ec;padding:14px 18px 18px}
      .gon-archive-tools{display:grid;grid-template-columns:190px minmax(220px,1fr);gap:10px;margin:10px 0 14px}.gon-archive-tools .field{margin:0}.gon-archive-tools select,.gon-archive-tools input{width:100%;box-sizing:border-box}
      .gon-archive-months{display:grid!important;gap:10px!important}.gon-archive-month{border:1px solid #d9e2ec;border-radius:12px;overflow:hidden;background:#fff}.gon-archive-month>summary{cursor:pointer;list-style:none;padding:11px 13px;background:#f7f9fc;display:flex;justify-content:space-between;gap:10px;font-weight:800;text-transform:capitalize}.gon-archive-month>summary::-webkit-details-marker{display:none}
      .gon-archive-month-list{display:grid}.gon-archive-month-list>.gon-history-row{border:0!important;border-top:1px solid #e7edf3!important;border-radius:0!important;margin:0!important}.gon-archive-month-list>.gon-history-row:first-child{border-top:0!important}
      .gon-archive-empty{padding:16px;border:1px dashed #c7d5e3;border-radius:12px;color:#667085;text-align:center}.gon-archive-source{display:inline-flex;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:800;margin-left:6px}.gon-archive-source.manual{background:#eaf3fa;color:#155f96}.gon-archive-source.timer{background:#eef4e8;color:#356b22}
      #gonTimerDrafts.gon-timer-pending>h2{margin-bottom:4px!important}.gon-timer-pending-count{display:inline-flex;margin-left:8px;border-radius:999px;padding:3px 8px;font-size:12px;font-weight:800;background:#fff4e5;color:#9a5200}
      @media(max-width:650px){.gon-archive-head{align-items:flex-start;flex-direction:column}.gon-archive-head-right{width:100%}.gon-archive-head-right button{flex:1}.gon-archive-tools{grid-template-columns:1fr}}
    `;document.head.append(style);
  }
  function monthKey(row){
    const text=row.querySelector('.gon-history-head strong')?.textContent||row.querySelector('strong')?.textContent||'';
    const m=text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);return m?`${m[3]}-${m[2]}`:'senza-data';
  }
  function monthLabel(key){
    if(key==='senza-data')return 'Senza data';const [y,m]=key.split('-').map(Number);return new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric'}).format(new Date(y,m-1,1));
  }
  function rowSource(row){const text=row.textContent||'';return /\bTimer\b/i.test(text)?'timer':'manual';}
  function updateArchiveCount(panel){
    const badge=panel.querySelector('[data-gon-archive-count]'),page=$('gonHistoryPage')?.textContent||'';if(!badge)return;
    const m=page.match(/·\s*(\d+)\s+attivit/i),next=m?`${m[1]} attività`:'Storico';if(badge.textContent!==next)badge.textContent=next;
  }
  function groupHistory(){
    historyScheduled=false;if(historyBusy)return;const panel=$('gonPersonalHistory'),list=$('gonHistoryList');if(!panel||!list)return;
    historyBusy=true;
    try{
      list.querySelectorAll('.gon-archive-empty').forEach(x=>x.remove());
      const rows=[...list.querySelectorAll('.gon-history-row')];if(!rows.length){updateArchiveCount(panel);return;}
      const source=panel.querySelector('[data-gon-history-source]')?.value||'all',term=(panel.querySelector('[data-gon-history-search]')?.value||'').trim().toLocaleLowerCase('it-IT');
      const groups=new Map();let visibleTotal=0;
      rows.forEach(row=>{
        const src=rowSource(row),matchSource=source==='all'||source===src,matchText=!term||(row.textContent||'').toLocaleLowerCase('it-IT').includes(term),visible=matchSource&&matchText;
        if(row.hidden===visible)row.hidden=!visible;if(visible)visibleTotal++;
        let badge=row.querySelector('[data-gon-source-badge]');if(!badge){badge=document.createElement('span');badge.dataset.gonSourceBadge='1';badge.className='gon-archive-source '+src;badge.textContent=src==='timer'?'Timer':'Normale';const meta=row.querySelector('.gon-history-meta');if(meta)meta.append(badge);}
        const key=monthKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
      });
      historyObserver?.disconnect();list.replaceChildren();let firstVisible=true;
      for(const [key,items] of groups){
        const shown=items.filter(x=>!x.hidden),group=document.createElement('details');group.className='gon-archive-month';group.hidden=!shown.length;group.open=Boolean(shown.length&&firstVisible);if(shown.length)firstVisible=false;
        const summary=document.createElement('summary');summary.innerHTML=`<span>${esc(monthLabel(key))}</span><span class="gon-history-meta">${shown.length} ${shown.length===1?'voce':'voci'}</span>`;
        const body=document.createElement('div');body.className='gon-archive-month-list';items.forEach(x=>body.append(x));group.append(summary,body);list.append(group);
      }
      if(!visibleTotal){const empty=document.createElement('div');empty.className='gon-archive-empty';empty.textContent='Nessuna attività nella pagina corrente con questi filtri.';list.append(empty);}
      updateArchiveCount(panel);
      observeHistoryList(list);
    }finally{historyBusy=false;}
  }
  function scheduleHistory(){if(historyScheduled)return;historyScheduled=true;requestAnimationFrame(groupHistory);}
  function observeHistoryList(list){historyObserver?.disconnect();historyObserver=new MutationObserver(scheduleHistory);historyObserver.observe(list,{childList:true,subtree:false});}
  function enhanceHistory(){
    const panel=$('gonPersonalHistory');if(!panel||panel.dataset.gonArchive==='1')return false;panel.dataset.gonArchive='1';panel.classList.add('gon-archive');
    const oldTitle=panel.querySelector('h2'),head=document.createElement('div');head.className='gon-archive-head';
    const title=document.createElement('h2');title.textContent='Storico attività';const right=document.createElement('div');right.className='gon-archive-head-right';
    const count=document.createElement('span');count.className='gon-archive-count';count.dataset.gonArchiveCount='1';count.textContent='Storico';const toggle=document.createElement('button');toggle.type='button';toggle.className='btn light';toggle.textContent='Apri storico';right.append(count,toggle);head.append(title,right);
    const body=document.createElement('div');body.className='gon-archive-body';body.hidden=true;
    [...panel.children].forEach(child=>{if(child!==oldTitle)body.append(child);});oldTitle?.remove();panel.append(head,body);
    const note=body.querySelector('.gon-history-meta');if(note)note.textContent='Inserimenti normali e timer sono conservati insieme, raggruppati per mese. Usa i filtri per trovare rapidamente una voce.';
    const tools=document.createElement('div');tools.className='gon-archive-tools';tools.innerHTML='<div class="field"><label>Origine</label><select data-gon-history-source><option value="all">Tutti gli inserimenti</option><option value="manual">Inserimenti normali</option><option value="timer">Inserimenti da timer</option></select></div><div class="field"><label>Cerca nella pagina</label><input data-gon-history-search maxlength="80" placeholder="Cliente, cantiere, macroarea o descrizione"></div>';
    const msg=$('gonHistoryMsg');body.insertBefore(tools,msg||body.firstChild);
    toggle.onclick=()=>{body.hidden=!body.hidden;toggle.textContent=body.hidden?'Apri storico':'Chiudi storico';if(!body.hidden)scheduleHistory();};
    tools.querySelector('select').onchange=scheduleHistory;tools.querySelector('input').oninput=scheduleHistory;
    const list=$('gonHistoryList');if(list){list.classList.add('gon-archive-months');observeHistoryList(list);scheduleHistory();}
    const page=$('gonHistoryPage');if(page)new MutationObserver(()=>updateArchiveCount(panel)).observe(page,{childList:true,characterData:true,subtree:true});
    return true;
  }
  function organizeTimer(){
    timerScheduled=false;if(timerBusy)return;const panel=$('gonTimerDrafts');if(!panel)return;timerBusy=true;
    try{
      panel.classList.add('gon-timer-pending');const title=panel.querySelector('h2');
      if(title&&title.dataset.gonTimerTitle!=='1'){title.textContent='Timer da completare';title.dataset.gonTimerTitle='1';}
      const note=[...panel.querySelectorAll('p.timer-note')].find(x=>x.id!=='gonTimerMessage');
      if(note&&note.dataset.gonTimerNote!=='1'){note.textContent='Qui restano soltanto le attività da sincronizzare o completare. Le attività concluse sono nello Storico attività.';note.dataset.gonTimerNote='1';}
      let visible=0;panel.querySelectorAll('.timer-row').forEach(row=>{const text=row.querySelector('p')?.textContent||'';const completed=/—\s*Completata\s*$/i.test(text);if(row.hidden!==completed)row.hidden=completed;if(!completed)visible++;});
      let badge=panel.querySelector('[data-gon-timer-pending-count]');if(!badge&&title){badge=document.createElement('span');badge.dataset.gonTimerPendingCount='1';badge.className='gon-timer-pending-count';title.append(badge);}const badgeText=visible?String(visible):'';if(badge&&badge.textContent!==badgeText)badge.textContent=badgeText;
      const retry=$('gonTimerRetry'),pending=Boolean(retry&&!retry.hidden),msg=$('gonTimerMessage'),error=Boolean(msg?.classList.contains('timer-error')&&msg.textContent.trim()),shouldShow=visible>0||pending||error;
      if(panel.hidden===shouldShow)panel.hidden=!shouldShow;
    }finally{timerBusy=false;}
  }
  function scheduleTimer(){if(timerScheduled)return;timerScheduled=true;requestAnimationFrame(organizeTimer);}
  function enhanceTimer(){const panel=$('gonTimerDrafts');if(!panel||panel.dataset.gonPending==='1')return false;panel.dataset.gonPending='1';timerObserver=new MutationObserver(scheduleTimer);timerObserver.observe(panel,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});scheduleTimer();return true;}
  function scan(){enhanceHistory();enhanceTimer();if($('gonPersonalHistory')&&$('gonTimerDrafts'))rootObserver?.disconnect();}
  function boot(){styles();scan();const ore=$('ore')||document.body;rootObserver=new MutationObserver(scan);rootObserver.observe(ore,{childList:true,subtree:true});document.addEventListener('gon:data-refreshed',()=>{scheduleHistory();scheduleTimer();});}
  window.GonHistoryOrganizer=Object.freeze({version:VERSION,refresh:()=>{scheduleHistory();scheduleTimer();}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();