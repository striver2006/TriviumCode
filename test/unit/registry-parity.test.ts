/**
 * 注册表对账（计划 §2.1）。
 *
 * 两类断言：
 *   1. **派生一致性**：types 的三张表、命名正则、前缀正则全部与注册表逐项相符；
 *   2. **grep 级对账**：`src/` 下除注册表与适配器外，不得出现具体 Agent 字面量。
 *
 * 第 2 类是本文件存在的主要理由。计划审查（run 20260913T115435Z）两侧合计
 * 查出 12 处硬编码，其中 8 处是我在原稿里自称「已补全」之后才被审出来的——
 * 人工清单维持不住完整性，因此完整性改由机器对账保证：新写的字面量当场红，
 * 而不是等到接入第五家 Agent 时以难定位的故障复现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  AGENTS,
  ALL_AGENT_IDS,
  ALL_FINDING_PREFIXES,
  CRITIC_AGENT_IDS,
  DEFAULT_DRIVER,
  agentByFindingId,
  agentByFindingPrefix,
  agentById,
  findingPrefixAlternation,
  isAgentId,
  suffixAlternation,
} from '../../src/trivium/agents/registry.js';
import { CRITICS, CRITIC_PREFIX, CRITIC_VENDOR } from '../../src/trivium/types.js';
import { looksLikeRoleArtifact, parseArtifactName } from '../../src/trivium/naming.js';
import { isFallbackId } from '../../src/trivium/disposition.js';
import { REPO_ROOT } from '../helpers/fixture.js';

// ─────────────────────── 1. 注册表自身的不变式 ───────────────────────

test('注册表：id / 后缀 / 前缀三者互不重复，且 suffix 恒等于 id', () => {
  const ids = new Set(AGENTS.map((a) => a.id));
  const suffixes = new Set(AGENTS.map((a) => a.suffix));
  const prefixes = new Set(AGENTS.map((a) => a.findingPrefix));

  assert.equal(ids.size, AGENTS.length, 'Agent id 有重复');
  assert.equal(suffixes.size, AGENTS.length, '归档后缀有重复');
  assert.equal(prefixes.size, AGENTS.length, '意见前缀有重复——两家共用前缀会让来源反推失效');

  for (const a of AGENTS) {
    assert.equal(a.suffix, a.id, `${a.id} 的 suffix 必须等于 id`);
  }
});

test('注册表：意见前缀不得互为前缀', () => {
  /*
   * `agentByFindingId` 按第一个连字符切分，因此前缀本身不含连字符即可区分。
   * 但若某天出现 `GLM` 与 `GLMX` 这类，人读编号时仍会混淆，提前拦住。
   */
  for (const a of AGENTS) {
    assert.ok(!a.findingPrefix.includes('-'), `${a.id} 的前缀不得含连字符`);
    for (const b of AGENTS) {
      if (a.id === b.id) continue;
      assert.ok(
        !b.findingPrefix.startsWith(a.findingPrefix),
        `前缀 ${b.findingPrefix} 以 ${a.findingPrefix} 开头，会造成来源反推歧义`,
      );
    }
  }
});

test('注册表：默认 Driver 必须是已登记且允许作 Driver 的 Agent', () => {
  const d = agentById(DEFAULT_DRIVER);
  assert.ok(d, '默认 Driver 未登记');
  assert.equal(d!.driverEnabled, true, '默认 Driver 的 driverEnabled 为假');
});

// ─────────────────────── 2. 派生表与注册表一致 ───────────────────────

test('派生：types 的 CRITICS / CRITIC_VENDOR / CRITIC_PREFIX 与注册表逐项相符', () => {
  assert.deepEqual([...CRITICS], [...CRITIC_AGENT_IDS]);

  for (const c of CRITICS) {
    const a = agentById(c)!;
    assert.equal(CRITIC_VENDOR[c], a.vendor, `${c} 的 vendor 不一致`);
    assert.equal(CRITIC_PREFIX[c], a.findingPrefix, `${c} 的意见前缀不一致`);
  }
});

