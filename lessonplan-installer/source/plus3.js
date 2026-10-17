
/* ---------- drafting helpers (all deterministic, built from the scheme / pupil book of the chosen lesson) ---------- */
function plusStory(){   /* the pupil-book lesson behind the chosen lesson, if any */
  try{
    if(lpUsingScheme()){ const bl=lpBookLinkFor(lpSchemeUnit(),lpSchemeLesson()); return bl&&!bl.approx?bl.story:null; }   /* only an exact pupil-book match supplies exercises; a "closest lesson" would give unrelated questions */
    return lpLesson();
  }catch(e){ return null; }
}
function plusTasks(){ const s=plusStory(); return (s&&s.tasks)||[]; }
function plusTitleOf(i,arr){ const x=arr[i]; if(!x) return ''; return lpTitleOnly(lpCleanSchemeTitle(x.title))||PLUS_ENG(stripLeadNum(x.title)); }
function plusPrevNext(){
  let prev='',next='';
  try{
    if(lpUsingScheme()){ const u=lpSchemeUnit(); const ls=(u&&u.lessons)||[]; const i=LP.lessonIdx; prev=plusTitleOf(i-1,ls); next=plusTitleOf(i+1,ls);
      if(!prev&&LP.unitIdx>0){ const pu=lpScheme().units[LP.unitIdx-1]; if(pu&&pu.lessons.length) prev=plusTitleOf(pu.lessons.length-1,pu.lessons); }
      if(!next){ const nu=lpScheme().units[LP.unitIdx+1]; if(nu&&nu.lessons.length) next=plusTitleOf(0,nu.lessons); } }
    else { const ls=lpLessons(); const i=LP.lessonIdx; prev=plusTitleOf(i-1,ls); next=plusTitleOf(i+1,ls); }
  }catch(e){}
  return {prev,next};
}
function plusCleanObjective(){
  let o=PLUS_ENG(LP.objectives).replace(/^[•*\-\s]+/,'');
  o=o.replace(/^(?:by the end of (?:the|this) lesson|given [^,]{3,80}),\s*/i,'').replace(/^(?:à la fin de la leçon|a la fin de la lecon|ku iherezo ry\'isomo),?\s*/i,'');
  o=o.replace(/^(?:the\s+)?(?:learners?|pupils?|students?)\s+(?:will|should)\s+be\s+able\s+to\s+/i,'').replace(/^les\s+[eé]l[eè]ves\s+seront\s+capables\s+(?:de|d\')\s*/i,'').replace(/^abanyeshuri\s+bazashobora\s+/i,'');
  return o;
}
function plusCriteriaDraft(){
  const lead={en:'I can ',fr:'Je peux ',rw:'Nshobora '}[plusLang()];
  const parts=plusCleanObjective().split(/[.;\n•]+/).map(s=>s.trim()).filter(s=>s.length>6).slice(0,4);
  if(!parts.length) return '';
  return parts.map(p=>{ p=p.replace(/\s*\(.*?\)\s*$/,''); const c=/^[A-Z]{2,}/.test(p)?p:p.charAt(0).toLowerCase()+p.slice(1); return '- '+lead+c.replace(/[.,;:]+$/,'')+'.'; }).join('\n');
}
function plusTermsDraft(){
  let src='';
  try{ if(lpUsingScheme()){ const s=lpSchemeLesson(); src=(s&&s.content)||''; } else { const s=lpLesson(); src=(s&&s.topic)||''; } }catch(e){}
  let terms=String(src).split(/[,;\n]+/).map(x=>PLUS_ENG(x).replace(/\.$/,'')).filter(x=>x.length>=3&&x.length<=40);
  if(terms.length<2){ const t=(LP.lessonTitle||'').split(/[\s,:;()]+/).filter(w=>w.length>=5); terms=terms.concat(t); }
  return Array.from(new Set(terms)).slice(0,8).join(', ');
}
function plusExitDraft(){
  const L=plusLang(); const tasks=plusTasks(); const pick=[]; const ansWord=tx(PLUS_UI.ans);
  const good=tasks.filter(t=>['number','choice','text'].includes(t.kind)&&t.prompt&&t.answer&&String(t.prompt).length<200);
  good.slice(0,3).forEach(t=>pick.push(t));
  if(pick.length<3) tasks.filter(t=>t.kind==='order'&&t.items&&t.items.length>2).slice(0,3-pick.length).forEach(t=>pick.push(t));
  const lines=pick.map((t,i)=>{
    if(t.kind==='order') return (i+1)+'. '+tx(PLUS_UI.order)+': '+t.items.slice(2).concat(t.items.slice(0,2)).join(' / ')+'  ['+ansWord+': '+t.items.join(' ')+']';
    const opts=t.options&&t.options.length?'  ('+t.options.join(' / ')+')':'';
    return (i+1)+'. '+PLUS_ENG(t.prompt).replace(/▁/g,'____')+opts+'  ['+ansWord+': '+PLUS_ENG(t.answer)+']';
  });
  if(lines.length) return lines.join('\n');
  const t=LP.lessonTitle||LP.unitTitle||'';
  return PLUS_UI.oral.map((o,i)=>(i+1)+'. '+tx(o).replace('{t}',t)).join('\n');
}
function plusHomeworkDraft(){
  const tasks=plusTasks().filter(t=>['number','choice','text'].includes(t.kind)&&t.prompt&&String(t.prompt).length<200);
  const used=(LP.exitTicket||'');
  const more=tasks.filter(t=>!used.includes(PLUS_ENG(t.prompt).slice(0,30))).slice(0,2);
  if(!more.length) return tx(PLUS_UI.hwdef);
  return more.map((t,i)=>(i+1)+'. '+PLUS_ENG(t.prompt).replace(/▁/g,'____')+(t.options&&t.options.length?'  ('+t.options.join(' / ')+')':'')).join('\n');
}
function plusPriorDraft(){
  const pn=plusPrevNext(); const out=[];
  if(pn.prev) out.push(tx(PLUS_UI.prevl)+': '+pn.prev); if(pn.next) out.push(tx(PLUS_UI.nextl)+': '+pn.next);
  return out.join('\n');
}
function plusDraftExtras(){
  LP.successCriteria=plusCriteriaDraft(); LP.keyTerms=plusTermsDraft(); LP.priorNext=plusPriorDraft();
  LP.exitTicket=plusExitDraft(); LP.homework=plusHomeworkDraft();
}
/* ---------- teaching approach, strategies, SEN, ICT: applied after the REB auto-fill ---------- */
function plusApplyApproach(){
  const key=LP.approach||'reb'; if(key==='plain') return; const M=PLUS_MODELS[key]||PLUS_MODELS.reb; const L=plusLang();
  const steps=M.steps[L]||M.steps.en; const dm=Math.max(3,+LP.devMin||30); const mins=plusSplit(dm,M.share);
  const w={en:'Step',fr:'Étape',rw:'Intambwe'}[L]; const reb={en:'REB scheme activity: ',fr:'Activité du programme REB : ',rw:'Igikorwa cya gahunda ya REB: '}[L];
  let acts=''; try{ if(lpUsingScheme()){ const s=lpSchemeLesson(); acts=PLUS_ENG(s&&s.activities); } }catch(e){}
  LP.devTeacher=steps.map((s,i)=>w+' '+(i+1)+' - '+s[0]+' ('+mins[i]+' min): '+s[1]+(i===1&&acts?' '+reb+acts:'')).join('\n');
  let learn=steps.map((s,i)=>w+' '+(i+1)+' - '+s[0]+' ('+mins[i]+' min): '+s[2]).join('\n');
  const st=Object.keys(LP.strategies||{}).filter(k=>LP.strategies[k]&&PLUS_STRATEGIES[k]);
  if(st.length) learn+='\n'+({en:'Learning strategies: ',fr:'Stratégies d\'apprentissage : ',rw:'Uburyo bwo kwiga: '}[L])+st.map(k=>tx(PLUS_STRATEGIES[k].t)).join(' ');
  LP.devLearner=learn; LP.devMin=dm;
  const pre=key==='e5'?{i:{en:'Engage - ',fr:'Engager - ',rw:'Gushishikariza - '},c:{en:'Evaluate - ',fr:'Évaluer - ',rw:'Gusuzuma - '}}:null;
  if(pre){ if(!/^(Engage|Engager|Gushishikariza)/.test(LP.introTeacher)) LP.introTeacher=pre.i[L]+LP.introTeacher; if(!/^(Evaluate|Évaluer|Gusuzuma)/.test(LP.concTeacher)) LP.concTeacher=pre.c[L]+LP.concTeacher; }
  const ex={en:' Exit ticket: see the questions below.',fr:' Billet de sortie : voir les questions ci-dessous.',rw:' Ibibazo bisoza isomo: reba hasi.'}[L];
  if(!LP.concTeacher.includes(ex.trim())) LP.concTeacher=LP.concTeacher.replace(/\s+$/,'')+ex;
}
function plusApplySEN(){
  const lines=(LP.differentiation||'').split('\n').filter(l=>!/^◆ /.test(l)); const L=plusLang();
  const add=Object.keys(LP.senChecks||{}).filter(k=>LP.senChecks[k]&&PLUS_SEN[k]).map(k=>'◆ '+tx(PLUS_SEN[k]));
  LP.differentiation=lines.concat(add).join('\n').trim();
}
function plusApplyICT(){
  const tools=Object.keys(LP.ictTools||{}).filter(k=>LP.ictTools[k]&&PLUS_ICT[k]); const L=plusLang();
  const link=PLUS_ENG(LP.ictLink);
  if(!tools.length&&!link){
    if(LP.ictNone){ LP.ict1=tx(PLUS_ICT_TXT.none); LP.ict2=''; LP.ict3=''; LP.ict4=''; }
    else if(/^(Projector\/laptop|Projecteur\/ordinateur|Projegiteri\/mudasobwa)/i.test(LP.ict1||'')){ LP.ict1=''; LP.ict2=''; LP.ict3=''; LP.ict4=''; }   /* the generator's projector boilerplate is not true for every school: leave it blank until a tool is chosen */
    return; }
  LP.ict1=tx(PLUS_ICT_TXT.tools)+(tools.length?tools.map(k=>tx(PLUS_ICT[k].t)).join('; '):'-')+'. '+(link?tx(PLUS_ICT_TXT.res)+link+'.':'');
  LP.ict2=tools.length?(tools.map(k=>({en:'The '+PLUS_ICT[k].name.toLowerCase()+': ',fr:'',rw:''}[L]||'')+tx(PLUS_ICT[k].why)).join('; ')+'.').replace(/^./,c=>c.toUpperCase()):'';
  LP.ict3=tx(PLUS_ICT_TXT.purpose)+' '+tx(PLUS_ICT_TXT.impact); LP.ict4=tx(PLUS_ICT_TXT.achieve);
}
function plusAfterAutofill(){
  if(!LP) return;
  if(LP.lang===undefined) LP.lang=''; if(!LP.approach) LP.approach='reb'; if(!LP.strategies) LP.strategies={};
  plusApplyApproach(); plusApplySEN(); plusApplyICT(); plusDraftExtras();
  if(typeof LP_TEXT_KEYS!=='undefined') LP._snap=lpTextSnapshot();
}
