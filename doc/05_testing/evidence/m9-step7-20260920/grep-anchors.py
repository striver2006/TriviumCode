#!/usr/bin/env python3
"""计划稿 §8.2 的 grep 差集自检：四条锚 + `*.snippet` include + `--only` 措辞锚 + 广撒网 `claude`。
输出：每条命中只给 file:line 与命中处前后 70 字的窗口，便于人读。"""
import pathlib, re, sys, collections

ROOT = pathlib.Path('/Users/chenzhenbo/Work/TriviumCode')
EXCL = {'node_modules', '.reviews', 'dist', 'reference', 'evidence', '.git'}
EXT = {'.md', '.ts', '.snippet'}
# 史实 / 行为面，不是现状断言：测试、实测报告、交底、EV-12 计划、设计 §21 台账与 16.1 里程碑表
SKIP_FILE = re.compile(r'^(test/|doc/05_testing/REPORT_|doc/08_project/M9-交底|doc/08_project/EV-12)')

ANCHORS = {
    'A1 待 M9 / 尚未启用 / 随后续里程碑': re.compile(r'待 M9|待实施 · M9|尚未启用|随后续里程碑|待 M8 / M9|M8 / M9 接入|随 M8 / M9|等 M8 / M9'),
    'A2 两侧审查 / 两家 / 三侧 / 三家 / 第三家 / 第四家': re.compile(r'两侧审查|只有两家|两家 Agent|两家启用|第三家|第四家|三家|三侧'),
    'A3 criticEnabled / driverEnabled': re.compile(r'criticEnabled|driverEnabled|critic_enabled|driver_enabled'),
    'A4 --only gemini|glm / gemini|glm': re.compile(r'--only gemini\|glm|gemini\|glm|gemini、glm|gemini / glm'),
}
BROAD = re.compile(r'claude', re.I)

def files():
    for p in ROOT.rglob('*'):
        if p.is_dir() or p.suffix not in EXT:
            continue
        if any(part in EXCL for part in p.relative_to(ROOT).parts):
            continue
        yield p

hits = collections.defaultdict(list)
broad_only = collections.Counter()
design = 'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md'
for p in files():
    rel = str(p.relative_to(ROOT))
    if SKIP_FILE.match(rel):
        continue
    try:
        lines = p.read_text(encoding='utf-8').split('\n')
    except UnicodeDecodeError:
        continue
    for i, line in enumerate(lines, 1):
        if rel == design and (i >= 3160 or 2890 <= i <= 2900):
            continue  # §21 台账与 16.1 表：史实叙述
        matched = False
        for name, rx in ANCHORS.items():
            for m in rx.finditer(line):
                matched = True
                a, b = max(0, m.start() - 70), min(len(line), m.end() + 70)
                hits[name].append(f'{rel}:{i}: …{line[a:b]}…')
        if not matched and BROAD.search(line):
            broad_only[rel] += 1

for name, lst in hits.items():
    print(f'\n=== {name}（{len(lst)} 处）')
    for h in lst:
        print(h)
print(f'\n=== 广撒网 `claude`（不含上面四锚的行）按文件计数，共 {sum(broad_only.values())} 行')
for rel, c in sorted(broad_only.items(), key=lambda kv: -kv[1]):
    print(f'{c:4d}  {rel}')
