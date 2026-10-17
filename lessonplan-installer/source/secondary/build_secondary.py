"""Merge REB 2026-27 secondary content distribution (weekly lesson lists) with the syllabus unit tables
into scheme-of-work JSON in the same shape the lesson plan generator reads for primary
(units -> lessons with objectives/content/activities/aids/assessment/references).
Usage: python build_secondary.py <cd.json> <syllabus.json> <out_dir>
Writes <out_dir>/secondary-data.js (global SEC_DATA) and <out_dir>/report.json."""
import re, sys, json, os, collections

SUBJECTS = {  # id: (name, short, colour)
 'biology': ('Biology and Health Sciences', 'Biology', '#2F9E44'), 'chemistry': ('Chemistry', 'Chemistry', '#7048E8'),
 'physics': ('Physics', 'Physics', '#1098AD'), 'maths': ('Mathematics', 'Maths', '#3B5BDB'),
 'maths_core': ('Core Mathematics', 'Core Maths', '#3B5BDB'), 'maths_basic': ('Basic Mathematics', 'Basic Maths', '#4C6EF5'),
 'english': ('English', 'English', '#0CA678'), 'english_minor': ('English (non-language options)', 'English (minor)', '#12B886'),
 'literature': ('Literature in English', 'Literature', '#0CA678'), 'kinyarwanda': ('Ikinyarwanda', 'Kinyarwanda', '#E8590C'),
 'kinyarwanda_minor': ('Ikinyarwanda (amashami atari indimi)', 'Kinyarwanda (minor)', '#F76707'),
 'french': ('Français', 'Français', '#7048E8'), 'french_minor': ('Français (options non littéraires)', 'Français (non litt.)', '#845EF7'),
 'kiswahili': ('Kiswahili', 'Kiswahili', '#D6336C'), 'geography': ('Geography and Environment', 'Geography', '#2B8A3E'),
 'history': ('History and Citizenship', 'History', '#A61E4D'), 'ict': ('ICT', 'ICT', '#1971C2'),
 'entrepreneurship': ('Entrepreneurship', 'Entrepreneurship', '#E67700'), 'agriculture': ('Agriculture', 'Agriculture', '#5C940D'),
 'home_science': ('Home Science', 'Home Science', '#C2255C'), 'fine_arts': ('Fine Arts and Crafts', 'Fine Arts', '#E64980'),
 'music': ('Music, Dance and Drama', 'Music', '#AE3EC9'), 'pes': ('Physical Education and Sports', 'P.E.', '#F08C00'),
 'religion_ethics': ('Religion and Ethics', 'Religion', '#862E9C'), 'gs_religion': ('General Studies and Religious Studies', 'Gen. Studies', '#862E9C'),
 'economics': ('Economics', 'Economics', '#E8590C'), 'psychology_languages': ('Psychology (languages pathway)', 'Psychology (lang.)', '#364FC7'),
 'psychology_arts': ('Psychology (arts and humanities pathway)', 'Psychology (arts)', '#5F3DC4'),
}

def subject_of(name):
    n = name.replace('_', ' ').upper()
    if 'PSYCHOLOGY' in n: return 'psychology_languages' if 'LANGUAGE' in n else 'psychology_arts'
    if 'LITERATURE' in n: return 'literature'
    if 'KISWAHILI' in n or 'SWAHILI' in n or 'LOWER SECONDARY 2026' in n: return 'kiswahili'
    if 'FRAN' in n or 'FRENCH' in n:
        return 'french_minor' if ('NON LITT' in n or 'DEUXIEME' in n and 'OPTI' in n and 'LITTERAIRE' not in n.split('OPTI')[-1][:6] and 'NON' in n) else 'french'
    if 'KINYA' in n or 'INGENGABYIGWA' in n:
        return 'kinyarwanda_minor' if ('MINOR' in n or 'NON LANGUAGE' in n) else 'kinyarwanda'
    if 'ENGLISH' in n:
        return 'english_minor' if ('MINOR' in n or 'NON LANGUAGE' in n or 'NON_LANGUAGE' in n) else 'english'
    if 'CORE MATH' in n or 'MATH CORE' in n: return 'maths_core'
    if 'BASIC MATH' in n or 'MATH BASIC' in n: return 'maths_basic'
    if 'MATH' in n: return 'maths'
    if re.search(r'\bICT\b', n): return 'ict'
    if re.search(r'\bPES\b|PHYSICAL EDUC', n): return 'pes'
    for key, sid in (('BIOLOGY', 'biology'), ('CHEMISTRY', 'chemistry'), ('PHYSICS', 'physics'), ('GEOGRAPHY', 'geography'),
                     ('HISTORY', 'history'), ('ENTREPRENEU', 'entrepreneurship'), ('AGRICULTURE', 'agriculture'),
                     ('HOME SCIENCE', 'home_science'), ('FINE ARTS', 'fine_arts'), ('MUSIC', 'music'), ('RELIGION AND ETHICS', 'religion_ethics'), ('GENERAL AND RELIGIOUS', 'gs_religion'),
                     ('ECONOMICS', 'economics')):
        if key in n: return sid
    return None

