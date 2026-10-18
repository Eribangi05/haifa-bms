/* ===== Lesson Studio, part 11: compact print (fewer pages) =====
   A "Compact print" switch on the preview: smaller type and padding, rows with nothing in them hidden, narrow margins.
   The choice is remembered (Accounts.root.settings.lpCompact). */
(function(){
  const css=document.createElement('style'); css.id='lpCompactCss';
  css.textContent='#printRoot.lp-compact .print-preview{font-size:10.5px!important;line-height:1.22!important}'
   +'#printRoot.lp-compact .print-preview table td,#printRoot.lp-compact .print-preview table th{padding:2px 4px!important;font-size:10.5px!important;line-height:1.22!important}'
   +'#printRoot.lp-compact .print-preview h1,#printRoot.lp-compact .print-preview h2{font-size:13px!important;margin:3px 0!important}'
   +'#printRoot.lp-compact .print-preview img{max-height:34px!important;width:auto!important}'
   +'#printRoot.lp-compact .print-preview table{margin:3px 0!important}'
   +'#printRoot.lp-compact .lp-emptyrow{display:none!important}'
   +'@media print{#printRoot.lp-compact .print-preview{padding:0!important}@page{margin:8mm}}';
  document.head.appendChild(css);
  function on(){ try{ return !!(Accounts.root.settings&&Accounts.root.settings.lpCompact); }catch(e){ return false; } }
  function mark(){
    const r=document.getElementById('printRoot'); if(!r) return;
    r.classList.toggle('lp-compact',on());
    r.querySelectorAll('.print-preview table tr').forEach(tr=>{ const c=tr.children; if(c.length<2||tr.querySelector('table,th[colspan]')){ tr.classList.remove('lp-emptyrow'); return; }
      const first=c[0].tagName==='TH'||/(^|\s)(lbl|label)/.test(c[0].className||'')||true; let empty=true; for(let i=1;i<c.length;i++){ if((c[i].textContent||'').replace(/\s+/g,'')){ empty=false; break; } }
      tr.classList.toggle('lp-emptyrow',empty&&c[0].tagName==='TH'&&!/(\d\.|ICT|Ikoranabuhanga|TIC)/i.test(tr.textContent||'')); });
    const b=document.getElementById('lpCompactBtn'); if(b) b.textContent=on()?'Compact print: on':'Compact print: off';
  }
  window.plusCompactToggle=function(){ try{ Accounts.root.settings=Accounts.root.settings||{}; Accounts.root.settings.lpCompact=!on(); if(typeof Accounts.save==='function') Accounts.save(); }catch(e){} mark(); };
  const _prev=lpPreview; lpPreview=function(){
    const r=_prev.apply(this,arguments);
    const a=document.querySelector('#printRoot .print-actions'); if(a&&!document.getElementById('lpCompactBtn')){ const b=document.createElement('button'); b.className='btn ghost sm'; b.id='lpCompactBtn'; b.onclick=plusCompactToggle; const pr=[...a.querySelectorAll('button')].pop(); a.insertBefore(b,pr); }
    mark(); return r;
  };
})();

/* ---- primary: point the exit ticket to the matching Pupil's Book section ---- */
(function(){
  function story(){
    try{ if(!LP||!/^P[1-6]$/.test(LP.classId||'')||!LP.subject||!lpUsingScheme()) return null; const sl=lpSchemeLesson(); if(!sl||!sl.bookLesson) return null;
      const cat=App.catalogCache&&App.catalogCache[LP.classId]; if(!cat) return null;
      for(const b of cat.books||[]){ if(b.id!==LP.subject&&!(b.subject===LP.subject)) continue; for(const u of b.units||[]) for(const st of u.stories||[]) if(st.id===sl.bookLesson) return {st,u,b}; }
    }catch(e){} return null; }
  const _exit=plusExitDraft; plusExitDraft=function(){
    const t=_exit.apply(this,arguments); const f=story(); if(!f) return t;
    const nums=(f.st.pages||[]).map(x=>parseInt(String(x).replace(/\D+/g,'').slice(0,6),10)).filter(x=>x>0); const a=nums.length?nums[0]:(f.st.pg&&f.st.pg[0]); const z=nums.length?nums[nums.length-1]:(f.st.pg&&f.st.pg[1]); if(!a) return t; const pdf=a===z?'PDF page '+a:'PDF pages '+a+'-'+z;
    const w={en:'More practice: Pupil\u2019s Book, ',fr:'Plus d\u2019exercices : Livre de l\u2019\u00e9l\u00e8ve, ',rw:'Imyitozo y\u2019inyongera: Igitabo cy\u2019umunyeshuri, '}[plusLang()]||'More practice: Pupil\u2019s Book, ';
    return t+'\n('+w+String(f.st.title).replace(/^\d+(\.\d+)*\.?\s*/,'')+', '+pdf+')';
  };
})();

