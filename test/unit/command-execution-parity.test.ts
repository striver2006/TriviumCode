/**
 * 适配器的命令执行能力声明 ↔ 各家工具面事实源（EV-95，审查侧实测措辞约束计划 r2 §3.1 ③）。
 *
 * 从事实源**推出**每家能不能执行命令，再与适配器上的 `commandExecution` 比对——一边改了另一边不跟就红。
 * 声明错了的代价是任务书第 7 节对审查员说错话：对能跑命令的一侧说「你没有执行能力」，
 * 它就会把真跑过的结果写成推理；反过来就是 EV-79 那种推理冒充实测。
 *
 * 工具名一律过**已分类表**：出现表里没有的工具名即红，逼加工具的人回来判它能不能执行命令。
 * 误红的出口是往表里登记一行，不是放宽判据。
 *
 * 边界：agy 侧对账的是仓库里的 `trivium-critic.md`；运行期生效的是安装器拷进用户 HOME 的副本，
 * 两者漂移不在本用例论域（EV-187）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { REPO_ROOT } from '../helpers/fixture.js';
import { agyAdapter } from '../../src/trivium/adapters/agy.js';
import { claudeAdapter } from '../../src/trivium/adapters/claude.js';
import { codexAdapter } from '../../src/trivium/adapters/codex.js';
import { zcodeAdapter, ZCODE_READONLY_DENYLIST } from '../../src/trivium/adapters/zcode.js';
import { realAdapters } from '../../src/trivium/adapters/index.js';
import { READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';
import { CODEX_READONLY_INVARIANTS } from '../../src/trivium/probes/codex.js';
import type { CommandExecution, CriticAdapter } from '../../src/trivium/adapters/base.js';

/** 工具名 → 能否执行命令。只登记见过并判过的名字 */
type ToolTable = Readonly<Record<string, boolean>>;

const CLAUDE_TOOLS: ToolTable = { Read: false, Grep: false, Glob: false, Bash: true };
const AGY_TOOLS: ToolTable = {
  view_file: false, read_file: false, grep_search: false, find_by_name: false, list_dir: false, finish: false,
  run_command: true,
};

/** 按已分类表推出能力：有一个能执行命令的工具 ⇒ readonly-shell；出现未分类的工具名 ⇒ 抛 */
function classify(tools: readonly string[], table: ToolTable, where: string): CommandExecution {
  const unknown = tools.filter((t) => !(t in table));
  if (unknown.length > 0) {
    throw new Error(`${where} 出现未分类的工具：${unknown.join('、')}——先判它能不能执行命令，再登记进本用例的工具表`);
  }
  return tools.some((t) => table[t]) ? 'readonly-shell' : 'none';
}

/** 从 agent 定义文本的 front-matter 取 `tools:` 列表（纯函数，负例喂内存里改过的文本，不碰仓库文件） */
function agyToolsFromDefinition(text: string): string[] {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  assert.ok(m, 'agent 定义缺 front-matter');
  const lines = m[1]!.split('\n');
  const at = lines.findIndex((l) => /^tools:\s*$/.test(l));
  assert.ok(at >= 0, 'front-matter 缺 tools: 列表');
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    const item = /^\s+-\s+(\S+)\s*$/.exec(l);
    if (!item) break;
    out.push(item[1]!);
  }
  assert.ok(out.length > 0, 'tools: 列表为空');
  return out;
}

/** zcode 是禁用名单（与另两家的白名单方向相反）：`Bash` 被禁 ⇒ 不能执行命令 */
function zcodeFact(denylist: string): CommandExecution {
  return denylist.split(',').map((s) => s.trim()).includes('Bash') ? 'none' : 'readonly-shell';
}

/**
 * claude 侧「不能执行命令」是三件的合取（代码双审 CODEX-01）：`--restricted` 移除执行命令 / 代码的内建工具，
 * `--strict-mcp-config` 挡住 MCP 工具混入，`--tools` 白名单只放读工具。只看白名单的话，删掉前两个旗标这里照样推出 `none`。
 */
function claudeFact(invariants: readonly string[]): CommandExecution {
  for (const flag of ['--restricted', '--strict-mcp-config']) {
    assert.ok(invariants.includes(flag), `READONLY_INVARIANTS 缺 ${flag}——claude 侧可能拿到执行命令的工具，先重新判它的命令执行能力`);
  }
  const at = invariants.indexOf('--tools');
  assert.ok(at >= 0 && at + 1 < invariants.length, 'READONLY_INVARIANTS 里找不到 --tools 及其取值');
  return classify(invariants[at + 1]!.split(','), CLAUDE_TOOLS, 'claude 工具白名单');
}

