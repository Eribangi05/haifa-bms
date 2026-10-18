/* ===== Lesson Studio, part 9: dates that follow the school year =====
   "Plans for the whole unit" used to put lessons on consecutive weekdays, past the end of the term and over the holidays.
   Now each lesson goes on the next day you really teach: your chosen weekdays, not a public holiday, not an extra day off you list,
   and inside a term (a unit that runs past the end of Term I continues on the first teaching day of Term II, with the right term label). */
const PLUS_HOLIDAYS={
  '2026-11-01':"All Saints' Day",'2026-12-25':'Christmas Day','2026-12-26':'Boxing Day','2027-01-01':"New Year's Day",'2027-01-02':'Day after New Year',
  '2027-02-01':'National Heroes Day','2027-03-10':'Eid al-Fitr (approximate: set by moon sighting)','2027-03-26':'Good Friday','2027-03-29':'Easter Monday',
  '2027-04-07':'Genocide Memorial Day','2027-05-01':'Labour Day','2027-05-17':'Eid al-Adha (approximate: set by moon sighting)','2027-07-01':'Independence Day','2027-07-04':'Liberation Day'
};
const PLUS_DAYNAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function plusCal(){
  const s=Accounts.root.settings; if(!s.lpCal||typeof s.lpCal!=='object') s.lpCal={};
  const c=s.lpCal; if(!Array.isArray(c.days)||!c.days.length) c.days=[1,2,3,4,5]; if(c.holidays===undefined) c.holidays=true; if(typeof c.off!=='string') c.off='';
  return c;
}
function plusOffList(){ return (plusCal().off||'').split(/[,;\s]+/).map(x=>x.trim()).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)); }
function plusIso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function plusTermOf(iso){ const T=LP_CALENDAR.terms; for(const n of Object.keys(T)) if(iso>=T[n].start&&iso<=T[n].end) return n; return ''; }
/* why a date is not a teaching day ('' = it is one) */
function plusOffReason(iso){
  const d=new Date(iso+'T12:00:00'); const wd=d.getDay(), c=plusCal();
  if(wd===0||wd===6) return 'a weekend';
  if(!c.days.includes(wd)) return 'not one of your teaching days';
  if(c.holidays&&PLUS_HOLIDAYS[iso]) return PLUS_HOLIDAYS[iso];
  if(plusOffList().includes(iso)) return 'a day off you listed';
  if(!plusTermOf(iso)) return 'school holiday (between terms)';
  return '';
}
function plusNextTeaching(iso){
  const d=new Date(iso+'T12:00:00'); const last=Object.values(LP_CALENDAR.terms).map(t=>t.end).sort().pop();
  for(let k=0;k<500;k++){ const s=plusIso(d); if(s>last) return null; if(!plusOffReason(s)) return s; d.setDate(d.getDate()+1); }
  return null;
}
function plusAfter(iso){ const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+1); return plusNextTeaching(plusIso(d)); }
(function(){
  const _next=lpNextSchoolDay, _add=lpAddSchoolDays;
  lpNextSchoolDay=function(iso){ return plusNextTeaching(iso)||_next(iso); };
  lpAddSchoolDays=function(iso,n){ let d=iso; for(let i=0;i<n;i++){ const nx=plusAfter(d); if(!nx) return _add(d,n-i); d=nx; } return d; };
  /* each lesson of a generated unit takes the term its date falls in */
  const _auto=lpAutofill; lpAutofill=function(){ if(typeof LP_BATCH!=='undefined'&&LP_BATCH&&LP&&LP.date){ const t=plusTermOf(LP.date); if(t) LP.term=t; } return _auto.apply(this,arguments); };
})();
function plusUnitLessonCount(){ try{ return lpUsingScheme()?((lpSchemeUnit()||{}).lessons||[]).length:lpLessons().length; }catch(e){ return 0; } }
const PLUS_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function plusNiceDate(iso){ const d=new Date(iso+'T12:00:00'); return PLUS_DAYNAMES[d.getDay()]+' '+d.getDate()+' '+PLUS_MON[d.getMonth()]+' '+d.getFullYear(); }
/* the sentence under the date card: this date, and where a whole unit would land */
function plusDateNote(){
  if(!LP) return ''; let out=[];
  const why=LP.date?plusOffReason(LP.date):''; 
  if(why) out.push('<span style="color:#b35900"><b>'+esc(plusNiceDate(LP.date))+' is '+esc(why)+'.</b> The next teaching day is '+esc(plusNiceDate(plusNextTeaching(LP.date)||LP.date))+'.</span>');
  else if(LP.date) out.push(esc(plusNiceDate(LP.date))+' is a teaching day'+(plusTermOf(LP.date)?' in '+esc(plusTermOf(LP.date)):'')+'.');
  const n=plusUnitLessonCount();
  if(n&&LP.date){ let d=plusNextTeaching(LP.date)||LP.date; const first=d; let k=1, spill=false; const t0=plusTermOf(d);
    while(k<n){ const nx=plusAfter(d); if(!nx){ spill=null; break; } d=nx; k++; if(plusTermOf(d)!==t0) spill=true; }
    if(spill===null) out.push('<span style="color:#b35900">This unit has '+n+' lessons and runs past the last day of the school year in the calendar.</span>');
    else out.push('This unit has <b>'+n+'</b> lessons: '+esc(plusNiceDate(first))+' to <b>'+esc(plusNiceDate(d))+'</b>'+(spill?' (<b>continues in '+esc(plusTermOf(d))+'</b> after the holiday).':'.'));
  }
  return out.join('<br>');
}
function plusDatesCardHTML(){
  const c=plusCal();
  const days=[1,2,3,4,5].map(w=>'<label class="lp-chk"><input type="checkbox" '+(c.days.includes(w)?'checked':'')+' onchange="plusCalDay('+w+',this.checked)"> '+PLUS_DAYNAMES[w]+'</label>').join('');
  return '<div class="card" id="lpDates" style="padding:18px 22px;margin-bottom:16px"><div style="font-weight:700;margin-bottom:4px">Dates and teaching days <span class="chip tiny" style="background:#e6f6fd;color:#0b4da2">new</span></div>'
   +'<div class="sub-note" style="margin-bottom:8px">Used by <b>Plans for the whole unit</b>: each lesson goes on your next teaching day. Public holidays and the gaps between terms are skipped, and a unit that passes the end of a term continues in the next one.</div>'
   +'<div class="lp-checks" style="margin-bottom:6px"><b style="margin-right:6px">I teach this class on:</b>'+days+'</div>'
   +'<div class="lp-checks"><label class="lp-chk"><input type="checkbox" '+(c.holidays?'checked':'')+' onchange="plusCalHol(this.checked)"> Skip Rwanda public holidays</label></div>'
   +'<div class="field" style="margin-top:8px"><label for="lpOff">Other days off (school events, mid-term break, exams), as dates separated by commas, for example 2027-02-15, 2027-03-01</label><input class="txt" id="lpOff" type="text" value="'+esc(c.off)+'" onchange="plusCalOff(this.value)" placeholder="2027-02-15, 2027-03-01"></div>'
   +'<div class="sub-note" id="lpDateNote" style="margin-top:8px">'+plusDateNote()+'</div></div>';
}
function plusCalRefresh(){ const n=document.getElementById('lpDateNote'); if(n) n.innerHTML=plusDateNote(); }
function plusCalDay(w,on){ const c=plusCal(); const s=new Set(c.days); if(on) s.add(w); else s.delete(w); if(!s.size){ toast('Choose at least one teaching day.'); lpEditor(); return; } c.days=[...s].sort(); Accounts.save(); plusCalRefresh(); }
function plusCalHol(on){ plusCal().holidays=!!on; Accounts.save(); plusCalRefresh(); }
function plusCalOff(v){ plusCal().off=String(v||''); Accounts.save(); plusCalRefresh(); }
(function(){
  const ed=lpEditor; lpEditor=function(){ ed.apply(this,arguments); try{ const di=document.querySelector('#view input[type=date]'); const card=di&&di.closest('.card'); if(card&&!document.getElementById('lpDates')) card.insertAdjacentHTML('afterend',plusDatesCardHTML()); }catch(e){ console.error(e); } };
  const ls=lpSet; lpSet=function(k,v){ ls.apply(this,arguments); if(k==='date'||k==='term') plusCalRefresh(); };
  const pu=lpPickUnit; lpPickUnit=function(){ const r=pu.apply(this,arguments); setTimeout(plusCalRefresh,0); return r; };
})();
