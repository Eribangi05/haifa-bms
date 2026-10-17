"""Parse REB 2026 secondary syllabi unit tables: per class and unit -> key unit competence,
learning objectives (knowledge / skills / attitudes), content, learning activities, links, assessment criteria, materials.
Usage: python parse_syl.py <folder with syllabus PDFs> <out.json>"""
import re, sys, json, glob, os
import pymupdf

UNITRE = re.compile(r'^\s*(?:Unit|Unité|Umutwe|Mada)\s*(\d+)\s*[:.\-–]?\s*(.*)$', re.I)
LESSONS = re.compile(r'(?:No\.?\s*of\s*lessons?|Number\s*of\s*(?:lessons?|periods?)|Nombre\s*de\s*(?:le[cç]ons|p[ée]riodes)|Amasaha|Idadi\s*ya\s*vipindi)\s*:?\s*(\d+)', re.I)
KUC = re.compile(r'^\s*(?:Key\s*Unit\s*Competence|Comp[ée]tence\s*cl[ée]|Ubushobozi\s*bw.ingenzi|Umahiri\s*mkuu)\s*:?\s*(.*)$', re.I)
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
        for l in lines[:6]:
            m = re.match(r'^\s*Senior\s*([1-6])\s*$', l, re.I)
            if m: cur['cls'] = 'S' + m.group(1)
        for i, l in enumerate(lines):
            m = re.match(r'^\s*(?:S\.?\s*([1-6]))\s+[A-Z][A-Za-z ,&]+$', l)
            if m and len(l) < 60: cur['cls'] = 'S' + m.group(1)
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
            m = re.match(r'^\s*Assessment\s*criteria\s*:?\s*(.*)$', l, re.I)
            if m: u['assessment'] = clean(m.group(1)); cur['field'] = 'assessment'; continue
            m = re.match(r'^\s*Materials?\s*:?\s*(.*)$', l, re.I)
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
                        if 'knowledge' in head and 'skills' in head: continue
                        u['knowledge'] += bullets(cells[0]); u['skills'] += bullets(cells[1]); u['attitudes'] += bullets(cells[2])
                        u['content'] += bullets(cells[3]); u['activities'] += bullets(cells[4])
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