test('派生：工件名正则认全部已登记后缀', () => {
  for (const id of ALL_AGENT_IDS) {
    const parsed = parseArtifactName(`2026-09-13-某主题-${id}.md`);
    assert.ok(parsed, `工件名解析不认后缀 ${id}——该 Agent 的历史留痕会对解析器整体不可见`);
    assert.equal(parsed!.role, id);
    assert.ok(looksLikeRoleArtifact(`2026-09-13-某主题-${id}.md`), `AC-07 检查器不识别后缀 ${id}`);
  }
});

test('派生：fallback 编号正则认全部已登记前缀', () => {
  for (const p of ALL_FINDING_PREFIXES) {
    assert.ok(isFallbackId(`${p}-F1`), `fallback 编号正则不认前缀 ${p}`);
  }
  assert.ok(!isFallbackId('NOPE-F1'), '未登记前缀不该被认成 fallback');
});

test('派生：交替正则片段与注册表次序一致', () => {
  assert.equal(findingPrefixAlternation(), ALL_FINDING_PREFIXES.join('|'));
  assert.equal(suffixAlternation(), ALL_AGENT_IDS.join('|'));
});

// ─────────────── 3. 反推函数：无匹配返回 null，禁止兜底（A-1） ───────────────

test('反推：未登记的前缀返回 null，而不是兜底到任一 Agent', () => {
  assert.equal(agentByFindingPrefix('NOPE'), null);
  assert.equal(agentByFindingId('NOPE-01'), null);
  assert.equal(agentById('nope'), null);
  assert.equal(isAgentId('nope'), false);
});

test('反推：已登记前缀逐项命中正确的 Agent', () => {
  for (const a of AGENTS) {
    assert.equal(agentByFindingId(`${a.findingPrefix}-01`)?.id, a.id);
    assert.equal(agentByFindingId(`${a.findingPrefix}-r2-03`)?.id, a.id);
    assert.equal(agentByFindingId(`${a.findingPrefix}-F1`)?.id, a.id);
  }
});

test('反推：畸形编号不抛异常，返回 null', () => {
  for (const bad of ['', '-', 'AGY', '-01', '01-AGY']) {
    assert.doesNotThrow(() => agentByFindingId(bad));
    assert.equal(agentByFindingId(bad), null, `「${bad}」不该被反推出 Agent`);
  }
});

// ─────────────────────── 4. grep 级对账 ───────────────────────

/**
 * 允许出现 Agent 字面量的文件。
 *
 * **加入本表前先想清楚**：注册表的价值在于「新增 Agent 只改注册项」，
 * 每加一个豁免就削弱一分。适配器与探针按定义就是 Agent 专属实现，它们
 * 的文件名本身即命名空间；除此之外的豁免应当极少，且要在此写明理由。
 */
const LITERAL_ALLOWLIST: readonly { file: string; why: string }[] = [
  { file: 'agents/registry.ts', why: '唯一登记处，字面量的来源本身' },
  { file: 'adapters/agy.ts', why: '厂商专属适配器：文件本身即该 Agent 的命名空间' },
  { file: 'adapters/zcode.ts', why: '厂商专属适配器：ZCode 调用与参数构造' },
  { file: 'adapters/agy-events.ts', why: '厂商专属：Antigravity 事件流解析' },
  { file: 'adapters/zcode-trace.ts', why: '厂商专属：ZCode 工具轨迹解析' },
  { file: 'probes/agy.ts', why: '厂商专属探针' },
  { file: 'probes/zcode.ts', why: '厂商专属探针：ZCode 能力实测' },
  { file: 'config.ts', why: '默认配置里各 Agent 的配置节键名；M7b 迁 agents.* 后收敛' },
  { file: 'hooks.ts', why: 'Hook 字面集与人读话术；M10 随 --agent 泛化' },
  { file: 'init.ts', why: '安装目标与配置模板；M10 随多目标合并泛化' },
  // 注意：`src/install.ts` 不在本对账的扫描范围（只扫 src/trivium/），
  // 因此不需要、也不应该为它留白名单条目——留着只会误导读者以为它被扫过。
  { file: 'cli.ts', why: '旗标名 --model-gemini / --model-glm；M7b 泛化，旧名长期保留为别名' },
  { file: 'review.ts', why: '适配器工厂接线 { gemini: agyAdapter, glm: zcodeAdapter }；M7b 改读注册表' },
  { file: 'run-protocol.ts', why: 'worker 进程的适配器重建接线；M7b 改读注册表' },
  { file: 'doctor.ts', why: '逐侧探测的人读输出与厂商专属诊断话术' },
  { file: 'preflight.ts', why: '逐侧预检的人读输出' },
  { file: 'selftest.ts', why: '自检场景里两侧桩的固定编排；M7b 增 N 侧场景' },
  { file: 'status.ts', why: '两侧进度的人读渲染；M7b 随动态 map 泛化' },
  { file: 'brief.ts', why: 'BRIEF 渲染中的角色话术' },
  { file: 'types.ts', why: 'CriticId 的字面收窄（Extract<AgentId, …>）；M7b 随注册表放开' },
  { file: 'schemas.ts', why: 'schema 文件名与 ajv 校验接线' },
  { file: 'parse.ts', why: '厂商结构化输出的字段兼容（各家注入自有字段）' },
];