STOP = set('the of and in to a for on with by from as an or is are at be this that into their its using use about'.split())
def toks(s): return {w for w in re.findall(r"[a-zà-ÿ’']{3,}", (s or '').lower()) if w not in STOP}
def overlap(a, b):
    A, B = toks(a), toks(b)
    return len(A & B) / (len(A) ** 0.5 * len(B) ** 0.5 + 1e-9) if A and B else 0

def best(items, text, k=1, offset=0):
    if not items: return []
    scored = sorted(((overlap(i, text), -idx, i) for idx, i in enumerate(items)), reverse=True)
    if scored[0][0] > 0.05: return [i for sc, _, i in scored[:k] if sc > 0.05] or [scored[0][2]]
    return [items[(offset + j) % len(items)] for j in range(min(k, len(items)))]

def clean_title(t):
    t = re.sub(r'^\s*(lesson\s*\d+\s*[:.\-]?\s*)', '', t or '', flags=re.I)
    t = re.sub(r'\s*[-–]\s*$', '', re.sub(r'\s+', ' ', t)).strip(' -•–;')
    return t

def split_title(t, content):
    """keep lesson titles short: long rows put the detail into the content field"""
    if len(t) <= 90: return t, content
    m = re.search(r'\s[-–]\s|:\s|;\s|\.\s(?=[A-Z])', t[20:])
    cut = 20 + m.start() if m else 90
    head = t[:cut].strip(' -:;,.')
    if len(head) > 100: head = head[:97].rsplit(' ', 1)[0] + '...'
    rest = t[cut:].strip(' -:;,.')
    return head, (content + '; ' + rest if rest and rest not in (content or '') else content)

def clean_aids(a):
    a = re.split(r'\s(?=Topic Area\b|Sub-?topic Area\b|Unit\s*\d+\s*[:.]|Senior\s*\d|Experimental version|Learning Objectives)', a or '')[0]
    return re.sub(r'\s+', ' ', a).strip(' .;')

def sentence(items):
    out = []
    for i in items:
        i = i.strip(' ;.')
        if i: out.append(i)
    return '; '.join(out)

def unit_match(cd_units, syl_units):
    """map index in cd_units -> syllabus unit"""
    res, used = {}, set()
    for i, cu in enumerate(cd_units):
        cand = [(overlap(cu['title'], su['title']) + (0.25 if su['n'] == cu['n'] else 0), j) for j, su in enumerate(syl_units) if j not in used]
        if not cand: continue
        sc, j = max(cand)
        same = syl_units[j]['n'] == cu['n'] and (abs(len(cd_units) - len(syl_units)) <= 1 or not cu['title'])
        if sc >= 0.3 or same: res[i] = syl_units[j]; used.add(j)
    return res

