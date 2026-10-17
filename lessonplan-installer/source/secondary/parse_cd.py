"""Parse REB 2026-27 secondary content-distribution PDFs into units/lessons.
Usage: python parse_cd.py <folder with PDFs> <out.json>
Each file: layout varies, so we walk text blocks and tables in reading order and track class / term / unit as they appear."""
import re, sys, json, glob, os
import pymupdf

WORDS = {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'une':1,'deux':2,'trois':3,'quatre':4,'cinq':5,'six':6}
CLS = re.compile(r'(?:Grade|Class)\s*:?\s*(?:Senior\s*|S)([1-6])\b|\bS([1-6])\s*[:\-–]|SENIOR\s*([1-6])\b|Senior\s*([1-6])\b', re.I)
UNIT = re.compile(r'^\s*(?:UNIT|UNIT[EÉ]|Unité)\s*(\d+)\s*[:.\-–]?\s*(.*)$', re.I)
RWN = {'mbere':1,'kabiri':2,'gatatu':3,'kane':4,'gatanu':5,'gatandatu':6,'cya mbere':1,'cya kabiri':2,'cya gatatu':3,'cya kane':4,'cya gatanu':5,'cya gatandatu':6}
UMUTWE = re.compile(r'^\s*UMUTWE\s+WA\s+(MBERE|KABIRI|GATATU|KANE|GATANU|GATANDATU|\d+)\s*[:.]?\s*(.*)$', re.I)
FRCLS = {'première':1,'premiere':1,'deuxième':2,'deuxieme':2,'troisième':3,'troisieme':3,'quatrième':4,'quatrieme':4,'cinquième':5,'cinquieme':5,'sixième':6,'sixieme':6}
TERM = re.compile(r'^\s*(?:TERM\s*([123])|MUHULA\s*WA\s*([123])|Trimestre\s*:?\s*([123])|(?:Igihembwe\s*cya\s*)(mbere|kabiri|gatatu))\b', re.I)
PER = re.compile(r'\(?\s*(?:periods?\s*[:=]?\s*(?:\d+\s*/\s*)?(\d+)|(?:\d+\s*/\s*)?(\d+)\s*\)?\s*periods?)\s*\)?', re.I)
KUC = re.compile(r'key\s*unit\s*competence\s*:?\s*(.*)', re.I)
PWK = re.compile(r'(?:periods?\s*per\s*week|umubare\s*w.amasaha\s*mu\s*cyumweru|nombre\s*de\s*p.riodes\s*par\s*semaine|idadi\s*ya\s*vipindi\s*kwa\s*wiki)\s*:?\s*(\d+)', re.I)
KUC2 = re.compile(r'^\s*(?:key\s*unit\s*competence|ubushobozi\s*bw.ingenzi[^:]*|comp[ée]tence\s*cl[ée]|umahiri\s*mkuu[^:]*)\s*:?\s*(.*)$', re.I)
PER2 = re.compile(r'(?:amasaha|amasomo|nombre\s*des?\s*p.riodes|idadi\s*ya\s*vipindi)\s*:?\s*(\d+)', re.I)
MADA = re.compile(r'^\s*MADA\s*NDOGO\s*:\s*(.*)$', re.I)

def clean(s):
    s = re.sub(r'\s+', ' ', (s or '').replace('•', ' ')).strip(' -•–')
    return s

def items(page):
    """yield (y, kind, payload) for the page in reading order"""
    out = []
    tabs = page.find_tables().tables
    boxes = [t.bbox for t in tabs]
    for b in page.get_text('blocks'):
        x0, y0, x1, y1, txt = b[:5]
        if any(y0 >= tb[1] - 2 and y1 <= tb[3] + 2 and x0 >= tb[0] - 2 and x1 <= tb[2] + 2 for tb in boxes):
            continue
        out.append((y0, 'text', txt))
    for t in tabs:
        ex = t.extract()
        for i, row in enumerate(ex):
            y = t.rows[i].bbox[1] if i < len(t.rows) else t.bbox[1]
            out.append((y, 'table', [row]))
    out.sort(key=lambda r: r[0])
    return out

