/**
 * 载体事实表对账（CLAUDE-08/CODEX-01：与注册表源码、载体 yaml 机器对账，
 * 防 cliKey / skill 根 / 完整调用模板静默漂移）。
 *
 * 数据源：本仓 src/trivium/agents/registry.ts 与 skills-src/carriers/*.yaml
 * （测试期依赖，运行期插件不 import 核心代码）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CARRIERS, invocationFor, skillRootCandidates, parseWrapperNodePath, AGENT_IDS } from '../../src/launch/carriers';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function registryText(): string {
  return readFileSync(path.join(REPO_ROOT, 'src', 'trivium', 'agents', 'registry.ts'), 'utf8');
}

/** 从注册表源码抽取每个 Agent 描述符块的登记字段 */
function parseRegistry(): Record<string, Record<string, string>> {
  const text = registryText();
  const agentsMatch = /export const AGENTS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(text);
  assert.ok(agentsMatch, '注册表 AGENTS 数组解析失败（源码结构变更？）');
  const body = agentsMatch[1]!;
  const out: Record<string, Record<string, string>> = {};
  for (const block of body.split(/\n  \{/)) {
    const id = /id:\s*'([^']+)'/.exec(block)?.[1];
    if (!id) continue;
    out[id] = {
      cliName: /cliName:\s*'([^']+)'/.exec(block)?.[1] ?? '',
      entryInvocation: /entryInvocation:\s*'([^']+)'/.exec(block)?.[1] ?? '',
      homeEnv: /homeEnv:\s*'([^']+)'/.exec(block)?.[1] ?? '',
      homeRel: /homeRel:\s*'([^']+)'/.exec(block)?.[1] ?? '',
      skillsRel: /skillsRel:\s*'([^']+)'/.exec(block)?.[1] ?? '',
    };
  }
  return out;
}

test('注册表四家 Agent 全部有登记块', () => {
  const reg = parseRegistry();
  for (const id of AGENT_IDS) assert.ok(reg[id], `注册表缺 ${id} 登记块`);
});

test('cliKey 与注册表 cliName 对齐（缺省即 agentId）', () => {
  const reg = parseRegistry();
  for (const id of AGENT_IDS) {
    assert.equal(
      CARRIERS[id].cliKey,
      reg[id]!.cliName || id,
      `${id} 的 cliKey 与注册表不一致`,
    );
  }
});

test('调用模板与注册表 entryInvocation 对齐（桌面端形态）', () => {
  const reg = parseRegistry();
  assert.equal(CARRIERS.claude.invocation, reg['claude']!.entryInvocation);
  assert.equal(CARRIERS.codex.invocation, reg['codex']!.entryInvocation);
  assert.equal(CARRIERS.gemini.invocation, reg['gemini']!.entryInvocation);
});

test('glm 终端 CLI 形态为 /skill 名字（载体 yaml 注释为源，CLAUDE-01）', () => {
  const yaml = readFileSync(path.join(REPO_ROOT, 'skills-src', 'carriers', 'glm.yaml'), 'utf8');
  assert.match(yaml, /\/skill 名字 参数/, 'glm.yaml 应登记命令行展开形态');
  assert.equal(CARRIERS.glm.invocation, '/skill {name}');
  assert.equal(invocationFor('glm', 'dual-run'), '/skill dual-run');
  assert.equal(invocationFor('codex', 'dual-run'), '$dual-run');
  assert.equal(invocationFor('claude', 'dual-run'), '/dual-run');
});

test('skill 根候选与注册表 entrySkillRoot 对齐', () => {
  const reg = parseRegistry();
  const home = '/home/tester';
  const prevHome = process.env['HOME'];
  const prevCodex = process.env['CODEX_HOME'];
  process.env['HOME'] = home;
  delete process.env['CODEX_HOME'];
  try {
    for (const id of AGENT_IDS) {
      const roots = skillRootCandidates(id, null)[0]!;
      const r = reg[id]!;
      const expect = (r.homeEnv ? `${home}/${r.homeRel || ''}` : `${home}/${r.homeRel}`) + `/${r.skillsRel}`;
      assert.equal(roots, expect.replace(/\/+/g, '/'), `${id} 安装位根与注册表不一致`);
    }
  } finally {
    process.env['HOME'] = prevHome;
    if (prevCodex === undefined) delete process.env['CODEX_HOME'];
    else process.env['CODEX_HOME'] = prevCodex;
  }
});

test('仓内渲染产物兜底根存在（本仓布局）', () => {
  const withRepo = skillRootCandidates('codex', '/repo');
  assert.ok(withRepo.includes('/repo/skills/dual-critic/entry/codex'));
  const claudeTop = skillRootCandidates('claude', '/repo');
  assert.ok(claudeTop.includes('/repo/skills'));
});

test('zcode 为脚本类拉起模式（AGY-02）', () => {
  assert.equal(CARRIERS.glm.launchMode, 'shellCommand');
  assert.equal(CARRIERS.claude.launchMode, 'direct');
  assert.equal(CARRIERS.codex.launchMode, 'direct');
  assert.equal(CARRIERS.gemini.launchMode, 'direct');
});

test('解析 wrapper 内嵌 node 绝对路径', () => {
  const wrapper = '#!/bin/sh\nexec "/opt/homebrew/opt/node/bin/node" "/Users/x/.claude/skills/dual-critic/scripts/trivium.cjs" "$@"\n';
  assert.equal(parseWrapperNodePath(wrapper), '/opt/homebrew/opt/node/bin/node');
  assert.equal(parseWrapperNodePath('#!/bin/sh\ntrue'), null);
});
