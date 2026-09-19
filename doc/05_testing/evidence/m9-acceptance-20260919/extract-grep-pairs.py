"""
从原始 stream-json 里截取：system/init + 全部 tool_use（Read/Grep/…，保留调用面）+ 仅 Grep 的 tool_result，
根前缀改写为 <ROOT>，其余逐字保留。输出 JSONL，可直接喂 parseClaudeEvents（测试加载时把 <ROOT> 换回具体根）。
用法：python3 extract-grep-pairs.py <RUN2|路径> <root> <out.jsonl>
"""
import json, os, sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
RUN2 = os.path.join(os.path.expanduser('~'), '.' + 'trivium', 'runs', 'm9-acceptance-14ec607d',
                    '20260919T120643Z', 'claude', 'out', 'stdout.jsonl')

src, root, dst = sys.argv[1], sys.argv[2], sys.argv[3]
if src == 'RUN2':
    src = RUN2
grep_ids = set()
out = []
n_uses = 0
for line in open(src):
    line = line.strip()
    if not line.startswith('{'):
        continue
    try:
        e = json.loads(line)
    except Exception:
        continue
    keep = False
    if e.get('type') == 'system' and e.get('subtype') == 'init':
        keep = True
    elif e.get('type') == 'assistant':
        blocks = [b for b in e.get('message', {}).get('content', []) if b.get('type') == 'tool_use']
        if blocks:
            for b in blocks:
                n_uses += 1
                if b.get('name') == 'Grep':
                    grep_ids.add(b['id'])
            e = {'type': 'assistant', 'message': {'content': blocks}, 'session_id': e.get('session_id')}
            keep = True
    elif e.get('type') == 'user':
        blocks = [b for b in e.get('message', {}).get('content', []) if b.get('type') == 'tool_result' and b.get('tool_use_id') in grep_ids]
        if blocks:
            e = {'type': 'user', 'message': {'content': blocks}, 'session_id': e.get('session_id')}
            keep = True
    if keep:
        out.append(json.dumps(e, ensure_ascii=False).replace(root, '<ROOT>'))
open(dst, 'w').write('\n'.join(out) + '\n')
print(f'{dst}: {len(out)} 行；tool_use {n_uses} 次，其中 Grep {len(grep_ids)} 次')
