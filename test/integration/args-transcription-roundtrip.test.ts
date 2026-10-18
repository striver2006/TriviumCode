/**
 * 参数转抄的往返用例（M10b 第 2 步，计划 r10 §2.4.2，CODEX-06）。
 *
 * ## 这条用例证什么
 *
 * 另三家载体不替换 `$ARGUMENTS`，参数由模型按转抄规约拼进命令（r10 §2.4.1）。
 * 规约本身是否**机械可靠**——同一组特殊字符按「整段单引号、内部单引号写 `'\''`、其余不转义」拼成
 * 命令行，经真实 shell 解析后，编排器落盘的主题与 BRIEF 第 2 段焦点是否与输入**逐字一致**——
 * 在编排器侧就能核：喂 shell 命令行，不经模型。
 *
 * ## 证不到什么
 *
 * 模型会不会照规约拼（转抄保真）只能在真实轮上核（r10 §4.2），不在这里。
 *
 * ## 含角色后缀字样的一组
 *
 * 在装有 TriviumCode Bash Hook 的载体上，这组会被已知误拦拦下（命令含 `.trivium` 又含写动词 ∧ 角色后缀）。
 * 这是**预期**，照实断言为「被拦」，**不算失败**，也不为它开豁免（RV-B1）；argv 这一侧照样逐字。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ASSET_ROOT, BUNDLE, bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { run } from '../../src/trivium/util/exec.js';
import { encodeStubConfig, STUB_ENV_VAR, type StubConfig } from '../../src/trivium/adapters/stub.js';
import { DEFAULT_DRIVER } from '../../src/trivium/agents/registry.js';
import { SH } from '../helpers/platform.js';

const TOPIC = '转抄往返';
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

/** 转抄规约的拼串：整段单引号，内部单引号写成 '\''，其余一律不转义（skills-src/partials/args/rule-quote.text.md） */
const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

const INPUTS = {
  /** 反引号、`*`、双引号、`$`、单引号 */
  plain: '看 `反引号` 与 *星号* 和 "双引号" 的 $HOME 处理，it\'s 单引号也要原样',
  /** 另含角色后缀字样与写动词字面：Hook 侧会误拦 */
  roleSuffix: '别让 rm 误删 x-glm.md 里 $PATH 的 `cat` 片段',
};

async function sh(root: string, cmd: string, stub: StubConfig | null) {
  // SH：POSIX 为 /bin/sh，win32 为 Git Bash 的 sh.exe（转抄测试的命令文法是 POSIX shell）
  return run(SH, ['-c', cmd], {
    cwd: root,
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, [STUB_ENV_VAR]: stub ? encodeStubConfig(stub) : undefined },
    timeoutMs: 120_000,
  });
}

function json(stdout: string): Record<string, unknown> {
  const c = extractJsonCandidate(stdout);
  assert.ok(c, `没有 JSON 输出：${stdout}`);
  return JSON.parse(c!.json) as Record<string, unknown>;
}

/** BRIEF 第 2 段的逐字引用块（brief.ts：`## 2. 本次审查焦点` 下以 `> ` 开头的行） */
function briefFocus(brief: string): string {
  const lines = brief.split('\n');
  const at = lines.findIndex((l) => l.startsWith('## 2. 本次审查焦点'));
  assert.ok(at >= 0, 'BRIEF 里没有第 2 段');
  const quoted: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.startsWith('> ')) quoted.push(l.slice(2));
    else if (quoted.length > 0) break;
  }
  return quoted.join('\n');
}

for (const [label, focus] of Object.entries(INPUTS)) {
  test(
    `转抄往返（${label}）：resolve 与 --start 经 shell 解析后，主题与 BRIEF 第 2 段焦点逐字一致`,
    { skip: bundleMissing && bundleSkipReason },
    async () => {
      const { root, stageDir } = await makeFixture({ topic: TOPIC });
      const tv = `"${process.execPath}" "${BUNDLE}"`;

      const resolved = await sh(
        root,
        `${tv} topic resolve --stage plan --json -- ${quote(focus)} --topic ${TOPIC} --driver ${DEFAULT_DRIVER}`,
        null,
      );
      assert.equal(resolved.code, EXIT.OK, `${resolved.stdout}${resolved.stderr}`);
      const r = json(resolved.stdout);
      assert.equal(r['topic'], TOPIC);
      assert.equal(r['prompt_hint'], focus, 'resolve 的焦点与输入不逐字一致');

      const started = await sh(
        root,
        `${tv} review --start --entry B --stage plan --topic ${TOPIC} --driver ${DEFAULT_DRIVER} ` +
          `--focus ${quote(String(r['prompt_hint']))} --json`,
        STUB,
      );
      assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
      const runId = String(json(started.stdout)['run_id']);
      let code: number = EXIT.STILL_RUNNING;
      for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
        code = (await cli(root, ['review', '--wait', runId, '--timeout', '20'], STUB, 60_000)).code ?? EXIT.FAIL;
      }
      assert.equal(code, EXIT.OK, '桩审查没有跑完');

      const runMeta = JSON.parse(await fs.readFile(path.join(stageDir, '_meta', `run-${runId}.json`), 'utf8')) as {
        topic: string;
      };
      assert.equal(runMeta.topic, TOPIC, 'run.json 的主题与输入不逐字一致');
      for (const side of Object.keys(STUB)) {
        const brief = await fs.readFile(path.join(stageDir, '_meta', `brief-${side}-${runId}.md`), 'utf8');
        assert.equal(briefFocus(brief), focus, `${side} 侧 BRIEF 第 2 段焦点与输入不逐字一致`);
      }
    },
  );
}

/*
 * r10 §2.4.2 写的是「含角色后缀字样的那一组会被误拦」。实测的触发条件不同：
 * `TV` 本身就含 `.trivium`（编排器独占路径的字面），所以**只要焦点里有写动词字面**整条命令就被拦，
 * 与有没有角色后缀字样无关；反过来，只有角色后缀字样、没有写动词时**不拦**（缺 `writeLike` 前置门）。
 * 三条都照实钉住，免得文档与入口资产把触发条件写错（入口资产的误拦提示写的是「写动词字面」）。
 */
async function hookPreBash(root: string, command: string): Promise<number | null> {
  const r = await run(process.execPath, [BUNDLE, 'gate', 'hook-pre-bash'], {
    cwd: root,
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, [STUB_ENV_VAR]: undefined },
    stdin: JSON.stringify({ session_id: 'S-转抄', tool_name: 'Bash', tool_input: { command }, cwd: root }),
    timeoutMs: 30_000,
  });
  return r.code;
}

test(
  'Bash Hook 误拦的真实触发条件：焦点含写动词字面即拦（预期，照实记为「被拦」）；只有角色后缀字样不拦',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    const tvLine = (focus: string): string =>
      `.trivium/bin/trivium topic resolve --stage plan --json -- ${quote(focus)} --topic ${TOPIC} --driver ${DEFAULT_DRIVER}`;
    assert.equal(await hookPreBash(root, tvLine(INPUTS.roleSuffix)), 2, '写动词 + 角色后缀：预期被拦');
    assert.equal(
      await hookPreBash(root, tvLine(INPUTS.roleSuffix.replace('x-glm.md', 'x.md'))), 2,
      '只有写动词：同样被拦（TV 本身含 .trivium）',
    );
    assert.equal(
      await hookPreBash(root, tvLine(INPUTS.roleSuffix.replace('别让 rm 误删', '别误改'))), 0,
      '只有角色后缀字样：不拦',
    );
  },
);
