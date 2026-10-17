"""Link each secondary scheme unit/lesson to the pages of its REB 2026-27 student book (and teacher's guide).
Usage: python link_books.py <folder with SB/TG pdfs named like  'SB__S2 Geography SB ....pdf'> <secondary-data.js> <out secondary-data.js> <report.json>
Page numbers are PDF page numbers (1-based). Links are text-matched: a unit is linked only when its heading is found in the book."""
import re, sys, json, os, glob, collections
import pymupdf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_secondary import subject_of, overlap, toks

def classify(fn):
    kind = 'tg' if fn.startswith('TG__') or ' TG ' in fn.upper() else 'sb'
    base = fn.split('__', 1)[-1]
    m = re.match(r'\s*[Ss]\s?([1-6])\b', base)
    cls = 'S' + m.group(1) if m else None
    n = base.upper().replace('_', ' ')
    sid = subject_of(base)
    if sid == 'maths' and cls in ('S4', 'S5', 'S6'): sid = 'maths_core'
    if 'AMASHAMI ATARI INDIMI' in n: sid = 'kinyarwanda_minor'
    if 'ISHAMI' in n and 'INDIMI' in n: sid = 'kinyarwanda'
    if 'NON LITT' in n or 'NON LITTÉ' in n: sid = 'french_minor'
    return kind, cls, sid

def page_texts(path):
    d = pymupdf.open(path); return [p.get_text() for p in d], d.get_toc(), len(d)

HEAD = re.compile(r"(?is)(?:^|\n)\s*(?:UNIT[E\u00c9]?|UMUTWE(?:\s+WA)?|MADA(?:\s+YA)?|CHAPITRE|CHAPTER)\s*(\d+|MBERE|KABIRI|GATATU|KANE|GATANU|GATANDATU|MOJA|MBILI|TATU|NNE|TANO|SITA)\s*[:.\-\u2013]?\s*(.+?)\s*[.\x08\ufffd\u2026\u00b7~]{3,}\s*(\d{1,3})\s*(?=\n|$)")

NUMW = {'MBERE': 1, 'KABIRI': 2, 'GATATU': 3, 'KANE': 4, 'GATANU': 5, 'GATANDATU': 6, 'MOJA': 1, 'MBILI': 2, 'TATU': 3, 'NNE': 4, 'TANO': 5, 'SITA': 6}

def toc_entries(texts):
    """printed contents list of the book: [(no, title, printed page)]"""
    head = '\n'.join(texts[:16]).replace('\x08', '.')
    out = []
    for m in HEAD.finditer(head):
        t = re.sub(r'\s+', ' ', m.group(2)).strip(' .')
        g = m.group(1).upper(); no = int(g) if g.isdigit() else NUMW[g]
        if len(t) >= 3 and len(t) < 160: out.append((no, t, int(m.group(3))))
    # keep the first occurrence of each unit number, in order
    seen, res = set(), []
    for e in out:
        if e[0] not in seen: seen.add(e[0]); res.append(e)
    return res

def coverage(title, text):
    T = toks(title); H = toks(text)
    return len(T & H) / len(T) if T else 0

def toc_last_page(texts):
    """last of the leading pages that look like a contents list (many dotted leaders)"""
    last = 0
    for i, t in enumerate(texts[:18]):
        if len(re.findall(r'[.\x08\ufffd\u2026]{5,}', t)) >= 4: last = i + 1
    return last

def offset_for(texts, entries):
    """PDF page = printed page + offset; the body page of a unit repeats its title near the top"""
    n = len(texts); votes = collections.Counter()
    for no, title, pr in entries[:8]:
        for pg in range(max(6, toc_last_page(texts) + 1), n + 1):
            head = texts[pg - 1][:700]; T = toks(title); ctx = re.search(r'(?i)\b(unit|unit\u00e9|umutwe|mada|lesson|somo)\b', head[:500])
            if (coverage(title, head) >= 0.8 or (ctx and coverage(title, head) >= 0.6)) and (len(T) >= 2 or ctx):
                votes[pg - pr] += 1; break
    if not votes: return None
    off, c = votes.most_common(1)[0]
    return off if c >= 2 or len(entries) < 3 else None

