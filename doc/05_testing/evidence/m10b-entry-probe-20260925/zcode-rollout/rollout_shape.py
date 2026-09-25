# 只读：ZCode rollout 的结构与保留策略读数。只输出键名、非凭据的会话类型头、常量，不输出任何正文值。
import json, glob, os, re

D = os.path.expanduser('~/.zcode/cli/rollout')
SECRET = re.compile(r'(?i)(bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9]{16,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|[0-9a-f]{32}\.[A-Za-z0-9]{16}|api[_-]?key["\s:=]+[A-Za-z0-9._-]{12,})')

print('## 目录清单（按修改时间）')
files = sorted(glob.glob(os.path.join(D, 'model-io-*.jsonl')), key=os.path.getmtime)
for f in files:
    e = json.loads(open(f).readline())
    h = e['request'].get('headers', {})
    t = open(f).read()
    print(os.path.basename(f), 'bytes', os.path.getsize(f), 'lines', len(t.splitlines()),
          'startedAt', e.get('startedAt'), 'model', json.dumps(e.get('model')),
          'title', h.get('x-title'), 'session-type', h.get('x-zcode-session-type'),
          'secret-shape-hits', len(SECRET.findall(t)))

print('\n## 请求头键名（三份并集）')
keys = set()
for f in files:
    for l in open(f):
        keys |= set((json.loads(l)['request'].get('headers') or {}).keys())
print(sorted(keys))
print('鉴权类头键：', [k for k in keys if re.search(r'(?i)auth|key|token|cookie', k)])

print('\n## 顶层与二层键路径（最新一份）')
e = json.loads(open(files[-1]).readline())
out = []
for k, v in e.items():
    if isinstance(v, dict):
        out += [f'{k}.{k2}' for k2 in v.keys()]
    else:
        out.append(k)
print(sorted(out))

print('\n## 入口文件常量（/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs）')
src = open('/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs', 'rb').read()
for name in [b'VFs', b'HFs', b'GFs']:
    m = re.search(rb'[,;{ ]' + name + rb'=([^,;]{1,40})', src)
    print(name.decode(), '=', m.group(1).decode() if m else None)
m = re.search(rb'function XFs\(e,t\)\{.{0,420}', src, re.S)
print('XFs:', m.group().decode('utf8', 'replace') if m else None)
m = re.search(rb'function e4s\([^)]*\)\{[^}]{0,200}\}', src)
print('e4s:', m.group().decode('utf8', 'replace') if m else None)
m = re.search(rb'function r4s\(e,t\)\{.{0,200}', src, re.S)
print('r4s:', m.group().decode('utf8', 'replace') if m else None)
