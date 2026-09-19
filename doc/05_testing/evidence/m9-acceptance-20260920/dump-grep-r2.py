import json, os
R = os.path.expanduser('~/.trivium/runs/m9-acceptance-14ec607d/20260919T162144Z/claude/out/stdout.jsonl')
root = '/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/8498a631-5c50-4055-b53d-336e61a51887/scratchpad/m9-acceptance'
uses = {}
for line in open(R):
    try:
        e = json.loads(line)
    except Exception:
        continue
    if e.get('type') == 'assistant':
        for b in e.get('message', {}).get('content', []):
            if b.get('type') == 'tool_use':
                uses[b['id']] = (b['name'], b.get('input', {}))
    if e.get('type') == 'user':
        for b in e.get('message', {}).get('content', []):
            if b.get('type') != 'tool_result':
                continue
            name, inp = uses.get(b.get('tool_use_id'), ('?', {}))
            if name != 'Grep':
                continue
            c = b.get('content')
            s = c if isinstance(c, str) else ''.join(x.get('text', '') for x in c if isinstance(x, dict))
            lines = s.split('\n')
            p = inp.get('path', '')
            print('== Grep', 'is_error=' + str(b.get('is_error', False)), 'output_mode=' + repr(inp.get('output_mode')),
                  'path=' + (os.path.relpath(p, root) if p else '<none>'), 'pattern=' + inp.get('pattern', '')[:70])
            print('   lines=%d' % len(lines))
            for ln in lines[:3]:
                print('   |', ln.replace(root, '<ROOT>')[:140])
