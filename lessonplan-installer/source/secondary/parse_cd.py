"""Parse REB 2026-27 secondary content-distribution PDFs into units/lessons.
Usage: python parse_cd.py <folder with PDFs> <out.json>
Each file: layout varies, so we walk text blocks and tables in reading order and track class / term / unit as they appear."""
import re, sys, json, glob, os
import pymupdf

CLS = re.compile(r'(?:Grade|Class)\s*:?\s*(?:Senior\s*|S)([1-6])\b|\bS([1-6])\s*[:\-–]|SENIOR\s*([1-6])\b|Senior\s*([1-6])\b', re.I)
UNIT = re.compile(r'^\s*UNIT\s*(\d+)\s*[:.\-–]?\s*(.*)$', re.I)
TERM = re.compile(r'^\s*TERM\s*([123])\b', re.I)
PER = re.compile(r'\(?\s*periods?\s*[:=]?\s*(\d+)\s*\)?', re.I)
KUC = re.compile(r'key\s*unit\s*competence\s*:?\s*(.*)', re.I)
PWK = re.compile(r'periods?\s*per\s*week\s*:?\s*(\d+)', re.I)

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
        out.append((t.bbox[1], 'table', t.extract()))
    out.sort(key=lambda r: r[0])
    return out

def parse(path):
    d = pymupdf.open(path)
    res = {'file': os.path.basename(path), 'classes': {}}
    cur = {'cls': None, 'term': None, 'unit': None, 'week': '', 'pwk': None}
    fname_cls = [int(c) for c in re.findall(r'S([1-6])\b', os.path.basename(path))]
    if fname_cls: cur['cls'] = 'S%d' % fname_cls[0]
    def unit_obj():
        c = res['classes'].setdefault(cur['cls'] or 'S?', {'periodsPerWeek': cur['pwk'], 'units': []})
        if c['periodsPerWeek'] is None: c['periodsPerWeek'] = cur['pwk']
        return c
    for page in d:
        for y, kind, pl in items(page):
            if kind == 'text':
                for line in [clean(l) for l in pl.split('\n')]:
                    if not line: continue
                    m = PWK.search(line)
                    if m: cur['pwk'] = int(m.group(1))
                    m = CLS.search(line)
                    if m and re.search(r'grade|class|senior', line, re.I) and len(line) < 80:
                        n = next(g for g in m.groups() if g)
                        new = 'S' + n
                        if new != cur['cls']:
                            cur['cls'] = new; cur['unit'] = None
                    m = TERM.match(line)
                    if m: cur['term'] = int(m.group(1))
                    m = UNIT.match(line)
                    if m:
                        title = m.group(2); per = PER.search(title)
                        title = clean(PER.sub('', title)).strip(' ()')
                        c = unit_obj()
                        u = {'n': int(m.group(1)), 'title': title, 'term': cur['term'], 'periods': int(per.group(1)) if per else None, 'kuc': '', 'lessons': []}
                        c['units'].append(u); cur['unit'] = u; cur['week'] = ''
                        continue
                    m = KUC.match(line)
                    if m and cur['unit'] is not None and not cur['unit']['lessons']:
                        cur['unit']['kuc'] = clean(m.group(1)); cur['kucOpen'] = True; continue
                    if cur.get('kucOpen') and cur['unit'] is not None and not cur['unit']['lessons'] and not re.match(r'^(week|content|lesson|periods?|number|main)\b', line, re.I) and not line.isdigit():
                        cur['unit']['kuc'] = clean(cur['unit']['kuc'] + ' ' + line)
                    else:
                        cur['kucOpen'] = False
                    if cur['unit'] is not None and not cur['unit']['periods']:
                        pm = PER.search(line)
                        if pm and len(line) < 60: cur['unit']['periods'] = int(pm.group(1))
            else:
                cur['kucOpen'] = False
                for row in pl:
                    cells = [c for c in row if c is not None]
                    vals = [clean(c) for c in cells]
                    if not any(vals): continue
                    head = ' '.join(vals).lower()
                    if re.match(r'^(week|weeks|lesson|content|periods?)\b', head) and not any(v.isdigit() for v in vals[-1:]):
                        continue
                    m = None
                    for v in vals:
                        mm = UNIT.match(v)
                        if mm: m = mm
                    if m and not any(v.isdigit() for v in vals[-1:]):
                        continue
                    # week = first short numeric cell, periods = last numeric cell, content = longest text
                    per = None
                    for v in reversed(vals):
                        if re.fullmatch(r'\d{1,2}', v): per = int(v); break
                    texts = [v for v in vals if v and not re.fullmatch(r'\d{1,2}', v)]
                    if not texts or per is None: continue
                    content = max(texts, key=len)
                    main = [t for t in texts if t != content]
                    wk = vals[0] if re.fullmatch(r'\d{1,2}', vals[0] or '') else ''
                    if wk: cur['week'] = wk
                    if cur['unit'] is None:
                        c = unit_obj()
                        u = {'n': 0, 'title': '', 'term': cur['term'], 'periods': None, 'kuc': '', 'lessons': []}
                        c['units'].append(u); cur['unit'] = u
                    cur['unit']['lessons'].append({'week': int(cur['week']) if cur['week'] else None, 'title': content, 'points': main[0] if main else '', 'periods': per})
    return res

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    allr = [parse(f) for f in sorted(glob.glob(os.path.join(src, '*.pdf')))]
    json.dump(allr, open(out, 'w'), ensure_ascii=False, indent=1)
    for r in allr:
        print(r['file'][:70], {k: (len(v['units']), sum(len(u['lessons']) for u in v['units'])) for k, v in r['classes'].items()})
