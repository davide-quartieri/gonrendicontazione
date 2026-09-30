const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const baseFile=process.argv[2],newFile=process.argv[3],out=process.argv[4];
function col(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function makeX(){
 const x={last:null,utils:{}};
 x.utils.book_new=()=>({SheetNames:[],Sheets:{}});
 x.utils.aoa_to_sheet=(a)=>{const s={};x.utils.sheet_add_aoa(s,a,{origin:'A1'});return s;};
 x.utils.sheet_add_aoa=(s,a,{origin})=>{const [,cc,rr]=origin.match(/^([A-Z]+)(\d+)$/);let c=0;for(const z of cc)c=c*26+z.charCodeAt(0)-64;for(let i=0;i<a.length;i++)for(let j=0;j<a[i].length;j++){const v=a[i][j];if(v!=null)s[col(c+j)+(Number(rr)+i)]={t:typeof v==='number'?'n':'s',v};}};
 x.utils.book_append_sheet=(b,s,n)=>{b.SheetNames.push(n);b.Sheets[n]=s;};x.writeFile=b=>x.last=b;return x;
}
function evaluate(file){const X=makeX(),context={window:{XLSX:X},console,URL,Blob,setTimeout,alert:()=>{throw new Error('Unexpected alert');}};vm.createContext(context);vm.runInContext(fs.readFileSync(file,'utf8'),context);return {doc:context.window.GonClientDocument,X};}
const base=evaluate(baseFile),next=evaluate(newFile),checks=[];
function check(name,fn){fn();checks.push(name);}
const fixture={id:'00000000-0000-4000-8000-000000000001',number:'RC-ESEMPIO',revision:1,state:'issued',document:{number:'RC-ESEMPIO',revision:1,issued_at:'2026-09-30',billing_basis:'client_period',client:{name:'Cliente dimostrativo',display:'Cliente dimostrativo',site:'Sede esempio'},project:{code:'INTERNO-NON-MOSTRARE',name:'Contenitore interno'},header:{issuer:'GON srl - ESEMPIO',summary:'Dati fittizi per il collaudo.',deliverables:'Elaborato dimostrativo',notes:'Dati esclusivamente dimostrativi.'},period_from:'2026-09-01',period_to:'2026-09-30',vat_rate:22,vat_note:'Aliquota indicata a solo scopo di test',discount_percent:5,activities:[{ref:1,date:'2026-09-10',description:'Rilievo dimostrativo',macro:'Rilievo in campo - PROGRAMMATO',type:'Cantiere',hours:10}],lines:[{id:'L1',refs:[1],description:'Rilievo dimostrativo',mode:'hour',unit:'h',quantity:10,price:100,amount:1000,terms_reference:'ACCORDO DI TEST',reason:'NOTA INTERNA DA NON PUBBLICARE'}],expenses:[{description:'Spesa dimostrativa',reference:'TEST',amount:50}],totals:{services:1000,discount:50,expenses:50,net:1000,vat:220,gross:1220,missing_rates:0,missing_vat:false}}};
const before=JSON.stringify(fixture),html=next.doc.buildHtml(fixture),wb=next.doc.monthlyWorkbook(fixture);
check('HTML shows VAT and gross without project',()=>{assert.ok(html.includes('TOTALE IVA INCLUSA'));assert.ok(html.includes((1220).toLocaleString('it-IT',{style:'currency',currency:'EUR'})));assert.ok(html.includes('220,00'));assert.ok(!html.includes('Commessa'));assert.ok(!html.includes('INTERNO-NON-MOSTRARE'));assert.ok(!html.includes('NOTA INTERNA'));});
check('No mutation of saved snapshot',()=>assert.equal(JSON.stringify(fixture),before));
check('Workbook summary values and formulas',()=>{assert.equal(wb.Sheets.Sintesi.B5.v,1000);assert.equal(wb.Sheets.Sintesi.B7.v,220);assert.equal(wb.Sheets.Sintesi.B8.v,1220);assert.match(wb.Sheets.Sintesi.B8.f,/Valorizzazione/);assert.equal(wb.Sheets.Valorizzazione.F13.v,220);assert.match(wb.Sheets.Valorizzazione.F13.f,/ROUND\(F11\*B12\/100,2\)/);assert.equal(wb.Sheets.Valorizzazione.F14.v,1220);});
check('Economic export route',()=>{next.doc.excel(fixture);assert.equal(JSON.stringify(next.X.last),JSON.stringify(wb));});
const legacy=structuredClone(fixture);delete legacy.document.billing_basis;delete legacy.document.vat_rate;delete legacy.document.vat_note;delete legacy.document.totals.vat;delete legacy.document.totals.gross;
check('Legacy HTML unchanged byte for byte',()=>assert.equal(next.doc.buildHtml(legacy),base.doc.buildHtml(legacy)));
check('Legacy Excel model unchanged',()=>{base.doc.excel(legacy);next.doc.excel(legacy);assert.equal(JSON.stringify(next.X.last),JSON.stringify(base.X.last));});
const flat=structuredClone(fixture);flat.document.activities=[];flat.document.lines[0]={...flat.document.lines[0],mode:'monthly',quantity:1,price:1000,refs:[],unit:'mese',description:'Forfait mensile complessivo'};delete flat.document.project;
check('Flat month without hours and without project',()=>{assert.ok(next.doc.buildHtml(flat).includes('Forfait mensile'));assert.ok(!next.doc.buildHtml(flat).includes('NaN'));assert.equal(next.doc.monthlyWorkbook(flat).Sheets.Sintesi.B8.v,1220);});
const zero=structuredClone(fixture);zero.document.vat_rate=0;zero.document.vat_note='Trattamento da verificare';zero.document.totals.vat=0;zero.document.totals.gross=1000;
check('Zero VAT not treated as missing',()=>{const w=next.doc.monthlyWorkbook(zero);assert.equal(w.Sheets.Sintesi.B7.v,0);assert.equal(w.Sheets.Sintesi.B8.v,1000);assert.ok(next.doc.buildHtml(zero).includes('Trattamento da verificare'));});
const missing=structuredClone(fixture);missing.document.lines[0].price=null;missing.document.lines[0].amount=null;Object.assign(missing.document.totals,{services:0,discount:0,net:null,vat:null,gross:null,missing_rates:1});
check('Missing price cannot masquerade as zero total',()=>{const w=next.doc.monthlyWorkbook(missing);assert.equal(w.Sheets.Sintesi.B8.v,'Da definire');assert.equal(w.Sheets.Valorizzazione.F11.v,'Da definire');assert.ok(w.Sheets.Valorizzazione.F11.f.includes('COUNT(E5:E5)=1'));});
const noVat=structuredClone(fixture);noVat.document.vat_rate=null;noVat.document.totals.vat=null;noVat.document.totals.gross=null;
check('Missing VAT preserved as unknown',()=>{assert.equal(next.doc.monthlyWorkbook(noVat).Sheets.Sintesi.B6.v,'Da definire');assert.equal(next.doc.monthlyWorkbook(noVat).Sheets.Sintesi.B8.v,'Da definire');});
const hostile=structuredClone(fixture);hostile.document.header.summary='<img src=x onerror=alert(1)>';hostile.document.vat_note='<script>bad()</script>';hostile.document.lines[0].description='=2+2';
check('Customer strings stay escaped text',()=>{const h=next.doc.buildHtml(hostile);assert.ok(!h.includes('<img src=x'));assert.ok(h.includes('&lt;script&gt;'));const c=next.doc.monthlyWorkbook(hostile).Sheets.Valorizzazione.B5;assert.equal(c.t,'s');assert.equal(c.v,'=2+2');assert.ok(!c.f);});
const empty=structuredClone(fixture);empty.document.lines=[];empty.document.activities=[];empty.document.expenses=[];empty.document.discount_percent=0;Object.assign(empty.document.totals,{services:0,discount:0,expenses:0,net:0,vat:0,gross:0});
check('Empty model has no reverse ranges',()=>{const w=next.doc.monthlyWorkbook(empty);assert.ok(!JSON.stringify(w).includes('F5:F4'));assert.equal(w.Sheets.Sintesi.B8.v,0);});
if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/monthly-report.html',html);fs.writeFileSync(out+'/legacy-report.html',base.doc.buildHtml(legacy));fs.writeFileSync(out+'/workbook-model.json',JSON.stringify(wb));fs.writeFileSync(out+'/checks.json',JSON.stringify(checks,null,2));}
console.log('MONTHLY DOCUMENT TESTS: '+checks.length+' passed: '+checks.join('; '));
