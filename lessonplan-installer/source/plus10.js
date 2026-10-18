/* ===== Lesson Studio, part 10: pre-primary (Years 1-3, classes N1-N3) =====
   Uses PP_DATA (preprimary/preprimary-data.js, built by preprimary/build_pp.py from the REB pre-primary schemes of work, Years 1-3).
   Adds the three pre-primary years, their six learning areas and the weekly scheme rows to the generator.
   Plans are in Kinyarwanda (English for the English and Social and emotional areas), speak of "children", last 30 minutes and use observation, not exams. */
const PP_CLASSES=['N1','N2','N3'];
function plusIsPP(c){ return /^N[1-3]$/.test(c||''); }
(function(){
  if(typeof PP_DATA==='undefined') return;
  const AREA={env:'pp_env',maths:'pp_maths',kinyarwanda:'kinyarwanda',english:'english',arts:'pp_arts',health:'pp_health',social:'pp_social'};
  const UNAREA={}; Object.keys(AREA).forEach(k=>UNAREA[AREA[k]]=k);
  const COL={pp_env:'#2f9e44',pp_maths:'#0b4da2',pp_arts:'#e64980',pp_health:'#f08c00'};
  if(typeof CLASS_META!=='undefined') PP_CLASSES.forEach((c,i)=>{ if(!CLASS_META[c]) CLASS_META[c]={id:c,name:'Pre-primary Year '+(i+1),short:c,color:['#f08c00','#e64980','#7048e8'][i],tint:['#fdf0dc','#fdeaf1','#eee9fd'][i]}; });
  if(typeof SUBJECT_META!=='undefined') Object.keys(PP_DATA.classes.N1).forEach(a=>{ const id=AREA[a], s=PP_DATA.classes.N1[a]; if(!SUBJECT_META[id]) SUBJECT_META[id]={name:s.name,short:s.name.split(' ')[0],icon:'book',color:COL[id]||'#0b4da2',tint:'#eef1f6'}; });
  const NAMEOF=a=>({env:'Environment (Ubumenyi bw’ibidukikije)',maths:'Numeracy (Imibare)',arts:'Arts and culture (Ubugeni n’umuco)',health:'Health and physical development (Ibonezabuzima)',social:'Social and emotional development (REB 2015 curriculum)',kinyarwanda:'Kinyarwanda',english:'English'}[a]);
  const cache={};
  function ppScheme(cls,subj){
    const k=cls+'-'+subj; if(cache.hasOwnProperty(k)) return cache[k];
    const a=UNAREA[subj], s=a&&PP_DATA.classes[cls]&&PP_DATA.classes[cls][a]; if(!s) return (cache[k]=null);
    return (cache[k]={class:cls,subject:subj,subjectName:NAMEOF(a),units:s.units.map(u=>({no:u.no,title:u.title,periods:u.periods,keyComp:u.keyComp,term:u.term,
      lessons:u.lessons.map(l=>Object.assign({},l,{assessment:l.assessment||''}))}))});
  }
  function ppSubjects(cls){ const c=PP_DATA.classes[cls]; if(!c) return []; return ['env','maths','kinyarwanda','english','arts','health','social'].filter(a=>c[a]).map(a=>({id:AREA[a],units:[],title:NAMEOF(a)})); }
  /* language: Kinyarwanda for every area except English (the REB schemes are written in Kinyarwanda) */
  const _ls=lpLangSubject; lpLangSubject=function(p){ if(p&&!p.lang&&plusIsPP(p.classId)) return (p.subject==='english'||p.subject==='pp_social')?'english':'kinyarwanda'; return _ls.apply(this,arguments); };
  const _lo=plusLangOf; plusLangOf=function(p){ if(p&&!p.lang&&plusIsPP(p.classId)) return (p.subject==='english'||p.subject==='pp_social')?'en':'rw'; return _lo.apply(this,arguments); };
  const _classes=plusClassIds; plusClassIds=function(){ return PP_CLASSES.concat(_classes.apply(this,arguments)); };
  const _editor=lpEditor;
  lpEditor=function(){
    const o=scopeClasses;
    scopeClasses=function(st){ const a=o(st); return PP_CLASSES.filter(c=>!a.includes(c)).concat(a); };
    try{ return _editor.apply(this,arguments); } finally{ scopeClasses=o; }
  };
  const _subjects=lpSubjects; lpSubjects=function(){ return plusIsPP(LP&&LP.classId)?ppSubjects(LP.classId):_subjects(); };
  const _books=pupilBooksOf; pupilBooksOf=function(c){ return plusIsPP(c)?[]:_books(c); };
  const _cat=ensureCatalog; ensureCatalog=function(c){ if(plusIsPP(c)){ App.catalogCache=App.catalogCache||{}; if(!App.catalogCache[c]) App.catalogCache[c]={books:[]}; return Promise.resolve(App.catalogCache[c]); } return _cat.apply(this,arguments); };
  const _load=lpLoadScheme; lpLoadScheme=function(cls,subject){
    if(plusIsPP(cls)){ const key=cls+'-'+subject; App.schemeCache=App.schemeCache||{}; App.schemeCache[key]=ppScheme(cls,subject); return Promise.resolve(App.schemeCache[key]); }
    return _load.apply(this,arguments);
  };
  /* children, not pupils; 30-minute sessions; objective framed as what the child will be able to do */
  function kids(t){ return String(t||'').replace(/\b[Pp]upils\b/g,m=>m[0]==='P'?'Children':'children').replace(/\b[Pp]upil\b/g,m=>m[0]==='P'?'Child':'child').replace(/\b[Aa]banyeshuri\b/g,m=>m[0]==='A'?'Abana':'abana').replace(/\b[Uu]munyeshuri\b/g,m=>m[0]==='U'?'Umwana':'umwana'); }
  PLUS_MODELS.play={ name:'Play-based learning (REB pre-primary)', share:[20,60,20], steps:{
   en:[['Circle time and warm-up','The teacher gathers the children in a circle, greets them with a song or rhyme, shows the picture or object of the day and asks simple questions.','Sing, answer simple questions and show what they already know.'],
       ['Guided play and activity','The teacher sets up the play area or materials, demonstrates once, then lets the children explore, play and practise in small groups while the teacher moves around, asks questions and observes.','Play, handle the materials, talk about what they do and help each other.'],
       ['Sharing and closing','The teacher invites the children to show or tell what they did, repeats the key word, song or rhyme, and tidies up together with the children.','Show and tell, sing the closing song and put the materials away.']],
   fr:[['Moment en cercle et échauffement','L\'enseignant(e) rassemble les enfants en cercle, les accueille avec une chanson ou une comptine, présente l\'image ou l\'objet du jour et pose des questions simples.','Chantent, répondent à des questions simples et montrent ce qu\'ils savent déjà.'],
       ['Jeu guidé et activité','L\'enseignant(e) prépare le coin de jeu ou le matériel, montre une fois, puis laisse les enfants explorer, jouer et s\'exercer en petits groupes en circulant, en questionnant et en observant.','Jouent, manipulent le matériel, parlent de ce qu\'ils font et s\'entraident.'],
       ['Partage et clôture','L\'enseignant(e) invite les enfants à montrer ou raconter ce qu\'ils ont fait, répète le mot clé, la chanson ou la comptine et range avec les enfants.','Montrent et racontent, chantent la chanson de fin et rangent le matériel.']],
   rw:[['Kwicara mu ruziga no gutangira','Umwarimu yicaza abana mu ruziga, abasuhuza aririmba indirimbo cyangwa umuvugo, akabereka ishusho cyangwa ikintu cyo kuri uyu munsi akababaza ibibazo byoroheje.','Baririmba, basubiza ibibazo byoroheje berekana ibyo basanzwe bazi.'],
       ['Gukina no gukora igikorwa','Umwarimu ategura aho gukinira cyangwa ibikoresho, akereka abana inshuro imwe, hanyuma abareka bagashakashaka, bagakina kandi bagakora mu matsinda mato, we akazenguruka, abaza ibibazo kandi yitegereza.','Barakina, bakoresha ibikoresho, bavuga ibyo bakora kandi bagafashanya.'],
       ['Gusangira no gusoza','Umwarimu asaba abana kwerekana cyangwa kuvuga ibyo bakoze, akongera kuvuga ijambo ry\'ingenzi, indirimbo cyangwa umuvugo, agafatanya n\'abana gutunganya ibikoresho.','Berekana kandi bakabara, baririmba indirimbo yo gusoza bagasubiza ibikoresho aho biba.']]}};
  const _after=plusAfterAutofill; plusAfterAutofill=function(){
    if(LP&&plusIsPP(LP.classId)&&!LP._ppApp){ LP.approach='play'; LP._ppApp=1; }
    const r=_after.apply(this,arguments);
    if(LP&&plusIsPP(LP.classId)){
      if(!LP._ppDur){ LP.duration=30; LP._ppDur=1; }
      if(typeof LP_TEXT_KEYS!=='undefined') LP_TEXT_KEYS.forEach(k=>{ if(typeof LP[k]==='string') LP[k]=kids(LP[k]); });
      const o=String(LP.objectives||'').replace(/^(?:By the end of the (?:lesson|session), |Ku iherezo ry[’']isomo, )(?:learners|pupils|children|abana|abanyeshuri)\s+(?:will be able to|bazashobora)\s+/i,'').trim().replace(/;\s+(\S)/g,(m,c)=>', '+c.toLowerCase());
      if(o){ const en=plusLang()==='en'; const body=o.charAt(0).toLowerCase()+o.slice(1);
        LP.objectives=(en?'By the end of the session, children will be able to ':'Ku iherezo ry’isomo, abana bazashobora ')+body+(/[.!?]$/.test(body)?'':'.'); }
      if(!LP._ppAs&&!/observ|kwitegereza/i.test(LP.assessment||'')||/^Observe each child/.test(LP.assessment||'')){ LP.assessment=plusLang()==='en'?'Observe each child during the activity and note who can do it alone, who needs help and who needs more time.':'Kwitegereza buri mwana mu gihe cy’igikorwa no kwandika ushobora kugikora wenyine, ukeneye ubufasha n’ukeneye igihe kirekire.'; LP._ppAs=1; }
      if(!LP._ppDf){ LP.differentiation=plusLang()==='en'?'Needs support: more time, real objects to handle, work next to a friend or the teacher. At level: do the activity alone and say what they did. Extension: help a friend, add a new idea, or make up their own song or game on the same theme.':'Abakeneye ubufasha: guhabwa igihe kirekire, gukoresha ibintu nyabyo, gukorana n’inshuti cyangwa umwarimu. Abakora neza: gukora igikorwa bonyine no kuvuga icyo bakoze. Abarenze: gufasha inshuti, kongeraho igitekerezo gishya cyangwa guhimba indirimbo cyangwa umukino ku nsanganyamatsiko imwe.'; LP._ppDf=1; }
      if(LP._snap) LP._snap=lpTextSnapshot();
    }
    return r;
  };
  /* assessment is by observation; no written exit tickets or homework for young children */
  const _exit=plusExitDraft; plusExitDraft=function(){
    if(!(LP&&plusIsPP(LP.classId))) return _exit.apply(this,arguments);
    const en=plusLang()==='en';
    return en?'Observation checklist (tick for each child): takes part in the activity; can do it alone; needs a little help; needs more time.':'Urutonde rwo kwitegereza (shyira ikimenyetso kuri buri mwana): yitabira igikorwa; agikora wenyine; akeneye ubufasha buke; akeneye igihe kirekire.';
  };
  const _hw=plusHomeworkDraft; plusHomeworkDraft=function(){
    if(!(LP&&plusIsPP(LP.classId))) return _hw.apply(this,arguments);
    return plusLang()==='en'?'Play at home: the child shows or tells a family member what was learned today (no written work).':'Gukina mu rugo: umwana yereka cyangwa abwira umuntu wo mu muryango icyo yize uyu munsi (nta mwitozo wanditse).';
  };
  const _tasks=plusTasks; plusTasks=function(){ return (LP&&plusIsPP(LP.classId))?[]:_tasks.apply(this,arguments); };
  window.plusPPSchemeFor=ppScheme;
})();