const AGY_DEFINITION_PATH =path.join(REPO_ROOT, 'skills/dual-critic/agents/trivium-critic.md');

/** 每家的事实源推导。多出一家没登记，最后一格会红 */
const FACTS: Record<string, { adapter: CriticAdapter; fact: () => CommandExecution; source: string }> = {
  glm: {
    adapter: zcodeAdapter,
    source: 'ZCODE_READONLY_DENYLIST',
    fact: () => zcodeFact(ZCODE_READONLY_DENYLIST),
  },
  claude: {
    adapter: claudeAdapter,
    source: 'probes/claude.ts READONLY_INVARIANTS 的 --tools 白名单',
    fact: () => claudeFact(READONLY_INVARIANTS),
  },
  gemini: {
    adapter: agyAdapter,
    source: 'skills/dual-critic/agents/trivium-critic.md 的 tools:',
    fact: () => classify(agyToolsFromDefinition(readFileSync(AGY_DEFINITION_PATH, 'utf8')), AGY_TOOLS, 'trivium-critic.md'),
  },
  codex: {
    adapter: codexAdapter,
    source: 'probes/codex.ts CODEX_READONLY_INVARIANTS',
    fact: () => {
      // 只认恰好这一种沙箱参数：别的取值（workspace-write / danger-full-access）不再是「只读 shell」，要有人重新判
      assert.deepEqual([...CODEX_READONLY_INVARIANTS], ['-s', 'read-only'], 'codex 沙箱参数变了，先重新判它的命令执行能力');
      return 'readonly-shell';
    },
  },
};

for (const [id, f] of Object.entries(FACTS)) {
  test(`${id}：适配器声明与事实源（${f.source}）一致`, () => {
    assert.equal(f.adapter.critic, id, '登记表的键与适配器的侧名对不上');
    assert.equal(f.adapter.commandExecution, f.fact(), `${id} 声明 ${f.adapter.commandExecution}，事实源推出的不一样`);
  });
}

test('接线表里的每一家都在本用例登记了事实源（下一家接入时不会悄悄漏对账）', () => {
  const wired = Object.keys(realAdapters()).sort();
  assert.deepEqual(wired, Object.keys(FACTS).sort());
});

test('负例：agent 定义里加一行 run_command ⇒ 推出 readonly-shell，与 agy 的声明不符', () => {
  const text = readFileSync(AGY_DEFINITION_PATH, 'utf8').replace(/^tools:\n/m, 'tools:\n  - run_command\n');
  const derived = classify(agyToolsFromDefinition(text), AGY_TOOLS, '改过的定义');
  assert.equal(derived, 'readonly-shell');
  assert.notEqual(derived, agyAdapter.commandExecution);
});

test('负例：出现未分类的工具名 ⇒ 抛「未分类」，不静默当成不能执行', () => {
  const text = readFileSync(AGY_DEFINITION_PATH, 'utf8').replace(/^tools:\n/m, 'tools:\n  - shell_exec\n');
  assert.throws(() => classify(agyToolsFromDefinition(text), AGY_TOOLS, '改过的定义'), /未分类的工具：shell_exec/);
  assert.throws(() => classify(['Read', 'LS'], CLAUDE_TOOLS, 'claude'), /未分类的工具：LS/);
});

test('负例：claude 的不变量里少了 --restricted 或 --strict-mcp-config ⇒ 当场红，不靠白名单推出 none', () => {
  for (const flag of ['--restricted', '--strict-mcp-config']) {
    const without = READONLY_INVARIANTS.filter((x) => x !== flag);
    assert.throws(() => claudeFact(without), new RegExp(`缺 ${flag}`));
  }
});

test('负例：名单里去掉 Bash 的 zcode、白名单里加上 Bash 的 claude 都推出 readonly-shell', () => {
  const noBash = ZCODE_READONLY_DENYLIST.split(',').filter((t) => t !== 'Bash').join(',');
  assert.equal(zcodeFact(noBash), 'readonly-shell');
  assert.notEqual(zcodeFact(noBash), zcodeAdapter.commandExecution);
  assert.equal(classify(['Read', 'Grep', 'Glob', 'Bash'], CLAUDE_TOOLS, 'claude'), 'readonly-shell');
});
