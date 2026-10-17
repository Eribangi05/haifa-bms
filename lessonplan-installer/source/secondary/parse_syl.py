"""Parse REB 2026 secondary syllabi unit tables: per class and unit -> key unit competence,
learning objectives (knowledge / skills / attitudes), content, learning activities, links, assessment criteria, materials.
Usage: python parse_syl.py <folder with syllabus PDFs> <out.json>"""
import re, sys, json, glob, os
import pymupdf

UNITRE = re.compile(r'^\s*(?:\W{0,3}\s*)?(?:Unit|Unité|Unite|Umutwe\s*wa|Mada\s*Ndogo)\s*(\d+)\s*[:.\-–]?\s*(.*)$', re.I)
SW_SUB = re.compile(r'^\s*Mada\s*Ndogo\s*:\s*(.*)$', re.I)
CLSWORD = {'mbere':1,'kabiri':2,'gatatu':3,'kane':4,'gatanu':5,'gatandatu':6,'kwanza':1,'pili':2,'tatu':3,'nne':4,'tano':5,'sita':6,'première':1,'premiere':1,'deuxième':2,'deuxieme':2,'troisième':3,'troisieme':3,'quatrième':4,'quatrieme':4,'cinquième':5,'cinquieme':5,'sixième':6,'sixieme':6}
LESSONS = re.compile(r'(?:Idadi\s*ya\s*Vipindi|No\.?\s*of\s*lessons?|Number\s*of\s*(?:lessons?|periods?)|Nombre\s*de\s*(?:le[cç]ons|p[ée]riodes)|Amasaha|Idadi\s*ya\s*vipindi)\s*:?\s*(\d+)', re.I)
KUC = re.compile(r'^\s*(?:Key\s*Unit\s*Competence|Comp[ée]tence[\s\-]*cl[ée]|Ubushobozi\s*bw.ingenzi[^:]*|Umahiri\s*Mkuu[^:]*)\s*:?\s*(.*)$', re.I)
CLSRE = re.compile(r'^\s*(?:Senior|S)\s*([1-6])\s*$|^\s*S\.?([1-6])\s+[A-Z]', re.I)

def clean(s):
    return re.sub(r'\s+', ' ', (s or '').replace('•', ' ')).strip(' -•–')

def bullets(cell):
    if not cell: return []
    parts = re.split(r'•|\n\s*[-–]\s+', cell)
    out = []
    for p in parts:
        t = clean(p)
        if len(t) > 2: out.append(t)
    return out