test('白名单纪律：每一项都要写明理由，且不得豁免不存在的文件', async () => {
  /*
   * 代码审查（run 20260913T121713Z）AGY-03/04 与 GLM-01/06 共同指出：
   * 白名单被用来**掩盖没改完的模块**——`topic-args.ts` 与 `report.ts` 根本
   * 不是 Agent 专属实现，加进来只是为了让对账变绿。grep 对账本是为补人工
   * 清单的漏而设，无理由的豁免把那处漏重新变回盲区。
   *
   * 所以白名单自己也得有守卫：理由必填，且豁免的文件必须真实存在
   * （文件被删或改名后，陈旧条目会悄悄扩大豁免面）。
   */
  const srcRoot = path.join(REPO_ROOT, 'src/trivium');
  for (const entry of LITERAL_ALLOWLIST) {
    assert.ok(
      entry.why.trim().length >= 6,
      `白名单条目 ${entry.file} 没有写明理由——每加一个豁免就削弱一分注册表的价值`,
    );
    await assert.doesNotReject(
      fs.access(path.join(srcRoot, entry.file)),
      `白名单条目 ${entry.file} 指向的文件不存在，应当删除该条目`,
    );
  }
});

/** 逐字符扫描，跳过注释与字符串之外的语法噪声由调用方以正则近似处理 */
async function collectSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (e.name.endsWith('.ts')) out.push(abs);
    }
  };
  await walk(root);
  return out;
}

test('grep 对账：白名单外的模块不得出现 Agent id / 前缀字面量', async () => {
  // 扫的是**工作树源码**而非 dist 产物：对账要在人写的那一份上做
  const srcRoot = path.join(REPO_ROOT, 'src/trivium');
  const files = await collectSourceFiles(srcRoot);
  assert.ok(files.length > 20, `源码扫描没找到足够文件（${files.length}），路径可能不对`);

  // 带引号的字面量才算——注释里提到 Agent 名是说明性文字，不影响行为
  const idPattern = new RegExp(`['"\`](?:${ALL_AGENT_IDS.join('|')})['"\`]`);
  const prefixPattern = new RegExp(`['"\`](?:${ALL_FINDING_PREFIXES.join('|')})-`);

  const offenders: string[] = [];
  for (const abs of files) {
    const rel = path.relative(srcRoot, abs);
    if (LITERAL_ALLOWLIST.some((w) => rel === w.file || rel.endsWith(`/${w.file}`))) continue;

    const src = await fs.readFile(abs, 'utf8');
    // 去掉行注释与块注释，只看真正参与求值的代码
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const [lineNo, line] of code.split('\n').entries()) {
      if (idPattern.test(line) || prefixPattern.test(line)) {
        offenders.push(`${rel}:${lineNo + 1}  ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '这些位置写了具体 Agent 字面量，应改读注册表；确属 Agent 专属实现时，' +
      '把文件加进 LITERAL_ALLOWLIST 并在那里写明理由：\n' + offenders.join('\n'),
  );
});
