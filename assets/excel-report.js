/* GON styled XLSX export. The openpyxl template carries styles, print layout,
 * embedded approved logo and native Excel charts. No external export service. */
(() => {
  'use strict';
  const VERSION = 'excel-report-1.0.0';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const CNS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const TYPES = ['Cantiere','Viaggio','Ufficio'];
  const MACROS = ['Rilievo in campo','Elaborazione rilievo','Assistenza cliente','Attività amministrative','Corso','Varie','Rilievo in campo - PROGRAMMATO','Elaborazione rilievo - PROGRAMMATA'];
  const xml = s => { const d=new DOMParser().parseFromString(s,'application/xml'); if(d.getElementsByTagName('parsererror').length)throw new Error('Modello Excel non valido.');return d; };
  const all = (d,n,ns=NS) => Array.from(d.getElementsByTagNameNS(ns,n));
  const first = (d,n,ns=NS) => all(d,n,ns)[0];
  const el = (d,n,text,ns=NS) => { const x=d.createElementNS(ns,n);if(text!==undefined)x.textContent=String(text);return x; };
  const serialize = d => new XMLSerializer().serializeToString(d);
  const round = n => Math.round((n+Number.EPSILON)*1e6)/1e6;
  const sum = rs => round(rs.reduce((s,e)=>s+e.hours,0));
  const lower = s => s.toLocaleLowerCase('it-IT');
  const col = i => {let s='';for(;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
  const dateLabel = s => s ? s.split('-').reverse().join('/') : 'tutte le date';
  const dateNumber = s => (Date.parse(s+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;
  const f = (formula,result) => ({formula,result});
  const safeText = s => String(s??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'');
  function value(c,v) {
    c.replaceChildren();c.removeAttribute('t');
    if(v===null||v===undefined)return;
    const d=c.ownerDocument;
    if(typeof v==='object'&&'formula' in v){
      if(typeof v.result==='string')c.setAttribute('t','str');
      c.append(el(d,'f',v.formula),el(d,'v',v.result));return;
    }
    if(typeof v==='number') {if(!Number.isFinite(v))throw new Error('Valore numerico non valido.');c.append(el(d,'v',v));return;}
    c.setAttribute('t','inlineStr');const is=el(d,'is'),t=el(d,'t',safeText(v));t.setAttribute('xml:space','preserve');is.append(t);c.append(is);
  }
  function set(d,address,v) {
    const c=all(d,'c').find(c=>c.getAttribute('r')===address);
    if(!c)throw new Error('Cella modello mancante: '+address);
    value(c,v);
  }
  function dynamicTable(d,data,totals,lastCol) {
    const body=first(d,'sheetData'),prototypes=[9,10,11].map(r=>all(body,'row').find(x=>+x.getAttribute('r')===r).cloneNode(true));
    all(body,'row').filter(r=>+r.getAttribute('r')>=9).forEach(r=>r.remove());
    const append=(r,values,proto)=>{
      const row=prototypes[proto].cloneNode(true);row.setAttribute('r',r);
      const cells=Array.from(row.children);cells.forEach((c,i)=>{c.setAttribute('r',col(i+1)+r);value(c,values[i]??null);});
      if(lastCol===11&&proto!==2){const lines=Math.max(2,Math.ceil(String(values[4]||'').length/40),...String(values[5]||'').split('\n').map(s=>Math.ceil(s.length/55)));row.setAttribute('ht',Math.min(180,lines*16+8));row.setAttribute('customHeight','1');}
      body.append(row);
    };
    data.forEach((r,i)=>append(i+9,r,i%2));
    const end=Math.max(9,data.length+8),totalRow=end+2;append(totalRow,totals,2);
    first(d,'dimension').setAttribute('ref','A1:'+col(lastCol)+totalRow);
    first(d,'autoFilter').setAttribute('ref','A8:'+col(lastCol)+end);
    return {end,totalRow};
  }
  const criterion = s => '"='+String(s).replace(/~/g,'~~').replace(/\*/g,'~*').replace(/\?/g,'~?').replace(/"/g,'""')+'"';
  function groups(rows,field,seed=[]) {
    const map=new Map();for(const name of seed)map.set(lower(name),{name,rows:[]});
    for(const row of rows){const name=row[field]||'';const k=lower(name);if(!map.has(k))map.set(k,{name,rows:[]});map.get(k).rows.push(row);}
    return [...map.values()];
  }
  function chart(d,categories,values,categoryRef,valueRef) {
    const cat=first(d,'cat',CNS),val=first(d,'val',CNS);cat.replaceChildren();val.replaceChildren();
    const reference=(parent,kind,ref,data)=>{
      const r=el(d,kind+'Ref',undefined,CNS),cache=el(d,kind+'Cache',undefined,CNS);r.append(el(d,'f',ref,CNS));
      if(kind==='num')cache.append(el(d,'formatCode','0.00',CNS));
      const pc=el(d,'ptCount',undefined,CNS);pc.setAttribute('val',data.length);cache.append(pc);
      data.forEach((v,i)=>{const pt=el(d,'pt',undefined,CNS);pt.setAttribute('idx',i);pt.append(el(d,'v',v,CNS));cache.append(pt);});r.append(cache);parent.append(r);
    };
    reference(cat,'str',categoryRef,categories);reference(val,'num',valueRef,values);
  }
  // ZIP STORE: CRC-32 and UTF-8 names, using only native browser APIs.
  const CRC_TABLE=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
  const crc = bytes => {let c=0xFFFFFFFF;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
  const decode64 = s => Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  function zip(parts) {
    const encode=new TextEncoder(),out=[],central=[];let offset=0,centralSize=0;
    for(const [name,part] of Object.entries(parts)){
      const n=encode.encode(name),b=part.base64!==undefined?decode64(part.base64):encode.encode(part.text),check=crc(b);
      const local=new Uint8Array(30+n.length),l=new DataView(local.buffer);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(12,33,true);l.setUint32(14,check,true);l.setUint32(18,b.length,true);l.setUint32(22,b.length,true);l.setUint16(26,n.length,true);local.set(n,30);
      const entry=new Uint8Array(46+n.length),v=new DataView(entry.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x0800,true);v.setUint16(14,33,true);v.setUint32(16,check,true);v.setUint32(20,b.length,true);v.setUint32(24,b.length,true);v.setUint16(28,n.length,true);v.setUint32(42,offset,true);entry.set(n,46);
      out.push(local,b);central.push(entry);offset+=local.length+b.length;centralSize+=entry.length;
    }
    const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
    return new Blob([...out,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function createWorkbook(template,input,meta={},logoPng) {
    if(template.version!==VERSION)throw new Error('Aggiorna la pagina: modello Excel non allineato.');
    const rows=input.map(x=>({...x,hours:Number(x.hours),client:String(x.client||''),macro:String(x.macro||'Non classificata')}));
    for(const x of rows){if(!Number.isFinite(x.hours)||x.hours<0||!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!Number.isFinite(dateNumber(x.date)))throw new Error('Controllare data e ore nelle attività prima di esportare.');}
    rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
    const parts=Object.fromEntries(Object.entries(template.parts).map(([n,v])=>[n,{...v}]));
    const docs=[1,2,3,4].map(n=>xml(parts['xl/worksheets/sheet'+n+'.xml'].text));
    const [D,A,M,C]=docs,N=Math.max(9,rows.length+8),hours="'Attivita'!$G$9:$G$"+N,types="'Attivita'!$D$9:$D$"+N,states="'Attivita'!$I$9:$I$"+N;
    const total=sum(rows),pending=rows.filter(x=>x.needs_details),macroGroups=groups(rows,'macro',MACROS),clientGroups=groups(rows,'client').sort((a,b)=>sum(b.rows)-sum(a.rows)||a.name.localeCompare(b.name));
    const subtitle=(meta.example?'ESEMPIO - dati fittizi | ':'')+'Periodo: '+(meta.from?dateLabel(meta.from):'inizio archivio')+' - '+(meta.to?dateLabel(meta.to):'fine archivio')+' | Cliente: '+(meta.client||'Tutti')+' | Esportato: '+(meta.exportedAt||new Date().toLocaleString('it-IT'));
    docs.forEach((d,i)=>set(d,i?'A7':'B7',subtitle));
    const details=rows.map(x=>[dateNumber(x.date),x.employee,x.client,x.type,x.macro,x.description,x.hours,x.entry_source==='timer'?'Timer':'Manuale',x.needs_details?'Da completare':'Completa',x.entry_source==='timer'&&x.duration_seconds?x.duration_seconds/3600:null,x.id]);
    const aBounds=dynamicTable(A,details,['TOTALE',null,null,null,null,null,f('SUM('+hours+')',total)],11);
    function summary(doc,gr,field,lastCol){
      const range="'Attivita'!$"+field+'$9:$'+field+'$'+N;
      // SUMPRODUCT equality also handles literal *, ? and ~ in client names.
      const data=gr.map(g=>{const exact='('+range+'="'+g.name.replace(/"/g,'""')+'")', v=sum(g.rows),totalFormula='SUMPRODUCT(--'+exact+','+hours+')';return [g.name||'Da associare',f('SUMPRODUCT(--'+exact+')',g.rows.length),f(totalFormula,v),...TYPES.map(t=>f('SUMPRODUCT(--'+exact+',--('+types+'="'+t+'"),'+hours+')',sum(g.rows.filter(x=>x.type===t)))),f('IFERROR('+totalFormula+'/SUM('+hours+'),0)',total?v/total:0),f('SUMPRODUCT(--'+exact+',--('+states+'="Da completare"),'+hours+')',sum(g.rows.filter(x=>x.needs_details))),...(lastCol===9?[g.name]:[])];});
      const end=Math.max(9,gr.length+8),tot=['TOTALE',f('SUM(B9:B'+end+')',rows.length),f('SUM(C9:C'+end+')',total),...TYPES.map((t,i)=>f('SUM('+col(i+4)+'9:'+col(i+4)+end+')',sum(rows.filter(x=>x.type===t)))),f('SUM(G9:G'+end+')',total?1:0),f('SUM(H9:H'+end+')',sum(pending))];
      return dynamicTable(doc,data,tot,lastCol);
    }
    const mBounds=summary(M,macroGroups,'E',8),cBounds=summary(C,clientGroups,'C',9);
    set(D,'B11',f('SUM('+hours+')',total));set(D,'F11',f("COUNTA('Attivita'!$K$9:$K$"+N+')',rows.length));
    set(D,'J11',f("SUMPRODUCT(--('Clienti'!$I$9:$I$"+cBounds.end+'<>""))',clientGroups.filter(x=>x.name).length));
    set(D,'N11',f('COUNTIF('+states+',"Da completare")',pending.length));
    TYPES.forEach((t,i)=>{set(D,'H'+(40+i),f('SUMIF('+types+','+criterion(t)+','+hours+')',sum(rows.filter(x=>x.type===t))));set(D,'K'+(40+i),f('IFERROR(H'+(40+i)+'/$B$11,0)',total?sum(rows.filter(x=>x.type===t))/total:0));set(D,'N'+(40+i),f('COUNTIF('+types+','+criterion(t)+')',rows.filter(x=>x.type===t).length));});
    const pHours=sum(pending),note='Nei totali sono incluse '+pending.length+' attività da completare ('+pHours.toFixed(4)+' h). Verificare i dettagli prima della rendicontazione definitiva.';
    set(D,'B45',f('"Nei totali sono incluse "&N11&" attività da completare ("&TEXT(SUMIF('+states+',"Da completare",'+hours+'),"0.0000")&" h). Verificare i dettagli prima della rendicontazione definitiva."',note));
    docs.forEach((d,i)=>{parts['xl/worksheets/sheet'+(i+1)+'.xml']={text:serialize(d)};});
    const bar=xml(parts['xl/charts/chart1.xml'].text),pie=xml(parts['xl/charts/chart2.xml'].text);
    chart(bar,macroGroups.map(g=>g.name),macroGroups.map(g=>sum(g.rows)),"'Macroaree'!$A$9:$A$"+mBounds.end,"'Macroaree'!$C$9:$C$"+mBounds.end);
    chart(pie,TYPES,TYPES.map(t=>sum(rows.filter(x=>x.type===t))),"'Dashboard'!$B$40:$B$42","'Dashboard'!$H$40:$H$42");
    parts['xl/charts/chart1.xml']={text:serialize(bar)};parts['xl/charts/chart2.xml']={text:serialize(pie)};
    const wb=xml(parts['xl/workbook.xml'].text);const bounds=[53,aBounds.totalRow,mBounds.totalRow,cBounds.totalRow];
    all(wb,'definedName').forEach(d=>{if(d.getAttribute('name')==='_xlnm.Print_Area'){const i=+d.getAttribute('localSheetId'),name=['Dashboard','Attivita','Macroaree','Clienti'][i],c=['P','J','H','H'][i];d.textContent="'"+name+"'!$A$1:$"+c+'$'+bounds[i];}});
    parts['xl/workbook.xml']={text:serialize(wb)};
    if(logoPng)for(const n of Object.keys(parts))if(/^xl\/media\/image\d+\.png$/.test(n))parts[n]={base64:logoPng.replace(/^data:image\/png;base64,/, '')};
    return zip(parts);
  }
  let busy=false;
  async function download() {
    if(busy)return;
    const btn=document.getElementById('excel'),hint=document.getElementById('gonExportStatus');busy=true;if(btn)btn.disabled=true;
    const say=t=>{if(hint)hint.textContent=t;};
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),90000);
    try {
      if(typeof db==='undefined'||!db)throw new Error('Accedi prima di esportare.');
      if(typeof MODE!=='undefined'&&MODE!=='pc')throw new Error('Esportazione disponibile dalla versione PC.');
      if(!navigator.onLine)throw new Error('Serve la connessione per esportare i dati aggiornati.');
      const filters={from:document.getElementById('from')?.value||'',to:document.getElementById('to')?.value||'',client:document.getElementById('rclient')?.value||'',exportedAt:new Date().toLocaleString('it-IT',{timeZone:'Europe/Rome'})};
      if(filters.from&&filters.to&&filters.from>filters.to)throw new Error('Controlla le date del report.');
      say('Verifica accesso e caricamento dati...');
      const auth=await db.auth.getUser();if(auth.error||!auth.data?.user)throw new Error('Sessione scaduta. Accedi nuovamente.');const owner=auth.data.user.id;
      const profile=await db.from('user_profiles').select('role').eq('user_id',owner).single().abortSignal(controller.signal);
      if(profile.error||profile.data?.role!=='admin')throw new Error('Esportazione riservata agli amministratori.');
      const rows=[],ids=new Set();let expected=null;
      do {
        let q=db.from('entries').select('*',{count:'exact'});if(filters.from)q=q.gte('date',filters.from);if(filters.to)q=q.lte('date',filters.to);if(filters.client)q=q.eq('client',filters.client);
        const r=await q.order('date').order('id').range(rows.length,rows.length+499).abortSignal(controller.signal);if(r.error)throw r.error;
        if(expected===null)expected=r.count;if(!Number.isInteger(expected)||r.count!==expected)throw new Error('Archivio cambiato durante l’esportazione. Riprova per avere dati coerenti.');
        if(expected>50000)throw new Error('Seleziona un periodo più breve (massimo 50.000 attività per file).');
        for(const row of r.data||[]){if(ids.has(row.id))throw new Error('Archivio aggiornato durante la lettura. Riprova.');ids.add(row.id);rows.push(row);}
        if(!(r.data||[]).length&&rows.length<expected)throw new Error('Lettura incompleta: nessun file parziale è stato esportato.');
        say('Caricate '+rows.length+' di '+expected+' attività...');
      } while(rows.length<expected);
      if(!rows.length)throw new Error('Nessuna attività nei filtri selezionati.');
      const session=await db.auth.getSession();if(session.data?.session?.user?.id!==owner)throw new Error('Account cambiato: esportazione annullata.');
      say('Preparazione dashboard, grafici e logo...');
      const response=await fetch('assets/report-template.json?v='+VERSION,{signal:controller.signal});if(!response.ok)throw new Error('Modello Excel non disponibile. Ricarica la pagina.');
      const template=await response.json();
      const blob=createWorkbook(template,rows,filters);const finalSession=await db.auth.getSession();if(finalSession.data?.session?.user?.id!==owner)throw new Error('Account cambiato: esportazione annullata.');const url=window.URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='GON_Rendicontazione_'+(filters.from||'inizio')+'_'+(filters.to||'oggi')+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>window.URL.revokeObjectURL(url),60000);
      say('Excel pronto: '+rows.length+' attività, 4 fogli e 2 grafici.');
    }catch(e){say('Esportazione non completata: '+(e?.message||e));}
    finally{clearTimeout(timeout);busy=false;if(btn)btn.disabled=false;}
  }
  function boot(){const b=document.getElementById('excel');if(!b)return;b.textContent='Esporta Excel con dashboard';b.onclick=download;try{if(typeof exportExcel==='function')exportExcel=download;}catch{}const p=document.createElement('p');p.id='gonExportStatus';p.className='small';p.setAttribute('role','status');p.style.marginTop='10px';b.parentElement.insertAdjacentElement('afterend',p);}
  window.GonExcelReport=Object.freeze({version:VERSION,createWorkbook,download});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
