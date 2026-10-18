#!/usr/bin/env python3
"""Parse the REB pre-primary schemes (Years 1-3) into rows: subject area, term, week, theme, title, lessons, objectives, activities, aids.
usage: parse_pp.py <year 1-3> <pdf> <out.json>"""
import sys,re,json,pymupdf
yr,pdf,out=sys.argv[1:4]
d=pymupdf.open(pdf)
def cl(s):
    if s is None: return ''
    s=s.replace('\xad','').replace('­','')
    s=re.sub(r'-\s*\n\s*','- ',s) if False else s
    return s
def lines(s):
    s=cl(s); items=[]; cur=[]
    for ln in s.split('\n'):
        ln=ln.strip()
        if not ln: continue
        if ln.startswith('-') or ln.startswith('•'):
            if cur: items.append(' '.join(cur))
            cur=[ln.lstrip('-•– ').strip()]
        else: cur.append(ln)
    if cur: items.append(' '.join(cur))
    return [re.sub(r'\s+',' ',x).strip(' -') for x in items if x.strip(' -')]
def flat(s): return re.sub(r'\s+',' ',cl(s)).strip()
AREAS=[('Ubumenyi','env'),('Imibare','maths'),('Ikinyarwanda','kinyarwanda'),('English','english'),('Ubugeni','arts'),('Ibonezabuzima','health')]
maxpage=int(sys.argv[4]) if len(sys.argv)>4 else 10**6
area='';term=0;rows=[];last=None;keep=None;cols=None
for pi,pg in enumerate(d):
    if pi>=maxpage: break
    if pi<9: continue
    txt=pg.get_text()
    for mm in re.finditer(r'^\s*\d(?:\.\d)*\.?\s*(Ubumenyi|Imibare|Ikinyarwanda|English|Ubugeni|Ibonezabuzima)',txt[:900],re.M):
        k=dict(AREAS)[mm.group(1)]
        if k=='env': term+=1
        area=k; keep=None; cols=None; last=None
    if not area: continue
    for t in pg.find_tables().tables:
        data=t.extract()
        if not data: continue
        h=[flat(c).lower() for c in data[0]]
        if any(x.startswith('intego') or x.startswith('objective') or x.startswith('learning obj') for x in h):
            keep=[i for i,x in enumerate(h) if x]; hh=[h[i] for i in keep]; cols={}
            for i,x in enumerate(hh):
                if x.startswith('icyumweru') or x.startswith('week'): cols['week']=i
                elif x.startswith('insanganya') or x.startswith('theme'): cols['theme']=i
                elif x in('umutwe','unit','units'): cols['title']=i
                elif x.startswith('isomo') or x.startswith('amasomo') or x.startswith('lesson'): cols['lessons']=i
                elif x.startswith('intego') or x.startswith('objective') or x.startswith('learning obj'): cols['obj']=i
                elif x.startswith('ibikorwa') or x.startswith('children') or x.startswith('learner'): cols['act']=i
                elif x.startswith('imfashanyigisho') or x.startswith('learning m') or x=='tlm': cols['aids']=i
            body=data[1:]
        elif cols and keep and len(data[0])>max(keep): body=data
        else: continue
        for r in body:
            r=[r[i] if i<len(r) else None for i in keep]
            g=lambda k: r[cols[k]] if k in cols and cols[k]<len(r) else None
            wk=flat(g('week'))
            filled=sum(1 for c in r if c and flat(c))
            if filled<=2 and not g('obj'): continue
            if wk and not re.match(r'^\d',wk): continue
            row=dict(year=int(yr),area=area,term=term,week=wk or (last['week'] if last else ''),
              theme=flat(g('theme')),title=flat(g('title')),lessons=lines(g('lessons')),
              obj=lines(g('obj')),act=lines(g('act')),aids=flat(g('aids')).lstrip('- '),page=pi+1)
            if not (row['obj'] or row['act']): continue
            if not row['theme'] and last and last['week']==row['week']: row['theme']=last['theme']
            if not wk and last and not row['title']: row['title']=last['title']
            rows.append(row); last=row
json.dump(rows,open(out,'w',encoding='utf-8'),ensure_ascii=False)
from collections import Counter
print(yr,len(rows),sorted(Counter((r['term'],r['area']) for r in rows).items()))
