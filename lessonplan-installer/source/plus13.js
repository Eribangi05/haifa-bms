/* ===== Lesson Studio, part 13: after the lesson - lesson evaluation and record of work =====
   After teaching, the teacher records what happened (REB reflective teaching: How did I teach? What was successful? What was not?
   How can I improve?). The answers go into the plan's "Teacher's self-evaluation" box and into the Record of work, a printable
   register of the lessons taught (date, class, subject, lesson, content covered, result, remarks). */
const PLUS_AFTER={
 en:{title:'After the lesson',taught:'Taught on',boys:'Boys present',girls:'Girls present',ach:'Was the objective achieved?',pct:'Learners who achieved it (%)',
  q1:'How did I teach? (what happened)',q2:'What was successful?',q3:'What was not very successful?',q4:'How can I improve it next time?',fol:'Learners who need follow-up',rem:'Remarks for the record of work',
  save:'Save to the plan',back:'Back to the plan',levels:['','Fully','Mostly','Partly','Not achieved'],
  sum:{ach:'Objective achieved',pct:'learners achieved it',ok:'Successful',no:'Not successful',imp:'To improve',fol:'Follow-up'}},
 fr:{title:'Après la leçon',taught:'Donnée le',boys:'Garçons présents',girls:'Filles présentes',ach:'L’objectif est-il atteint ?',pct:'Élèves qui l’ont atteint (%)',
  q1:'Comment ai-je enseigné ? (ce qui s’est passé)',q2:'Qu’est-ce qui a bien marché ?',q3:'Qu’est-ce qui a moins bien marché ?',q4:'Comment m’améliorer la prochaine fois ?',fol:'Élèves à suivre',rem:'Remarques pour le registre',
  save:'Enregistrer dans le plan',back:'Retour au plan',levels:['','Pleinement','En grande partie','En partie','Non atteint'],
  sum:{ach:'Objectif atteint',pct:'élèves l’ont atteint',ok:'Réussi',no:'Moins réussi',imp:'À améliorer',fol:'Suivi'}},
 rw:{title:'Nyuma y’isomo',taught:'Ryigishijwe ku wa',boys:'Abahungu bahari',girls:'Abakobwa bahari',ach:'Intego yagezweho?',pct:'Abanyeshuri bayigezeho (%)',
  q1:'Nigishije nte? (ibyabaye)',q2:'Ni iki cyagenze neza?',q3:'Ni iki kitagenze neza?',q4:'Nakwiyongera nte ubutaha?',fol:'Abanyeshuri bakeneye gukurikiranwa',rem:'Ibisobanuro byo mu gitabo cy’imirimo',
  save:'Bika mu gishushanyo',back:'Subira ku gishushanyo',levels:['','Byuzuye','Ahanini','Igice','Ntiyagezweho'],
  sum:{ach:'Intego yagezweho',pct:'bayigezeho',ok:'Cyagenze neza',no:'Kitagenze neza',imp:'Kunoza',fol:'Gukurikirana'}}};
