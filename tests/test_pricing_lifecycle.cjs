'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2],'utf8');
const checks=[];
async function test(name,fn){await fn();checks.push(name);}
function extract(name){const re=new RegExp('\\n (?:async )?function '+name+'\\([^\\n]*[\\s\\S]*?(?=\\n (?:async )?function |\\n window\\.GonCommercial)');const m=source.match(re);assert.ok(m,'Function '+name);return m[0];}
const raw=source.match(/const TARIFF_CATALOG = (\[[\s\S]*?\]);/);assert.ok(raw,'catalog');
const catalog=JSON.parse(raw[1]);
const seedCtx={};vm.createContext(seedCtx);vm.runInContext(extract('tariffSeed'),seedCtx);
const row=(macro,type,mode,price)=>({rules:[{macro,type,mode,price,round_mode:'none',round_minutes:60}]});
function removalContext(overrides={}){
 const calls=[];
 const ctx={allowed:true,editorDirty:false,currentReport:null,confirm:()=>true,prompt:()=> 'Motivo di collaudo',
  rpc:async(action,args)=>{calls.push({action,args});return {removed:true};},
  loadOverview:async()=>{calls.push('reload');},say:message=>calls.push(message),reportDialog:{close:()=>calls.push('close')},...overrides};
 vm.createContext(ctx);vm.runInContext(extract('removeReport'),ctx);return {ctx,calls};
}
(async()=>{
 await test('Exactly 11 rows: 9 hourly + 2 monthly programmed',()=>{assert.equal(catalog.length,11);assert.equal(catalog.filter(r=>r[2]==='hour').length,9);assert.equal(catalog.filter(r=>r[2]==='monthly').length,2);});
 await test('All 13 crossed-out combinations are absent',()=>{
  const forbidden=[['Rilievo in campo','Ufficio'],['Elaborazione rilievo','Cantiere'],['Elaborazione rilievo','Viaggio'],...['Attività amministrative','Corso','Varie'].flatMap(m=>[[''+m,'Cantiere'],[''+m,'Viaggio']]),['Rilievo in campo - PROGRAMMATO','Viaggio'],['Rilievo in campo - PROGRAMMATO','Ufficio'],['Elaborazione rilievo - PROGRAMMATA','Cantiere'],['Elaborazione rilievo - PROGRAMMATA','Viaggio']];
  assert.equal(forbidden.length,13);for(const [m,t] of forbidden)assert.ok(!catalog.some(r=>r[0]===m&&r[1]===t));
 });
 await test('Assistenza cliente retains all three types',()=>assert.equal(catalog.filter(r=>r[0]==='Assistenza cliente').length,3));
 await test('Scheduled modes cannot be selected as hourly',()=>{assert.ok(catalog.filter(r=>r[0].includes('PROGRAMMAT')).every(r=>r[2]==='monthly'));assert.ok(extract('editTerms').includes('tr.dataset.mode=mode'));assert.ok(!extract('editTerms').includes('data-field="mode"'));});
 await test('Hourly prices are preserved, including explicit zero',()=>{assert.equal(seedCtx.tariffSeed(row('Rilievo in campo','Cantiere','hour',60),'Rilievo in campo','Cantiere','hour').price,60);assert.equal(seedCtx.tariffSeed(row('Varie','Ufficio','hour',0),'Varie','Ufficio','hour').price,0);});
 await test('Historical hourly programmed price not reinterpreted',()=>assert.equal(seedCtx.tariffSeed(row('Rilievo in campo - PROGRAMMATO','Cantiere','hour',60),'Rilievo in campo - PROGRAMMATO','Cantiere','monthly').price,''));
 await test('Confirmed monthly programmed price preserved',()=>{const x=seedCtx.tariffSeed(row('Elaborazione rilievo - PROGRAMMATA','Ufficio','monthly',400),'Elaborazione rilievo - PROGRAMMATA','Ufficio','monthly');assert.equal(x.price,400);assert.equal(x.round_minutes,0);assert.equal(x.round_mode,'none');});
 await test('Missing price remains unknown, never automatic zero',()=>assert.equal(seedCtx.tariffSeed(null,'Corso','Ufficio','hour').price,''));
 await test('Editor clearly states fee unit and total forfait inclusion',()=>{const ui=extract('makeTermsDialog');assert.ok(ui.includes('una quota per cliente, macroarea e mese'));assert.ok(ui.includes('gia incluse'));assert.ok(ui.includes('gcTVat'));assert.ok(ui.includes("mode==='monthly'?'none'"));});
 await test('Removal cancel does not call server',async()=>{const {ctx,calls}=removalContext({confirm:()=>false});await ctx.removeReport({id:'R1',state:'draft',version:1,revision:0});assert.equal(calls.length,0);});
 await test('User cannot invoke UI removal',async()=>{const {ctx,calls}=removalContext({allowed:false});await assert.rejects(()=>ctx.removeReport({id:'R1',state:'draft'}));assert.equal(calls.length,0);});
 await test('Draft deletion carries exact identifier and version',async()=>{const {ctx,calls}=removalContext();await ctx.removeReport({id:'R1',state:'draft',version:7,revision:0});assert.equal(calls[0].action,'report_remove');assert.equal(calls[0].args.id,'R1');assert.equal(calls[0].args.version,7);assert.equal(calls[0].args.reason,'');assert.ok(calls.includes('reload'));});
 await test('Sent report requires reason before API call',async()=>{for(const reason of [null,'']){const {ctx,calls}=removalContext({prompt:()=>reason});if(reason===null)await ctx.removeReport({id:'R1',state:'sent',revision:0});else await assert.rejects(()=>ctx.removeReport({id:'R1',state:'sent',revision:0}));assert.equal(calls.length,0);}});
 await test('Sent cancellation explains rebilling and preserves external invoices',async()=>{let text='';const {ctx,calls}=removalContext({confirm:s=>{text=s;return true;}});await ctx.removeReport({id:'R2',state:'sent',number:'RC-TEST',version:3,revision:0});assert.ok(text.includes('ANNULLATO'));assert.ok(text.includes('tornano rendicontabili'));assert.ok(text.includes('fatture o email'));assert.equal(calls[0].args.reason,'Motivo di collaudo');});
 await test('Server rejection does not remove anything in the UI',async()=>{const {ctx,calls}=removalContext({rpc:async()=>{throw new Error('stale');}});await assert.rejects(()=>ctx.removeReport({id:'R2',state:'sent',version:1,revision:0}),/stale/);assert.equal(calls.length,0);});
 await test('Unsaved report edits require explicit save or discard first',async()=>{const {ctx,calls}=removalContext({editorDirty:true,currentReport:{id:'R3'}});await assert.rejects(()=>ctx.removeReport({id:'R3',state:'draft',version:1,revision:0}));assert.equal(calls.length,0);});
 await test('Archive and report dialog both expose removal action',()=>{assert.ok(source.includes("del.textContent='Elimina'"));assert.ok(source.includes("$('gcRDiscard').textContent=draft?'Elimina bozza':'Elimina dallo storico'"));assert.ok(source.includes("$('gcRDiscard').onclick=()=>action('gcRDiscard',()=>removeReport(currentReport))"));});
 console.log('PRICING LIFECYCLE TESTS: '+checks.length+' passed: '+checks.join('; '));
})().catch(error=>{console.error(error);process.exitCode=1;});
