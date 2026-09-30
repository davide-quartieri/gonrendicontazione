/* Client document v1. Only immutable/saved snapshot fields are rendered. */
(() => {
 'use strict';
 const VERSION='commercial-1.0.0';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const n=v=>Number(v||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:4});
 const eur=v=>v===null||v===undefined?'Da definire':Number(v).toLocaleString('it-IT',{style:'currency',currency:'EUR'});
 const date=s=>s?String(s).slice(0,10).split('-').reverse().join('/'):'';
 const rows=(heads,data)=>'<table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+data.map(r=>'<tr>'+r.map((v,i)=>'<td'+(i===r.length-1?' class="num"':'')+'>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const sum=a=>a.reduce((v,x)=>v+Number(x.hours||0),0);
 const filename=r=>(r.number||'BOZZA-'+r.id.slice(0,8))+'_rev'+r.revision;
 function buildHtml(report){
  if(!report?.document)throw new Error('Documento non disponibile.');
  const d=report.document,h=d.header,acts=d.activities,total=sum(acts),types=['Cantiere','Viaggio','Ufficio'];
  const groups=new Map();for(const a of acts)groups.set(a.macro,(groups.get(a.macro)||0)+Number(a.hours));const highest=Math.max(1,...groups.values());
  const logo=/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(h.logo||'')?'<img src="'+h.logo+'" alt="GON">':'<strong class="wordmark">GON <small>srl</small></strong>';
  const label=d.number||report.number||'BOZZA - NON EMESSA',revision=d.revision??report.revision;
  const meta=esc(d.client.name)+' | '+esc(d.project.code)+' | '+date(d.period_from)+' - '+date(d.period_to);
  const header=()=>'<header>'+logo+'<div>'+esc(label)+'<br><small>Revisione '+revision+(d.issued_at?' | '+date(d.issued_at):'')+'</small></div></header>';
  const footer='<footer>'+esc(h.issuer||'GON srl')+' | '+esc(label)+' | Rev. '+revision+'</footer>';
  const terms=[...new Set(d.lines.map(l=>l.terms_reference).filter(Boolean))].join('; ')||'Condizioni indicate nel quadro economico';
  const notes=d.lines.some(l=>Number(l.round_minutes)>0&&l.round_mode!=='none')?'Sono applicati gli arrotondamenti concordati riportati nel quadro economico.':'Nessun arrotondamento aggiuntivo automatico delle ore.';
  const summaryLines=[['Totale prestazioni',eur(d.totals.services)],['Sconto '+n(d.discount_percent)+'% sulle prestazioni','- '+eur(d.totals.discount)],['Prestazioni al netto dello sconto',eur(Number(d.totals.services)-Number(d.totals.discount))],['Spese concordate (non scontate)',eur(d.totals.expenses)],['CORRISPETTIVO DEL PERIODO',eur(d.totals.net)]];
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${esc(filename(report))}</title><style>
   @page{size:A4;margin:16mm 14mm}*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:#18394e;font:11px/1.45 Arial,sans-serif}.sheet{width:210mm;min-height:297mm;margin:18px auto;padding:16mm 14mm;background:white;box-shadow:0 4px 22px #18394e18}
   header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #155f96;padding-bottom:10px;margin-bottom:12px}header img{width:170px;max-height:64px;object-fit:contain}header div{text-align:right;font-size:11px;color:#547086}.wordmark{font-size:30px}.wordmark small{font-size:14px}
   .eyebrow{color:#168b8a;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em}h1{font-size:25px;margin:5px 0 10px;line-height:1.2}h2{font-size:14px;margin:18px 0 8px}p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.muted,small{color:#607c90}.info{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#eff6fa;padding:12px;margin:12px 0}.info b{display:block;color:#607c90;text-transform:uppercase;font-size:9px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kpi{background:#eff6fa;border-top:3px solid #168b8a;padding:10px}.kpi b{display:block;font-size:21px;margin-top:7px}.kpi small{font-size:9px}
   table{width:100%;border-collapse:collapse;margin:8px 0;table-layout:auto}th{background:#123d5b;color:white;font-size:10px;text-align:left;padding:9px}td{padding:8px;border-bottom:1px solid #dbe6ed;vertical-align:middle;overflow-wrap:anywhere;max-width:270px}td.num{text-align:right;white-space:nowrap}tr{break-inside:avoid}thead{display:table-header-group}tfoot{display:table-footer-group}
   .bar{height:11px;background:#155f96}.bars td:first-child{width:48%}.bars td:last-child{width:26%}.money{background:#123d5b;color:white;padding:14px;margin-top:18px;display:flex;justify-content:space-between;align-items:center;gap:16px}.money strong{font-size:23px;white-space:nowrap}.money small{color:#c5e5f4}.note{font-size:10px;color:#607c90}.warn{padding:10px;background:#fff3df;color:#815516}.economics td:last-child{font-variant-numeric:tabular-nums}.totals tr:last-child{background:#123d5b;color:white;font-weight:bold}footer{margin-top:24px;color:#607c90;border-top:1px solid #dbe6ed;padding-top:8px;font-size:9px}.toolbar{padding:12px;text-align:center}.toolbar button{padding:10px 20px;cursor:pointer;border:0;border-radius:8px;background:#155f96;color:white}
   @media print{body{background:white}.sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none;break-before:page}.sheet:first-of-type{break-before:auto}.toolbar{display:none}a{color:inherit}h1,h2,header{break-after:avoid}.kpis,.money,.info{break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
   @media screen and (max-width:820px){.sheet{width:100%;padding:20px;min-height:0}.kpis{grid-template-columns:1fr 1fr}.info{grid-template-columns:1fr}.money{flex-wrap:wrap}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">Stampa / Salva in PDF</button><p class="note">Nella finestra di stampa scegli Salva come PDF. Disattiva intestazioni e pie di pagina del browser.</p></div>
  <section class="sheet">${header()}<div class="eyebrow">Rendiconto cliente</div><h1>Attivit\u00e0, ore e corrispettivi</h1><p>${esc(d.project.name)}</p>${!d.number?'<p class="warn">BOZZA NON EMESSA - da verificare prima dell\u2019invio.</p>':''}
   <div class="info"><div><b>Destinatario</b>${esc(d.client.name)}<p>${esc(h.recipient_address)}</p><b>Referente cliente</b>${esc(h.recipient_contact||'-')}</div><div><b>Periodo</b>${date(d.period_from)} - ${date(d.period_to)}<b>Cantiere / sede</b>${esc(d.client.site||d.client.display)}<b>Commessa / ordine</b>${esc(d.project.code)} | ${esc(d.project.order_ref||'-')}</div></div>
   <h2>01 Sintesi delle attivit\u00e0</h2><p>${esc(h.summary||'Sintesi da completare')}</p><h2>02 Ore delle attivit\u00e0 selezionate</h2><div class="kpis">${[['Totale',total],...types.map(t=>[t,sum(acts.filter(a=>a.type===t))])].map(([t,v])=>'<div class="kpi"><small>'+esc(t.toUpperCase())+'</small><b>'+n(v)+' h</b></div>').join('')}</div>
   <p class="note">Ore-persona in formato decimale. Le quantit\u00e0 valorizzate e le eventuali rettifiche commerciali sono esposte nel quadro economico.</p>
   <h2>03 Distribuzione delle ore per macroarea</h2><table class="bars"><thead><tr><th>Macroarea</th><th>Ore</th><th>Quota</th><th>Confronto</th></tr></thead><tbody>${[...groups].map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+n(v)+'</td><td>'+n(total?v*100/total:0)+'%</td><td><div class="bar" style="width:'+Math.round(v/highest*100)+'%"></div></td></tr>').join('')}</tbody></table>
   <p class="note">PROGRAMMATO / PROGRAMMATA identifica la categoria delle attivit\u00e0 svolte, non ore future.</p><div class="money"><div>CORRISPETTIVO DEL PERIODO<br><small>Dettaglio nel quadro economico | IVA e altri oneri esclusi</small></div><strong>${eur(d.totals.net)}</strong></div>${footer}</section>
  <section class="sheet">${header()}<div class="eyebrow">Dettaglio del periodo</div><h1>Attivit\u00e0 eseguite</h1><p class="muted">${meta}</p>
   ${rows(['Rif.','Data','Attivit\u00e0 / risultato','Macroarea','Tipo','Ore'],acts.map(a=>[String(a.ref).padStart(2,'0'),date(a.date),a.description,a.macro,a.type,n(a.hours)]))}<p><strong>Totale ore selezionate: ${n(total)} h</strong></p>
   <h2>04 Elaborati e riferimenti di consegna</h2><p>${esc(h.deliverables||'Nessun riferimento aggiuntivo indicato.')}</p><h2>05 Note e criteri applicati</h2><p>${esc(h.notes||notes)}</p><p class="note">Le ore di viaggio sono esposte separatamente. I corrispettivi fanno riferimento alle quantit\u00e0 approvate nel quadro economico; le ore operative originali restano conservate nell'archivio GON.</p><div class="info"><div><b>Referente GON / contatto</b>${esc(h.contact||'-')}</div><div><b>Documento</b>${esc(label)} | Rev. ${revision}</div></div>${footer}</section>
  <section class="sheet">${header()}<div class="eyebrow">Quadro economico</div><h1>Valorizzazione delle prestazioni</h1><p class="muted">${meta}</p><div class="info"><div><b>Riferimento economico</b>${esc(terms)}</div><div><b>Modalit\u00e0</b>${esc([...new Set(d.lines.map(l=>({hour:'A ore',fixed:'Forfait',monthly:'Canone mensile'}[l.mode])))].join(' / '))}</div></div>
   <h2>06 Prestazioni valorizzate</h2><div class="economics">${rows(['Rif.','Prestazione / tipo ore','Quantit\u00e0','U.M.','Tariffa EUR','Importo EUR'],d.lines.map(l=>[l.refs.join(', '),l.description,n(l.quantity),l.unit,l.price===null?'Da definire':n(l.price),eur(l.amount)]))}</div>
   <p class="note">Importo riga = quantit\u00e0 x tariffa, arrotondato al centesimo. Per forfait e canoni le ore operative non vengono addebitate nuovamente.</p>
   <h2>07 Spese concordate</h2>${d.expenses.length?rows(['Descrizione / giustificativo','Importo EUR'],d.expenses.map(e=>[e.description+(e.reference?' | '+e.reference:''),eur(e.amount)])):'<p>Nessuna spesa aggiuntiva.</p>'}
   <h2>08 Riepilogo economico</h2><div class="totals">${rows(['Voce','Importo EUR'],summaryLines)}</div>
   <p class="note">Importi in EUR. IVA e altri oneri eventualmente applicabili non sono calcolati nel presente rendiconto. Sconto applicato soltanto alle prestazioni; spese non scontate.</p><p class="note">Documento di rendicontazione tecnico-economica: non sostituisce la fattura.</p>${footer}</section></body></html>`;
 }
 function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
 function open(report){const w=window.open('','_blank');if(!w)return alert('Consenti l apertura della finestra di anteprima.');w.opener=null;w.document.open();w.document.write(buildHtml(report));w.document.close();}
 function download(report){downloadBlob(new Blob([buildHtml(report)],{type:'text/html;charset=utf-8'}),filename(report)+'.html');}
 function excel(report){
  if(!window.XLSX)return alert('Libreria Excel non caricata. Ricarica la pagina e riprova.');
  const X=window.XLSX,d=report.document,wb=X.utils.book_new(),title=(report.number||'BOZZA')+' | Rev. '+report.revision;
  const values=[['GON srl - RENDICONTO CLIENTE',title],['Cliente',d.client.name],['Commessa',d.project.code+' - '+d.project.name],['Periodo',date(d.period_from)+' - '+date(d.period_to)],[],['CORRISPETTIVO (EUR)',d.totals.net??'Da definire'],['IVA e altri oneri','Esclusi, non calcolati'],[],['Sintesi',d.header.summary],['Criteri',d.header.notes],['Fonte','Copia salvata nel modulo Rendiconti clienti GON']];
  const summary=X.utils.aoa_to_sheet(values);summary['!cols']=[{wch:34},{wch:90}];summary.B6={t:d.totals.net===null?'s':'n',v:d.totals.net??'Da definire',z:'#,##0.00'};X.utils.book_append_sheet(wb,summary,'Sintesi');
  const data=[['GON srl - PRESTAZIONI',title],['Quantita e prezzi sono quelli del documento salvato.'],[],['Rif.','Prestazione','U.M.','Quantita','Tariffa EUR','Importo EUR']];
  for(const l of d.lines)data.push([l.refs.join(', '),l.description,l.unit,Number(l.quantity),l.price===null?null:Number(l.price),l.amount]);
  const table=X.utils.aoa_to_sheet(data),last=data.length;
  for(let i=0;i<d.lines.length;i++){const row=i+5;if(d.lines[i].price!==null)table['F'+row]={t:'n',f:'ROUND(D'+row+'*E'+row+',2)',v:d.lines[i].amount,z:'#,##0.00'};}
  X.utils.sheet_add_aoa(table,[['Totale prestazioni',null,null,null,null,d.totals.services],['Sconto %',d.discount_percent],['Sconto EUR',null,null,null,null,d.totals.discount],['Spese concordate',null,null,null,null,d.totals.expenses],['CORRISPETTIVO',null,null,null,null,d.totals.net]],{origin:'A'+(last+2)});
  const s=last+2;table['F'+s]={t:'n',f:'SUM(F5:F'+last+')',v:d.totals.services,z:'#,##0.00'};table['F'+(s+2)]={t:'n',f:'ROUND(F'+s+'*B'+(s+1)+'/100,2)',v:d.totals.discount,z:'#,##0.00'};
  if(d.totals.net!==null)table['F'+(s+4)]={t:'n',f:'F'+s+'-F'+(s+2)+'+F'+(s+3),v:d.totals.net,z:'#,##0.00'};
  const expenseStart=s+7;X.utils.sheet_add_aoa(table,[['SPESE','Giustificativo','Importo EUR'],...d.expenses.map(x=>[x.description,x.reference,x.amount])],{origin:'A'+expenseStart});
  table['!cols']=[{wch:18},{wch:60},{wch:14},{wch:16},{wch:18},{wch:20}];table['!autofilter']={ref:'A4:F'+last};X.utils.book_append_sheet(wb,table,'Valorizzazione');
  const activities=X.utils.aoa_to_sheet([['GON srl - ATTIVITA',title],[],['Rif.','Data','Attivita','Macroarea','Tipo ore','Ore'],...d.activities.map(a=>[a.ref,date(a.date),a.description,a.macro,a.type,a.hours])]);activities['!cols']=[{wch:7},{wch:14},{wch:65},{wch:43},{wch:14},{wch:14}];activities['!autofilter']={ref:'A3:F'+(d.activities.length+3)};X.utils.book_append_sheet(wb,activities,'Attivita');
  X.writeFile(wb,filename(report)+'.xlsx');
 }
 window.GonClientDocument=Object.freeze({version:VERSION,buildHtml,open,download,excel});
})();
