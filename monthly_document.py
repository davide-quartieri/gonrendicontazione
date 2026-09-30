"""Client-period documents with VAT. Legacy snapshots retain the legacy renderer."""
VERSION = 'monthly-vat-1.0.0'


def one(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError('Monthly document marker missing or repeated: ' + old[:90])
    return source.replace(old, new, 1)


WORKBOOK = r'''
 function monthlyWorkbook(report){
  if(!window.XLSX)throw new Error('Libreria Excel non caricata.');
  const X=window.XLSX,d=report.document,t=d.totals,wb=X.utils.book_new();
  const title=(report.number||'BOZZA')+' | Rev. '+report.revision;
  const moneyFormat='#,##0.00;[Red](#,##0.00);"-"';
  const number=(v)=>v===null||v===undefined?null:Number(v);
  const cached=(formula,v)=>v===null||v===undefined?{t:'s',f:formula,v:'Da definire'}:{t:'n',f:formula,v:Number(v),z:moneyFormat};
  const lines=[['GON srl - PRESTAZIONI',title],['Quantita e prezzi sono quelli della copia salvata. Importi in EUR, IVA esclusa.'],[],['Rif.','Prestazione','U.M.','Quantita','Tariffa EUR','Importo EUR']];
  for(const l of d.lines)lines.push([(l.refs||[]).join(', '),l.description,l.unit,Number(l.quantity),number(l.price),number(l.amount)]);
  const count=d.lines.length,last=4+count,s=last+2;
  const summaryRows=[['Totale prestazioni',null,null,null,null,t.services],['Sconto %',d.discount_percent],['Sconto EUR',null,null,null,null,t.discount],['Spese imponibili, IVA esclusa',null,null,null,null,t.expenses],['IMPONIBILE',null,null,null,null,t.net],['Aliquota IVA %',number(d.vat_rate)],['IVA',null,null,null,null,t.vat],['TOTALE IVA INCLUSA',null,null,null,null,t.gross]];
  const table=X.utils.aoa_to_sheet(lines);
  X.utils.sheet_add_aoa(table,summaryRows,{origin:'A'+s});
  const exStart=s+10,exFirst=exStart+1,exLast=exStart+d.expenses.length;
  X.utils.sheet_add_aoa(table,[['SPESE IMPONIBILI','Giustificativo','Importo EUR, IVA esclusa'],...d.expenses.map(e=>[e.description,e.reference,Number(e.amount)])],{origin:'A'+exStart});
  for(let i=0;i<count;i++){
    const r=i+5;
    table['F'+r]=cached('IF(ISNUMBER(E'+r+'),ROUND(D'+r+'*E'+r+',2),"Da definire")',d.lines[i].amount);
    for(const c of ['D','E'])if(table[c+r])table[c+r].z='0.00##';
  }
  table['F'+s]=cached(count?'SUM(F5:F'+last+')':'0',t.services);
  table['F'+(s+2)]=cached('IF(ISNUMBER(F'+s+'),ROUND(F'+s+'*B'+(s+1)+'/100,2),"Da definire")',t.discount);
  table['F'+(s+3)]=cached(d.expenses.length?'SUM(C'+exFirst+':C'+exLast+')':'0',t.expenses);
  table['F'+(s+4)]=cached(count?'IF(COUNT(E5:E'+last+')='+count+',F'+s+'-F'+(s+2)+'+F'+(s+3)+',"Da definire")':'F'+s+'-F'+(s+2)+'+F'+(s+3),t.net);
  table['F'+(s+6)]=cached('IF(AND(ISNUMBER(F'+(s+4)+'),ISNUMBER(B'+(s+5)+')),ROUND(F'+(s+4)+'*B'+(s+5)+'/100,2),"Da definire")',t.vat);
  table['F'+(s+7)]=cached('IF(COUNT(F'+(s+4)+',F'+(s+6)+')=2,SUM(F'+(s+4)+',F'+(s+6)+'),"Da definire")',t.gross);
  table['!cols']=[{wch:27},{wch:63},{wch:15},{wch:16},{wch:18},{wch:22}];
  if(count)table['!autofilter']={ref:'A4:F'+last};
  const values=[['GON srl - RENDICONTO CLIENTE',title],['Cliente',d.client.name||d.client.display],['Periodo',date(d.period_from)+' - '+date(d.period_to)],[],['IMPONIBILE (EUR)',t.net??'Da definire'],['Aliquota IVA %',number(d.vat_rate)],['IVA (EUR)',t.vat??'Da definire'],['TOTALE IVA INCLUSA (EUR)',t.gross??'Da definire'],[],['Trattamento IVA',d.vat_note||'Aliquota unica sulle prestazioni nette e sulle spese imponibili.'],['Sintesi',d.header.summary],['Criteri',d.header.notes],['Fonte','Copia salvata nel modulo Rendiconti clienti GON'],['Avvertenza','Copia di lavoro. Non sostituisce la fattura; modifiche Excel non cambiano il documento archiviato.']];
  const summary=X.utils.aoa_to_sheet(values);summary['!cols']=[{wch:35},{wch:95}];
  summary.B5=cached("'Valorizzazione'!F"+(s+4),t.net);
  summary.B6=d.vat_rate===null||d.vat_rate===undefined?{t:'s',v:'Da definire'}:{t:'n',f:"'Valorizzazione'!B"+(s+5),v:Number(d.vat_rate),z:'0.00##'};
  summary.B7=cached("'Valorizzazione'!F"+(s+6),t.vat);
  summary.B8=cached("'Valorizzazione'!F"+(s+7),t.gross);
  X.utils.book_append_sheet(wb,summary,'Sintesi');X.utils.book_append_sheet(wb,table,'Valorizzazione');
  const acts=X.utils.aoa_to_sheet([['GON srl - ATTIVITA',title],[],['Rif.','Data','Attivita','Macroarea','Tipo ore','Ore'],...d.activities.map(a=>[a.ref,date(a.date),a.description,a.macro,a.type,Number(a.hours)])]);
  acts['!cols']=[{wch:8},{wch:14},{wch:65},{wch:43},{wch:14},{wch:14}];
  if(d.activities.length)acts['!autofilter']={ref:'A3:F'+(d.activities.length+3)};
  X.utils.book_append_sheet(wb,acts,'Attivita');return wb;
 }
 function buildHtml(report){return report?.document?.billing_basis==='client_period'?monthlyBuildHtml(report):legacyBuildHtml(report);}
 function excel(report){
  if(report?.document?.billing_basis!=='client_period')return legacyExcel(report);
  window.XLSX.writeFile(monthlyWorkbook(report),filename(report)+'.xlsx');
 }
'''


def patch_document(source):
    source = one(source, "const VERSION='commercial-1.0.0';", "const VERSION='" + VERSION + "';")
    start = source.index(' function buildHtml(report){')
    end = source.index('\n function downloadBlob(', start)
    legacy = source[start:end]
    monthly = one(legacy, 'function buildHtml(report)', 'function monthlyBuildHtml(report)')
    monthly = one(monthly, "esc(d.client.name)+' | '+esc(d.project.code)+' | '+", "esc(d.client.name)+' | '+")
    monthly = one(monthly, '<p>${esc(d.project.name)}</p>', '<p>Rendiconto per cliente e periodo</p>')
    monthly = one(monthly, "<b>Commessa / ordine</b>${esc(d.project.code)} | ${esc(d.project.order_ref||'-')}", '<b>Accordo di riferimento</b>${esc(terms)}')
    monthly = one(monthly, "['CORRISPETTIVO DEL PERIODO',eur(d.totals.net)]", "['IMPONIBILE',eur(d.totals.net)],['IVA '+(d.vat_rate===null||d.vat_rate===undefined?'da definire':n(d.vat_rate)+'%'),eur(d.totals.vat)],['TOTALE IVA INCLUSA',eur(d.totals.gross)]")
    monthly = one(monthly, '<div>CORRISPETTIVO DEL PERIODO<br><small>Dettaglio nel quadro economico | IVA e altri oneri esclusi</small></div><strong>${eur(d.totals.net)}</strong>', '<div>TOTALE IVA INCLUSA<br><small>Imponibile ${eur(d.totals.net)} | IVA ${eur(d.totals.vat)}</small></div><strong>${eur(d.totals.gross)}</strong>')
    monthly = one(monthly, "monthly:'Canone mensile'", "monthly:'Forfait mensile'")
    monthly = one(monthly, '<h2>07 Spese concordate</h2>', '<h2>07 Spese imponibili concordate, IVA esclusa</h2>')
    monthly = one(monthly, 'Importi in EUR. IVA e altri oneri eventualmente applicabili non sono calcolati nel presente rendiconto. Sconto applicato soltanto alle prestazioni; spese non scontate.', "Importi in EUR. IVA unica applicata alle prestazioni al netto dello sconto e alle spese imponibili, non scontate. Oneri ulteriori non calcolati. ${esc(d.vat_note||'')}")
    source = source[:start] + legacy.replace('function buildHtml(report)', 'function legacyBuildHtml(report)', 1) + '\n' + monthly + source[end:]
    source = one(source, ' function excel(report){', ' function legacyExcel(report){')
    source = one(source, ' window.GonClientDocument=Object.freeze({version:VERSION,buildHtml,open,download,excel});', WORKBOOK + '\n window.GonClientDocument=Object.freeze({version:VERSION,buildHtml,open,download,excel,monthlyWorkbook});')
    return source
