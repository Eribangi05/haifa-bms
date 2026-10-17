import json,glob,os,re,sys
HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=sys.argv[1] if len(sys.argv)>1 else os.path.normpath(os.path.join(HERE,'..','..','..','smart-school-app-android','app','src','main','assets','content'))
def pnum(p):
    m=re.search(r'(\d+)',str(p)); return int(m.group(1)) if m else 0
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
                    o['topic']=s.get('topic'); o['tk']=''.join(KIND.get(t.get('kind'),'x') for t in tasks); o['tp']=[(t.get('prompt') or '')[:140] for t in tasks[:2]]
                st.append(o); nl+=1
            units.append({'id':u.get('id'),'title':u.get('title'),'stories':st})
        books.append({'id':b['id'],'title':b.get('title'),'units':units})
    cat[cls]={'books':books}
sch={}
for f in sorted(glob.glob(ROOT+'/teacher-docs/schemes/P*-*.json')):
    k=os.path.basename(f)[:-5]; sch[k]=json.load(open(f,encoding='utf-8'))
json.dump({'catalog':cat,'schemes':sch},open(os.path.join(HERE,'data.json'),'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('stories',nl,'schemes',len(sch),'bytes',os.path.getsize('data.json'))
for c in sorted(cat): print(c,[b['id'] for b in cat[c]['books']])
print(sorted(sch))