function plusAfterL(){ return PLUS_AFTER[plusLang()]||PLUS_AFTER.en; }
function plusAfterState(){ LP.reflect=LP.reflect||{}; return LP.reflect; }
function plusAfterSet(k,v){ plusAfterState()[k]=v; }
function plusAfterSummary(){
  const r=plusAfterState(), T=plusAfterL(), S=T.sum, out=[];
  if(+r.ach) out.push(S.ach+': '+T.levels[+r.ach]+(r.pct!==undefined&&r.pct!==''?' ('+r.pct+'% '+S.pct+')':'')+'.'); else if(r.pct) out.push(r.pct+'% '+S.pct+'.');
  if(r.q2) out.push(S.ok+': '+r.q2); if(r.q3) out.push(S.no+': '+r.q3); if(r.q4) out.push(S.imp+': '+r.q4); if(r.fol) out.push(S.fol+': '+r.fol);
  return out.join('\n');
}
function plusAfterSave(){
  const s=plusAfterSummary(); if(s) LP.selfEval=s; const r=plusAfterState(); if(r.taught) LP.taughtOn=r.taught; r.done=1;
  lpSaveDraft(); plusAfterOpen();
}
function plusAfterOpen(){
  if(!LP) return; const r=plusAfterState(), T=plusAfterL();
  if(r.taught===undefined) r.taught=LP.date||'';
  const f=(k,l,type)=>`<label class="field"><span>${l}</span><input class="txt" type="${type||'text'}" value="${esc(r[k]===undefined?'':r[k])}" onchange="plusAfterSet('${k}',this.value)"></label>`;
  const a=(k,l)=>`<label class="field"><span>${l}</span><textarea class="txt" rows="3" onchange="plusAfterSet('${k}',this.value)">${esc(r[k]||'')}</textarea></label>`;
  const sel=`<label class="field"><span>${T.ach}</span><select class="txt" onchange="plusAfterSet('ach',this.value)">${T.levels.map((l,i)=>`<option value="${i}"${+r.ach===i?' selected':''}>${l||'-'}</option>`).join('')}</select></label>`;
  const actions=`<button class="btn ghost sm" onclick="lpPreview()">${icon('back')} ${T.back}</button><span style="flex:1"></span><button class="btn" onclick="plusAfterSave()">${icon('check')} ${T.save}</button>`;
  paintPrint(T.title,LP.lessonTitle||'',actions,`<div class="sheet"><h2>${T.title}: ${esc(LP.lessonTitle||'')}</h2>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${f('taught',T.taught,'date')}${sel}${f('boys',T.boys,'number')}${f('girls',T.girls,'number')}${f('pct',T.pct,'number')}${f('fol',T.fol)}</div>
   ${a('q1',T.q1)}${a('q2',T.q2)}${a('q3',T.q3)}${a('q4',T.q4)}${a('rem',T.rem)}
   <p class="h" style="color:#6b7c93;font-size:12px">${r.done?'Saved. ':''}REB reflective teaching: how did I teach, what was successful, what was not, how can I improve (Foundation of Education, Unit 9.3).</p></div>`);
}
/* ---- record of work ---- */
function plusRowsOfWork(f){
  return lpStore().filter(p=>(!f.cls||p.classId===f.cls)&&(!f.subject||p.subject===f.subject)&&(!f.term||p.term===f.term)).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||(a.savedAt||0)-(b.savedAt||0)).map(p=>{
    const r=p.reflect||{}, T=PLUS_AFTER[plusLangOf(p)]||PLUS_AFTER.en; const cm=classMeta(p.classId||'P4');
    return {date:p.taughtOn||p.date||'',cls:cm.name,subject:p.subject?metaFor(p.subject).name:'',unit:[p.unitNo,p.unitTitle].filter(Boolean).join(' - '),lesson:p.lessonTitle||'',periods:p.periods||1,
      content:String(p.contentSummary||'').slice(0,160),status:r.done?'Taught':'Planned',result:+r.ach?T.levels[+r.ach]+(r.pct?' ('+r.pct+'%)':''):'',present:(+r.boys||0)+(+r.girls||0)||'',remarks:r.rem||'',term:p.term||''};
  });
}
function plusRowFilter(){ const F=Accounts.root.settings.lpRowF=Accounts.root.settings.lpRowF||{}; return F; }
function plusRecordHTML(plain){
  const f=plusRowFilter(), rows=plusRowsOfWork(f), sc=schoolInfo();
  const cls=[...new Set(lpStore().map(p=>p.classId).filter(Boolean))], subs=[...new Set(lpStore().map(p=>p.subject).filter(Boolean))], terms=[...new Set(lpStore().map(p=>p.term).filter(Boolean))];
  const opt=(arr,cur,lab)=>`<option value="">${lab}</option>`+arr.map(x=>`<option value="${esc(x)}"${cur===x?' selected':''}>${esc(lab==='All classes'?classMeta(x).name:lab==='All subjects'?metaFor(x).name:x)}</option>`).join('');
  return `<div class="sheet"><h2 style="text-align:center">RECORD OF WORK</h2><p style="text-align:center">${esc(sc.name||'')} &middot; ${esc(((typeof LP_ACADEMIC_YEAR!=='undefined')?LP_ACADEMIC_YEAR:''))}</p>
   ${plain?'':`<div class="no-print" style="display:flex;gap:8px;margin:8px 0"><select class="txt" onchange="plusRowFilter().cls=this.value;plusRecordOpen()">${opt(cls,f.cls,'All classes')}</select><select class="txt" onchange="plusRowFilter().subject=this.value;plusRecordOpen()">${opt(subs,f.subject,'All subjects')}</select><select class="txt" onchange="plusRowFilter().term=this.value;plusRecordOpen()">${opt(terms,f.term,'All terms')}</select></div>`}
   <table class="rw-t" style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>${['Date','Class','Subject','Unit','Lesson','Periods','Content covered','Status','Result','Present','Remarks'].map(h=>`<th style="border:1px solid #33415c;padding:4px;background:#e0f1fa">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${[r.date,r.cls,r.subject,r.unit,r.lesson,r.periods,r.content,r.status,r.result,r.present,r.remarks].map(x=>`<td style="border:1px solid #33415c;padding:4px;vertical-align:top">${esc(x)}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="11" style="padding:10px">No lesson plans saved yet.</td></tr>'}</tbody></table>
   <div class="sign-row"><div class="sig">Teacher</div><div class="sig">Head teacher / Director of studies</div></div></div>`;
}
function plusRecordOpen(){ const actions=`<button class="btn ghost sm" onclick="renderLessonPlans()">${icon('back')} My lesson plans</button><span style="flex:1"></span><button class="btn ghost sm" onclick="plusRecordCsv()">Excel (CSV)</button><button class="btn ghost sm" onclick="plusRecordWord()">Word (.doc)</button><button class="btn" onclick="doPrint()">${icon('exams')} Print / Save PDF</button>`; paintPrint('Record of work','',actions,plusRecordHTML()); }
function plusRecordCsv(){ const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"'; const rows=plusRowsOfWork(plusRowFilter()); const h=['Date','Term','Class','Subject','Unit','Lesson','Periods','Content covered','Status','Result','Learners present','Remarks'];
  plusDownload('record-of-work.csv',new Blob(['﻿'+[h.map(q).join(',')].concat(rows.map(r=>[r.date,r.term,r.cls,r.subject,r.unit,r.lesson,r.periods,r.content,r.status,r.result,r.present,r.remarks].map(q).join(','))).join('\r\n')],{type:'text/csv'})); }
function plusRecordWord(){ plusDownload('record-of-work.doc',new Blob(['﻿',plusWordHTML(plusRecordHTML(true))],{type:'application/msword'})); }
(function(){
  const _prev=lpPreview; lpPreview=function(){
    const r=_prev.apply(this,arguments);
    const a=document.querySelector('#printRoot .print-actions'); if(a&&!document.getElementById('lpAfterBtn')){ const b=document.createElement('button'); b.className='btn ghost sm'; b.id='lpAfterBtn'; b.textContent=plusAfterL().title; b.onclick=plusAfterOpen; const pr=[...a.querySelectorAll('button')].pop(); a.insertBefore(b,pr); }
    return r;
  };
  const _home=renderLessonPlans; renderLessonPlans=function(){
    const r=_home.apply(this,arguments);
    const v=document.getElementById('view'); if(v&&!document.getElementById('lpRecBtn')){ const d=document.createElement('div'); d.style.cssText='margin:0 0 12px;display:flex;gap:8px'; d.innerHTML='<button class="btn ghost sm" id="lpRecBtn" onclick="plusRecordOpen()">Record of work</button>'; v.insertBefore(d,v.firstChild); }
    return r;
  };
})();