def find_units(texts, toc, units):
    """-> list of start pages (1-based) or None per unit, monotonic"""
    n = len(texts); starts = [None] * len(units)
    ents = toc_entries(texts); off = offset_for(texts, ents) if ents else None
    find_units.off = None
    if ents and off is not None:
        pages = [(no, t, pr + off) for no, t, pr in ents if 1 <= pr + off <= n]
        used = set(); last = 0
        for i, u in enumerate(units):
            best = (0, None)
            for j, (no, t, pg) in enumerate(pages):
                if j in used: continue
                sc = overlap(u['title'], t) + (0.25 if no == int(u['no']) else 0)
                if sc > best[0]: best = (sc, j)
            if best[0] >= 0.4 or (best[1] is not None and pages[best[1]][0] == int(u['no']) and len(pages) == len(units)):
                j = best[1]; pg = pages[j][2]
                if pg >= last: starts[i] = pg; used.add(j); last = pg
        if sum(1 for x in starts if x) >= max(1, len(units) // 2):
            find_units.off = off; return starts
    # fallback: heading search in the body
    starts = [None] * len(units); last = 1
    for i, u in enumerate(units):
        no = int(u['no']); best = (0, None)
        for pg in range(max(last, toc_last_page(texts) + 1, 8), n + 1):
            head = texts[pg - 1][:500]
            if re.search(r'(?i)\b(unit|unit\u00e9|umutwe|mada)\s*%d\b' % no, head) or re.search(r'(?i)\bUNIT\s*\n\s*%d\s*\n' % no, texts[pg - 1][:200]):
                s = 0.3 + overlap(u['title'], head)
                if s > best[0]: best = (s, pg)
                if s >= 0.6: break
        if best[0] >= 0.45: starts[i] = best[1]; last = best[1]
    return starts


NOISE = re.compile(r"(?i)(experimental version|toleo la majaribio|igitabo kiri mu igerageza|student.s book|teacher.s guide|manuel de l.[e\u00e9]l[e\u00e8]ve|^\s*senior\s*\w+\s*$|^\s*[ivxlc]+\s*$|^\s*\d{1,3}\s*$)")
TERM = re.compile(r"(?im)^\s*(content summary|example\s*\d*\s*:?|activity\s*[\d.]+[a-z]?\s*:?|application activity\s*[\d.]+[a-z]?\s*:?|end of unit assessment|unit summary|skills lab|summary of the unit|key words?|learning objectives|\d+\.\d+(?:\.\d+)?\.?\s+[A-Z][^\n]{3,90}|exercise\s*[\d.]*\s*:?|unit\s+\d+\s*:?.*)$")
APP = re.compile(r"(?im)^\s*(application activity|exercises?|practice|activit[e\u00e9]s? d.application|exercices?( d.application)?|imyitozo|igikorwa cyo kwiyibutsa|ibibazo|zoezi|mazoezi|maswali|zoezi la matumizi)\s*([\d.]+[a-z]?)?\s*:?\s*$")
ACT = re.compile(r"(?im)^\s*(activity|activit[e\u00e9]|igikorwa|shughuli)\s*([\d.]+[a-z]?)\s*:?\s*$")
EUA = re.compile(r"(?im)^\s*(end of unit assessment|end[- ]of[- ]unit exercises?|unit assessment|isuzuma risoza umutwe|evaluation de l.unit[e\u00e9]|tathmini ya mada)[^\n]{0,40}$")

def clean_lines(t):
    return [l for l in t.split('\n') if l.strip() and not NOISE.search(l)]

def garbled(x):
    return sum(1 for ch in x if '\ue000' <= ch <= '\uf8ff') >= 3

def questions(body):
    body = '\n'.join(body)
    parts = [x for x in re.split(r'(?m)^\s*(?=\d{1,2}[.)]\s)', body) if x.strip()]
    qs = []
    for x in parts:
        x = re.sub(r'^\s*\d{1,2}[.)]\s*', '', x); x = re.sub(r'\s+', ' ', x).strip()
        if len(x) >= 12 and not garbled(x): qs.append(x[:240])
    if len(qs) < 2:
        one = re.sub(r'\s+', ' ', body).strip()
        qs = [one[:300]] if len(one) >= 20 and not garbled(one) else []
    return qs[:6]

def extract_exercises(texts, lo, hi):
    """application activities and the end-of-unit assessment inside pages lo..hi (1-based)"""
    lines = []
    for pg in range(lo, min(hi, len(texts)) + 1):
        for l in clean_lines(texts[pg - 1]): lines.append((pg, l))
    acts, eua, lacts = [], [], []; i = 0
    while i < len(lines):
        pg, l = lines[i]
        m = APP.match(l); e = EUA.match(l); a_ = ACT.match(l) if not (m or e) else None
        if m or e or a_:
            body = []; j = i + 1
            while j < len(lines) and len(body) < 40:
                if TERM.match(lines[j][1]) or APP.match(lines[j][1]) or EUA.match(lines[j][1]): break
                body.append(lines[j][1]); j += 1
            qs = questions(body)
            if qs:
                if e: eua = qs + ([] if len(qs) >= 6 else [])
                elif a_: lacts.append({'p': pg, 'q': qs})
                else: acts.append({'p': pg, 'q': qs})
            i = j
        else: i += 1
    if len(acts) < 2 and lacts: acts = sorted(acts + lacts, key=lambda a: a['p'])
    return acts, eua

def best_page(texts, lo, hi, query):
    qs = toks(query); bp, bs = lo, 0
    for pg in range(lo, hi + 1):
        pt = toks(texts[pg - 1][:3000]); 
        if not pt or not qs: continue
        s = len(qs & pt) / (len(qs) ** 0.5 * len(pt) ** 0.5)
        if s > bs: bs, bp = s, pg
    return bp, bs

def main(src, in_js, out_js, rep_path):
    data = json.loads(open(in_js, encoding='utf8').read().split('=', 1)[1].rsplit(';', 1)[0])
    files = collections.defaultdict(list)
    for p in sorted(glob.glob(os.path.join(src, '*.pdf'))):
        fn = os.path.basename(p); kind, cls, sid = classify(fn)
        if cls and sid: files[(kind, cls, sid)].append(p)
    rep = {'subjects': 0, 'withSB': 0, 'withTG': 0, 'unitsLinked': 0, 'unitsTotal': 0, 'noBook': [], 'weak': []}
    cache = {}
    for cls, cl in data['classes'].items():
        for sid, sub in cl['subjects'].items():
            rep['subjects'] += 1; sc = sub['scheme']; sub['books'] = {}
            for kind in ('sb', 'tg'):
                cands = files.get((kind, cls, sid)) or []
                if not cands: continue
                path = max(cands, key=os.path.getsize)
                if path not in cache:
                    try: cache[path] = page_texts(path)
                    except Exception as e: print('ERR', path, e); continue
                texts, toc, n = cache[path]
                starts = find_units(texts, toc, sc['units'])
                off = find_units.off
                found = sum(1 for s_ in starts if s_)
                if kind == 'sb': rep['unitsTotal'] += len(starts)
                if n < 8: continue
                ends = []
                for i, s_ in enumerate(starts):
                    nxt = next((x for x in starts[i + 1:] if x), None)
                    ends.append((nxt - 1 if nxt and nxt > s_ else n) if s_ else None)
                body0 = max(8, toc_last_page(texts) + 1)
                linked = 0
                for ui, u in enumerate(sc['units']):
                    approx = False
                    if starts[ui] and found >= max(1, (len(starts) + 1) // 2):
                        u[kind] = [starts[ui], max(starts[ui], ends[ui] or starts[ui])]
                    else:
                        # no reliable unit heading: find each lesson by its text and span the unit over the confident ones
                        pgs = []
                        for l in u['lessons']:
                            pg, sc_ = best_page(texts, body0, n, l['title'] + ' ' + (l.get('content') or ''))
                            if sc_ >= 0.22: l[kind + 'p'] = pg; pgs.append(pg)
                        if len(pgs) >= max(2, len(u['lessons']) // 2) and max(pgs) - min(pgs) <= 90:
                            u[kind] = [min(pgs), max(pgs)]; u[kind + 'x'] = 1; approx = True
                        else:
                            for l in u['lessons']: l.pop(kind + 'p', None)
                            continue
                    linked += 1
                    lo, hi = u[kind]
                    if kind == 'sb':
                        acts, eua = extract_exercises(texts, lo, hi)
                        if acts: u['acts'] = acts
                        if eua: u['eua'] = eua
                    if not approx:
                        for l in u['lessons']:
                            pg, sc_ = best_page(texts, lo, min(hi, lo + 60), l['title'] + ' ' + (l.get('content') or ''))
                            if sc_ >= 0.1: l[kind + 'p'] = pg
                    if kind == 'sb' and u.get('acts'):
                        for l in u['lessons']:
                            pg = l.get('sbp')
                            if pg:
                                ix = next((k for k, a_ in enumerate(u['acts']) if pg - 1 <= a_['p'] <= pg + 6), None)
                                if ix is not None: l['ea'] = ix
                if linked == 0: rep['weak'].append('%s-%s-%s 0/%d' % (cls, sid, kind, len(starts))); continue
                if kind == 'sb': rep['unitsLinked'] += linked; rep['withSB'] += 1
                else: rep['withTG'] += 1
                sub['books'][kind] = {'file': os.path.basename(path).split('__', 1)[-1], 'pages': n, 'off': off}
    open(out_js, 'w', encoding='utf8').write('const SEC_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    json.dump(rep, open(rep_path, 'w'), indent=1)
    print(json.dumps(rep, indent=1)[:2500])

if __name__ == '__main__':
    main(*sys.argv[1:5])
