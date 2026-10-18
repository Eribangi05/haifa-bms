#!/usr/bin/env python3
"""Add the Lesson Studio features (teaching approaches, REB plan check, exit ticket, rubric, worksheet, week planner ...) to the
Smart School App's lesson-plan generator.  Run it on a renderer folder (desktop: src/renderer, Android: app/src/main/assets/renderer):
    python port_to_apps.py <renderer folder>
It patches lessonplan.js (idempotent), writes lessonplan-plus.js next to it and loads it from index.html / dev.html."""
import re,sys,os
R=sys.argv[1]; HERE=os.path.dirname(os.path.abspath(__file__))
p=os.path.join(R,'lessonplan.js'); src=open(p,encoding='utf-8').read()
def rep(a,b,n=1):
    global src
    c=src.count(a); assert c==n,(a[:60],c); src=src.replace(a,b)
if 'lpLangSubject' not in src:
    rep("function lpLang(subj){ const s=(subj!==undefined ? subj : (LP&&LP.subject)); return s==='french'?'fr':s==='kinyarwanda'?'rw':'en'; }",
        "function lpLangSubject(p){ return p&&p.lang==='fr'?'french':p&&p.lang==='rw'?'kinyarwanda':p&&p.lang==='en'?'english':(p&&p.subject); }\nfunction lpLang(subj){ const s=(subj!==undefined ? subj : (LP&&lpLangSubject(LP))); return s==='french'?'fr':s==='kinyarwanda'?'rw':'en'; }")
    rep("const fr=p.subject;","const fr=lpLangSubject(p);")
    rep("const title=lpCleanSchemeTitle(s.title)||","const title=lpTitleOnly(lpCleanSchemeTitle(s.title))||")
    rep("LP.objectives=s.objectives||LP.objectives;","LP.objectives=s.objectives||LP.objectives||lpDefaultObjective(title,lang);")
    rep("LP.contentSummary=s.content||LP.contentSummary;","LP.contentSummary=s.content||LP.contentSummary||title;")
    rep("function lpSchemeLesson(){","""/* the printed plan has its own Lesson No column, so the title drops the "Lesson 3:" prefix and the "(2 Periods)" suffix of the scheme row */
function lpTitleOnly(t){ return String(t||'').replace(/^\\s*(?:lesson|le[c\\u00e7]on|isomo)\\s*\\d+\\s*[:.\\-\\u2013]\\s*/i,'').replace(/\\s*\\(\\s*\\d+\\s*(?:periods?|p[\\u00e9e]riodes?)\\s*\\)\\s*$/i,'').trim(); }
function lpDefaultObjective(t,lang){ return lang==='fr'?'\\u00c0 la fin de la le\\u00e7on, les \\u00e9l\\u00e8ves seront capables d\\'expliquer et d\\'appliquer correctement \\u00ab '+t+' \\u00bb.':(lang==='rw'?'Ku iherezo ry\\'isomo, abanyeshuri bazashobora gusobanura no gukoresha neza \\u00ab '+t+' \\u00bb.':'By the end of the lesson, learners will be able to explain and apply "'+t+'" correctly.'); }
function lpSchemeLesson(){""")
    open(p,'w',encoding='utf-8').write(src)
style="""/* the app's colour variables, under the names the Lesson Studio code uses */
(function(){ const s=document.createElement('style'); s.textContent=':root{--soft:var(--surface-2,#eef3f9);--mute:var(--ink-3,#51607d);--tab-on:var(--reb-blue,#0b4da2);--card:var(--surface,#fff);--ok:#2f9e44}'; document.head.appendChild(s); })();
"""
plus=''.join(open(os.path.join(HERE,f),encoding='utf-8').read() for f in ['plus1.js','plus2.js','plus3.js','plus4.js','plus5.js','plus6.js','plus7.js','plus8.js','plus9.js','plus10.js'])
open(os.path.join(R,'lessonplan-plus.js'),'w',encoding='utf-8').write(style+plus)
SEC=os.path.join(HERE,'secondary','secondary-data.js'); PP=os.path.join(HERE,'preprimary','preprimary-data.js')
has_sec=os.path.exists(SEC) or os.path.exists(PP)
if has_sec: open(os.path.join(R,'lessonplan-secondary.js'),'w',encoding='utf-8').write(''.join(open(f,encoding='utf-8').read() for f in (SEC,PP) if os.path.exists(f)))
for f in ('index.html','dev.html','index-android.html'):
    fp=os.path.join(R,f)
    if os.path.exists(fp):
        h=open(fp,encoding='utf-8').read()
        tag='<script src="lessonplan.js"></script>'; assert h.count(tag)==1,(f,h.count(tag))
        want=tag+('\n<script src="lessonplan-secondary.js"></script>' if has_sec else '')+'\n<script src="lessonplan-plus.js"></script>'
        h=h.replace(tag+'\n<script src="lessonplan-secondary.js"></script>\n<script src="lessonplan-plus.js"></script>',tag).replace(tag+'\n<script src="lessonplan-plus.js"></script>',tag).replace(tag,want)
        open(fp,'w',encoding='utf-8').write(h)
print('ported',R)
