import json,glob,os,re,sys
HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=sys.argv[1] if len(sys.argv)>1 else os.path.normpath(os.path.join(HERE,'..','..','..','smart-school-app-android','app','src','main','assets','content'))
def pnum(p):
    m=re.search(r'(\d+)',str(p)); return int(m.group(1)) if m else 0

# the PDF text extraction split some long words at line ends ("Mathemati cs"): join the ones that occur many times
FIX=[('mathemati cs','mathematics'),('comprehensi on','comprehension'),('comprehens ion','comprehension'),('understandi ng','understanding'),('itonde ry','itondery'),('igihekane ry','igihekanery'),('multiplicati on','multiplication'),('competenc es','competences'),('summa ry','summary'),('manipulativ es','manipulatives')]
FIXRE=[(re.compile(re.escape(a),re.I),b) for a,b in FIX]
def fixtext(t):
    for rx,b in FIXRE:
        t=rx.sub(lambda m: (b[0].upper()+b[1:]) if m.group(0)[0].isupper() else b,t)
    return t
def fixall(o):
    if isinstance(o,str): return fixtext(o)
    if isinstance(o,list): return [fixall(x) for x in o]
    if isinstance(o,dict): return {k:fixall(v) for k,v in o.items()}
    return o
KIND={'number':'n','choice':'c','order':'o','match':'m','text':'t'}
cat={}; nl=0
for f in sorted(glob.glob(ROOT+'/classes/P*/books/catalog.json')):
    cls=f.split('/classes/')[1].split('/')[0]; d=json.load(open(f,encoding='utf-8')); books=[]
    for b in d['books']:
        if b.get('teacherOnly') and not b['id'].startswith('tg_'): continue
        units=[]
        for u in b.get('units',[]):
            st=[]
            for s in u.get('stories',[]):
                pg=[pnum(x) for x in (s.get('pages') or [])]; pg=[x for x in pg if x]
                tasks=s.get('tasks') or []
                o={'id':s.get('id'),'title':s.get('title'),'pg':[pg[0],pg[-1],len(s.get('pages') or [])] if pg else [0,0,len(s.get('pages') or [])]}
                if not b['id'].startswith('tg_'):
                    o['topic']=s.get('topic')
                    # compact tasks: [kind letter, prompt, answer, why, extra] (extra = options | items | pairs | rubric)
                    def cap(x,n): x='' if x is None else str(x); return x if len(x)<=n else x[:n-1]+'\u2026'
                    o['t']=[]
                    for t in tasks:
                        k=KIND.get(t.get('kind'), 'd' if t.get('kind')=='draw' else 'x')
                        ex=t.get('options') or t.get('items') or ([[cap(a,90),cap(b2,90)] for a,b2 in t['pairs']] if t.get('pairs') else None) or (cap(t.get('rubric'),200) if t.get('rubric') else None)
                        o['t'].append([k,cap(t.get('prompt'),260),cap(t.get('answer'),120),cap(t.get('why'),220),ex])
                st.append(o); nl+=1
            units.append({'id':u.get('id'),'title':u.get('title'),'stories':st})
        books.append({'id':b['id'],'title':b.get('title'),'units':units})
    cat[cls]={'books':books}
sch={}
for f in sorted(glob.glob(ROOT+'/teacher-docs/schemes/P*-*.json')):
    k=os.path.basename(f)[:-5]; sch[k]=json.load(open(f,encoding='utf-8'))
sch=fixall(sch)
json.dump({'catalog':cat,'schemes':sch},open(os.path.join(HERE,'data.json'),'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('stories',nl,'schemes',len(sch),'bytes',os.path.getsize('data.json'))
for c in sorted(cat): print(c,[b['id'] for b in cat[c]['books']])
print(sorted(sch))
