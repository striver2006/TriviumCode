# M9 第 6 步第 2 轮验收：按 trace.json 逐项溯源 consulted 的匹配来源（Read / 文件级 Grep / Grep content 命中）。
# 用法：python3 consulted-trace-r2.py [夹具根] [trace.json] [review-claude-<run>.json]
# 不传参时用验收当时的会话级路径；入库后可把三份证据文件当参数传入复算。
import json, os, sys

root = sys.argv[1] if len(sys.argv) > 1 else '/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/8498a631-5c50-4055-b53d-336e61a51887/scratchpad/m9-acceptance'
trace_path = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.trivium/runs/m9-acceptance-14ec607d/20260919T162144Z/claude/out/trace.json')
review_path = sys.argv[3] if len(sys.argv) > 3 else root + '/.reviews/M9-验收-3812f4c/code/_meta/review-claude-20260919T162144Z.json'
t = json.load(open(trace_path))
rv = json.load(open(review_path))
rel = lambda p: os.path.relpath(p, root)

reads, fgrep, dgrep = set(), set(), []
for u in t['toolUses']:
    i = u.get('input', {})
    if u['name'] == 'Read':
        reads.add(rel(i['file_path']))
    if u['name'] == 'Grep':
        p = i.get('path', '')
        if os.path.isfile(p):
            fgrep.add(rel(p))
        else:
            dgrep.append(rel(p) if p else '<cwd>')
hits = {rel(p) for p in t['grep']['hits']}
listed = {rel(p) for p in t['grep']['listed']}
print('Read:', sorted(reads))
print('文件级 Grep path:', sorted(fgrep))
print('目录级 Grep path:', dgrep)
print('content 命中:', sorted(hits))
print('listed:', sorted(listed))
n = 0
for c in rv['consulted']:
    src = [k for k, s in (('Read', reads), ('文件级Grep', fgrep), ('Grep命中', hits)) if c in s]
    n += bool(src)
    print(f'  {c:45s} {src}')
print(f'匹配 {n}/{len(rv["consulted"])}')
print('Grep 调用 (mode, path形态, pattern前50):')
for u in t['toolUses']:
    if u['name'] == 'Grep':
        i = u['input']
        p = i.get('path', '')
        print('  ', repr(i.get('output_mode')), 'file' if os.path.isfile(p) else 'dir', rel(p) if p else '<none>', '|', i.get('pattern', '')[:60])
print('toolErrors:', t.get('toolErrors'))
print('StructuredOutput 次数:', sum(1 for u in t['toolUses'] if u['name'] == 'StructuredOutput'))
