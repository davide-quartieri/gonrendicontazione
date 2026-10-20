"""Final additive stage for nonfinancial GEDIT package classification. No DB access."""
from pathlib import Path
import json,hashlib,os,re,subprocess
ROOT=Path(__file__).resolve().parent
VERSION='gedit-packages-1.0.0'
def once(s,a,b):
 if s.count(a)!=1:raise RuntimeError('GEDIT integration marker mismatch: '+a[:100])
 return s.replace(a,b,1)
def install_gedit_packages(out):
 out=Path(out);assets=out/'assets'
 (assets/'gedit-packages.js').write_bytes((ROOT/'assets/gedit-packages.js').read_bytes())
 for name in ('pc','mobile'):
  path=out/(name+'.html');s=path.read_text()
  s=once(s,'async function addEntry(){',"async function addEntry(){let packageCode;try{packageCode=await window.GonGeditPackages.read('main');}catch(err){alert(err.message);return;}")
  s=once(s,"hours:+$('hours').value,created_by:currentUser.id}","hours:+$('hours').value,periodic_package_code:packageCode,created_by:currentUser.id}")
  # Reset only after a successful save or storage into the existing offline queue.
  s=s.replace("$('desc').value='';$('hours').value='';", "$('desc').value='';$('hours').value='';window.GonGeditPackages.resetMain();")
  s=once(s,'async function saveOcr(){',"async function saveOcr(){let geditRows;try{geditRows=await window.GonGeditPackages.prepareRows(ocrRows.filter(r=>r.selected!==false));}catch(err){alert(err.message);return;}")
  s=once(s,"chosen=ocrRows.filter(r=>r.selected!==false)","chosen=geditRows")
  s=once(s,"description:r.description,hours:r.hours,created_by:currentUser.id", "description:r.description,hours:r.hours,periodic_package_code:r.periodic_package_code||null,created_by:currentUser.id")
  s=once(s,"</select></td><td><input data-i=\"'+i+'\" data-f=\"description\"", "</select></td><td>'+window.GonGeditPackages.ocrHtml(r,i)+'<input data-i=\"'+i+'\" data-f=\"description\"")
  s=once(s,"$('ocrbody').innerHTML=html;", "$('ocrbody').innerHTML=html;window.GonGeditPackages.bindOcr(ocrRows,renderOcr);")
  s=once(s,'<script src="assets/macroarea-catalog.js', '<script src="assets/gedit-packages.js?v='+VERSION+'"></script>\n<script src="assets/macroarea-catalog.js')
  path.write_text(s)
 path=assets/'personal-history.js';s=path.read_text()
 s=once(s,"timer_stopped_at,duration_seconds';", "timer_stopped_at,duration_seconds,periodic_package_code';")
 s=once(s,"$('gonHistoryEditMsg').textContent='';dialog.showModal();", "window.GonGeditPackages.attach('history','gonEditClient','gonEditMacro','gonEditDescription',editing.periodic_package_code||'');$('gonHistoryEditMsg').textContent='';dialog.showModal();")
 old="const r=await api().rpc('gon_update_my_entry',{p_entry_id:editing.id,p_expected_user:actor.id,p_expected_version:editing.edit_version,p_date:$('gonEditDate').value,p_client:$('gonEditClient').value,p_type:$('gonEditType').value,p_macro:$('gonEditMacro').value,p_description:$('gonEditDescription').value.trim(),p_hours:Number($('gonEditHours').value)});"
 new="const code=await window.GonGeditPackages.read('history');const r=await api().rpc('gon_entry_with_package',{p_action:'edit',p_expected_user:actor.id,p_payload:{entry_id:editing.id,expected_version:editing.edit_version,date:$('gonEditDate').value,client:$('gonEditClient').value,type:$('gonEditType').value,macro:$('gonEditMacro').value,description:$('gonEditDescription').value.trim(),hours:Number($('gonEditHours').value),periodic_package_code:code}});"
 s=once(s,old,new);path.write_text(s)
 path=assets/'activity-timer.js';s=path.read_text()
 s=once(s,"duration_seconds,needs_details'", "duration_seconds,needs_details,periodic_package_code'")
 s=once(s,"$('gonTimerDetailError').textContent='';dialog.showModal();", "window.GonGeditPackages.attach('timer','gonTimerDetailClient','gonTimerDetailMacro','gonTimerDetailText',row.periodic_package_code||'',true);$('gonTimerDetailError').textContent='';dialog.showModal();")
 old="await rpc('gon_complete_timer',{p_entry_id:dialog.dataset.entryId,p_expected_user:actor.id,p_client:$('gonTimerDetailClient').value,p_type:$('gonTimerDetailType').value,p_macro:$('gonTimerDetailMacro').value,p_description:$('gonTimerDetailText').value.trim()});"
 new="const code=await window.GonGeditPackages.read('timer');await rpc('gon_entry_with_package',{p_action:'complete',p_expected_user:actor.id,p_payload:{entry_id:dialog.dataset.entryId,client:$('gonTimerDetailClient').value,type:$('gonTimerDetailType').value,macro:$('gonTimerDetailMacro').value,description:$('gonTimerDetailText').value.trim(),periodic_package_code:code}});"
 s=once(s,old,new);path.write_text(s)
 for mode in ('pc','mobile'):
  path=out/(mode+'.html');s=path.read_text()
  for script in ('personal-history.js','activity-timer.js'):
   s=re.sub('('+re.escape(script)+r'\?v=[^"\s]+)',lambda m:m.group(1)+'-'+VERSION,s)
  path.write_text(s)
 for path in [assets/n for n in ('gedit-packages.js','personal-history.js','activity-timer.js')]:subprocess.run(['node','--check',str(path)],check=True)
 manifest=dict(version=VERSION,commit=os.environ.get('RENDER_GIT_COMMIT',''),classification_field='periodic_package_code',prices_exposed=False,legacy_rows_unchanged=True,hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [out/'pc.html',out/'mobile.html',assets/'gedit-packages.js',assets/'personal-history.js',assets/'activity-timer.js']})
 (out/'gedit-packages-build.json').write_text(json.dumps(manifest,indent=2))
 print('GEDIT PACKAGE BUILD VERIFIED',json.dumps(manifest))