def class_of(line):
    m = re.search(r'umwaka\s+wa\s+(mbere|kabiri|gatatu|kane|gatanu|gatandatu)', line, re.I)
    if m: return 'S%d' % RWN[m.group(1).lower()]
    m = re.search(r'classe\s*:\s*([1-6])\s*(?:\u00e8me|e|\u00e8re|re)?\s*ann', line, re.I)
    if m: return 'S' + m.group(1)
    m = re.search(r'classe\s*:\s*(\w+)', line, re.I)
    if m and m.group(1).lower() in FRCLS: return 'S%d' % FRCLS[m.group(1).lower()]
    m = re.search(r'(?:kidato\s*cha|darasa)\s*:?\s*(?:kidato\s*cha\s*)?:?\s*([1-6])\b', line, re.I)
    if m: return 'S' + m.group(1)
    if not re.search(r'grade|class|senior|^\s*s[1-6]\b|premi|deuxi', line, re.I) or len(line) > 90: return None
    m = re.search(r'(?:Senior|Grade|Class|S)\s*:?\s*(?:Senior\s*|S)?([1-6])\b', line, re.I)
    if m: return 'S' + m.group(1)
    m = re.search(r'senior\s+(one|two|three|four|five|six)\b', line, re.I)
    if m: return 'S%d' % WORDS[m.group(1).lower()]
    return None

def perval(m):
    return int(m.group(1) or m.group(2)) if m else None

