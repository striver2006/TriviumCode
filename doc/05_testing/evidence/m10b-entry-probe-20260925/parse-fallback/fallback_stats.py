# 只读：统计 .reviews 归档里每次运行各审查侧的 status，重点看 parse_fallback。
import json, glob, os, collections, re

ROOT = '/Users/chenzhenbo/Work/TriviumCode/.reviews'
runs = glob.glob(os.path.join(ROOT, '*', '*', '_meta', 'run-*.json'))
by_agent = collections.defaultdict(collections.Counter)
fallbacks = []
keys_seen = collections.Counter()
for f in sorted(runs):
    try:
        r = json.load(open(f))
    except Exception:
        continue
    for cid, c in (r.get('critics') or {}).items():
        st = c.get('status')
        by_agent[cid][st] += 1
        keys_seen.update(c.keys())
        if st == 'parse_fallback':
            fallbacks.append({
                'run': os.path.relpath(f, ROOT),
                'critic': cid,
                'model': c.get('model_effective') or c.get('model_requested'),
                'reason': {k: c.get(k) for k in c if re.search(r'(?i)parse|reason|error|fallback', k)},
            })

print('runs', len(runs))
for a, cnt in sorted(by_agent.items()):
    total = sum(cnt.values())
    print(a, dict(cnt), 'fallback rate', f"{cnt.get('parse_fallback', 0)}/{total}")
print('critic keys', sorted(keys_seen))
print('--- fallbacks')
for x in fallbacks:
    print(json.dumps(x, ensure_ascii=False)[:400])