def parse(path):
    d = pymupdf.open(path)
    base = os.path.basename(path)
    res = {'file': base, 'classes': {}}
    cur = {'cls': None, 'unit': None, 'field': None}
    fn = re.findall(r'S([1-6])(?:\s*-\s*S?([1-6]))?', base)
    for page in d:
        text = page.get_text()
        lines = [l for l in text.split('\n')]
        # class marker at top of the page ("Senior 1")
        for l in lines[:8]:
            m = re.match(r'^\s*Senior\s*([1-6])\s*$', l, re.I)
            if m: cur['cls'] = 'S' + m.group(1)
            m = re.match(r'^\s*Senior\s*(One|Two|Three|Four|Five|Six)\s*$', l, re.I)
            if m: cur['cls'] = 'S%d' % {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6}[m.group(1).lower()]
            m = re.match(r'^\s*S([1-6])\s*[:.]\s*[A-Z]', l)
            if m: cur['cls'] = 'S' + m.group(1)
            m = re.match(r'^\s*(?:Umwaka\s*wa|Kidato\s*cha|Ann[ée]e\s*:?)?\s*(mbere|kabiri|gatatu|kane|gatanu|gatandatu|kwanza|pili|tatu|nne|tano|sita)\s*$', l, re.I) if re.match(r'^\s*(UMWAKA|Kidato)', l, re.I) else None
            if m: cur['cls'] = 'S%d' % CLSWORD[m.group(1).lower()]
            m = re.match(r'^\s*(Premi[eè]re|Deuxi[eè]me|Troisi[eè]me|Quatri[eè]me|Cinqui[eè]me|Sixi[eè]me)\s*Ann[ée]e\s*$', l, re.I)
            if m: cur['cls'] = 'S%d' % CLSWORD[m.group(1).lower().replace('è','e')] if m.group(1).lower().replace('è','e') in CLSWORD else cur['cls']
            m = re.match(r'^\s*Kidato\s*cha\s*(\w+)\s*$', l, re.I)
            if m and m.group(1).lower() in CLSWORD: cur['cls'] = 'S%d' % CLSWORD[m.group(1).lower()]
        for i, l in enumerate(lines):
            m = re.match(r'^\s*(?:S\.?\s*([1-6]))\s+[A-Z][A-Za-z ,&]+$', l)
            if m and len(l) < 60: cur['cls'] = 'S' + m.group(1)
            m = SW_SUB.match(l)
            if m and cur['cls']:
                c = res['classes'].setdefault(cur['cls'], {'units': {}})
                title = clean(m.group(1)); j = i + 1
                while j < len(lines) and lines[j].strip() and not re.match(r'^\s*(Idadi|Umahiri|Kidato)', lines[j], re.I) and j < i + 3:
                    title = clean(title + ' ' + lines[j]); j += 1
                n = len(c['units']) + 1
                u = c['units'].setdefault(n, {'n': n, 'title': title, 'lessons': None, 'kuc': '', 'knowledge': [], 'skills': [], 'attitudes': [], 'content': [], 'activities': [], 'links': '', 'assessment': '', 'materials': '', '_seen': False})
                cur['unit'] = u; cur['field'] = None
                continue
            m = UNITRE.match(l)
            if m and len(l) < 200 and not re.match(r'^\s*Unit\s*\d+\s*[a-z]', l):
                n = int(m.group(1)); title = clean(m.group(2))
                if i + 2 < len(lines) and not title:
                    title = clean(lines[i + 1])
                c = res['classes'].setdefault(cur['cls'] or 'S?', {'units': {}})
                u = c['units'].setdefault(n, {'n': n, 'title': title, 'lessons': None, 'kuc': '', 'knowledge': [], 'skills': [], 'attitudes': [], 'content': [], 'activities': [], 'links': '', 'assessment': '', 'materials': '', '_seen': False})
                if title and not u['title']: u['title'] = title
                cur['unit'] = u; cur['field'] = None
                continue
            u = cur['unit']
            if u is None: continue
            m = LESSONS.search(l)
            if m and u['lessons'] is None: u['lessons'] = int(m.group(1)); continue
            m = KUC.match(l)
            if m and not u['kuc']:
                k = clean(m.group(1)); j = i + 1
                while j < len(lines) and lines[j].strip() and not re.match(r'^\s*(Learning Objectives|Knowledge|Content|Objectifs|Malengo)', lines[j], re.I) and j < i + 4:
                    k = clean(k + ' ' + lines[j]); j += 1
                u['kuc'] = k; continue
            m = re.match(r'^\s*Links?\s*to\s*other\s*subjects?\s*:?\s*(.*)$', l, re.I)
            if m: u['links'] = clean(m.group(1)); cur['field'] = 'links'; continue
            m = re.match(r'^\s*(?:Assessment\s*criteria|Vigezo\s*vya\s*Tathmini|Crit[èe]res\s*d.[ée]valuation|Ibisabwa\s*mu\s*isuzuma)\s*:?\s*(.*)$', l, re.I)
            if m: u['assessment'] = clean(m.group(1)); cur['field'] = 'assessment'; continue
            m = re.match(r'^\s*(?:Materials?|Vifaa\s*vya\s*Ufundishaji[^:]*|Mat[ée]riel[^:]*|Ibikoresho[^:]*)\s*:?\s*(.*)$', l, re.I)
            if m and len(l) > 10: u['materials'] = clean(m.group(1)); cur['field'] = 'materials'; continue
            if cur['field'] in ('links', 'assessment', 'materials') and l.strip() and not l.startswith('Experimental') and len(l) > 3 and not re.match(r'^\s*(\d+\s*$|Senior|.*Syllabus for)', l):
                u[cur['field']] = clean(u[cur['field']] + ' ' + l)
        # the 5-column tables (objectives K/S/A, content, activities)
        u = cur['unit']
        if u is not None:
            for t in page.find_tables().tables:
                rows = t.extract()
                if not rows: continue
                ncol = max(len(r) for r in rows)
                for r in rows:
                    cells = [c for c in r if c is not None]
                    if ncol >= 5 and len(cells) >= 5:
                        head = ' '.join(clean(c) for c in cells).lower()
                        if re.search(r'knowledge|savoirs|ubumenyi\b|maarifa', head) and re.search(r'skills|savoir-faire|ubumenyi ngiro|stadi', head) and len(head) < 400: continue
                        u['knowledge'] += bullets(cells[0]); u['skills'] += bullets(cells[1]); u['attitudes'] += bullets(cells[2])
                        for cc in cells[3:-1]: u['content'] += bullets(cc)
                        u['activities'] += bullets(cells[-1])
                    elif len(cells) >= 2 and ncol in (2, 3):
                        # continuation pages: content | activities
                        u['content'] += bullets(cells[-2]); u['activities'] += bullets(cells[-1])
    for c in res['classes'].values():
        c['units'] = sorted(c['units'].values(), key=lambda x: x['n'])
        for u in c['units']: u.pop('_seen', None)
    return res

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    allr = []
    for f in sorted(glob.glob(os.path.join(src, '*.pdf'))):
        try: allr.append(parse(f))
        except Exception as e: print('ERR', f, e)
    json.dump(allr, open(out, 'w'), ensure_ascii=False, indent=1)
    for r in allr:
        print(r['file'][:60], {k: (len(v['units']), sum(1 for u in v['units'] if u['knowledge'] or u['content'])) for k, v in r['classes'].items()})
