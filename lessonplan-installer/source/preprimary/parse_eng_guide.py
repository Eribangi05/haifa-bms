#!/usr/bin/env python3
"""Parse 'English for pre-primary Rwandan schools, Teacher's guide, Grade 1-3' (REB 2019): themes, lessons, song/rhyme/poem texts,
objectives and materials.  usage: parse_eng_guide.py <text file made from the PDF pages with [[file pN]] markers> <out.json>"""
import re,sys,json
t=open(sys.argv[1],encoding='utf-8').read()
# page markers -> keep as position info
marks=[(m.start(),m.group(1),int(m.group(2))) for m in re.finditer(r'\[\[(\S+) p(\d+)\]\]',t)]
def page_at(pos):
    last=None
    for s,f,p in marks:
        if s<=pos: last=(f,p)
        else: break
    return last
# grade sections: standalone 'GRADE n' lines after the table of contents
grades=[(m.start(),int(m.group(1))) for m in re.finditer(r'\n\s*GRADE\s+([123])\s*\n',t)]
grades=[g for g in grades if g[0]>20000]
def grade_at(pos):
    g=1
    for s,n in grades:
        if s<=pos: g=n
    return g
clean=lambda s: re.sub(r'[ \t]+',' ',s).strip()
body=re.sub(r'\[\[[^\]]+\]\]\n(?:\d+\n)?','\n',t)   # drop page markers and their page number line
# rebuild position map on the cleaned text by working on t directly instead: iterate over t
res=[]; theme=None
tok=[(m.start(),'T',clean(m.group(1))) for m in re.finditer(r'\n\s*Theme:\s*([^\n]+)',t)]
tok+=[(m.start(),'L',(int(m.group(1)),clean(m.group(2)))) for m in re.finditer(r'\n\s*Lesson\s*(\d+)\s*:\s*([^\n]+)',t)]
tok.sort(key=lambda x:x[0])
def segtext(a,b):
    s=t[a:b]; s=re.sub(r'\[\[[^\]]+\]\]\n(?:\d+\n)?','\n',s)
    return s
cur=None
for i,(pos,k,v) in enumerate(tok):
    end=tok[i+1][0] if i+1<len(tok) else len(t)
    if k=='T':
        seg=segtext(pos,end)
        obj=re.search(r'Learning [Oo]bjective:\s*(.*?)(?:Teaching and learning materials|\n\s*\n|$)',seg,re.S)
        mat=re.search(r'Teaching and learning materials:\s*(.*?)(?:References|\n\s*\n|$)',seg,re.S)
        cur={'theme':v,'obj':clean(obj.group(1)) if obj else '','mat':clean(mat.group(1)) if mat else '','grade':grade_at(pos)}
    else:
        n,title=v
        seg=segtext(pos,end); lines=[clean(x) for x in seg.strip().split('\n')[1:]]
        # drop table scaffolding and guidance, keep verse lines
        verse=[]
        stop=re.compile(r'^(Steps and|Teacher|Learner|Introduction|Lesson development|Step \d|Conclusion|Evaluation|Teaching and Learning|The methodology|Extension|a\)|b\)|c\)|Learning [Oo]bjective|Teaching and learning|References)',re.I)
        for ln in lines:
            if not ln: continue
            if stop.match(ln):
                if re.match(r'^(Steps and|Teacher|Introduction)',ln,re.I) or ln.lower().startswith(('the methodology','extension')): break
                continue
            verse.append(ln)
        lobj=re.search(r'Learning [Oo]bjective:\s*(.*?)(?:Teaching and learning materials|\n)',seg,re.S)
        lmat=re.search(r'Teaching and learning materials:\s*(.*?)(?:References|\n\s*\n)',seg,re.S)
        pg=page_at(pos)
        res.append({'grade':grade_at(pos) or (cur['grade'] if cur else 0),'theme':cur['theme'] if cur else '','no':n,'title':title,'verse':verse[:14],
          'obj':clean(lobj.group(1)) if lobj else (cur['obj'] if cur else ''),'mat':clean(lmat.group(1)) if lmat else (cur['mat'] if cur else ''),'page':pg[1] if pg else 0,'file':pg[0] if pg else ''})
res=[r for r in res if len(r['verse'])>=2 or r['obj']]
json.dump(res,open(sys.argv[2],'w',encoding='utf-8'),ensure_ascii=False)
print(len(res),[ (g,sum(1 for r in res if r['grade']==g)) for g in (0,1,2,3)])