/* ---- the default REB approach follows the REB teacher-training text (Foundation of Education, Unit 8.2, "Parts of a lesson"):
   discovery activity -> presentation and exploitation of learners' productions -> summary and application ---- */
(function(){
  PLUS_MODELS.reb.share=[30,40,30];
  PLUS_MODELS.reb.steps={
   en:[['Discovery activity','The teacher gives the task and clear instructions, lets the learners work in pairs or groups, and moves around to monitor and support those who are behind, without giving the knowledge directly.','Work together on the task, discuss, try out ideas and record their findings.'],
       ['Presentation and exploitation of learners’ work','The teacher invites group representatives to present, then asks the class to judge which productions are correct, incomplete or false; the teacher corrects, completes and confirms.','Present their findings, listen to others and decide what is correct, incomplete or false.'],
       ['Summary and application','The teacher summarises the key knowledge with examples, links it to the lesson objective, guides learners to note it down and gives application exercises from real life.','Note the summary and do the application exercises, linking what they learned to real life.']],
   fr:[['Activité de découverte','L’enseignant(e) donne la tâche et les consignes, laisse les élèves travailler en binômes ou en groupes et circule pour suivre et aider ceux qui sont en retard, sans donner directement le savoir.','Travaillent ensemble sur la tâche, discutent, essaient des idées et notent leurs trouvailles.'],
       ['Présentation et exploitation des productions','L’enseignant(e) invite des représentants des groupes à présenter, puis demande à la classe de juger quelles productions sont correctes, incomplètes ou fausses ; il corrige, complète et confirme.','Présentent leurs trouvailles, écoutent les autres et décident ce qui est correct, incomplet ou faux.'],
       ['Synthèse et application','L’enseignant(e) résume les savoirs clés avec des exemples, les relie à l’objectif de la leçon, guide la prise de notes et propose des exercices d’application tirés de la vie réelle.','Notent la synthèse et font les exercices d’application en liant ce qu’ils ont appris à la vie réelle.']],
   rw:[['Igikorwa cyo kuvumbura','Umwarimu atanga umurimo n’amabwiriza asobanutse, agaha abanyeshuri umwanya wo gukorera mu mpuzandengo cyangwa mu matsinda, akazenguruka akurikirana agafasha abasigaye inyuma, atabahaye ubumenyi mu buryo butaziguye.','Bakorera hamwe umurimo, baraganira, bagerageza ibitekerezo bakandika ibyo bavumbuye.'],
       ['Kugaragaza no gusesengura ibyakozwe','Umwarimu asaba ababwira amatsinda kugaragaza ibyakozwe, hanyuma agasaba ishuri gusuzuma ibikozwe neza, ibituzuye n’ibitari byo; umwarimu arakosora, akuzuza kandi akemeza.','Bagaragaza ibyo bavumbuye, bakumva abandi bakemeza ibikozwe neza, ibituzuye n’ibitari byo.'],
       ['Incamake no gushyira mu bikorwa','Umwarimu avuga incamake y’ubumenyi bw’ingenzi akoresheje ingero, akayihuza n’intego y’isomo, agafasha abanyeshuri kwandika, akanatanga imyitozo ijyanye n’ubuzima busanzwe.','Bandika incamake bagakora imyitozo, bahuza ibyo bize n’ubuzima busanzwe.']]};
})();
