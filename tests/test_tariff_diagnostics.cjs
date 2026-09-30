'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2],'utf8'),checks=[];
const match=source.match(/const TARIFF_CATALOG = (\[[\s\S]*?\]);/);assert.ok(match);
const ctx={TARIFF_CATALOG:JSON.parse(match[1])};vm.createContext(ctx);
for(const name of ['rateDateLabel','rateTermsAt','rateCheck','savedRateLabel','rateCoverageMessages','reportRateMessages']){
 const pattern=new RegExp('\\n function '+name+'\\([^\\n]*[\\s\\S]*?(?=\\n function )');
 const m=source.match(pattern);assert.ok(m,'Missing '+name);vm.runInContext(m[0],ctx);
}
const rule={macro:'Elaborazione rilievo',type:'Ufficio',mode:'hour',price:50};
const base={id:'t1',version:1,valid_from:'2026-09-01',valid_to:null,superseded:false,billing_mode:'hourly',rules:[rule]};
const entry={id:'a1',ref:1,date:'2026-09-21',macro:rule.macro,type:rule.type,hours:3};
function test(name,fn){fn();checks.push(name);}
test('Correct effective-date match',()=>assert.equal(ctx.rateCheck(entry,[base]).ok,true));
test('Gedit dates before September 30 are uncovered',()=>{const r=ctx.rateCheck(entry,[{...base,valid_from:'2026-09-30'}]);assert.equal(r.code,'before_start');assert.ok(r.message.includes('30/09/2026'));});
test('Inclusive first valid day',()=>assert.equal(ctx.rateCheck({...entry,date:'2026-09-30'},[{...base,valid_from:'2026-09-30'}]).ok,true));
test('Expired or gap dates do not fall back to latest price',()=>assert.equal(ctx.rateCheck(entry,[{...base,valid_to:'2026-09-10'}]).code,'date_gap'));
test('No configured customer agreement',()=>assert.equal(ctx.rateCheck(entry,[]).code,'no_terms'));
test('Superseded conditions never reused',()=>assert.equal(ctx.rateCheck(entry,[{...base,superseded:true}]).code,'no_terms'));
test('Latest applicable version wins',()=>assert.equal(ctx.rateTermsAt([base,{...base,id:'t2',version:2}],entry.date).id,'t2'));
test('Zero rate remains valid',()=>assert.equal(ctx.rateCheck(entry,[{...base,rules:[{...rule,price:0}]}]).ok,true));
test('Null price distinguished from missing agreement',()=>assert.equal(ctx.rateCheck(entry,[{...base,rules:[{...rule,price:null}]}]).code,'missing_price'));
test('Missing rate combination',()=>assert.equal(ctx.rateCheck(entry,[{...base,rules:[]}]).code,'missing_rule'));
test('Programmed rate requires monthly mode',()=>{const e={...entry,macro:'Elaborazione rilievo - PROGRAMMATA'};assert.equal(ctx.rateCheck(e,[{...base,rules:[{...rule,macro:e.macro}]}]).code,'wrong_mode');assert.equal(ctx.rateCheck(e,[{...base,rules:[{...rule,macro:e.macro,mode:'monthly',price:2000}]}]).ok,true);});
test('Full monthly fee including zero and unknown',()=>{assert.equal(ctx.rateCheck(entry,[{...base,billing_mode:'monthly_flat',monthly_price:0}]).ok,true);assert.equal(ctx.rateCheck(entry,[{...base,billing_mode:'monthly_flat',monthly_price:null}]).code,'missing_flat');});
test('Legacy conditions require explicit confirmation',()=>assert.equal(ctx.rateCheck(entry,[{...base,billing_mode:'legacy'}]).code,'legacy'));
test('Empty reference never means empty tariff',()=>{const s=ctx.savedRateLabel({price:50,terms_id:'t1',terms_version:1,terms_reference:''});assert.ok(s.includes('Condizioni v1'));assert.ok(!s.includes('non definita'));});
test('Manual and explicit-zero saved rates not missing',()=>{assert.ok(ctx.savedRateLabel({price:0,terms_id:'t1'}).startsWith('Condizioni'));assert.ok(ctx.savedRateLabel({price:50,terms_id:null}).includes('impostata'));});
test('Actual absent saved prices shown explicitly',()=>assert.ok(ctx.savedRateLabel({price:null,terms_id:null}).includes('Nessuna tariffa')));
const report={state:'draft',document:{client:{id:'c1'},vat_rate:22,activities:[entry],lines:[{price:null,entry_ids:['a1'],refs:[1]}]}};
const data={client:{id:'c1'},terms:[base]};
test('Old draft with available rates asks explicit refresh',()=>assert.ok(ctx.reportRateMessages(report,data).join(' ').includes('Aggiorna da')));
test('Invalid-date draft does not promise refresh resolves it',()=>{const m=ctx.reportRateMessages(report,{...data,terms:[{...base,valid_from:'2026-09-30'}]}).join(' ');assert.ok(m.includes('30/09/2026'));assert.ok(!m.includes('Le condizioni attuali contengono'));});
test('Other customer rates never used',()=>assert.ok(ctx.reportRateMessages(report,{...data,client:{id:'other'}})[0].includes('carica il cliente')));
test('Issued report never flagged for repricing',()=>assert.equal(ctx.reportRateMessages({...report,state:'sent'},data).length,0));
test('Stored unknown VAT not silently changed',()=>assert.ok(ctx.reportRateMessages({...report,document:{...report.document,vat_rate:null}},data).join(' ').includes('IVA della copia')));
test('Diagnostic functions leave all supplied records unchanged',()=>{const before=JSON.stringify({report,data});ctx.reportRateMessages(report,data);ctx.rateCoverageMessages([entry],data.terms);assert.equal(JSON.stringify({report,data}),before);});
test('Generated UI uses factual saved-price labels',()=>{assert.ok(source.includes('esc(savedRateLabel(line))'));assert.ok(!source.includes("esc(line.terms_reference||'Tariffa non definita')"));});
console.log('TARIFF DIAGNOSTICS TESTS: '+checks.length+' passed: '+checks.join('; '));
