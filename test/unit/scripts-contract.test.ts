/**
 * **`scripts/*.mjs` 是类型检查看不见的调用点**（代码双审 r3 AGY-02）。
 *
 * ## 这条用例买的是什么
 *
 * r1 裁定「准入脚本要 import 生产封装，不许自建配方」——那条裁定是对的，
 * 它消掉了「脚本那份配方与生产漂移」的风险。**但它的副作用没人管**：
 * 脚本是 `.mjs`，不进 `tsc --noEmit` 的覆盖面，于是每一个 import 生产模块的脚本
 * 都成了**改签名时编译器点不出来的调用点**。
 *
 * r3 兑现了这个代价：`buildDenySettings` 的返回型从 `string` 改成
 * `DenySettingsBuild` 时，准入脚本的两处调用点没跟上，`--settings` 会拼成
 * `'[object Object]'`、随后的 `JSON.parse` 当场抛——而 `npm run check` **全绿**。
 *
 * 所以这里补的不是「那两行改对了没有」（那是一次性的），
 * 而是**那一整类缺口的机器判据**：脚本至少要被语法检查扫到，
 * 且已知的易漂移调用点要有形状断言。
 *
 * ## 它的边界
 *
 * `node --check` 只验语法，验不出类型错用；形状断言是**按已知调用点**登记的，
 * 不是完备的静态分析。真正的完备解是把脚本也纳入类型检查
 * （改成 `.ts` 或加 `// @ts-check` + JSDoc），那是比本轮大的改动——
 * **这一点如实写在这里，不要让这条用例看起来比它实际做的更强**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../helpers/fixture.js';

const SCRIPTS = path.join(REPO_ROOT, 'scripts');

async function mjsFiles(): Promise<string[]> {
  const entries = await fs.readdir(SCRIPTS, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => e.name)
    .sort();
}

test('S1 scripts/ 下每个 .mjs 都通过语法检查', async () => {
  const files = await mjsFiles();
  assert.ok(files.length > 0, 'scripts/ 下应当有 .mjs——扫不到说明路径错了，不是「都通过」');

  const bad: string[] = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', path.join(SCRIPTS, f)], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (r.status !== 0) bad.push(`${f}: ${(r.stderr ?? '').split('\n')[0]}`);
  }
  assert.deepEqual(bad, [], '这些脚本语法不过');
});

test('S2 `buildDenySettings` 的每处脚本调用点都取 `.json`，不得原样传对象（AGY-02）', async () => {
  const files = await mjsFiles();
  const offenders: string[] = [];
  let callSites = 0;

  for (const f of files) {
    const src = await fs.readFile(path.join(SCRIPTS, f), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      // 注释行不算调用点（本文件与脚本里都会**提到**这个函数名）
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//')) return;
      if (!code.includes('buildDenySettings(')) return;
      callSites += 1;
      /*
       * 判据：这一行（或它赋值到的名字）后续要取 `.json`。
       * 两种合法写法都放行：
       *   const settingsJson = …buildDenySettings(…).json;
       *   const denyBuild = …buildDenySettings(…);  … denyBuild.json
       * 违规形态恰是 r3 那个：`const settingsJson = …buildDenySettings(…)` 然后直接当串用。
       */
      if (code.includes('.json')) return;
      const assigned = /const\s+([A-Za-z_$][\w$]*)\s*=/.exec(code)?.[1];
      const rest = lines.slice(i + 1, i + 15).join('\n');
      if (assigned && new RegExp(`\\b${assigned}\\.json\\b`).test(rest)) return;
      offenders.push(`${f}:${i + 1}  ${code}`);
    });
  }

  assert.ok(
    callSites > 0,
    'scripts/ 里应当有 buildDenySettings 调用点——一个都扫不到，这条断言就是恒真的空转',
  );
  assert.deepEqual(
    offenders,
    [],
    '这些调用点把整个 DenySettingsBuild 当成 JSON 串用了，--settings 会变成 [object Object]',
  );
});
