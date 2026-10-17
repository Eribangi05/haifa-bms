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
  /* keep only real questions or tasks (a question mark or a task verb), not the steps of a worked method */
  const TASKV=/^(?:\(?[a-z]\)\s*)?(find|calculate|solve|explain|describe|discuss|list|state|identify|write|draw|compare|convert|evaluate|determine|give|define|name|outline|prove|simplify|express|differentiate|analy[sz]e|suggest|mention|justify|classify|construct|sketch|show|use|complete|match|fill|answer|read|translate|compose|summari[sz]e|distinguish|calculer|r\u00e9soudre|expliquer|d\u00e9crire|citer|\u00e9crire|identifier|compl\u00e9ter|lisez|r\u00e9pondez|sobanura|andika|vuga|garagaza|erekana|ssoma|eleza|taja|andika|jibu|soma|fafanua|toa)\b/i;
  function exClean(q){ q=String(q||'').trim(); if(q.length<235) return q; const cut=Math.max(q.lastIndexOf('. '),q.lastIndexOf('? '),q.lastIndexOf(': ')); return cut>60?q.slice(0,cut+1).trim():''; }
  function exOK(q){ return /\?/.test(q)||TASKV.test(String(q).trim()); }
  const expanded={};
  function secScheme(cls,subj){
    const k=cls+'-'+subj; if(expanded.hasOwnProperty(k)) return expanded[k];
    const s=SEC_DATA.classes[cls]&&SEC_DATA.classes[cls].subjects[subj]; if(!s){ expanded[k]=null; return null; }
    const sc=s.scheme, ref=sc.references||'', bk=s.books||{};
    function rng(a,b,off){ const x=off!=null?[a-off,b-off]:null; const pdf=a===b?'PDF page '+a:'PDF pages '+a+'-'+b; if(!x||x[0]<1) return pdf; return (a===b?'p. '+x[0]:'pp. '+x[0]+'-'+x[1])+' ('+pdf+')'; }
    function cite(u,l,kind,label){ const r=u[kind]; if(!r||!bk[kind]) return ''; const off=bk[kind].off; const lp=l[kind+'p'];
      return label+' (Senior '+cls[1]+' '+s.name+'), Unit '+u.no+', '+rng(r[0],r[1],off)+(lp?'; this lesson is near '+(off!=null&&lp-off>=1?'p. '+(lp-off)+' (PDF page '+lp+')':'PDF page '+lp):''); }
    expanded[k]={class:sc.class,subject:sc.subject,subjectName:sc.subjectName,units:sc.units.map(u=>({no:u.no,title:u.title,periods:u.periods,keyComp:u.keyComp,term:u.term,
      lessons:u.lessons.map(l=>{ const sb=cite(u,l,'sb',"Student's Book"), tg=cite(u,l,'tg',"Teacher's Guide"); const refs=[l.references||ref, sb, tg].filter(Boolean).join(' ');
        const aids=[sb?"Student's Book "+rng(u.sb[0],u.sb[1],bk.sb.off):'', l.aids||u.aids||''].filter(Boolean).join('; ');
        const act=(l.ea!=null&&u.acts)?u.acts[l.ea]:null, off=bk.sb&&bk.sb.off, pp=l.sbp?(off!=null&&l.sbp-off>=1?l.sbp-off:l.sbp):0, ap=act?(off!=null&&act.p-off>=1?act.p-off:act.p):0;
        return Object.assign({},l,{aids:aids,assessment:l.assessment||u.assessment||'',references:refs,sbBook:sb?1:0,ex:act?act.q.map(exClean).filter(q=>q&&exOK(q)):[],exPage:ap,bookPage:pp}); })}))};
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

  /* ---- real book exercises: the Student's Book application activities for the lesson ---- */
  const BOOKWORD={en:"Student's Book",fr:"Livre de l’élève",rw:'Igitabo cy’umunyeshuri'};
  function secLesson(){ try{ return lpUsingScheme()?lpSchemeLesson():null; }catch(e){ return null; } }
  function secBookLine(sl){ if(!sl||!sl.sbBook) return ''; const pg=sl.exPage||sl.bookPage; return pg?(BOOKWORD[plusLang()]||BOOKWORD.en)+', p. '+pg:''; }
  const _tasks=plusTasks; plusTasks=function(){
    if(!(LP&&plusIsSec(LP.classId))) return _tasks.apply(this,arguments);
    const sl=secLesson(); const ref=secBookLine(sl);
    return ((sl&&sl.ex)||[]).map(q=>({kind:'text',prompt:q,answer:ref?('Mark with the class; see '+ref+' and the Teacher’s Guide where available.'):'Mark with the class.'}));
  };
  const _exit2=plusExitDraft; plusExitDraft=function(){
    if(!(LP&&plusIsSec(LP.classId))) return _exit2.apply(this,arguments);
    const sl=secLesson(); const ex=(sl&&sl.ex)||[];
    if(!ex.length){ const t=_exit2.apply(this,arguments); const ref=secBookLine(sl); return ref?t+'\n('+({en:'More practice: ',fr:'Plus d’exercices : ',rw:'Imyitozo y’inyongera: '}[plusLang()]||'More practice: ')+ref+')':t; }
    const ref=secBookLine(sl);
    return ex.slice(0,3).map((q,i)=>(i+1)+'. '+q).join('\n')+(ref?'\n('+({en:'From the ',fr:'Du ',rw:'Biva mu '}[plusLang()]||'From the ')+ref+')':'');
  };
  const _hw2=plusHomeworkDraft; plusHomeworkDraft=function(){
    if(!(LP&&plusIsSec(LP.classId))) return _hw2.apply(this,arguments);
    const sl=secLesson(); const ex=(sl&&sl.ex)||[]; const rest=ex.slice(3,5);
    if(!rest.length) return _hw2.apply(this,arguments);
    return rest.map((q,i)=>(i+1)+'. '+q).join('\n');
  };
  window.plusSecSchemeFor=secScheme;
})();
