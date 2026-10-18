#!/usr/bin/env python3
"""Build preprimary-data.js (PP_DATA) from pp1/2/3.json made by parse_pp.py (REB pre-primary schemes, Years 1-3)."""
import json,re,os
HERE=os.path.dirname(os.path.abspath(__file__))
NAMES={'env':("Ubumenyi bw’ibidukikije","Environment"),'maths':("Imibare","Numeracy"),'kinyarwanda':("Ikinyarwanda","Kinyarwanda"),
 'english':("English","English"),'arts':("Ubugeni n’umuco","Arts and culture"),'health':("Ibonezabuzima","Health and physical development")}
SPLIT=[('nsan ganya matsiko','nsanganyamatsiko'),('nsanganya matsiko','nsanganyamatsiko'),('nsan ganyamatsiko','nsanganyamatsiko'),('bi fatiye','bifatiye'),('nsanganya\u00a0matsiko','nsanganyamatsiko'),('Insanganya matsiko','Insanganyamatsiko')]
def fix(t):
    t=re.sub(r'\s+',' ',t or '').strip(); t=t.replace('­','')
    for a,c in SPLIT: t=t.replace(a,c)
    return t
SPLIT.extend([('insan ganyamatsiko','insanganyamatsiko'),('fit anye','fitanye')])
def fixsplit_all(texts):
    from collections import Counter
    W=Counter(); B=Counter()
    for t in texts:
        ws=re.findall(r"[A-Za-z\u2019']+",t.lower()); W.update(ws); B.update(zip(ws,ws[1:]))
    return W,B
def apply_split(t,W,B):
    ws=re.split(r'(\s+)',t); out=[]; i=0
    while i<len(ws):
        w=ws[i]
        if i+2<len(ws) and re.fullmatch(r"[A-Za-z\u2019']{1,4}",w) and re.fullmatch(r"[a-z\u2019']{3,}",ws[i+2]):
            j=(w+ws[i+2]).lower()
            if W[j]>=3 and W[j]>=3*B[(w.lower(),ws[i+2].lower())] and w.lower() not in ('ku','mu','ni','na','ba','bi','mw','cy','ky','by','ry','wa','ya','za','ka','tu','ze','we','be','ye','ba','ibi','aba','ubu','imi','ama','uru','ici','ubw','umu','izi'):
                out.append(w+ws[i+2]); i+=3; continue
        out.append(w); i+=1
    return ''.join(out)
def joined(xs,sep='; '): return sep.join(fix(x).rstrip('.;, ') for x in xs if fix(x))
out={'classes':{}}
for y in (1,2,3):
    rows=json.load(open(os.path.join(HERE,'pp%d.json'%y),encoding='utf-8'))
    cl={}
    for r in rows:
        if not (r['obj'] or r['act']): continue
        cl.setdefault(r['area'],[]).append(r)
    subs={}
    for area,rs in cl.items():
        units=[]; key=None
        for r in rs:
            k=(r['term'],r['theme'] or '')
            if k!=key:
                key=k; units.append({'no':str(len(units)+1),'title':fix(r['theme']) or ('Term %d'%r['term']),'periods':'','term':r['term'],'keyComp':'','lessons':[]})
            u=units[-1]
            title=fix(r['title']) or fix(joined(r['lessons'])[:80])
            wk=fix(r['week'])
            u['lessons'].append({'title':title,'periods':'','week':('Week %s'%wk) if wk else '',
              'objectives':joined(r['obj']),'content':joined(r['lessons']) or title,'activities':joined(r['act'],'. ')+'.' if r['act'] else '',
              'aids':fix(r['aids']).strip('- '),'assessment':'','references':'REB Pre-primary scheme of work, Year %d (%s), term %d, week %s'%(y,NAMES[area][1],r['term'],wk)})
        subs[area]={'name':NAMES[area][1],'local':NAMES[area][0],'units':units,'n':sum(len(u['lessons']) for u in units)}
    out['classes']['N%d'%y]=subs
def walk(o,f):
    if isinstance(o,str): return f(o)
    if isinstance(o,list): return [walk(x,f) for x in o]
    if isinstance(o,dict): return {k:walk(v,f) for k,v in o.items()}
    return o
texts=[]; walk(out,lambda s:texts.append(s) or s)
W,B=fixsplit_all(texts)
before=sum(len(s.split()) for s in texts)
out=walk(out,lambda s:apply_split(s,W,B))
js='const PP_DATA='+json.dumps(out,ensure_ascii=False,separators=(',',':'))+';\n'
open(os.path.join(HERE,'preprimary-data.js'),'w',encoding='utf-8').write(js)
print(len(js),{c:{a:s['n'] for a,s in v.items()} for c,v in out['classes'].items()})
