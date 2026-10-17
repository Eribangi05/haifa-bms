
/* ---------- language for one plan (override of the subject-based default) ---------- */
let PLUS_FORCE='';
function plusLangOf(p){ return p.lang==='fr'||p.lang==='rw'||p.lang==='en'?p.lang:(p.subject==='french'?'fr':p.subject==='kinyarwanda'?'rw':'en'); }
(function(){ const f=plusLang; plusLang=function(){ if(PLUS_FORCE) return PLUS_FORCE; return f(); }; })();
function plusWithLang(p,fn){ const old=PLUS_FORCE; PLUS_FORCE=plusLangOf(p); try{ return fn(); } finally{ PLUS_FORCE=old; } }
['successCriteria','keyTerms','priorNext','exitTicket','homework'].forEach(k=>{ if(typeof LP_TEXT_KEYS!=='undefined'&&!LP_TEXT_KEYS.includes(k)) LP_TEXT_KEYS.push(k); });

/* ---------- wrappers around the REB generator ---------- */
(function(){
  const fresh=lpFreshDraft; lpFreshDraft=function(){ const d=fresh(); const df=(Accounts.root.settings.defaults)||{};
    d.approach=df.approach||'reb'; d.lang=''; d.strategies={}; d.ictTools=Object.assign({},df.ictTools||{}); d.ictLink=''; d.extras={criteria:true,terms:true,prior:true,exit:true,homework:true,rubric:true};
    d.successCriteria=''; d.keyTerms=''; d.priorNext=''; d.exitTicket=''; d.homework=''; d.fav=false; return d; };
  const fs=lpAutofillFromScheme; lpAutofillFromScheme=function(){ if(!lpHasLesson()) return fs(); const b=LP_BATCH; LP_BATCH=true; try{ fs(); } finally{ LP_BATCH=b; } plusAfterAutofill(); if(!LP_BATCH){ toast('Auto-filled from the REB scheme of work. Review and edit as needed.'); lpEditor(); } };
  const fc=lpAutofillFromCatalog; lpAutofillFromCatalog=function(){ if(!lpHasLesson()) return fc(); const b=LP_BATCH; LP_BATCH=true; try{ fc(); } finally{ LP_BATCH=b; } plusAfterAutofill(); if(!LP_BATCH){ toast('Auto-filled from the lesson. Review and edit as needed.'); lpEditor(); } };
  const ls=lpSet; lpSet=function(k,v){ ls(k,v); plusCheckSoon(); };
  const lt=lpToggle; lpToggle=function(g,n){ lt(g,n); plusCheckSoon(); };
  const ed=lpEditor; lpEditor=function(){ ed(); try{ plusInject(); }catch(e){ console.error(e); } };
  const sh=lpSheetHTML; lpSheetHTML=function(p){ return plusWithLang(p,()=>plusSheetExtras(sh(p),p)); };
})();
function plusSet(k,v){ if(!LP) return; LP[k]=v; plusCheckSoon(); }
function plusTog(g,k){ if(!LP) return; LP[g]=LP[g]||{}; LP[g][k]=!LP[g][k]; plusCheckSoon(); }
function plusRemember(){ const s=Accounts.root.settings; s.defaults=s.defaults||{}; s.defaults.approach=LP.approach; s.defaults.ictTools=Object.assign({},LP.ictTools||{}); Accounts.save(); }
function plusApplyAll(){
  if(!lpHasLesson()||!(LP.objectives||'').trim()){ toast('Choose a lesson and press Auto-fill first; then apply the design options.'); return; }
  plusApplyApproach(); plusApplySEN(); plusApplyICT(); plusRemember(); LP._snap=lpTextSnapshot(); toast('Applied. The lesson steps, differentiation and ICT answers were updated.'); lpEditor();
}
function plusRedraft(){ if(!lpHasLesson()){ toast('Choose a lesson first.'); return; } plusDraftExtras(); lpEditor(); toast('Success criteria, key terms, exit ticket and homework were drafted again.'); }

