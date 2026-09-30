const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const [beforeFile,afterFile,uiFile]=process.argv.slice(2);
function col(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function makeX(){const X={utils:{}};X.utils.book_new=()=>({SheetNames:[],Sheets:{}});X.utils.sheet_add_aoa=(s,a,{origin})=>{const [,cc,rr]=origin.match(/^([A-Z]+)(\d+)$/);let c=0;for(const z of cc)c=c*26+z.charCodeAt(0)-64;for(let i=0;i<a.length;i++)for(let j=0;j<a[i].length;j++){const v=a[i][j];if(v!=null)s[col(c+j)+(Number(rr)+i)]={t:typeof v==='number'?'n':'s',v};}};X.utils.aoa_to_sheet=a=>{const s={};X.utils.sheet_add_aoa(s,a,{origin:'A1'});return s;};X.utils.book_append_sheet=(b,s,n)=>{b.SheetNames.push(n);b.Sheets[n]=s;};X.writeFile=b=>X.last=b;return X;}
function evaluate(path){const X=makeX(),c={window:{XLSX:X},console,URL,Blob,setTimeout,alert:()=>{throw new Error('Unexpected alert');}};vm.createContext(c);vm.runInContext(fs.readFileSync(path,'utf8'),c);return {doc:c.window.GonClientDocument,X};}
const before=evaluate(beforeFile),after=evaluate(afterFile),checks=[];
const r={id:'11111111-1111-4111-8111-111111111111',state:'draft',revision:0,document:{billing_basis:'client_period',client:{id:'TEST-ROOT',name:'Gedit',display:'Gedit',site:'Calcinato / Vighizzolo',billing_grouped:true,sites:[{client_id:'S1',site:'Calcinato',display:'Gedit Calcin'},{client_id:'S2',site:'Vighizzolo',display:'Gedit Vighiz'}]},header:{issuer:'GON - ESEMPIO',summary:'Dati fittizi di collaudo',notes:'Test only'},period_from:'2030-01-01',period_to:'2030-01-31',vat_rate:22,vat_note:'Aliquota di test',discount_percent:0,activities:[{ref:1,date:'2030-01-02',description:'Attivita alpha',macro:'Rilievo in campo',type:'Cantiere',hours:2,site:'Calcinato',client:'Gedit Calcin'},{ref:2,date:'2030-01-03',description:'Attivita beta',macro:'Rilievo in campo',type:'Cantiere',hours:3,site:'Vighizzolo',client:'Gedit Vighiz'}],lines:[{id:'L1',refs:[1,2],description:'Prestazione test',mode:'hour',unit:'h',quantity:5,price:100,amount:500,terms_reference:'TEST'}],expenses:[],totals:{services:500,discount:0,expenses:0,net:500,vat:110,gross:610,missing_rates:0,missing_vat:false}}};
function check(name,fn){fn();checks.push(name);}
const original=JSON.stringify(r),html=after.doc.buildHtml(r),wb=after.doc.monthlyWorkbook(r);
check('One recipient and both site labels in document',()=>{assert.ok(html.includes('Gedit'));assert.ok(html.includes('[Calcinato] Attivita alpha'));assert.ok(html.includes('[Vighizzolo] Attivita beta'));assert.ok(html.includes('Cantieri inclusi'));});
check('Source snapshot unchanged',()=>assert.equal(JSON.stringify(r),original));
check('VAT and amount formulas unchanged',()=>{const old=before.doc.monthlyWorkbook(r);for(const name of ['Valorizzazione'])assert.equal(JSON.stringify(old.Sheets[name]),JSON.stringify(wb.Sheets[name]));assert.equal(wb.Sheets.Sintesi.B8.v,610);assert.ok(wb.Sheets.Sintesi.B8.f);});
check('Excel preserves site per activity and combined recipient',()=>{const a=wb.Sheets.Attivita;assert.equal(a.G3.v,'Cantiere');assert.equal(a.G4.v,'Calcinato');assert.equal(a.G5.v,'Vighizzolo');assert.equal(a.F4.v,2);assert.equal(a.F5.v,3);assert.equal(a['!autofilter'].ref,'A3:G5');assert.equal(wb.Sheets.Sintesi.B2.v,'Gedit');assert.equal(wb.Sheets.Sintesi.B16.v,'Calcinato / Vighizzolo');});
const single=structuredClone(r);delete single.document.client.billing_grouped;delete single.document.client.sites;
check('Ungrouped monthly output unchanged',()=>{assert.equal(after.doc.buildHtml(single),before.doc.buildHtml(single));assert.equal(JSON.stringify(after.doc.monthlyWorkbook(single)),JSON.stringify(before.doc.monthlyWorkbook(single)));});
const legacy=structuredClone(single);delete legacy.document.billing_basis;delete legacy.document.vat_rate;legacy.document.project={code:'OLD',name:'Storico',order_ref:'OLD'};
check('Legacy issued output unchanged',()=>{assert.equal(after.doc.buildHtml(legacy),before.doc.buildHtml(legacy));before.doc.excel(legacy);after.doc.excel(legacy);assert.equal(JSON.stringify(after.X.last),JSON.stringify(before.X.last));});
const empty=structuredClone(r);empty.document.activities=[];empty.document.lines[0]={...empty.document.lines[0],mode:'monthly',quantity:1,price:500,refs:[],unit:'mese'};
check('Single group flat fee also works without hours',()=>{assert.ok(after.doc.buildHtml(empty).includes('Forfait mensile'));assert.equal(after.doc.monthlyWorkbook(empty).Sheets.Sintesi.B8.v,610);assert.ok(!after.doc.monthlyWorkbook(empty).Sheets.Attivita['!autofilter']);});
const special=structuredClone(r);special.document.activities[0].site='<b>=2+2</b>';
check('Site labels remain escaped text',()=>{assert.ok(!after.doc.buildHtml(special).includes('[<b>'));const c=after.doc.monthlyWorkbook(special).Sheets.Attivita.G4;assert.equal(c.t,'s');assert.equal(c.v,'<b>=2+2</b>');assert.ok(!c.f);});
(async()=>{
 const ui=fs.readFileSync(uiFile,'utf8'),match=ui.match(/async function references\(selected\)\{[\s\S]*?(?=\n function panelOpen\()/);assert.ok(match);
 const select={value:'TEST-ROOT',options:[],replaceChildren(...v){this.options=v;this.value='';},add(v){this.options.push(v);}};
 let rpcCalls=0;
 const context={epoch:1,actor:{id:'ADMIN-TEST'},allowed:true,clients:[],AbortController,setTimeout,clearTimeout,
  Option:class Option{constructor(text,value){this.text=text;this.value=value;}},$:()=>select,
  api:()=>({rpc:(name,args)=>{assert.equal(name,'gon_billing_customers');assert.equal(args.p_expected_user,'ADMIN-TEST');rpcCalls++;return{abortSignal:async()=>({data:[{id:'TEST-ROOT',display:'Gedit'},{id:'OTHER',display:'Altro cliente'}]})};}})};
 vm.createContext(context);vm.runInContext(match[0],context);await context.references();
 check('Billing selector uses authorized grouped catalog',()=>{assert.equal(rpcCalls,1);assert.equal(select.options.filter(o=>o.text==='Gedit').length,1);assert.equal(select.options.length,3);assert.equal(select.value,'TEST-ROOT');});
 context.allowed=false;await assert.rejects(()=>context.references(),/amministratore/);checks.push('Selector fails closed for non-admin UI');
 console.log('BILLING GROUP TESTS: '+checks.length+' passed: '+checks.join('; '));
})().catch(e=>{console.error(e);process.exitCode=1;});
