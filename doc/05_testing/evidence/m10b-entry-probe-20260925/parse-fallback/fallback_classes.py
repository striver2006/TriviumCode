# 只读：按失败形态归类统计 .reviews 归档里的 parse_fallback。
import json, glob, os, collections

ROOT = '/Users/chenzhenbo/Work/TriviumCode/.reviews'


def cls(r):
    if r is None:
        return '无 fail_reason'
    if '找不到 JSON 对象' in r:
        return 'E 找不到 JSON 对象'
    if 'JSON 语法错误' in r:
        if 'Bad escaped character' in r:
            return 'D1 语法：非法转义'
        if 'after JSON' in r:
            return 'D2 语法：JSON 后有多余内容'
        return 'D3 语法：其它（缺逗号/括号）'
    parts = []
    if "required property 'confidence'" in r:
        parts.append('A1 缺 confidence')
    elif 'required property' in r:
        parts.append('A2 缺其它必填')
    if 'allowed values' in r:
        parts.append('B 枚举越界')
    if 'additional properties' in r:
        parts.append('C1 根对象多余键' if '(根对象) must NOT have additional' in r else 'C2 条目多余键')
    return '+'.join(parts) or '其它'


tab = collections.defaultdict(collections.Counter)
models = collections.defaultdict(collections.Counter)
dates = collections.defaultdict(collections.Counter)
for f in sorted(glob.glob(os.path.join(ROOT, '*', '*', '_meta', 'run-*.json'))):
    r = json.load(open(f))
    rid = os.path.basename(f)[4:12]
    for cid, c in (r.get('critics') or {}).items():
        if c.get('status') != 'parse_fallback':
            continue
        tab[cid][cls(c.get('fail_reason'))] += 1
        models[cid][c.get('model_effective') or c.get('model_requested')] += 1
        dates[cid][rid] += 1

for cid in sorted(tab):
    print('==', cid, dict(models[cid]))
    for k, v in tab[cid].most_common():
        print('   ', v, k)
    print('    日期', dict(sorted(dates[cid].items())))
