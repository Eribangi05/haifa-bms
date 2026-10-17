
/* ---------- preview with extra actions ---------- */
function lpPreview(){
  const actions=`
    <button class="btn ghost sm" onclick="lpEditor()">${icon('back')} Back to editor</button>
    <span style="flex:1"></span>
    <button class="btn ghost sm" onclick="lpSaveDraft()">${icon('check')} Save</button>
    <button class="btn ghost sm" onclick="plusWorksheet()">Worksheet + answers</button>
    <button class="btn ghost sm" onclick="plusCopyText()">Copy as text</button>
    <button class="btn ghost sm" onclick="plusWord()">Word (.doc)</button>
    <button class="btn ghost sm" onclick="plusAIPrompt()">Improve with AI</button>
    <button class="btn" onclick="doPrint()">${icon('exams')} Print / Save PDF</button>`;
  paintPrint('Lesson plan', (LP.lessonTitle||''), actions, lpSheetHTML(LP));
}
/* ---------- plain text, Word, AI prompt ---------- */
function plusPlainText(p){
  return plusWithLang(p,()=>{
    const L=k=>lpL(k,lpLangSubject(p)); const cm=classMeta(p.classId||'P4'); const subj=p.subject?metaFor(p.subject).name:'';
    const sec=(h,v)=>v&&String(v).trim()?'\n'+h.toUpperCase()+'\n'+String(v).trim()+'\n':'';
    let t=(p.schoolName||schoolInfo().name||'')+'\n'+L('Lesson Plan').toUpperCase()+'\n'+[L('Teacher')+': '+(p.teacherName||''),L('Class')+': '+cm.name,L('Subject')+': '+subj,L('Term')+': '+(p.term||''),L('Date')+': '+(p.date||''),L('Unit No')+' '+(p.unitNo||'')+' / '+L('Lesson No')+' '+(p.lessonNo||''),L('Duration')+': '+(p.duration||40)+' min'].join(' | ')+'\n';
    t+=sec(L('Unit title'),p.unitTitle)+sec(L('Key unit competence'),p.keyCompetence)+sec(L('Title of the lesson'),p.lessonTitle)+sec(L('Learning objectives'),p.objectives);
    if(p.successCriteria&&(p.extras||{}).criteria!==false) t+=sec(tx(PLUS_UI.criteria),p.successCriteria);
    t+=sec(L('Content summary'),p.contentSummary)+sec(L('Teaching and learning aids (for all learners)'),p.materials);
    t+=sec(L('Introduction')+' ('+(p.introMin||'')+' min)',L('Teacher\'s activity')+': '+(p.introTeacher||'')+'\n'+L('Learner\'s activity')+': '+(p.introLearner||''));
    t+=sec(L('Development')+' ('+(p.devMin||'')+' min)',L('Teacher\'s activity')+':\n'+(p.devTeacher||'')+'\n'+L('Learner\'s activity')+':\n'+(p.devLearner||''));
    t+=sec(L('Conclusion')+' ('+(p.concMin||'')+' min)',L('Teacher\'s activity')+': '+(p.concTeacher||'')+'\n'+L('Learner\'s activity')+': '+(p.concLearner||''));
    t+=sec(L('Assessment'),p.assessment)+sec(L('Differentiation'),p.differentiation);
    if((p.extras||{}).exit!==false) t+=sec(tx(PLUS_UI.exit),p.exitTicket);
    if((p.extras||{}).homework!==false) t+=sec(tx(PLUS_UI.hw),p.homework);
    t+=sec(L('References'),p.references)+sec(L('Self-evaluation of ICT use in this lesson'),[p.ict1,p.ict2,p.ict3,p.ict4].filter(Boolean).map((x,i)=>(i+1)+'. '+x).join('\n'));
    return t.trim()+'\n';
  });
}
function plusCopy(text,okMsg){
  const done=()=>toast(okMsg||'Copied.');
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done,()=>plusCopyFallback(text,done)); } else plusCopyFallback(text,done);
}
function plusCopyFallback(text,done){ const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); done(); }catch(e){ toast('Could not copy. Select the text in the preview instead.'); } ta.remove(); }
function plusCopyText(){ if(!LP) return; plusCopy(plusPlainText(LP),'Copied. Paste it into WhatsApp, an email or a document.'); }
function plusDownload(name,blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },600); }
function plusWordHTML(inner){
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Lesson plan</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}table{border-collapse:collapse;width:100%;margin-bottom:10pt}td,th{border:1px solid #333;padding:4pt;vertical-align:top;font-size:10pt;text-align:left}th{background:#e6f6fd}h2{color:#053857;margin:0}.sh-doc-title{text-align:center;font-weight:bold;font-size:14pt;margin:8pt 0}.sh-head img{width:60px;height:60px}.sign-row{margin-top:24pt}.sig{display:inline-block;width:45%;border-top:1px solid #333;text-align:center;margin-right:4%}</style></head><body>'+inner+'</body></html>';
}
function plusWord(){ if(!LP) return; const name=(LP.lessonTitle||'lesson-plan').replace(/[^\wÀ-ſ]+/g,'-').slice(0,40)||'lesson-plan'; plusDownload('lesson-plan-'+name+'.doc',new Blob(['﻿',plusWordHTML(lpSheetHTML(LP))],{type:'application/msword'})); toast('Word file saved to your Downloads. Open it in Word or WordPad.'); }
function plusAIPrompt(){
  if(!LP) return; const p=LP; const cm=classMeta(p.classId||'P4'); const subj=p.subject?metaFor(p.subject).name:'';
  const lang={en:'English',fr:'French',rw:'Kinyarwanda'}[plusLangOf(p)];
  const T=(h,v)=>v&&String(v).trim()?h+':\n'+String(v).trim()+'\n\n':'';
  const text='You are an experienced Rwandan primary-school teacher trainer. Improve the lesson plan below. Keep it in the official REB lesson plan template (Competence-Based Curriculum).\n\n'
   +'Context: '+cm.name+', '+subj+', Unit '+(p.unitNo||'?')+' - '+(p.unitTitle||'')+', Lesson '+(p.lessonNo||'?')+', '+(p.duration||40)+' minutes, '+((+p.boys||0)+(+p.girls||0)||'about 40')+' learners, term '+(p.term||'')+' '+(p.academicYear||'')+'. Resources are limited: a chalkboard, the REB pupil book and local materials; ICT only as stated.\n\n'
   +T('Key unit competence',p.keyCompetence)+T('Lesson title',p.lessonTitle)+T('Learning objectives (REB scheme of work)',p.objectives)+T('Content summary',p.contentSummary)+T('REB activities and aids (from the scheme of work)',(function(){ try{ const s=lpUsingScheme()?lpSchemeLesson():null; return s?[s.activities,s.aids].filter(Boolean).join('\nAids: '):''; }catch(e){ return ''; } })())
   +T('Current plan - introduction',(p.introTeacher||'')+'\n'+(p.introLearner||''))+T('Current plan - development',(p.devTeacher||'')+'\n'+(p.devLearner||''))+T('Current plan - conclusion',(p.concTeacher||'')+'\n'+(p.concLearner||''))+T('Assessment',p.assessment)+T('Differentiation',p.differentiation)
   +'Please:\n1. Make the objective SMART (specific, measurable, achievable, relevant, time-bound) and write 2-3 "I can" success criteria.\n2. Describe the introduction, development and conclusion in detail, with minutes for every activity (they must add up to '+(p.duration||40)+').\n3. Name the generic competences and cross-cutting issues each part develops, with a one-line reason.\n4. Add differentiation for learners below, at and above the expected level, and for the special needs listed.\n5. Add an exit ticket of 3 questions with answers that can be done in 5 minutes.\n6. Suggest simple ICT use for REB\'s ICT criterion (for example a teacher\'s phone or the radio) with the exact resource.\n7. Do not invent REB page numbers or links; say "check the pupil book" when unsure.\n8. Write the final plan in '+lang+', using the same headings as the REB template.\n';
  plusCopy(text,'Prompt copied. Paste it into ChatGPT, Claude or Gemini, then paste the improved plan back here.');
}
/* ---------- worksheet and answer key from the pupil-book exercises of the lesson ---------- */
function plusWorksheetById(id){ const p=lpStore().find(x=>x.id===id); if(!p) return; LP=Object.assign(lpFreshDraft(),JSON.parse(JSON.stringify(p))); ensureCatalog(LP.classId).then(()=>lpLoadScheme(LP.classId,LP.subject)).then(()=>plusWorksheet()); }
function plusWorksheetSheets(p){
  return plusWithLang(p,()=>{
    const tasks=plusTasks().filter(t=>t.prompt).slice(0,10); if(!tasks.length) return null;
    const abc='abcdefgh'; const cm=classMeta(p.classId||'P4'); const subj=p.subject?metaFor(p.subject).name:'';
    const q=(t,i)=>{
      let b=`<div style="font-weight:600">${i+1}. ${esc(PLUS_ENG(t.prompt).replace(/▁/g,'______'))}</div>`;
      if(t.kind==='choice'&&t.options) b+='<div style="margin:4px 0 0 18px">'+t.options.map((o,j)=>`(${abc[j]||j+1}) ${esc(o)}`).join('&nbsp;&nbsp;&nbsp;')+'</div>';
      else if(t.kind==='order'&&t.items) b+=`<div style="margin:4px 0 0 18px">${esc(t.items.slice(2).concat(t.items.slice(0,2)).join(' / '))}</div><div style="border-bottom:1px solid #444;height:26px;margin-top:6px"></div>`;
      else if(t.kind==='match'&&t.pairs) b+=`<div style="display:flex;gap:40px;margin:6px 0 0 18px"><div>${t.pairs.map((x,j)=>`${j+1}. ${esc(x[0])}`).join('<br>')}</div><div>${t.pairs.slice(1).concat(t.pairs.slice(0,1)).map((x,j)=>`${abc[j]}. ${esc(x[1])}`).join('<br>')}</div></div>`;
      else if(t.kind==='draw') b+='<div style="border:1px solid #444;height:130px;margin-top:6px"></div>';
      else b+='<div style="border-bottom:1px solid #444;height:26px;margin-top:6px;max-width:420px"></div>';
      return `<div style="margin-bottom:14px;break-inside:avoid">${b}</div>`;
    };
    const head=(title)=>`<div class="sheet lp-sheet">${schoolHeaderHTML()}<div class="sh-doc-title">${esc(title)}</div><div class="lp-names"><span><b>${tx(PLUS_UI.name)}:</b> ____________________</span><span><b>${tx(PLUS_UI.cls)}:</b> ${esc(cm.name)}</span><span><b>${tx(PLUS_UI.date)}:</b> ____________</span></div><div style="margin:0 0 12px;color:#51617a">${esc(subj)} - ${esc(p.lessonTitle||'')}</div>`;
    const key=tasks.map((t,i)=>{ let a=''; if(t.kind==='match'&&t.pairs) a=t.pairs.map((x,j)=>`${j+1} = ${esc(x[1])}`).join('; '); else if(t.kind==='order'&&t.items) a=esc(t.items.join(' ')); else if(t.kind==='draw') a=esc(t.rubric||''); else a=esc(PLUS_ENG(t.answer)); return `<div style="margin-bottom:8px"><b>${i+1}.</b> ${a}${t.why&&t.kind!=='order'?`<div style="color:#51617a;font-size:12px">${esc(t.why)}</div>`:''}</div>`; }).join('');
    return head(tx(PLUS_UI.worksheet))+tasks.map(q).join('')+`<div class="foot-note">${esc(subj)} &middot; ${esc(cm.name)} &middot; EduSmart Lesson Plan Generator</div></div>`+head(tx(PLUS_UI.worksheet)+' - '+tx(PLUS_UI.key))+key+'</div>';
  });
}
function plusWorksheet(){
  if(!LP) return; const sheets=plusWorksheetSheets(LP);
  if(!sheets){ toast('No pupil-book lesson matches this lesson exactly, so there are no exercises to build a worksheet from. Use the exit ticket, or choose the lesson from the pupil-book list (untick the official scheme).'); return; }
  const actions=`<button class="btn ghost sm" onclick="lpPreview()">${icon('back')} Back to the plan</button><span style="flex:1"></span><button class="btn" onclick="doPrint()">${icon('exams')} Print / Save PDF</button>`;
  paintPrint('Worksheet', LP.lessonTitle||'', actions, sheets);
}
/* ---------- library: search, filters, favourites, week planner, CSV ---------- */
const PLUS_LIB={q:'',cls:'',subj:'',term:'',view:'list',fav:false};
function plusLibFiltered(){
  const q=PLUS_LIB.q.trim().toLowerCase();
  return lpStore().slice().sort((a,b)=>(b.savedAt||0)-(a.savedAt||0)).filter(p=>(!PLUS_LIB.cls||p.classId===PLUS_LIB.cls)&&(!PLUS_LIB.subj||p.subject===PLUS_LIB.subj)&&(!PLUS_LIB.term||p.term===PLUS_LIB.term)&&(!PLUS_LIB.fav||p.fav)&&(!q||[p.lessonTitle,p.unitTitle,p.objectives,p.keyTerms].join(' ').toLowerCase().includes(q)));
}
function plusStar(id){ const p=lpStore().find(x=>x.id===id); if(!p) return; p.fav=!p.fav; lpPersist(); plusLibRender(); }
function plusLibSet(k,v){ PLUS_LIB[k]=v; plusLibRender(); }
function plusMonday(iso){ const d=new Date((iso||'')+'T12:00:00'); if(isNaN(d)) return ''; const k=(d.getDay()+6)%7; d.setDate(d.getDate()-k); return d.toISOString().slice(0,10); }
function plusLibRows(list){
  if(!list.length) return `<div class="empty" style="padding:34px">${icon('guide')}<div>${lpStore().length?'No plans match these filters.':'No saved lesson plans yet. Create your first one.'}</div></div>`;
  return list.map(p=>{ const cm=classMeta(p.classId||'P4'); const subj=p.subject?metaFor(p.subject).name:''; const sc=plusScore(p);
    return `<div class="card row-card" style="margin-bottom:10px"><button class="btn ghost sm" style="padding:4px 8px" aria-label="${p.fav?'Remove from favourites':'Add to favourites'}" onclick="plusStar('${p.id}')">${p.fav?'&#9733;':'&#9734;'}</button>
      <div class="thumb" style="background:${p.subject?metaFor(p.subject).tint:'#eef2f8'}">${icon('f_guide')}</div>
      <div class="rc-body" style="cursor:pointer" onclick="lpOpen('${p.id}')"><b>${esc(p.lessonTitle||'Untitled lesson')}</b><span>${esc(subj)} &middot; ${esc(cm.name)}${p.unitNo?(' &middot; Unit '+esc(String(p.unitNo))):''} &middot; ${esc(p.date||'')} &middot; REB check ${sc.total}/100</span></div>
      <button class="btn ghost sm" onclick="lpPreviewById('${p.id}')">${icon('exams')} Open PDF</button><button class="btn ghost sm" onclick="plusWorksheetById('${p.id}')">Worksheet</button><button class="btn ghost sm" onclick="lpDuplicate('${p.id}')">Duplicate</button><button class="btn ghost sm" onclick="lpDelete('${p.id}')">${icon('x')}</button></div>`; }).join('');
}
function plusWeekHTML(list){
  if(!list.length) return plusLibRows(list);
  const weeks={}; list.forEach(p=>{ const m=plusMonday(p.date); if(m){ (weeks[m]=weeks[m]||[]).push(p); } });
  const keys=Object.keys(weeks).sort().reverse(); if(!keys.length) return '<div class="empty" style="padding:24px">Your plans have no dates yet.</div>';
  const days=['Mon','Tue','Wed','Thu','Fri'];
  return keys.map(m=>{ const end=new Date(m+'T12:00:00'); end.setDate(end.getDate()+4);
    return `<div class="card" style="padding:12px 14px;margin-bottom:12px;overflow:auto"><div style="font-weight:700;margin-bottom:6px">Week of ${esc(m)} to ${esc(end.toISOString().slice(0,10))}</div><table class="lp-tbl" style="margin:0"><tr>${days.map(d=>`<th>${d}</th>`).join('')}</tr><tr>${days.map((d,i)=>{ const dd=new Date(m+'T12:00:00'); dd.setDate(dd.getDate()+i); const iso=dd.toISOString().slice(0,10); const ps=weeks[m].filter(p=>p.date===iso); return `<td style="min-width:130px"><div class="sub-note">${iso.slice(5)}</div>${ps.map(p=>`<div style="margin:3px 0;cursor:pointer;color:var(--tab-on)" onclick="lpOpen('${p.id}')"><b>${esc(classMeta(p.classId||'P4').short)}</b> ${esc(p.subject?metaFor(p.subject).short||metaFor(p.subject).name:'')}<br><span style="font-size:12px">${esc((p.lessonTitle||'').slice(0,48))}</span></div>`).join('')}</td>`; }).join('')}</tr></table></div>`; }).join('');
}
function plusLibBody(){ const list=plusLibFiltered(); return `<div class="sub-note" style="margin:0 0 8px">${list.length} of ${lpStore().length} shown</div>`+(PLUS_LIB.view==='week'?plusWeekHTML(list):plusLibRows(list)); }
function plusLibRender(){ const el=document.getElementById('libBody'); if(el) el.innerHTML=plusLibBody(); const sel=document.querySelectorAll('[data-libv]'); sel.forEach(b=>b.classList.toggle('line',b.dataset.libv!==PLUS_LIB.view)); }
function plusCSV(){
  const rows=[['Date','Class','Subject','Unit','Lesson','Title','Term','REB check']].concat(lpStore().slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(p=>[p.date||'',classMeta(p.classId||'P4').name,p.subject?metaFor(p.subject).name:'',p.unitNo||'',p.lessonNo||'',p.lessonTitle||'',p.term||'',plusScore(p).total]));
  const csv='﻿'+rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  plusDownload('lesson-plans-index-'+new Date().toISOString().slice(0,10)+'.csv',new Blob([csv],{type:'text/csv'})); toast('List saved to your Downloads (opens in Excel).');
}
function plusPrintWeek(){
  const list=plusLibFiltered(); const actions=`<button class="btn ghost sm" onclick="renderLessonPlans()">${icon('back')} My lesson plans</button><span style="flex:1"></span><button class="btn" onclick="doPrint()">${icon('exams')} Print / Save PDF</button>`;
  paintPrint('Week planner','',actions,`<div class="sheet lp-sheet">${schoolHeaderHTML()}<div class="sh-doc-title">Weekly lesson overview</div>${plusWeekHTML(list)}</div>`);
}
function renderLessonPlans(){
  if(!isTeacher()) return navigate({name:'teacher'});
  setTop('Lesson plans','Generate REB-format lesson plans');
  const used=lpStore(); const subjects=Array.from(new Set(used.map(p=>p.subject).filter(Boolean)));
  paint(`
    ${banner('teacher','f_guide','REB lesson plan generator','Pick a subject, grade, unit and lesson. The plan is built in the official REB template from the 2026-2027 scheme of work, scored against REB\'s own criteria, and ready to edit, print and share.',`<button class="btn" style="background:#fff;color:#0c8599" onclick="lpNew()">${icon('guide')} New lesson plan</button>`)}
    ${lpCalendarStale()?`<div class="card" style="padding:12px 16px;margin-bottom:14px;background:#fff3d6;border:1px solid #f0c766;color:#3b2d00">The term dates in the generator are for <b>${LP_ACADEMIC_YEAR}</b> and that year has ended. Please check the date and term on each new plan.</div>`:''}
    <div class="section-head"><h2>Your lesson plans</h2><span class="sub-note">${used.length} saved</span><span class="line"></span></div>
    <div class="card" style="padding:12px 14px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input class="txt" style="max-width:240px" type="search" placeholder="Search title, unit, objective" value="${esc(PLUS_LIB.q)}" oninput="plusLibSet('q',this.value)" aria-label="Search lesson plans">
      <select class="txt" style="max-width:130px" onchange="plusLibSet('cls',this.value)" aria-label="Class">${plusOpt('','All classes',PLUS_LIB.cls)}${plusClassIds().map(c=>plusOpt(c,classMeta(c).name,PLUS_LIB.cls)).join('')}</select>
      <select class="txt" style="max-width:170px" onchange="plusLibSet('subj',this.value)" aria-label="Subject">${plusOpt('','All subjects',PLUS_LIB.subj)}${subjects.map(s=>plusOpt(s,metaFor(s).name,PLUS_LIB.subj)).join('')}</select>
      <select class="txt" style="max-width:120px" onchange="plusLibSet('term',this.value)" aria-label="Term">${plusOpt('','All terms',PLUS_LIB.term)}${LP_TERMS.map(t=>plusOpt(t,t,PLUS_LIB.term)).join('')}</select>
      <label class="lp-chk"><input type="checkbox" ${PLUS_LIB.fav?'checked':''} onchange="plusLibSet('fav',this.checked)"> Favourites</label>
      <span style="flex:1"></span>
      <button class="btn sm ${PLUS_LIB.view==='list'?'':'line'}" data-libv="list" onclick="plusLibSet('view','list')">List</button><button class="btn sm ${PLUS_LIB.view==='week'?'':'line'}" data-libv="week" onclick="plusLibSet('view','week')">Week planner</button>
      <button class="btn sm ghost" onclick="plusPrintWeek()">Print week</button><button class="btn sm ghost" onclick="plusCSV()">Export list (CSV)</button></div></div>
    <div id="libBody">${plusLibBody()}</div>`);
}