def build(cd_path, syl_path, out_dir):
    cd = json.load(open(cd_path)); syl = json.load(open(syl_path))
    CD = collections.defaultdict(list); SY = collections.defaultdict(list)
    for r in cd:
        sid = subject_of(r['file'])
        for c, v in r['classes'].items():
            if c != 'S?' and v['units'] and sid: CD[(c, sid)].append((r['file'], v))
    for r in syl:
        sid = subject_of(r['file'])
        for c, v in r['classes'].items():
            if v['units'] and sid: SY[(c, sid)].append((r['file'], v))
    keys = sorted(set(CD) | {k for k in SY if k[0] != 'S?'})
    # 'S?' syllabus data applies to the classes the same subject has elsewhere
    for (c, sid), lst in list(SY.items()):
        if c == 'S?':
            for (c2, sid2) in keys:
                if sid2 == sid: SY[(c2, sid2)] = SY.get((c2, sid2), []) + lst
    data = {'version': '2026-27', 'source': 'REB 2026 syllabi and content distribution (experimental versions)', 'classes': {}}
    report = {'noSyllabusBySubject': {}, 'subjects': 0, 'units': 0, 'lessons': 0, 'fromSyllabusOnly': [], 'unitsWithoutSyllabus': 0, 'periodMismatch': 0}
    for (c, sid) in keys:
        name, short, colour = SUBJECTS[sid]
        syl_units = []
        sl = SY.get((c, sid), [])
        if sl:
            f, v = max(sl, key=lambda fv: len(fv[1]['units'])); syl_units = list(v['units'])
        cdlist = CD.get((c, sid), [])
        cd_units = []
        if cdlist:
            f, v = max(cdlist, key=lambda fv: sum(len(u['lessons']) for u in fv[1]['units']))
            cd_units = [u for u in v['units'] if u['lessons']]
        level = 'Advanced Level' if c in ('S4', 'S5', 'S6') else 'Ordinary Level'
        ref = 'Rwanda Basic Education Board (REB). 2026. %s Syllabus for %s (experimental version) and content distribution 2026-2027.' % (name, level)
        units = []
        if cd_units:
            mp = unit_match(cd_units, syl_units)
            for i, cu in enumerate(cd_units):
                su = mp.get(i)
                if not su:
                    report['unitsWithoutSyllabus'] += 1; report['noSyllabusBySubject'][sid] = report['noSyllabusBySubject'].get(sid, 0) + 1
                K = (su or {}).get('knowledge', []); S = (su or {}).get('skills', []); A = (su or {}).get('attitudes', [])
                C = (su or {}).get('content', []); ACT = (su or {}).get('activities', [])
                lessons = []
                for li, l in enumerate(cu['lessons']):
                    text = l['title'] + ' ' + (l.get('points') or '')
                    obj = best(K, text, 2, li) + best(S, text, 1, li) + best(A, text, 1, li)
                    if not obj: obj = [clean_title(l['title'])]
                    points = l.get('points') or ''
                    cont = points if points and clean_title(points) != clean_title(l['title']) else sentence(best(C, text, 2, li)) or clean_title(l['title'])
                    ttl, cont = split_title(clean_title(l['title']) or ('Lesson %d' % (li + 1)), cont)
                    lessons.append({'title': ttl, 'periods': str(l['periods']) if l.get('periods') else '',
                                    'week': ('Week %d' % l['week']) if l.get('week') else '', 'objectives': sentence(obj), 'content': cont.replace('\n', ' ').strip(' ;'),
                                    'activities': sentence(best(ACT, text, 1, li))})
                tot = sum(int(x['periods'] or 0) for x in lessons)
                if cu.get('periods') and (tot < 0.7 * cu['periods'] or tot > 1.3 * cu['periods']): report['periodMismatch'] += 1
                units.append({'no': str(len(units) + 1), 'title': (re.sub(r'^\s*Unit\s*\d+\s*[:.\-]?\s*', '', cu['title'] or '', flags=re.I) or (su or {}).get('title', '') or ('Unit %d' % (len(units) + 1))).strip(' .'),
                              'periods': str(cu.get('periods') or (su or {}).get('lessons') or tot or ''), 'term': cu.get('term'), 'keyComp': cu.get('kuc') or (su or {}).get('kuc', ''), 'aids': clean_aids((su or {}).get('materials', '')), 'assessment': clean_aids((su or {}).get('assessment', '')), 'lessons': lessons})
        else:
            report['fromSyllabusOnly'].append('%s-%s' % (c, sid))
            for su in syl_units:
                C = su.get('content', []) or [su['title']]
                n = su.get('lessons') or len(C)
                per = max(1, round(n / max(1, len(C))))
                lessons = []
                for li, item in enumerate(C):
                    lessons.append({'title': clean_title(item)[:140], 'periods': str(per), 'week': '', 'objectives': sentence(best(su.get('knowledge', []), item, 2, li) + best(su.get('skills', []), item, 1, li) + best(su.get('attitudes', []), item, 1, li)) or clean_title(item),
                                    'content': item, 'activities': sentence(best(su.get('activities', []), item, 1, li))})
                units.append({'no': str(len(units) + 1), 'title': su['title'], 'periods': str(su.get('lessons') or ''), 'term': None, 'keyComp': su.get('kuc', ''), 'aids': su.get('materials', ''), 'assessment': su.get('assessment', ''), 'lessons': lessons})
        if not units: continue
        report['subjects'] += 1; report['units'] += len(units); report['lessons'] += sum(len(u['lessons']) for u in units)
        data['classes'].setdefault(c, {'subjects': {}})['subjects'][sid] = {'id': sid, 'name': name, 'short': short, 'color': colour,
            'scheme': {'class': c, 'subject': sid, 'subjectName': name, 'references': ref, 'units': units}}
    os.makedirs(out_dir, exist_ok=True)
    js = 'const SEC_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(os.path.join(out_dir, 'secondary-data.js'), 'w', encoding='utf8').write(js)
    json.dump(report, open(os.path.join(out_dir, 'report.json'), 'w'), indent=1)
    return data, report

if __name__ == '__main__':
    d, r = build(*sys.argv[1:4])
    print(json.dumps(r, indent=1))
    for c in sorted(d['classes']): print(c, len(d['classes'][c]['subjects']), 'subjects:', ', '.join(sorted(d['classes'][c]['subjects'])))