/* ---------- editor cards ---------- */
function plusOpt(v,l,sel){ return `<option value="${esc(v)}" ${sel===v?'selected':''}>${esc(l)}</option>`; }
function plusDesignHTML(){
  const ap=LP.approach||'reb';
  const models=Object.keys(PLUS_MODELS).map(k=>plusOpt(k,PLUS_MODELS[k].name,ap)).join('')+plusOpt('plain','Keep the scheme text as it is (no timed steps)',ap);
  const strat=Object.keys(PLUS_STRATEGIES).map(k=>`<label class="lp-chk"><input type="checkbox" ${LP.strategies&&LP.strategies[k]?'checked':''} onchange="plusTog('strategies','${k}')"> ${esc(PLUS_STRATEGIES[k].name)}</label>`).join('');
  const ict=Object.keys(PLUS_ICT).map(k=>`<label class="lp-chk"><input type="checkbox" ${LP.ictTools&&LP.ictTools[k]?'checked':''} onchange="plusTog('ictTools','${k}')"> ${esc(PLUS_ICT[k].name)}</label>`).join('');
  return `<div class="card" id="lpDesign" style="padding:22px;margin-bottom:16px">
    <div style="font-weight:700;margin-bottom:4px">Lesson design <span class="chip tiny" style="background:#e6f6fd;color:#053857">new</span></div>
    <div class="sub-note" style="margin-bottom:10px">Choose how you want to teach, then press <b>Auto-fill</b> (above) or <b>Apply</b> (below). Everything stays editable.</div>
    <div class="grid g-2" style="gap:12px">
      <div class="field"><label>Teaching approach</label><select class="txt" onchange="plusSet('approach',this.value)">${models}</select></div>
      <div class="field"><label>Language of the plan</label><select class="txt" onchange="plusSet('lang',this.value);lpEditor()">${plusOpt('','Automatic (follows the subject)',LP.lang||'')}${plusOpt('en','English',LP.lang||'')}${plusOpt('fr','Français',LP.lang||'')}${plusOpt('rw','Kinyarwanda',LP.lang||'')}</select></div>
    </div>
    <div style="font-weight:600;margin:12px 0 6px">Learning strategies to include (optional)</div><div class="lp-checks">${strat}</div>
    <div style="font-weight:600;margin:12px 0 4px">ICT tools you will use <span class="sub-note">(REB scores ICT use out of 40: name the tool and the resource)</span></div><div class="lp-checks">${ict}</div>
    <label class="lp-chk" style="margin-top:6px"><input type="checkbox" ${LP.ictNone?'checked':''} onchange="plusSet('ictNone',this.checked)"> No ICT tool in this lesson (the plan will say so)</label>
    <div class="field"><label>Web link or exact resource (for example the REB e-learning page or the video title)</label><input class="txt" value="${esc(LP.ictLink||'')}" placeholder="e.g. REB e-learning, P4 Mathematics Pupil's Book, Unit 1" oninput="plusSet('ictLink',this.value)"></div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" onclick="plusApplyAll()">${icon('check')} Apply to this plan</button><span class="sub-note" style="align-self:center">Rewrites the Development in timed steps, adds SEN support to Differentiation and fills the ICT answers.</span></div>
    ${LP.lang&&LP.lang!==lpLang(LP.subject)?'':''}
  </div>`;
}
function plusExtrasHTML(){
  const ex=LP.extras||{}; const f=(k,l)=>`<label class="lp-chk"><input type="checkbox" ${ex[k]!==false?'checked':''} onchange="LP.extras=LP.extras||{};LP.extras['${k}']=this.checked"> ${l}</label>`;
  return `<div class="card" id="lpExtras" style="padding:22px;margin-bottom:16px">
    <div style="font-weight:700;margin-bottom:4px">Extras for this lesson <span class="chip tiny" style="background:#e6f6fd;color:#053857">new</span></div>
    <div class="sub-note" style="margin-bottom:8px">Drafted from the scheme and the pupil book when you press Auto-fill. Edit freely; tick what to print.</div>
    ${lpArea('successCriteria','Success criteria ("I can ...")','',3)}
    ${lpField('keyTerms','Key terms','words learners should meet')}
    ${lpArea('priorNext','Prior knowledge / next lesson','',2)}
    ${lpArea('exitTicket','Exit ticket (3 quick questions with answers)','',4)}
    ${lpArea('homework','Homework / extension','',2)}
    <div style="font-weight:600;margin:10px 0 4px">Print these sections</div>
    <div class="lp-checks">${f('criteria','Success criteria')}${f('terms','Key terms')}${f('prior','Prior knowledge / next lesson')}${f('exit','Exit ticket')}${f('homework','Homework / extension')}${f('rubric','Rubric')}</div>
    <div style="margin-top:8px"><button class="btn line" onclick="plusRedraft()">Draft these again from the lesson</button></div>
  </div>`;
}
function plusCheckCardHTML(){ return `<div class="card" id="lpCheck" style="padding:22px;margin-bottom:16px"><div style="font-weight:700;margin-bottom:8px">REB plan check <span class="chip tiny" style="background:#e6f6fd;color:#053857">new</span></div><div id="lpCheckBody">${plusCheckHTML()}</div></div>`; }
function plusInject(){
  if(!LP) return; const view=document.getElementById('view'); const cards=view.querySelectorAll('.card'); if(!cards.length) return;
  cards[0].insertAdjacentHTML('afterend',plusDesignHTML());
  const save=view.querySelector('button[onclick="lpSaveDraft()"]'); if(!save) return; const row=save.parentElement;
  row.insertAdjacentHTML('beforebegin',plusExtrasHTML()+plusCheckCardHTML());
  row.insertAdjacentHTML('beforeend',`<button class="btn line" onclick="plusWorksheet()">${icon('exams')} Worksheet + answers</button><button class="btn line" onclick="plusCopyText()">Copy as text</button><button class="btn line" onclick="plusWord()">Word (.doc)</button><button class="btn line" onclick="plusAIPrompt()">${icon('star')} Improve with AI</button>`);
}
/* ---------- the printed plan: extra sections and rubric ---------- */
function plusSheetExtras(html,p){
  const ex=p.extras||{}; const on=k=>ex[k]!==false; const row=(l,v)=>v&&String(v).trim()?`<tr><td class="lp-k">${esc(l)}</td><td class="lp-v">${nl(v)}</td></tr>`:'';
  let rows='';
  const ap=PLUS_MODELS[p.approach]; if(ap&&p.approach&&p.approach!=='plain') rows+=row(tx(PLUS_UI.approach),ap.name);
  if(on('criteria')) rows+=row(tx(PLUS_UI.criteria),p.successCriteria);
  if(on('terms')) rows+=row(tx(PLUS_UI.terms),p.keyTerms);
  if(on('prior')) rows+=row(tx(PLUS_UI.prior),p.priorNext);
  if(on('exit')) rows+=row(tx(PLUS_UI.exit),p.exitTicket);
  if(on('homework')) rows+=row(tx(PLUS_UI.hw),p.homework);
  let out=rows?`<table class="lp-tbl"><tr><th colspan="2">${esc(tx({en:'Lesson extras',fr:'Compléments de la leçon',rw:'Ibindi byo mu isomo'}))}</th></tr>${rows}</table>`:'';
  if(on('rubric')&&p.successCriteria){
    const crit=String(p.successCriteria).split('\n').map(x=>x.replace(/^-\s*/,'').trim()).filter(Boolean).slice(0,3);
    if(crit.length) out+=`<table class="lp-tbl"><tr><th>${esc(tx(PLUS_UI.rubric))}</th>${PLUS_UI.levels.map(l=>`<th>${esc(tx(l))}</th>`).join('')}</tr>${crit.map(c=>`<tr><td>${esc(c)}</td>${PLUS_UI.desc.map(d=>`<td>${esc(tx(d))}</td>`).join('')}</tr>`).join('')}</table>`;
  }
  const i=html.lastIndexOf('<div class="sign-row"'); return i<0?html+out:html.slice(0,i)+out+html.slice(i);
}
