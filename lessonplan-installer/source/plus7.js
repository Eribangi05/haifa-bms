/* ===== Lesson Studio, part 7: secondary school (S1-S6) =====
   Uses SEC_DATA (secondary-data.js, built by secondary/build_secondary.py from the REB 2026-27 syllabi and content
   distribution). Adds Senior 1-6 classes, their subjects, and the official unit/lesson lists to the generator.
   Everything else (models, extras, REB check, library, exports) works unchanged on top of that. */
const SEC_CLASSES=['S1','S2','S3','S4','S5','S6'];
function plusIsSec(c){ return /^S[1-6]$/.test(c||''); }
function plusClassIds(){ return ['P1','P2','P3','P4','P5','P6'].concat(typeof SEC_DATA!=='undefined'?SEC_CLASSES:[]); }
(function(){
  if(typeof SEC_DATA==='undefined') return;
  const TINT=['#e6eafc','#e0f4f7','#e6f6ea','#fdf0dc','#fdeaf1','#eee9fd'];
  if(typeof CLASS_META!=='undefined') SEC_CLASSES.forEach((c,i)=>{ if(!CLASS_META[c]) CLASS_META[c]={id:c,name:'Senior '+c[1],short:c,color:['#0b4da2','#1098ad','#2f9e44','#f08c00','#e64980','#7048e8'][i],tint:TINT[i]}; });
  /* subject metadata for ids the primary app does not know (biology, chemistry, ...) */
  if(typeof SUBJECT_META!=='undefined') SEC_CLASSES.forEach(c=>{ const cl=SEC_DATA.classes[c]; if(!cl) return; Object.keys(cl.subjects).forEach(id=>{ const s=cl.subjects[id]; if(!SUBJECT_META[id]) SUBJECT_META[id]={name:s.name,short:s.short,icon:'book',color:s.color,tint:'#eef1f6'}; }); });
  const expanded={};
  function secScheme(cls,subj){
    const k=cls+'-'+subj; if(expanded.hasOwnProperty(k)) return expanded[k];
    const s=SEC_DATA.classes[cls]&&SEC_DATA.classes[cls].subjects[subj]; if(!s){ expanded[k]=null; return null; }
    const sc=s.scheme, ref=sc.references||'';
    expanded[k]={class:sc.class,subject:sc.subject,subjectName:sc.subjectName,units:sc.units.map(u=>({no:u.no,title:u.title,periods:u.periods,keyComp:u.keyComp,term:u.term,
      lessons:u.lessons.map(l=>Object.assign({},l,{aids:l.aids||u.aids||'',assessment:l.assessment||u.assessment||'',references:l.references||ref}))}))};
    return expanded[k];
  }
  function secSubjects(cls){ const cl=SEC_DATA.classes[cls]; if(!cl) return []; return Object.keys(cl.subjects).map(id=>({id,units:[],title:cl.subjects[id].name})).sort((a,b)=>metaFor(a.id).name.localeCompare(metaFor(b.id).name)); }
  /* class chips in the editor: add Senior classes for any teacher */
  const _editor=lpEditor;
  lpEditor=function(){
    const o=scopeClasses;
    scopeClasses=function(st){ const a=o(st); return a.concat(SEC_CLASSES.filter(c=>!a.includes(c))); };
    try{ return _editor.apply(this,arguments); } finally{ scopeClasses=o; }
  };
  const _subjects=lpSubjects; lpSubjects=function(){ return plusIsSec(LP&&LP.classId)?secSubjects(LP.classId):_subjects(); };
  const _books=pupilBooksOf; pupilBooksOf=function(c){ return plusIsSec(c)?[]:_books(c); };
  const _cat=ensureCatalog; ensureCatalog=function(c){ if(plusIsSec(c)){ App.catalogCache=App.catalogCache||{}; if(!App.catalogCache[c]) App.catalogCache[c]={books:[]}; return Promise.resolve(App.catalogCache[c]); } return _cat.apply(this,arguments); };
  const _load=lpLoadScheme; lpLoadScheme=function(cls,subject){
    if(plusIsSec(cls)){ const key=cls+'-'+subject; App.schemeCache=App.schemeCache||{}; App.schemeCache[key]=secScheme(cls,subject); return Promise.resolve(App.schemeCache[key]); }
    return _load.apply(this,arguments);
  };
  /* secondary classes: "students", not "pupils" (REB uses learners/students at this level) */
  function students(t){ return String(t||'').replace(/\bPupils\b/g,'Students').replace(/\bpupils\b/g,'students').replace(/\bPupil\b/g,'Student').replace(/\bpupil\b/g,'student').replace(/\bPupils’/g,'Students’').replace(/\bpupils’/g,'students’'); }
  const _after=plusAfterAutofill; plusAfterAutofill=function(){
    const r=_after.apply(this,arguments);
    if(LP&&plusIsSec(LP.classId)&&typeof LP_TEXT_KEYS!=='undefined'){
      LP_TEXT_KEYS.forEach(k=>{ if(typeof LP[k]==='string') LP[k]=students(LP[k]); });
      /* frame the syllabus objectives as a SMART statement with a condition (REB checks for one) */
      const o=String(LP.objectives||'').trim();
      if(o && !/^(by the end|at the end|\u00e0 la fin|a la fin|ku iherezo)/i.test(o) && !/(will be able to|seront capables|bazashobora)/i.test(o)){
        const L=plusLang(); const body=o.charAt(0).toLowerCase()+o.slice(1);
        const keep=/^[A-Z]{2,}/.test(o)?o:body;
        LP.objectives=({fr:'\u00c0 la fin de la le\u00e7on, les \u00e9l\u00e8ves seront capables de ',rw:'Ku iherezo ry\u2019isomo, abanyeshuri bazashobora ',en:'By the end of the lesson, students will be able to '}[L]||'By the end of the lesson, students will be able to ')+keep;
      }
      if(LP._snap) LP._snap=lpTextSnapshot();
    }
    return r;
  };

  /* ---- secondary drafting: the syllabus objectives are action statements, so they make good exit tasks ---- */
  function secObjectives(){ return String(LP.objectives||'').split(/\s*;\s*|\n+/).map(x=>x.replace(/^[•*\-–\s]+/,'').replace(/[.\s]+$/,'')).filter(x=>x.length>8); }
  function secTask(o){ return o.charAt(0).toUpperCase()+o.slice(1)+'.'; }
  const _exit=plusExitDraft; plusExitDraft=function(){
    if(!(LP&&plusIsSec(LP.classId))) return _exit.apply(this,arguments);
    const os=secObjectives(); const know=os.filter(o=>!/^(appreciate|show|value|acknowledge|respect|develop|promote|demonstrate concern|take pride|be |engage in|cooperate)/i.test(o));
    const pick=(know.length?know:os).slice(0,3);
    if(!pick.length) return _exit.apply(this,arguments);
    const guide={en:'Marking guide: the answer uses the key terms of the lesson correctly and gives a reason or example.',fr:'Guide de correction : la réponse utilise correctement les termes clés et donne une raison ou un exemple.',rw:'Uko bikosorwa: igisubizo gikoresha neza amagambo y’ingenzi kandi gitanga impamvu cyangwa urugero.'}[plusLang()]||'';
    return pick.map((o,i)=>(i+1)+'. '+secTask(o)).join('\n')+(guide?'\n('+guide+')':'');
  };
  const _hw=plusHomeworkDraft; plusHomeworkDraft=function(){
    if(!(LP&&plusIsSec(LP.classId))) return _hw.apply(this,arguments);
    const os=secObjectives(); const sk=os.filter(o=>/^(apply|solve|calculate|draw|construct|design|write|prepare|compose|analy|compare|evaluate|investigate|research|plan|use|create|demonstrate)/i.test(o));
    const pn=plusPrevNext(); const lines=[];
    const t=(sk[0]||os[os.length>1?1:0]);
    if(t) lines.push('1. '+({en:'In your exercise book: ',fr:'Dans ton cahier : ',rw:'Mu ikayi ryawe: '}[plusLang()]||'')+secTask(t));
    if(pn&&pn.next) lines.push((lines.length+1)+'. '+({en:'Read ahead for the next lesson: ',fr:'Lis à l’avance pour la prochaine leçon : ',rw:'Soma mbere ku isomo rikurikira: '}[plusLang()]||'')+String(pn.next).replace(/[.\s]+$/,'')+'.');
    return lines.length?lines.join('\n'):_hw.apply(this,arguments);
  };
  const _terms=plusTermsDraft; plusTermsDraft=function(){
    const t=_terms.apply(this,arguments);
    if(!(LP&&plusIsSec(LP.classId))) return t;
    let src=''; try{ const sl=lpSchemeLesson(); src=(sl&&sl.content)||''; }catch(e){}
    const out=[]; String(src).split(/\s*;\s*/).forEach(seg=>{ const head=seg.split(':')[0].trim(); const w=head.split(/\s+/);
      if(head&&w.length<=4&&head.length>=4) out.push(head.replace(/[.,]+$/,'')); else { seg.split(/\s*,\s*/).forEach(x=>{ x=x.replace(/^(?:meaning|importance|types?|causes?|effects?|examples?|characteristics|uses?) of\s+/i,'').replace(/[.]+$/,'').trim(); if(x.length>=4&&x.split(/\s+/).length<=4) out.push(x); }); } });
    const u=Array.from(new Set(out.map(x=>x.charAt(0).toUpperCase()+x.slice(1)))).slice(0,8);
    return u.length>=2?u.join(', '):t;
  };
  window.plusSecSchemeFor=secScheme;
})();
