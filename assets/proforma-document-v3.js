/* Proforma v3 renderer. Only saved snapshots; older documents retain their renderer. */
(() => {
 'use strict';
 const previous=window.GonClientDocument;
 if(!previous)throw new Error('Modulo documenti non disponibile.');
 const VERSION='proforma-v3.0.0';
 const isNew=r=>Number(r?.document?.proforma_schema)===3;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=s=>s?String(s).slice(0,10).split('-').reverse().join('/'):'';
 const n=s=>s==null?'Da definire':Number(s).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:6});
 const eur=s=>s==null?'Da definire':(Number(s)===0?0:Number(s)).toLocaleString('it-IT',{style:'currency',currency:'EUR'});
 const clean=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_.-]+/g,'_').slice(0,100);
 const filename=r=>'Fattura_proforma_'+clean(r.document.client.legal?.legal_name||r.document.client.name)+'_'+clean(r.number||'BOZZA-'+r.id.slice(0,8))+'_rev'+r.revision;
 function lineDate(l,d){
  const month=String(l.unit_key||'').match(/(\d{4}-\d{2})$/);
  if(l.mode==='monthly'&&month){const [y,m]=month[1].split('-').map(Number);return date(month[1]+'-01')+' - '+date(new Date(Date.UTC(y,m,0)).toISOString());}
  return (l.dates||[]).slice().sort().map(date).join(', ')||date(d.period_from)+' - '+date(d.period_to);
 }
 function sortedLines(d){return d.lines.slice().sort((a,b)=>String(a.dates?.[0]||d.period_from).localeCompare(String(b.dates?.[0]||d.period_from))||String(a.site||'').localeCompare(String(b.site||'')));}
 function buildHtml(r){
  if(!isNew(r))return previous.buildHtml(r);
  const d=r.document,t=d.totals,h=d.header||{},p=d.client.legal||{},acts=d.activities.slice().sort((a,b)=>a.date.localeCompare(b.date)||String(a.client).localeCompare(String(b.client))||String(a.id).localeCompare(String(b.id)));
  const logo=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(h.logo||'')?'<img src="'+h.logo+'" alt="GON">':'<strong class="wordmark">GON srl</strong>';
  const label=r.number||'BOZZA NON EMESSA', rev=Number(r.revision||0);
  const header=()=>'<header>'+logo+'<div>FATTURA PROFORMA<br><strong>'+esc(label)+'</strong> | Rev. '+rev+'<br><small>'+date(d.issued_at||r.issued_at)+'</small></div></header>';
  const footer='<footer>Fattura proforma - Documento non valido ai fini fiscali. Non sostituisce la fattura elettronica.<br>'+esc(h.issuer||'GON srl')+' | '+esc(label)+' | Rev. '+rev+'</footer>';
  const fields=[['Partita IVA',p.vat_number],['Codice fiscale',p.tax_code],['Codice destinatario',p.sdi_code],['PEC',p.pec],['Email',p.email],['Telefono',p.phone],['Referente',p.contact]];
  const info=fields.filter(([,v])=>v).map(([k,v])=>'<div><small>'+esc(k)+'</small><br>'+esc(v)+'</div>').join('');
  const amountRows=[['Prestazioni',t.services],['Sconto sulle prestazioni ('+n(d.discount_percent)+'%)',t.discount==null?null:-Number(t.discount)],['Spese imponibili',t.expenses],['Compensi netti e spese',t.net],['Base Cassa geometri',t.cassa_base],['Cassa geometri '+n(d.cassa_rate)+'%',t.cassa],['Imponibile IVA',t.taxable],['IVA '+n(d.vat_rate)+'%',t.vat],['TOTALE PROFORMA',t.gross]];
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';img-src data:;style-src 'unsafe-inline';script-src 'unsafe-inline'"><title>${esc(filename(r))}</title><style>
  @page{size:A4;margin:15mm 12mm}*{box-sizing:border-box}body{margin:0;background:#edf3f7;color:#193c54;font:11px/1.45 Arial,sans-serif}.sheet{width:210mm;min-height:297mm;background:white;padding:15mm 12mm;margin:20px auto}header{display:flex;justify-content:space-between;gap:18px;align-items:center;border-bottom:2px solid #176496;padding-bottom:12px;margin-bottom:16px}header img{width:165px;max-height:65px;object-fit:contain}header div{text-align:right}.wordmark{font-size:28px}h1{font-size:24px;margin:8px 0}h2{font-size:15px;margin:20px 0 8px}p{white-space:pre-wrap;overflow-wrap:anywhere}small,.note{color:#597185}.nonfiscal{font-weight:bold;color:#914800}.info{display:grid;grid-template-columns:1fr 1fr;gap:18px;background:#f0f6fa;padding:12px}.party{font-size:14px;font-weight:bold}.facts{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:10px}.table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#173f5a;color:white;text-align:left;padding:8px 5px;font-size:10px}td{border-bottom:1px solid #dbe6ee;padding:8px 5px;vertical-align:middle;overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}.num{text-align:right;font-variant-numeric:tabular-nums}.date{font-size:10px}.totals{width:62%;margin:18px 0 0 auto;border-collapse:collapse}.totals td{padding:5px 7px}.totals tr:last-child{background:#173f5a;color:white;font-weight:bold;font-size:14px}.note{font-size:10px;margin:8px 0}.banner{background:#fff0d4;color:#875710;padding:10px}.kpis{display:flex;gap:10px;margin:12px 0}.kpis div{flex:1;background:#eff6fa;padding:9px}.kpis b{display:block;font-size:18px}footer{border-top:1px solid #cddde8;margin-top:18px;padding-top:8px;font-size:9px;color:#597185}.toolbar{text-align:center;padding:12px}.toolbar button{background:#176496;color:white;border:0;border-radius:8px;padding:10px 20px}.activity td{font-size:10px}
  @media print{body{background:white}.sheet{width:auto;min-height:0;padding:0;margin:0;break-before:page}.sheet:first-of-type{break-before:auto}.toolbar{display:none}.info,.totals,header,.kpis{break-inside:avoid}h1,h2{break-after:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  @media screen and (max-width:820px){.sheet{width:100%;padding:18px;min-height:0}.info{grid-template-columns:1fr}.totals{width:100%}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">Stampa / Salva PDF</button><p class="note">Salva come PDF; disattiva le intestazioni e i pie di pagina del browser.</p></div>
  <section class="sheet">${header()}<h1>FATTURA PROFORMA</h1><p class="nonfiscal">Documento non valido ai fini fiscali</p>${!r.number?'<p class="banner">BOZZA: verificare anagrafica, interventi e corrispettivi prima dell\u2019emissione.</p>':''}
  <div class="info"><div><small>CLIENTE</small><div class="party">${esc(p.legal_name||d.client.name)}</div><p>${esc([p.address,[p.postcode,p.city,p.province].filter(Boolean).join(' '),p.country].filter(Boolean).join('\n'))}</p><div class="facts">${info}</div></div><div><small>PERIODO DELLE PRESTAZIONI</small><p><strong>${date(d.period_from)} - ${date(d.period_to)}</strong></p><small>CANTIERI / SEDI</small><p>${esc((d.client.sites||[]).map(s=>s.site||s.display).join(' / ')||d.client.site)}</p><small>EMITTENTE</small><p>${esc(h.issuer||'GON srl')}</p><small>REFERENTE GON</small><p>${esc(h.contact||'')}</p>${p.payment_terms?'<small>CONDIZIONI DI PAGAMENTO</small><p>'+esc(p.payment_terms)+'</p>':''}</div></div>
  <h2>Prestazioni per data e attivit\u00e0</h2><p>${esc(h.summary||'')}</p><table class="table"><colgroup><col style="width:15%"><col style="width:42%"><col style="width:11%"><col style="width:15%"><col style="width:17%"></colgroup><thead><tr><th>Data / periodo</th><th>Attivit\u00e0 e cantiere</th><th class="num">Quantit\u00e0</th><th class="num">Prezzo EUR</th><th class="num">Importo EUR</th></tr></thead><tbody>${sortedLines(d).map(l=>'<tr><td class="date">'+esc(lineDate(l,d))+'</td><td>'+esc(l.description)+'<br><small>'+esc([l.site,l.macro,l.type].filter(Boolean).join(' | '))+'</small></td><td class="num">'+n(l.quantity)+'<br><small>'+esc(l.unit)+'</small></td><td class="num">'+eur(l.price)+'</td><td class="num">'+eur(l.amount)+'</td></tr>').join('')}</tbody></table>
  ${d.expenses.length?'<h2>Spese imponibili concordate</h2><table class="table"><tbody>'+d.expenses.map(e=>'<tr><td>'+esc(e.description)+(e.reference?' | '+esc(e.reference):'')+'</td><td class="num">'+eur(e.amount)+'</td></tr>').join('')+'</tbody></table>':''}
  <table class="totals"><tbody>${amountRows.map(([k,v])=>'<tr><td>'+esc(k)+'</td><td class="num">'+eur(v)+'</td></tr>').join('')}</tbody></table>
  <p class="note">Cassa geometri calcolata ${d.cassa_on_expenses?'su compensi netti e spese imponibili':'sui compensi netti, escluse le spese'}. L\u2019IVA si applica dopo l\u2019aggiunta della Cassa. ${esc(d.vat_note||'')}</p>
  <p class="note">Le voci a forfait sostituiscono la valorizzazione oraria delle attivit\u00e0 collegate: nessun doppio addebito. Le ore originali rimangono nel dettaglio operativo.</p>
  ${footer}</section>
  <section class="sheet">${header()}<h1>Dettaglio giornaliero delle attivit\u00e0</h1><p>${esc(p.legal_name||d.client.name)} | ${date(d.period_from)} - ${date(d.period_to)}</p>
  <div class="kpis">${['Cantiere','Viaggio','Ufficio'].map(type=>'<div>'+type+'<b>'+n(acts.filter(a=>a.type===type).reduce((s,a)=>s+Number(a.hours),0))+' h</b></div>').join('')}</div>
  <table class="table activity"><colgroup><col style="width:14%"><col style="width:17%"><col style="width:18%"><col style="width:42%"><col style="width:9%"></colgroup><thead><tr><th>Data</th><th>Cantiere</th><th>Operatore</th><th>Attivit\u00e0 svolta</th><th class="num">Ore</th></tr></thead><tbody>${acts.map(a=>'<tr><td>'+date(a.date)+'</td><td>'+esc(a.site||a.client)+'</td><td>'+esc(a.employee)+'</td><td>'+esc(a.description)+'<br><small>'+esc(a.macro+' | '+a.type)+'</small></td><td class="num">'+n(a.hours)+'</td></tr>').join('')}</tbody></table>
  <p class="note">Ore-persona decimali: il totale di due operatori non indica automaticamente la durata della squadra. Mezza giornata e giornata intera vengono confermate dall\u2019amministrazione.</p>${h.deliverables?'<h2>Elaborati / consegne</h2><p>'+esc(h.deliverables)+'</p>':''}${h.notes?'<h2>Note</h2><p>'+esc(h.notes)+'</p>':''}${footer}</section></body></html>`;
 }
 function workbook(r){
  const X=window.XLSX;if(!X)throw new Error('Libreria Excel non caricata.');
  const d=r.document,t=d.totals,p=d.client.legal||{},wb=X.utils.book_new(),ls=sortedLines(d),moneyFormat='#,##0.00;[Red](#,##0.00);"-"';
  const cached=(f,v)=>v==null?{t:'s',f,v:'Da definire'}:{t:'n',f,v:Number(v),z:moneyFormat};
  const lines=[['GON - FATTURA PROFORMA',r.number||'BOZZA'],['Documento non valido ai fini fiscali - copia di lavoro'],[],['Data / periodo','Cantiere','Attivita','Macroarea','Tipo','Quantita','U.M.','Prezzo EUR','Importo EUR'],...ls.map(l=>[lineDate(l,d),l.site||'',l.description,l.macro,l.type,Number(l.quantity),l.unit,l.price,l.amount])];
  const ws=X.utils.aoa_to_sheet(lines),last=4+ls.length,s=last+3;
  const totals=[['Prestazioni',null,null,null,null,null,null,null,t.services],['Sconto %',d.discount_percent],['Sconto EUR',null,null,null,null,null,null,null,t.discount],['Spese imponibili',null,null,null,null,null,null,null,t.expenses],['Compensi netti e spese',null,null,null,null,null,null,null,t.net],['Cassa %',d.cassa_rate],['Base Cassa',null,null,null,null,null,null,null,t.cassa_base],['Spese soggette Cassa: 1=si, 0=no',d.cassa_on_expenses?1:0],['Cassa geometri',null,null,null,null,null,null,null,t.cassa],['Imponibile IVA',null,null,null,null,null,null,null,t.taxable],['IVA %',d.vat_rate],['IVA EUR',null,null,null,null,null,null,null,t.vat],['TOTALE PROFORMA',null,null,null,null,null,null,null,t.gross]];
  X.utils.sheet_add_aoa(ws,totals,{origin:'A'+s});
  ls.forEach((l,i)=>{const j=i+5;ws['I'+j]=cached('IF(AND(ISNUMBER(F'+j+'),ISNUMBER(H'+j+')),ROUND(F'+j+'*H'+j+',2),"Da definire")',l.amount);});
  const ex=s+16;X.utils.sheet_add_aoa(ws,[['Spesa','Giustificativo','Importo EUR'],...d.expenses.map(e=>[e.description,e.reference,e.amount])],{origin:'A'+ex});
  ws['I'+s]=cached(ls.length?'SUM(I5:I'+last+')':'0',t.services);
  ws['I'+(s+2)]=cached('ROUND(I'+s+'*B'+(s+1)+'/100,2)',t.discount);
  ws['I'+(s+3)]=cached(d.expenses.length?'SUM(C'+(ex+1)+':C'+(ex+d.expenses.length)+')':'0',t.expenses);
  ws['I'+(s+4)]=cached('IF('+(ls.length?'COUNT(H5:H'+last+')='+ls.length:'TRUE')+',ROUND(I'+s+'-I'+(s+2)+'+I'+(s+3)+',2),"Da definire")',t.net);
  ws['I'+(s+6)]=cached('IF(ISNUMBER(I'+(s+4)+'),I'+(s+4)+'-IF(B'+(s+7)+'=1,0,I'+(s+3)+'),"Da definire")',t.cassa_base);
  ws['I'+(s+8)]=cached('IF(AND(ISNUMBER(I'+(s+6)+'),ISNUMBER(B'+(s+5)+')),ROUND(I'+(s+6)+'*B'+(s+5)+'/100,2),"Da definire")',t.cassa);
  ws['I'+(s+9)]=cached('IF(COUNT(I'+(s+4)+',I'+(s+8)+')=2,SUM(I'+(s+4)+',I'+(s+8)+'),"Da definire")',t.taxable);
  ws['I'+(s+11)]=cached('IF(AND(ISNUMBER(I'+(s+9)+'),ISNUMBER(B'+(s+10)+')),ROUND(I'+(s+9)+'*B'+(s+10)+'/100,2),"Da definire")',t.vat);
  ws['I'+(s+12)]=cached('IF(COUNT(I'+(s+9)+',I'+(s+11)+')=2,SUM(I'+(s+9)+',I'+(s+11)+'),"Da definire")',t.gross);
  ws['!cols']=[{wch:28},{wch:25},{wch:65},{wch:35},{wch:14},{wch:15},{wch:14},{wch:18},{wch:20}];if(ls.length)ws['!autofilter']={ref:'A4:I'+last};
  const summary=X.utils.aoa_to_sheet([['FATTURA PROFORMA',r.number||'BOZZA'],['Documento non valido ai fini fiscali'],['Cliente',p.legal_name||d.client.name],['Indirizzo',[p.address,p.postcode,p.city,p.province,p.country].filter(Boolean).join(' ')],['P. IVA / CF',[p.vat_number,p.tax_code].filter(Boolean).join(' / ')],['Periodo',date(d.period_from)+' - '+date(d.period_to)],[],['Compensi netti e spese',t.net],['Cassa geometri',t.cassa],['Imponibile IVA',t.taxable],['IVA',t.vat],['TOTALE',t.gross],[],['PEC',p.pec||''],['Codice destinatario',p.sdi_code||''],['Email / telefono',[p.email,p.phone].filter(Boolean).join(' / ')],['Pagamento',p.payment_terms||''],['Avvertenza','Modificare questo Excel non modifica il documento archiviato.']]);
  for(const [row,offset,val] of [[8,4,t.net],[9,8,t.cassa],[10,9,t.taxable],[11,11,t.vat],[12,12,t.gross]])summary['B'+row]=cached("'Valorizzazione'!I"+(s+offset),val);
  summary['!cols']=[{wch:32},{wch:92}];X.utils.book_append_sheet(wb,summary,'Sintesi');X.utils.book_append_sheet(wb,ws,'Valorizzazione');
  const acts=X.utils.aoa_to_sheet([['GON - DETTAGLIO GIORNALIERO'],['Documento non valido ai fini fiscali'],[],['Data','Cantiere','Operatore','Macroarea','Tipo','Attivita','Ore'],...d.activities.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(a=>[date(a.date),a.site||a.client,a.employee,a.macro,a.type,a.description,Number(a.hours)])]);
  acts['!cols']=[{wch:14},{wch:27},{wch:26},{wch:36},{wch:14},{wch:75},{wch:12}];if(d.activities.length)acts['!autofilter']={ref:'A4:G'+(4+d.activities.length)};X.utils.book_append_sheet(wb,acts,'Attivita');return wb;
 }
 function download(r){if(!isNew(r))return previous.download(r);const blob=new Blob([buildHtml(r)],{type:'text/html;charset=utf-8'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=filename(r)+'.html';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
 function open(r){if(!isNew(r))return previous.open(r);const w=window.open('','_blank');if(!w)throw new Error('Consenti la finestra di anteprima.');w.opener=null;w.document.open();w.document.write(buildHtml(r));w.document.close();}
 function excel(r){if(!isNew(r))return previous.excel(r);window.XLSX.writeFile(workbook(r),filename(r)+'.xlsx');}
 window.GonClientDocument=Object.freeze({...previous,version:VERSION,buildHtml,open,download,excel,workbookV3:workbook,filenameV3:filename});
})();
