
/* ---------- REB plan check: the five criteria of REB's "Model lesson template" (15 + 10 + 30 + 40 + 5 = 100) ---------- */
const PLUS_STOP=new Set('the and for with that this from will able learners pupils students their they them into about using use are was were has have not but can out one two all any how what when where which who why your you our its his her him she also than then there these those each such more most some very much many other only over same too via per'.split(' '));
function plusWords(t){ return String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9]+/).filter(w=>w.length>=4&&!PLUS_STOP.has(w)); }
function plusScore(p){
  p=p||LP; const R=[]; const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const add=(name,max,items)=>{ const pts=items.reduce((a,i)=>a+(i.ok?i.pts:0),0); R.push({name,max,pts,items}); };
  const gen=Object.values(p.generic||{}).filter(Boolean).length, cross=Object.values(p.cross||{}).filter(Boolean).length;
  const gcAll=['introGC','devGC','concGC'].every(k=>String(p[k]||'').trim().length>10)||String(p.genericNote||'').trim().length>10;
  add('Competences and cross-cutting issues',15,[
    {ok:gen>=1,pts:6,tip:'Tick at least one generic competence.'},{ok:gen>=3,pts:2,tip:'Three generic competences give a fuller picture.'},
    {ok:cross>=1,pts:4,tip:'Tick at least one cross-cutting issue.'},{ok:cross>=2,pts:1,tip:'Add a second cross-cutting issue where it fits.'},
    {ok:gcAll,pts:2,tip:'Write a short explanation of how each competence is addressed.'}]);
  const obj=PLUS_ENG(p.objectives), on=norm(obj);
  add('Clear, SMART objective',10,[
    {ok:new RegExp('\\b('+PLUS_BLOOM+')\\b','i').test(on)&&!PLUS_VAGUE.test(obj),pts:4,tip:PLUS_VAGUE.test(obj)?'Replace vague verbs (understand, know) with something you can see: identify, solve, explain, write.':'Start with a measurable action verb (identify, solve, explain, write).'},
    {ok:obj.length>0&&/(learners?|pupils?|students?|[eé]l[eè]ves|abanyeshuri|^[A-Za-zÀ-ſ•\-\s]{3,20}\b)/i.test(obj),pts:1,tip:'Say who does what (learners will be able to ...).'},
    {ok:/(by the end|at least|%|\d|within|minutes?|[àa] la fin|ku iherezo|nibura)/i.test(obj),pts:3,tip:'Add a condition or a target: "by the end of the lesson", "with at least 80% correct".'},
    {ok:obj.length>=40&&obj.length<=320,pts:2,tip:obj.length<40?'The objective is very short; say what exactly learners will do.':'Keep the objective to what can be achieved in one lesson.'}]);
  const ph=k=>String(p[k+'Teacher']||'').trim().length>15&&String(p[k+'Learner']||'').trim().length>15;
  const total=(+p.introMin||0)+(+p.devMin||0)+(+p.concMin||0), dur=+p.duration||0;
  const timed=(String(p.devTeacher||'').match(/\(\d+\s*min\)/g)||[]).length;
  const objw=new Set(plusWords(obj)), actw=plusWords([p.introTeacher,p.introLearner,p.devTeacher,p.devLearner,p.concTeacher,p.concLearner,p.contentSummary].join(' '));
  const overlap=actw.filter(w=>objw.has(w)).length;
  const ticked=Object.keys(p.generic||{}).filter(k=>p.generic[k]).concat(Object.keys(p.cross||{}).filter(k=>p.cross[k]));
  const gcText=norm([p.introGC,p.devGC,p.concGC,p.genericNote].join(' '));
  const gcRel=ticked.length&&ticked.some(k=>norm(k).split(/[^a-z]+/).filter(w=>w.length>=6).some(w=>gcText.includes(w.slice(0,6))));
  add('Teaching and learning activities',30,[
    {ok:ph('intro'),pts:2,tip:'Describe both the teacher\'s and the learners\' activity in the Introduction.'},{ok:ph('dev'),pts:2,tip:'Describe both columns in the Development.'},{ok:ph('conc'),pts:2,tip:'Describe both columns in the Conclusion.'},
    {ok:dur>0&&total===dur,pts:6,tip:'The three parts must add up to the lesson time (use "Balance the minutes").'},
    {ok:timed>=3,pts:6,tip:'Describe the Development in at least three steps, each with its own minutes (choose a teaching approach and press "Apply").'},
    {ok:overlap>=2,pts:6,tip:'Make the activities use the words of the objective, so they clearly lead to it.'},
    {ok:!!gcRel,pts:6,tip:'Link the activities to the competences you ticked (name them in the explanation).'}]);
  const ictTools=Object.keys(p.ictTools||{}).filter(k=>p.ictTools[k]).length;
  const ictTxt=norm([p.ict1,p.ict2,p.ict3,p.ict4].join(' '));
  add('Use of ICT tools',40,[
    {ok:ictTools>=1||(!/^(projector\/laptop|projecteur\/ordinateur|projegiteri\/mudasobwa)/.test(norm(p.ict1||''))&&/(phone|telephone|radio|projector|projecteur|laptop|ordinateur|computer|tablet|video|app|mudasobwa|telefoni|radiyo)/.test(ictTxt)),pts:10,tip:'Name the ICT tool you will use (phone, radio, projector, laptop, REB e-learning ...). Without ICT this part scores 0.'},
    {ok:String(p.ictLink||'').trim().length>3||/(https?:|www\.|\.rw|reb e-?learning|elearning)/.test(ictTxt),pts:10,tip:'Give the web link or the exact resource (for example the REB e-learning page or the video title).'},
    {ok:[p.ict2,p.ict3,p.ict4].every(x=>String(x||'').trim().length>15),pts:10,tip:'Answer ICT questions 2, 3 and 4 (why this tool, expected impact, effect on achievement).'},
    {ok:/(interact|discuss|answer|particip|question|group|pair|respon|reponse|baganira|basubiza)/.test(ictTxt)&&ictTools>=1,pts:10,tip:'Say how the tool makes learners interact (they discuss, answer, try tasks).'}]);
  const hasItems=String(p.exitTicket||'').trim().length>20||/\?/.test(String(p.assessment||''));
  add('Assessment',5,[
    {ok:String(p.assessment||'').trim().length>20,pts:2,tip:'Say how you will check that the objective was met.'},
    {ok:hasItems,pts:3,tip:'Include test items that are ready to use (the exit ticket does this) and fit in the lesson time.'}]);
  const total100=R.reduce((a,r)=>a+r.pts,0);
  const label=total100>=85?'Strong':total100>=70?'Good':total100>=50?'Needs work':'Incomplete';
  return {total:total100,label,parts:R};
}
function plusCheckHTML(){
  const sc=plusScore(); const col=sc.total>=85?'#20603D':sc.total>=70?'#00A1DE':sc.total>=50?'#8a5a00':'#c92a2a';
  return `<div class="row" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><div style="font-size:34px;font-weight:800;color:${col}">${sc.total}<span style="font-size:15px;color:var(--mute)"> / 100</span></div><div><b style="color:${col}">${sc.label}</b><div class="sub-note">Scored with the REB model lesson template criteria. Fix the items below to raise it.</div></div></div>`
   +sc.parts.map(r=>{ const miss=r.items.filter(i=>!i.ok); return `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-weight:600;font-size:13.5px"><span>${esc(r.name)}</span><span>${r.pts} / ${r.max}</span></div><div style="height:8px;border-radius:6px;background:var(--soft);overflow:hidden"><div style="height:100%;width:${Math.round(100*r.pts/r.max)}%;background:${r.pts===r.max?'#20603D':'#00A1DE'}"></div></div>${miss.length?`<ul style="margin:5px 0 0 18px;font-size:13px;color:var(--mute)">${miss.map(i=>`<li>${esc(i.tip)}</li>`).join('')}</ul>`:'<div class="sub-note" style="margin-top:3px">&#10003; Complete</div>'}</div>`; }).join('');
}
let plusCheckTimer=null;
function plusCheckSoon(){ clearTimeout(plusCheckTimer); plusCheckTimer=setTimeout(()=>{ const el=document.getElementById('lpCheckBody'); if(el&&LP) el.innerHTML=plusCheckHTML(); },250); }
