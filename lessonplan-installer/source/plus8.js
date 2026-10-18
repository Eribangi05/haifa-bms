/* ===== Lesson Studio, part 8: quality fixes found in the review =====
   - lesson titles from Kinyarwanda and French schemes lose their "Isomo rya 1:" / "(Isaha 1)" / "Leçon 3 :" wrappers
   - lessons whose scheme row has no objective get one drafted from the activities, or from a subject-aware template, not a generic "explain and apply" */
lpTitleOnly=function(t){
  let s=String(t||'');
  s=s.replace(/^\s*(?:lesson|le[cç]on|isomo(?:\s+rya)?|icyumweru\s+cya)\s*\d+\s*[:.\-–]?\s*/i,'');
  s=s.replace(/\s*\(\s*(?:\d+\s*(?:periods?|p[ée]riodes?|amasaha|isaha)|(?:isaha|amasaha|period|p[ée]riode)s?\s*\d+)\s*\)\s*$/i,'');
  s=s.replace(/\s*(?:icyumweru\s+cya\s+\d+|week\s+\d+|semaine\s+\d+)\b.*$/i,'');
  s=s.replace(/[….]{3,}.*$/,'').replace(/^[\s●•*\-]+/,'');
  return s.replace(/\s{2,}/g,' ').trim();
};
(function(){
  const lc=s=>s?s.charAt(0).toLowerCase()+s.slice(1):s;
  const TASKV=/^[\W\d]*(identify|use|explain|define|state|describe|listen|read|write|count|solve|add|subtract|multiply|divide|apply|compare|name|recogni[sz]e|draw|sing|say|talk|tell|respond|ask|answer|practi[sc]e|understand|demonstrate|differentiate|classify|list|match|measure|calculate|construct|develop|appreciate|show|create|make|perform|play|round|order|complete|find|give|distinguish|interpret|observe|investigate|plan|prepare|discuss|share|express|recite|spell|pronounce|sort|group|arrange|represent|convert|estimate|build|design|follow|participate|sketch|paint|present|exchange|introduce|greet|retell|act)\b/i;
  const T={
    en:{english:'listen to, speak, read and write about "{t}" using the language taught in the lesson.',maths:'solve simple problems on "{t}" and explain how they found their answers.',set:'observe, describe and explain "{t}" using examples from their surroundings.',sst:'describe and explain "{t}" using examples from their community.',arts:'create and talk about their work on "{t}" using the materials and techniques taught.',pes:'perform the movements and skills of "{t}" safely and with control.',def:'explain and apply "{t}" correctly.'},
    fr:{french:'comprendre et utiliser « {t} » à l’oral et à l’écrit dans des situations simples.',def:'expliquer et appliquer correctement « {t} ».'},
    rw:{kinyarwanda:'gusoma, kuvuga no kwandika bakoresheje neza « {t} ».',def:'gusobanura no gukoresha neza « {t} ».'}
  };
  const lead={en:'By the end of the lesson, learners will be able to ',fr:'À la fin de la leçon, les élèves seront capables de ',rw:'Ku iherezo ry’isomo, abanyeshuri bazashobora '};
  lpDefaultObjective=function(t,lang){
    const L=(lang==='fr'||lang==='rw')?lang:'en'; const subj=(typeof LP!=='undefined'&&LP&&LP.subject)||'';
    let sl=null; try{ sl=lpUsingScheme()?lpSchemeLesson():null; }catch(e){}
    /* 1. the first activity that is a task ("Identify and use ...") is the objective in other words */
    if(L==='en'&&sl&&sl.activities){
      const first=String(sl.activities).split(/(?<=[.;])\s+|\n+|\s-\s/).map(x=>x.replace(/^[\s●•*\-]+/,'').trim()).find(x=>x.length>12&&x.length<170&&TASKV.test(x));
      if(first) return lead.en+lc(first.replace(/[.;\s]+$/,''))+'.';
    }
    const tab=T[L]; const body=(tab[subj]||tab.def).replace('{t}',t);
    return lead[L]+body;
  };
})();
