/* ===== Lesson Studio, part 10: pre-primary (Years 1-3, classes N1-N3) =====
   Uses PP_DATA (preprimary/preprimary-data.js, built by preprimary/build_pp.py from the REB pre-primary schemes of work, Years 1-3).
   Adds the three pre-primary years, their six learning areas and the weekly scheme rows to the generator.
   Plans are in Kinyarwanda (English for the English and Social and emotional areas), speak of "children", last 20-30 minutes (REB pre-primary timetable 2026-27: 30 min for Environment, Numeracy and languages; 20 min for Arts, Health and Social) and use observation, not exams. */
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
  PLUS_MODELS.playeng={ name:'Songs, rhymes and poems (REB English guide for pre-primary)', share:[25,50,25], steps:{
   en:[['Show the materials and model','The teacher shows the picture or object, recites the first two lines of the song, rhyme or poem with gestures, and invites the children to listen.','Look, listen and touch the materials; listen to the first two lines.'],
       ['Repeat and build up line by line','The teacher asks the children to repeat the first two lines in groups, then one by one, then adds the third line and the next, always with gestures.','Repeat in groups and one by one, adding a line each time and using gestures.'],
       ['Recite the whole text','The teacher helps the children to say the whole song, rhyme or poem, then asks them to recite it one by one and in pairs with appropriate gestures.','Recite the whole text in groups, one by one and in pairs, with gestures.']],
   fr:[['Montrer le mat\u00e9riel et mod\u00e9liser','L\u2019enseignant(e) montre l\u2019image ou l\u2019objet, dit les deux premi\u00e8res lignes avec des gestes et invite les enfants \u00e0 \u00e9couter.','Regardent, \u00e9coutent et touchent le mat\u00e9riel.'],
       ['R\u00e9p\u00e9ter et ajouter ligne par ligne','Les enfants r\u00e9p\u00e8tent en groupes puis un par un ; l\u2019enseignant(e) ajoute la ligne suivante avec des gestes.','R\u00e9p\u00e8tent en groupes et un par un en ajoutant une ligne \u00e0 chaque fois.'],
       ['R\u00e9citer le texte entier','Les enfants disent tout le texte, puis un par un et en bin\u00f4mes avec des gestes.','R\u00e9citent le texte entier avec des gestes.']],
   rw:[['Kwerekana ibikoresho no kwigana','Umwarimu yereka ishusho cyangwa ikintu, avuga imirongo ibiri ya mbere y\u2019indirimbo, umuvugo cyangwa agakino akoresheje ibimenyetso, agasaba abana gutega amatwi.','Barareba, bateze amatwi kandi bakora ku bikoresho.'],
       ['Gusubiramo wongeraho umurongo ku wundi','Umwarimu asaba abana gusubiramo mu matsinda hanyuma umwe umwe, akongeraho umurongo wa gatatu n\u2019ukurikiraho akoresheje ibimenyetso.','Basubiramo mu matsinda no umwe umwe, bongeraho umurongo buri gihe bakoresha ibimenyetso.'],
       ['Kuvuga byose','Umwarimu afasha abana kuvuga byose, hanyuma bakabivuga umwe umwe no mu mpuzandengo bakoresha ibimenyetso bikwiye.','Bavuga byose mu matsinda, umwe umwe no mu mpuzandengo bakoresha ibimenyetso.']]}};
  const _after=plusAfterAutofill; plusAfterAutofill=function(){
    if(LP&&plusIsPP(LP.classId)){
      /* session length from the REB pre-primary timetable; introduction / development / conclusion + evaluation as in the REB guide's sample plan (3 + 10 + 3 + 4 of 20 minutes) */
      if(!LP._ppDur){ LP.duration=/^(pp_arts|pp_health|pp_social)$/.test(LP.subject||'')?20:30; LP._ppDur=1; }
      const d=+LP.duration||30; LP.introMin=Math.max(3,Math.round(d*0.13)); LP.concMin=Math.max(3,Math.round(d*0.2)); LP.devMin=Math.max(8,d-LP.introMin-LP.concMin);
      if(!LP._ppApp){ LP.approach=LP.subject==='english'?'playeng':'play'; LP._ppApp=1; }
    }
    const r=_after.apply(this,arguments);
    if(LP&&plusIsPP(LP.classId)){
      {
        const en=plusLang()==='en';
        LP.introTeacher=en?'The teacher and the children sing a song or play a short game related to the lesson ('+LP.introMin+' min).':'Umwarimu n\u2019abana baririmba indirimbo cyangwa bakina umukino ujyanye n\u2019isomo ('+LP.introMin+' min).';
        LP.introLearner=en?'Children sing the song or play the game.':'Abana baririmba cyangwa bakina.';
        LP.concTeacher=en?'The teacher asks the children one by one to show or repeat what they learned, and suggests a short activity to repeat at home ('+LP.concMin+' min).':'Umwarimu asaba abana umwe umwe kwerekana cyangwa gusubiramo ibyo bize, akabaha igikorwa cyoroheje cyo gusubiramo mu rugo ('+LP.concMin+' min).';
        LP.concLearner=en?'Children show or recite what they learned; at home they repeat it with the family.':'Abana berekana cyangwa basubiramo ibyo bize; mu rugo babisubiramo n\u2019umuryango.';
      }
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
