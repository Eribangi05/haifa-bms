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

HEAD = re.compile(r"(?is)(?:^|\n)\s*(?:UNIT[E\u00c9]?|UMUTWE(?:\s+WA)?|MADA(?:\s+YA)?|CHAPITRE|CHAPTER)\s*(\d+)\s*[:.\-\u2013]?\s*(.+?)\s*[.\x08\ufffd\u2026\u00b7]{3,}\s*(\d{1,3})\s*(?=\n|$)")

def toc_entries(texts):
    """printed contents list of the book: [(no, title, printed page)]"""
    head = '\n'.join(texts[:16]).replace('\x08', '.')
    out = []
    for m in HEAD.finditer(head):
        t = re.sub(r'\s+', ' ', m.group(2)).strip(' .')
        if len(t) >= 3 and len(t) < 160: out.append((int(m.group(1)), t, int(m.group(3))))
    # keep the first occurrence of each unit number, in order
    seen, res = set(), []
    for e in out:
        if e[0] not in seen: seen.add(e[0]); res.append(e)
    return res

def coverage(title, text):
    T = toks(title); H = toks(text)
    return len(T & H) / len(T) if T else 0

def offset_for(texts, entries):
    """PDF page = printed page + offset; the body page of a unit repeats its title near the top"""
    n = len(texts); votes = collections.Counter()
    for no, title, pr in entries[:8]:
        for pg in range(6, n + 1):
            if coverage(title, texts[pg - 1][:700]) >= 0.8 and len(toks(title)) >= 2:
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
        for pg in range(max(last, 8), n + 1):
            head = texts[pg - 1][:500]
            if re.search(r'(?i)\b(unit|unit\u00e9|umutwe|mada)\s*%d\b' % no, head) or re.search(r'(?i)\bUNIT\s*\n\s*%d\s*\n' % no, texts[pg - 1][:200]):
                s = 0.3 + overlap(u['title'], head)
                if s > best[0]: best = (s, pg)
                if s >= 0.6: break
        if best[0] >= 0.45: starts[i] = best[1]; last = best[1]
    return starts

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
                found = sum(1 for s in starts if s)
                if kind == 'sb': rep['unitsTotal'] += len(starts); rep['unitsLinked'] += found
                if found < max(1, (len(starts) + 1) // 2):
                    rep['weak'].append('%s-%s-%s %d/%d' % (cls, sid, kind, found, len(starts)))
                    if kind == 'sb': rep['unitsTotal'] -= 0
                    continue
                if n < 8: continue
                if kind == 'sb': rep['withSB'] += 1
                else: rep['withTG'] += 1
                ends = []
                for i, s in enumerate(starts):
                    nxt = next((x for x in starts[i + 1:] if x), None)
                    ends.append((nxt - 1 if nxt and nxt > s else (n if s else None)) if s else None)
                sub['books'][kind] = {'file': os.path.basename(path).split('__', 1)[-1], 'pages': n, 'off': find_units.off}
                for ui, u in enumerate(sc['units']):
                    if not starts[ui]: continue
                    u.setdefault(kind, [starts[ui], max(starts[ui], ends[ui] or starts[ui])])
                    lo, hi = u[kind]
                    for l in u['lessons']:
                        pg, sc_ = best_page(texts, lo, min(hi, lo + 60), l['title'] + ' ' + (l.get('content') or ''))
                        if sc_ >= 0.1: l[kind + 'p'] = pg
    open(out_js, 'w', encoding='utf8').write('const SEC_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    json.dump(rep, open(rep_path, 'w'), indent=1)
    print(json.dumps(rep, indent=1)[:2500])

if __name__ == '__main__':
    main(*sys.argv[1:5])
