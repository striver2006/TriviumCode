# EV-107 前置臂判据比对（r5 §4.7）：run.json 与两份审查件 front-matter 逐格对期望值。只读。
import json, os, re

FX = '<fixture>'
RUN = '20260925T031426Z'
PLAN = os.path.join(FX, '.reviews', 'EV-107-前置臂', 'plan')
run = json.load(open(os.path.join(PLAN, '_meta', f'run-{RUN}.json')))

EXPECT = {
    'gemini': {'model_effective': 'gpt-oss-120b-medium', 'heterogeneous': False, 'override_reason': '非空'},
    'glm': {'model_effective': 'GLM-*', 'heterogeneous': True, 'override_reason': '无或 null'},
}


def verdict(field, exp, got):
    if exp == '非空':
        return got not in (None, '')
    if exp == '无或 null':
        return got is None
    if exp == 'GLM-*':
        return isinstance(got, str) and re.search(r'(?i)glm-', got) is not None
    return got == exp


def front_matter(p):
    t = open(p, encoding='utf8').read()
    m = re.match(r'^---\n(.*?)\n---', t, re.S)
    fm = {}
    if m:
        for line in m.group(1).splitlines():
            if ':' in line and not line.startswith(' '):
                k, v = line.split(':', 1)
                fm[k.strip()] = v.strip()
    return fm


print('run.driver =', run.get('driver'), '| critics =', list((run.get('critics') or {}).keys()))
rows = []
for cid, exp in EXPECT.items():
    c = run['critics'][cid]
    fm = front_matter(os.path.join(PLAN, f'2026-09-25-EV-107-前置臂-{cid}.md'))
    for field, e in exp.items():
        got = c.get(field)
        rows.append((cid, field, e, got, verdict(field, e, got), fm.get(field)))
    print(cid, 'status', c.get('status'), 'vendor', c.get('vendor'), 'model_requested', c.get('model_requested'),
          'model_effective_source', c.get('model_effective_source'), 'model_override_applied', c.get('model_override_applied'))
print()
print('侧 | 字段 | 期望 | run.json | 判 | front-matter')
for r in rows:
    print(' | '.join(str(x) for x in r))
print()
print('全部成立：', all(r[4] for r in rows))