def parse(path):
    d = pymupdf.open(path)
    res = {'file': os.path.basename(path), 'classes': {}}
    cur = {'cls': None, 'term': None, 'unit': None, 'week': '', 'pwk': None, 'kuc': False}
    m0 = re.findall(r'S([1-6])\b', os.path.basename(path))
    if m0: cur['cls'] = 'S' + m0[0]
    def cls_obj():
        return res['classes'].setdefault(cur['cls'] or 'S?', {'periodsPerWeek': None, 'units': []})
    def heading(line):
        """True if the line was a heading (unit/term/class/key competence)."""
        m = PWK.search(line)
        if m:
            cur['pwk'] = int(m.group(1)); cls_obj()['periodsPerWeek'] = cur['pwk']
        c = class_of(line)
        if c and only and m0: c = 'S' + m0[0]
        if c and c != cur['cls']:
            cur['cls'] = c; cur['unit'] = None; cur['kuc'] = False
            cls_obj()['periodsPerWeek'] = cur['pwk']
            return True
        m = TERM.match(line)
        if m:
            g = [x for x in m.groups() if x]
            cur['term'] = int(g[0]) if g[0].isdigit() else RWN[g[0].lower()]; cur['kuc'] = False; return True
        m = UMUTWE.match(line)
        if m:
            n = m.group(1); n = int(n) if n.isdigit() else RWN[n.lower()]
            title = m.group(2); pm = PER2.search(title)
            title = clean(PER2.sub('', title)); c = cls_obj()
            u = next((x for x in c['units'] if x['n'] == n), None)
            if u is None:
                u = {'n': n, 'title': title, 'term': cur['term'], 'periods': int(pm.group(1)) if pm else None, 'kuc': '', 'lessons': []}; c['units'].append(u)
            cur['unit'] = u; cur['week'] = ''; cur['kuc'] = False
            return True
        m = MADA.match(line)
        if m:
            c = cls_obj(); title = clean(m.group(1))
            u = next((x for x in c['units'] if x['title'].lower() == title.lower()), None)
            if u is None:
                u = {'n': len(c['units']) + 1, 'title': title, 'term': cur['term'], 'periods': None, 'kuc': '', 'lessons': []}; c['units'].append(u)
            cur['unit'] = u; cur['week'] = ''; cur['kuc'] = False; cur['mada'] = True
            return True
        m = PER2.search(line)
        if m and cur['unit'] is not None and not cur['unit']['periods'] and len(line) < 40:
            cur['unit']['periods'] = int(m.group(1)); return True
        m = UNIT.match(line)
        if m:
            title = m.group(2); per = perval(PER.search(title))
            title = clean(PER.sub('', title)).strip(' ()')
            c = cls_obj(); n = int(m.group(1))
            u = next((x for x in c['units'] if x['n'] == n and (not title or x['title'][:15].lower() == title[:15].lower() or not x['title'] or re.search(r'cont', title, re.I))), None)
            if u is None:
                u = {'n': n, 'title': title, 'term': cur['term'], 'periods': per, 'kuc': '', 'lessons': []}
                c['units'].append(u)
            elif per and not u['periods']:
                u['periods'] = per
            cur['unit'] = u; cur['week'] = ''; cur['kuc'] = False
            return True
        m = KUC2.match(line)
        if m and cur['unit'] is not None:
            if not cur['unit']['kuc']: cur['unit']['kuc'] = clean(m.group(1))
            cur['kuc'] = True; return True
        if cur['kuc'] and cur['unit'] is not None and not cur['unit']['lessons'] and not re.match(r'^(week|weeks|content|lesson|periods?|number|main)\b', line, re.I) and not line.isdigit() and len(line) > 3:
            cur['unit']['kuc'] = clean(cur['unit']['kuc'] + ' ' + line); return True
        cur['kuc'] = False
        return False
    def lesson_row(vals):
        head = ' '.join(vals).lower()
        if re.match(r'^(week|weeks|lesson|content|contents|periods?|semaine)\b', head) and not re.fullmatch(r'\d{1,2}', vals[-1] or ''): return
        per = None
        for v in reversed(vals):
            if re.fullmatch(r'\d{1,2}', v): per = int(v); break
        texts = [v for v in vals if v and not re.fullmatch(r'\d{1,2}', v)]
        if not texts or per is None: return
        content = max(texts, key=len)
        if re.match(r'^\s*(total|jumla|somme|igiteranyo)\b', content, re.I) or re.match(r'^\s*(end of term|examination|exam |examen|ibizamini|mitihani|final exam)', content, re.I): return
        main = [t for t in texts if t != content]
        wk = vals[0] if re.fullmatch(r'\d{1,2}', vals[0] or '') else ''
        if wk: cur['week'] = wk
        if cur['unit'] is None:
            c = cls_obj()
            u = {'n': 0, 'title': '', 'term': cur['term'], 'periods': None, 'kuc': '', 'lessons': []}
            c['units'].append(u); cur['unit'] = u
        cur['unit']['lessons'].append({'week': int(cur['week']) if cur['week'] else None, 'title': content, 'points': main[0] if main else '', 'periods': per})
    only = len(set(m0)) == 1 and not re.search(r'S\s*\d\s*-\s*S\s*\d', os.path.basename(path))
    for page in d:
        for y, kind, pl in items(page):
            if kind == 'text':
                for line in [clean(l) for l in pl.split('\n')]:
                    if line: heading(line)
            else:
                HEAD = re.compile(r'^\s*(UNIT[EÉ]?\s*\d|TERM\s*[123]|Key\s*unit|(Grade|Class)\s*:|SENIOR\b|UMUTWE|Ubushobozi|Igihembwe|Umwaka|Comp[ée]tence|Classe\s*:|Trimestre|MADA\s*NDOGO|IDADI\s*YA|Umahiri|MUHULA|DARASA|KIDATO)', re.I)
                for row in pl:
                    vals = []; found = False
                    for cell in row:
                        if cell is None: continue
                        keep = []
                        for ln in str(cell).split('\n'):
                            if HEAD.match(ln) and not re.search(r'^\s*(Key\s*unit|Ubushobozi|Comp[ée]tence|Umahiri)', ln, re.I):
                                heading(clean(ln)); found = True
                            elif HEAD.match(ln):
                                heading(clean(ln)); found = True
                            else:
                                keep.append(ln)
                        vals.append(clean(' '.join(keep)))
                    if not any(vals): continue
                    if found and not re.fullmatch(r'\d{1,2}', vals[-1] or ''):
                        # heading row (possibly with trailing text that belongs to the competence statement)
                        if cur['kuc'] and cur['unit'] is not None and not cur['unit']['lessons']:
                            extra = clean(' '.join(v for v in vals if v and not v.isdigit()))
                            if extra and extra not in cur['unit']['kuc']: cur['unit']['kuc'] = clean(cur['unit']['kuc'] + ' ' + extra)
                        continue
                    if found: continue
                    cur['kuc'] = False
                    lesson_row(vals)
    return res

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    allr = [parse(f) for f in sorted(glob.glob(os.path.join(src, '*.pdf')))]
    json.dump(allr, open(out, 'w'), ensure_ascii=False, indent=1)
    for r in allr:
        print(r['file'][:70], {k: (len(v['units']), sum(len(u['lessons']) for u in v['units'])) for k, v in r['classes'].items()})
