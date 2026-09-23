import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  hookPreWrite, hookPreBash, hookPreCommit, hookStop, hookSessionStart, runHook, looksLikeWriteCommand,
  extractTargetPath, isForgedRoleFile, hasProtectedRoleSuffix,
  criticRoleSuffixes, isInsideArchive, isOrchestratorOwned, runningRewriteViolation,
  type HookInput,
} from '../../src/trivium/hooks.js';
import { looksLikeRoleArtifact } from '../../src/trivium/naming.js';
import { ALL_AGENT_IDS, DEFAULT_DRIVER, type AgentId } from '../../src/trivium/agents/registry.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { exists } from '../../src/trivium/util/fsx.js';
import { setGate } from '../../src/trivium/state.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { run } from '../../src/trivium/util/exec.js';

const SESSION = 'S-CURRENT';
const STALE = 120_000;

async function fakeCtx(opts: { withConfig?: boolean } = {}): Promise<Ctx> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-hook-'));
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });
  if (opts.withConfig !== false) {
    await fs.writeFile(path.join(triviumDir, 'config.yaml'), 'schema: trivium.config.v1\n');
  }
  return {
    config: defaultConfig(),
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir,
    sources: ['<test>'],
  };
}

function writeInput(filePath: string, over: Partial<HookInput> = {}): HookInput {
  return { session_id: SESSION, tool_name: 'Write', tool_input: { file_path: filePath }, ...over };
}

// ── 路径工具 ──

test('从各种 tool_input 字段名里取出目标路径', () => {
  assert.equal(extractTargetPath({ tool_input: { file_path: '/a' } }), '/a');
  assert.equal(extractTargetPath({ tool_input: { notebook_path: '/b.ipynb' } }), '/b.ipynb');
  assert.equal(extractTargetPath({ tool_input: {} }), null);
  assert.equal(extractTargetPath({}), null);
});

test('纯后缀检查：只问形态，不问位置', () => {
  // 原先测的是跨时间函数 hasRoleSuffixCrossTime（提交锚专用）；M10a 第 2 步 EV-55 后提交锚改按
  // artifacts[] 登记判不可变，那个函数随之删除（代码双审 r2 CODEX-03）。形态断言改挂到当轮函数、
  // 以缺省 Driver 取值——断言本身一字未改
  assert.equal(hasProtectedRoleSuffix('2026-09-10-t-gemini.md', DEFAULT_DRIVER), true);
  assert.equal(hasProtectedRoleSuffix('2026-09-10-t-glm.md', DEFAULT_DRIVER), true);
  /*
   * 后两条**结论不变、理由已改写**（M9 第 4 步）。
   *
   * 旧理由是「`-claude.md` 不是审核者角色」——那句话在 claude 的 `criticEnabled`
   * 翻为 true 的那一刻就成了假的，而断言会照样绿（判据换了集合，取值恰好还相同），
   * 于是注释会静默地变成谎话。
   *
   * 新理由：**`-claude.md` 是当轮 Driver 自己的产出**。判据是「全部已登记角色
   * 减当轮 Driver」，与「谁能当审核者」无关——见 `criticRoleSuffixes(DEFAULT_DRIVER)` 的文档块。
   */
  assert.equal(hasProtectedRoleSuffix('2026-09-10-t-claude.md', DEFAULT_DRIVER), false);
  assert.equal(hasProtectedRoleSuffix('2026-09-10-t-revised-claude.md', DEFAULT_DRIVER), false);
  assert.equal(hasProtectedRoleSuffix('src/gemini.md', DEFAULT_DRIVER), false, '文件名必须以 -gemini.md 结尾');
});

/*
 * **识别集 ⊇ 保护集**，差集恰是当轮 Driver（M9 第 4 步，计划双审 AGY-02 ≡ CODEX-04 的连带 3）。
 *
 * 两者此前**相等**（`naming` 用全量后缀、Hook 用 `CRITICS`，而 claude 恰好未启用），
 * 所以这层关系从来没被写下来过。改判据之后它们不再相等，而不等的方向是有讲究的：
 * 识别得出来（`looksLikeRoleArtifact` 认得 Driver 的产出是角色工件，归档要靠它排序轮次）
 * 但不保护（Driver 要能写自己的裁决件）。
 *
 * 反过来若保护集大于识别集，就是「拦得住却认不出」——Driver 交不了卷，
 * 而归档还以为那份文件不存在。
 *
 * ## 这条用例**证伪不了什么**，要说清楚（代码双审 CODEX-04 ≡ GLM-03 ≡ AGY-04）
 *
 * 上一版这里写着「这条用例今天恒成立，两侧任一改错都当场红」——**那两句自相矛盾**，
 * 而且后半句是假的：
 *   · 差集那条断言是**重言式**：`diff` 与 `criticRoleSuffixes(DEFAULT_DRIVER)` 同源于 `ALL_AGENT_IDS`，
 *     只要 `DEFAULT_DRIVER` 已登记，`diff === [DEFAULT_DRIVER]` 恒真；
 *   · 把实现换回被替换掉的旧判据（`CRITIC_AGENT_IDS` 减 Driver）**也不会红**：
 *     四家全启用时两个集合取值逐字相同。
 *
 * 也就是说「保护集的来源是**身份全集**而不是**启用集合**」这一层，
 * 今天没有任何观测能区分——要到注册表登记第五家（且它未启用为审核者）那天才有。
 * 本用例真正能证伪的是下面那段**换 Driver** 的断言：它锁住参数契约与差集的动态性。
 */
test('识别集 ⊇ 保护集，差集恰是当轮 Driver', () => {
  const protectedIds = criticRoleSuffixes(DEFAULT_DRIVER);

  for (const id of protectedIds) {
    const f = `2026-09-10-t-${id}.md`;
    assert.equal(hasProtectedRoleSuffix(f, DEFAULT_DRIVER), true, `${id} 应在保护集内`);
    assert.equal(looksLikeRoleArtifact(f), true, `保护集成员 ${id} 必须也被识别集认出`);
  }

  const diff = ALL_AGENT_IDS.filter((id) => !protectedIds.includes(id));
  assert.deepEqual(
    diff, [DEFAULT_DRIVER],
    '识别集与保护集的差集必须恰是当轮 Driver——多一个就是有角色的产出没人保护，少一个就是 Driver 交不了卷',
  );

  // 差集成员：识别得出来，但不受保护
  const driverFile = `2026-09-10-t-${DEFAULT_DRIVER}.md`;
  assert.equal(looksLikeRoleArtifact(driverFile), true, 'Driver 的产出仍是角色工件，归档要靠它算轮次');
  assert.equal(
    hasProtectedRoleSuffix(driverFile, DEFAULT_DRIVER), false,
    'Driver 的产出不受保护，否则它写不了自己的裁决件',
  );
});

/*
 * **当轮面真的按当轮算**（EV-68）。
 *
 * 上一条用例锁的是 `criticRoleSuffixes(driver)` 这个**源头**函数的参数契约，
 * 而 EV-68 的缺口根本不在源头——源头一直是对的，错在下游两处消费点
 * 把 driver 丢了（`hasCriticRoleSuffix` 不收参、`ROLE_SUFFIX_ANYWHERE` 模块级固化）。
 * 所以断言必须推到**消费点这一层**，否则换掉源头实现也照样绿。
 *
 * 文件名字面写死、不从 `criticRoleSuffixes(driver)` 反推：反推出来的是重言式
 * （与上一条用例注释里点破的是同一个坑）。
 */
test('当轮面按当轮 Driver 翻转：hasProtectedRoleSuffix 的两个方向', () => {
  // 方向①：codex 当 Driver 时，它自己的产出不受保护——否则它交不了卷
  assert.equal(
    hasProtectedRoleSuffix('2026-09-19-t-response-codex.md', 'codex'), false,
    '当轮 Driver 是 codex，-codex.md 是它自己的交卷文件，必须放行',
  );
  // 方向②：同一轮里 claude 是审核者，它的产出反而要保护
  assert.equal(
    hasProtectedRoleSuffix('2026-09-19-t-claude.md', 'codex'), true,
    '当轮 Driver 是 codex 时 claude 是审核者，Driver 不得伪造它的产出',
  );
  // 缺省 Driver 下两条结论恰好相反——这才说明判据真的随 driver 变，而不是常量
  assert.equal(hasProtectedRoleSuffix('2026-09-19-t-response-codex.md', DEFAULT_DRIVER), true);
  assert.equal(hasProtectedRoleSuffix('2026-09-19-t-claude.md', DEFAULT_DRIVER), false);
});

/*
 * **换一个当轮 Driver，保护集必须跟着翻转**（代码双审 AGY-04 ≡ GLM-03 ≡ CODEX-04）。
 *
 * `criticRoleSuffixes(driver)` 的 `driver` 参数曾被记成「M10 的预留接口」，而上一版
 * 全仓**零覆盖**：把它忽略掉、或把函数体写死成 `!== DEFAULT_DRIVER`，一条用例都不会红。
 * **该参数已于 M9 第 6 步前置真正接通**（EV-68）——接上的时点比原判断早了一个里程碑，
 * 因为第 5 步放开 `--driver` 之后，第 6 步验收当场就要用到它。
 *
 * 本条锁的是**源头**函数的参数契约。EV-68 的缺口不在源头（源头一直是对的），
 * 而在下游消费点把 driver 丢了，那一层由「当轮面按当轮 Driver 翻转」等用例锁。
 *
 * 这条断言不是重言式：它让同一个函数在两个不同入参下产出**不同**的集合，
 * 并检查翻转的方向对不对。
 */
test('换当轮 Driver：保护集与差集一起翻转（criticRoleSuffixes 的参数契约）', () => {
  const other = ALL_AGENT_IDS.find((id) => id !== DEFAULT_DRIVER)!;
  const swapped = criticRoleSuffixes(other);

  assert.ok(
    !swapped.includes(other),
    `换 Driver 之后 ${other} 应退出保护集——它成了执笔者，要能写自己的产出`,
  );
  assert.ok(
    swapped.includes(DEFAULT_DRIVER),
    `换 Driver 之后原 Driver ${DEFAULT_DRIVER} 应进入保护集——它此刻是审查员，产出只能由编排器落盘`,
  );

  const swappedDiff = ALL_AGENT_IDS.filter((id) => !swapped.includes(id));
  assert.deepEqual(swappedDiff, [other], '差集必须跟着当轮 Driver 走，而不是钉死在缺省值上');

  // 识别集不随 Driver 变：它问的是「像不像角色工件」，与谁执笔无关
  for (const id of [DEFAULT_DRIVER, other]) {
    assert.equal(
      looksLikeRoleArtifact(`2026-09-10-t-${id}.md`), true,
      `识别集与当轮 Driver 无关，${id} 的产出始终是角色工件`,
    );
  }
});

test('识别伪造审查文件：形态像 + 落在归档内', () => {
  const root = '/p';
  const archive = '/p/.reviews';

  assert.equal(isForgedRoleFile('/p/.reviews/t/plan/2026-09-10-t-gemini.md', root, archive, DEFAULT_DRIVER), true);
  assert.equal(isForgedRoleFile('.reviews/t/plan/2026-09-10-t-glm.md', root, archive, DEFAULT_DRIVER), true);
  assert.equal(isForgedRoleFile('2026-09-10-t-claude.md', root, archive, DEFAULT_DRIVER), false);

  /*
   * 有意的契约变更（2026-09-14 收窄，计划 D-4）：归档根之外的同形态文件不再拦。
   * 它们进不了 gate 的任何读取面，拦它没有防御价值，只会锁死 doc/ 下沿用
   * 「日期-主题-角色」命名的设计稿——本仓库自己就踩了很久。
   */
  assert.equal(
    isForgedRoleFile('doc/02_design/2026-09-10-t-glm.md', root, archive, DEFAULT_DRIVER),
    false,
    'doc/ 下的同形态设计稿应放行',
  );
  assert.equal(
    isForgedRoleFile('2026-09-10-t-glm.md', root, archive, DEFAULT_DRIVER),
    false,
    '项目根下的裸名文件不在归档内，应放行',
  );
});

test('判定路径是否在归档根内', () => {
  assert.equal(isInsideArchive('.reviews/t/plan/x.md', '/p', '/p/.reviews'), true);
  assert.equal(isInsideArchive('/p/.reviews/t/x.md', '/p', '/p/.reviews'), true);
  assert.equal(isInsideArchive('src/a.ts', '/p', '/p/.reviews'), false);
  assert.equal(isInsideArchive('/p/.reviews', '/p', '/p/.reviews'), false, '归档根自身不算「内部」');
});

test('判定归档内哪些文件由编排器独占（_meta/ 与 task.json）', () => {
  assert.equal(isOrchestratorOwned('.reviews/t/plan/_meta/review-gemini-R1.json', '/p', '/p/.reviews'), true);
  assert.equal(isOrchestratorOwned('/p/.reviews/t/task.json', '/p', '/p/.reviews'), true);
  assert.equal(isOrchestratorOwned('.reviews/t/plan/2026-09-10-t-revised-claude.md', '/p', '/p/.reviews'), false);
  assert.equal(isOrchestratorOwned('.reviews/t/plan/2026-09-10-t-claude.md', '/p', '/p/.reviews'), false);
  assert.equal(isOrchestratorOwned('src/task.json', '/p', '/p/.reviews'), false, '归档外的同名文件不算');
});

// ── hook-pre-write ──

test('Driver 不得写 _meta/ 与 task.json：它们是留痕核对的锚，与闸门状态无关', async () => {
  const ctx = await fakeCtx();
  // 没有任何闸门——该规则和伪造审查文件一样不受会话与 TTL 限制
  for (const p of [
    '.reviews/t/plan/_meta/review-gemini-R1.json',
    '.reviews/t/code/_meta/run-R1.json',
    '.reviews/t/task.json',
  ]) {
    const r = await hookPreWrite(ctx, writeInput(p));
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `${p} 应被拒`);
    assert.match(r.stderr ?? '', /编排器独占维护/);
  }
  // 裁决件与原稿照常放行
  assert.equal((await hookPreWrite(ctx, writeInput('.reviews/t/plan/2026-09-10-t-revised-claude.md'))).exitCode, EXIT.OK);
  assert.equal((await hookPreWrite(ctx, writeInput('.reviews/t/plan/2026-09-10-t-claude.md'))).exitCode, EXIT.OK);
});

test('伪造审查文件一律拒绝，不受会话与 TTL 限制', async () => {
  const ctx = await fakeCtx();
  // 完全没有闸门
  const r = await hookPreWrite(ctx, writeInput('.reviews/t/plan/2026-09-10-t-glm.md'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(r.stderr ?? '', /审查文档只能由编排器/);
  const j = r.json?.['hookSpecificOutput'] as Record<string, unknown>;
  assert.equal(j['permissionDecision'], 'deny');
});

test('本会话未审批闸门期间，写业务文件被拒并给出解除指引', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '登录重构', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookPreWrite(ctx, writeInput('src/auth/oidc.ts'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(r.stderr ?? '', /dual-approve --topic 登录重构 --stage plan/);
  assert.match(r.stderr ?? '', /dual-abandon/);
});

test('闸门期仍允许写归档（裁决件要写进去）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookPreWrite(ctx, writeInput('.reviews/t/plan/2026-09-10-t-revised-claude.md'));
  assert.equal(r.exitCode, EXIT.OK);
});

test('其它会话的闸门不拦本会话的业务写入（RV-05）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: 'S-OTHER', heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreWrite(ctx, writeInput('src/a.ts'))).exitCode, EXIT.OK);
});

test('闸门未记录会话 id（skill 默认路径）时业务写入照样被拦', async () => {
  const ctx = await fakeCtx();
  // 不传 sessionId：这正是 skill 里 `review --start` 不带 --session-id 时的真实形态
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', heartbeatStaleMs: STALE,
  });
  const r = await hookPreWrite(ctx, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, 'session_id 为 null 不能成为写锁失效的理由');
});

test('双审进行中也拦业务写入（就地模式下审查员在读真实工作树）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'running', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookPreWrite(ctx, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(r.stderr ?? '', /双审进行中/);
});

test('配置关闭写锁时不拦', async () => {
  const ctx = await fakeCtx();
  ctx.config.gate.block_business_write_when_awaiting_approval = false;
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreWrite(ctx, writeInput('src/a.ts'))).exitCode, EXIT.OK);
});

test('拿不到目标路径时放过（宁可放过也不误伤）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreWrite(ctx, { session_id: SESSION, tool_input: {} })).exitCode, EXIT.OK);
});

// ── hook-pre-bash（B5：Bash 是 hook-pre-write 的旁路）──

const bashInput = (command: string): HookInput => ({ session_id: SESSION, tool_name: 'Bash', tool_input: { command } });

test('写命令形态识别：重定向 / tee / sed -i / rm / git checkout 算写，只读命令不算', () => {
  for (const c of [
    'cat > src/a.ts <<EOF\nx\nEOF', 'echo x >> src/a.ts', 'printf x | tee src/a.ts', "sed -i '' s/x/y/ src/a.ts",
    'rm -rf src', 'mv a b', 'git checkout -- src/a.ts', 'git stash', 'npm install lodash', "python3 -c \"open('a','w').write('x')\"",
  ]) assert.equal(looksLikeWriteCommand(c), true, `应判为写：${c}`);
  for (const c of [
    'git status', 'git diff HEAD', 'npm test', 'npm run build 2>&1 | tail', 'grep -rn foo src', 'ls -la', 'cat src/a.ts',
    'echo hi > /dev/null', 'node --test dist/test', 'git log --oneline | head',
  ]) assert.equal(looksLikeWriteCommand(c), false, `不该判为写：${c}`);
});

test('looksLikeWriteCommand 保留剥离语义：heredoc 正文是数据不是命令', () => {
  const script = "python3 - <<'PY'\nimport pathlib\np = pathlib.Path('x')\ns = \"await fs.writeFile(f, 'rm -rf src'); // 2026-09-12-t-gemini.md\"\nPY";
  assert.equal(looksLikeWriteCommand(script), false, '本项目实施过程中就被这条误报拦过');
  // heredoc 之外的真实写命令照样识别
  assert.equal(looksLikeWriteCommand("cat <<'EOF' > src/a.ts\nx\nEOF"), true);
  assert.equal(looksLikeWriteCommand("python3 - <<'PY'\nprint(1)\nPY\nrm -rf src"), true);
});

test('GLM-03：hookPreBash 在未剥离的原文上判，heredoc 里写保护对象必须被拦', async () => {
  const ctx = await fakeCtx();
  // 攻击形态：一条 heredoc 把审查结论改成空 findings，再配空裁决表过闸
  const attack = "python3 - <<'PY'\nimport json, pathlib\np = pathlib.Path('.reviews/t/code/_meta/review-glm-R1.json')\np.write_text(json.dumps({'findings': []}))\nPY";
  const r = await hookPreBash(ctx, bashInput(attack));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, 'heredoc 正文指向 _meta 必须拦');
  assert.match(r.stderr ?? '', /编排器独占/);
  // state.json 同理
  const attack2 = "python3 - <<'PY'\nopen('.trivium/state.json','w').write('{\"gates\":[]}')\nPY";
  assert.equal((await hookPreBash(ctx, bashInput(attack2))).exitCode, EXIT.GATE_BLOCK);
  // 正文不涉保护对象、又没有闸门 → 仍然放行（误拦面只覆盖保护对象与闸门期）
  const benign = "python3 - <<'PY'\ns = \"await fs.writeFile(f, 'x')\"\nPY";
  assert.equal((await hookPreBash(ctx, bashInput(benign))).exitCode, EXIT.OK);
});

test('GLM-03：闸门期不剥 heredoc，正文里的写命令一并拦下', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: '登录重构', stage: 'plan', state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE });
  const script = "python3 - <<'PY'\nopen('src/auth/oidc.ts','w').write('x')\nPY";
  assert.equal((await hookPreBash(ctx, bashInput(script))).exitCode, EXIT.GATE_BLOCK);
});

test('AGY-01：主题名含 ASCII s 时保护不得失效（原正则蜕化为 [^s]*）', async () => {
  const ctx = await fakeCtx();
  for (const topic of ['session', 'auth_service', 'user_status', 'skills', '审核修复']) {
    for (const c of [
      `echo {} > .reviews/${topic}/code/_meta/review-glm-R1.json`,
      `sed -i '' s/x/y/ .reviews/${topic}/code/_meta/run-R1.json`,
      `echo {} > .reviews/${topic}/task.json`,
    ]) {
      const r = await hookPreBash(ctx, bashInput(c));
      assert.equal(r.exitCode, EXIT.GATE_BLOCK, `主题 ${topic} 应拦：${c}`);
    }
  }
});

test('GLM-04：cd 归一化后的相对路径与不带尾斜杠的 _meta 目录本身都受保护', async () => {
  const ctx = await fakeCtx();
  for (const c of [
    'cd .reviews && echo {} > t/plan/_meta/run-R1.json',   // 写段不含 .reviews 前缀
    'cd .reviews/t/plan && rm -rf _meta',                   // 裸目录名
    'echo {} > .reviews/t/plan/_meta',                      // 指向 _meta 本身，无尾斜杠
    'rm -rf .reviews',                                      // 整个归档根
  ]) {
    const r = await hookPreBash(ctx, bashInput(c));
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `应拦：${c}`);
  }
});

test('AGY-03：.trivium 与 wrapper 目录受保护（删掉它等于一次性解除全部 Hook）', async () => {
  const ctx = await fakeCtx();
  for (const c of [
    'rm -rf .trivium',
    'rm -rf .trivium/bin',
    'chmod -x .trivium/bin/trivium',
    'mv .trivium/bin/trivium /tmp/x',
  ]) {
    const r = await hookPreBash(ctx, bashInput(c));
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `应拦：${c}`);
    assert.match(r.stderr ?? '', /编排器独占/);
  }
  // 项目内其它文件不受影响
  assert.equal((await hookPreBash(ctx, bashInput('rm -rf dist'))).exitCode, EXIT.OK);
});

test('闸门期用 Bash 改工作树被拦，并说明这是启发式与解除办法', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: '登录重构', stage: 'plan', state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE });
  const r = await hookPreBash(ctx, bashInput('cat > src/auth/oidc.ts <<EOF\nx\nEOF'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(r.stderr ?? '', /启发式/);
  assert.match(r.stderr ?? '', /dual-approve --topic 登录重构/);
  // 只读命令照常
  assert.equal((await hookPreBash(ctx, bashInput('npm test'))).exitCode, EXIT.OK);
});

test('没有闸门时 Bash 写命令放行；但指向审查文档 / _meta / state.json 的写命令任何时候都拦', async () => {
  const ctx = await fakeCtx();
  assert.equal((await hookPreBash(ctx, bashInput('cat > src/a.ts'))).exitCode, EXIT.OK);
  for (const c of [
    'cat > .reviews/t/plan/2026-09-12-t-gemini.md',
    'echo {} > .reviews/t/plan/_meta/review-gemini-R1.json',
    'echo {} > .reviews/t/task.json',
    'echo x > .trivium/state.json',
    'rm -rf .trivium/lock',
  ]) {
    const r = await hookPreBash(ctx, bashInput(c));
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `应拦：${c}`);
    assert.match(r.stderr ?? '', /编排器独占/);
  }
});

test('拿不到命令行或不是 Bash 事件 → 放行', async () => {
  const ctx = await fakeCtx();
  assert.equal((await hookPreBash(ctx, { session_id: SESSION, tool_name: 'Bash' })).exitCode, EXIT.OK);
  assert.equal((await hookPreBash(ctx, { session_id: SESSION, tool_name: 'Write', tool_input: { command: 'rm -rf x' } })).exitCode, EXIT.OK);
});

test('RV-B1（已撤回）：借 git commit 夹带的五类形态，任何时候都不得绕过保护集', async () => {
  const ctx = await fakeCtx();
  /*
   * 2026-09-12 曾加过「整条命令就是一次 git commit 即豁免保护集扫描」的例外（RV-B1），
   * 被双审打穿后撤回（11 条意见全部接受，留痕见 .reviews/RV-B1-commit豁免/）。
   * 下面五类是当时实测能放行的夹带路径，现在全部锁成负例——
   * 谁再想开这个口子，这一组会当场红。
   *
   * 撤回的理由不是「前置条件不够多」，而是方向错了：原判定 fail-closed（看见字面就拦），
   * 豁免把它变成需要穷举危险形态的 fail-open，而 shell 的攻击面穷举不完。
   */
  for (const [c, why] of [
    // ① 换行：分段正则不含 \n，但 shell 把换行当分隔符照常执行（AGY-r2-01 / GLM-r2-01）
    ['git commit -m x\nrm .reviews/t/plan/a-gemini.md', '换行后接写命令'],
    ['git commit -m x\r\necho {} > .reviews/t/plan/_meta/run-R1.json', 'CRLF 换行'],
    // ② 附着重定向：重定向符不是分段字符，目标可被截断/创建（GLM-r2-02，Gemini 未发现）
    ['git commit -m x > .reviews/t/plan/a-glm.md', '重定向截断审查文档'],
    ['git commit -m x >> .reviews/t/plan/_meta/review-glm-R1.json', '追加写 _meta'],
    // ③ 文本提及：根本不是 commit，只因文本里出现 git 与 commit（AGY-r2-04 / GLM-r2-03）
    ['echo 记得 git commit > .reviews/t/plan/_meta/review-glm-R1.json', '文本提及 + 重定向'],
    ['cp /tmp/fake.md .reviews/t/code/a-glm.md # 之后记得 git commit', '注释伪装'],
    ['sh -c "rm .reviews/t/plan/a-gemini.md" git commit', 'sh -c 前缀 + git commit 尾随'],
    // ④ 配置 / 环境注入：git 会经 shell 执行 editor（AGY-r2-03 / GLM-r2-04）
    ['git -c core.editor="rm .reviews/t/plan/a-gemini.md" commit --allow-empty', '-c core.editor 注入'],
    ['GIT_EDITOR="rm .reviews/t/plan/a-glm.md" git commit --allow-empty', 'GIT_EDITOR 前缀'],
    // ⑤ 进程替换：替换体在子进程真实执行（AGY-r2-02 / GLM-r2-05）
    ['git commit -F <(rm .reviews/t/plan/a-gemini.md)', '进程替换'],
    // 原本就该拦的复合与替换形态，一并留住
    ['git commit -m x && rm .reviews/t/plan/a-gemini.md', '复合段'],
    ['git commit -m "$(rm .reviews/t/plan/a-gemini.md)"', '命令替换'],
    ["git commit -F - <<'EOF'\n改 .reviews/t/plan/_meta/run-R1.json\nEOF", 'heredoc'],
    ['git checkout -- .reviews/t/plan/_meta', 'git checkout'],
    /*
     * ⑥ 2026-09-14 收窄时新增的形态（计划 §5）。前两条是收窄方案两度栽过的地方：
     *    token 尾随 `)` / `,w)` 时 basename 不匹配 `$` 锚定的后缀正则，
     *    若以「basename 匹配」为介入条件就会直接放行——故介入必须用宽口径。
     */
    ['python3 -c "open(\'.reviews/t/plan/a-gemini.md\',\'w\')"', '单行 python 写归档件'],
    ['node -e "require(\'fs\').writeFileSync(\'.reviews/t/plan/a-glm.md\',\'x\')"', '单行 node 写归档件'],
    /*
     * ⑦ 搬运式伪造（GLM-r2-02）：后缀在**源** token（归档外，本身可放行），
     *    归档在**目录** token（无后缀、不介入）。两头都躲开判定，伪审查件就落进
     *    阶段目录——而 listStageArtifacts 按文件名清点、checkStageArtifacts 据此
     *    判「审查件在位」，留痕与 --check-artifacts 双双被伪造，git 锚对未跟踪
     *    新增文件还失明。收窄前靠整条文本正则拦住，收窄后必须靠条件 (d) 自己站稳。
     */
    ['cp doc/2026-09-14-t-gemini.md .reviews/t/plan/', 'cp 搬运：后缀在源'],
    ['mv doc/2026-09-14-t-glm.md .reviews/t/plan/', 'mv 搬运：后缀在源'],
    ['install doc/2026-09-14-t-gemini.md .reviews/t/plan/x.md', 'install 搬运'],
    ['rsync doc/2026-09-14-t-glm.md .reviews/t/plan/', 'rsync 搬运'],
    // ⑧ 定位不出当前目录时不得放行
    ['cd $UNKNOWN && rm 2026-09-14-t-glm.md', 'cwd 推断不出'],
  ] as const) {
    const r = await hookPreBash(ctx, bashInput(c));
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `应拦（${why}）：${c}`);
    assert.match(r.stderr ?? '', /编排器独占/);
  }
});

test('Bash 侧不随 Write 侧收窄：命令文本出现角色后缀一律拦', async () => {
  /*
   * 收窄尝试经三轮双审打穿后撤回（详见 hooks.ts 的长注释）。压垮它的是
   * 「收窄创设了新系统状态」——doc/ 下从此可合法存在同形态文件，于是
   * `cp -R doc/ .reviews/t/plan/` 这类全程不含后缀字样的搬运成为新通道，
   * 以字面量为介入信号的规则结构性失效。
   *
   * 这里锁死「Bash 侧维持字面拦」的现状：误拦有 Write/Edit 出口，
   * 漏拦则伪审查件直接落进阶段目录。
   */
  const ctx = await fakeCtx();
  for (const [c, why] of [
    ['git mv doc/2026-09-14-t-glm.md doc/2026-09-14-t.md', '归档外改名也拦（有 Write 出口）'],
    ['sed -i "" s/a/b/ doc/02_design/2026-09-14-t-gemini.md', '归档外就地编辑也拦'],
    ['cp doc/x-gemini.md .reviews/t/plan/', '搬运式伪造'],
    ['D=.reviews/t/plan; cp doc/x-glm.md $D/', '变量承载归档路径'],
    ['cp doc/x-glm.md ~/Work/TriviumCode/.reviews/t/plan/', '~ 展开后落进归档'],
  ] as const) {
    const r = await hookPreBash(ctx, bashInput(c));
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `应拦（${why}）：${c}`);
  }
});

test('收窄后：Write 侧对 doc/ 放行、对归档内仍拦', async () => {
  const ctx = await fakeCtx();
  const inDoc = await hookPreWrite(ctx, writeInput('doc/02_design/2026-09-14-t-glm.md'));
  assert.equal(inDoc.exitCode, EXIT.OK, 'doc/ 下的设计稿应可写');

  const inArchive = await hookPreWrite(ctx, writeInput('.reviews/t/plan/2026-09-14-t-glm.md'));
  assert.equal(inArchive.exitCode, EXIT.GATE_BLOCK, '归档内的审查件仍不许伪造');
});

test('软链：两个方向都拦得住', async () => {
  const ctx = await fakeCtx();
  const archive = ctx.archiveRoot;
  await fs.mkdir(path.join(archive, 't/plan'), { recursive: true });
  await fs.mkdir(path.join(ctx.projectRoot, 'doc'), { recursive: true });

  // ① 归档外的软链指向归档内：realpath 落在归档内 → 拦
  const realArtifact = path.join(archive, 't/plan/2026-09-14-t-gemini.md');
  await fs.writeFile(realArtifact, '# real\n');
  const linkInDoc = path.join(ctx.projectRoot, 'doc/2026-09-14-t-gemini.md');
  await fs.symlink(realArtifact, linkInDoc);
  assert.equal(
    isForgedRoleFile(linkInDoc, ctx.projectRoot, archive, DEFAULT_DRIVER),
    true,
    'doc/ 下指向归档内的软链，Write 会沿链覆写真审查件',
  );

  // ② 归档内的软链指向归档外：词法在归档内 → 仍拦
  const outside = path.join(ctx.projectRoot, 'outside.md');
  await fs.writeFile(outside, '# outside\n');
  const linkInArchive = path.join(archive, 't/plan/2026-09-14-t-glm.md');
  await fs.symlink(outside, linkInArchive);
  assert.equal(
    isForgedRoleFile(linkInArchive, ctx.projectRoot, archive, DEFAULT_DRIVER),
    true,
    '归档内的路径不因软链指向外部而被放行',
  );
});

test('归档根不可解析时，归档内的后缀写入仍被拦', async () => {
  /*
   * 审查意见 GLM-r2-03：realpath 失败若让异常外泄，runHook 的兜底 catch 会
   * return ALLOW、或走 EXIT.FAIL=1（hooks.json 约定「1 = 非阻断」）——两条都是
   * 静默放行。这里的夹具没有真建 .reviews/，realpathSync 必然 ENOENT。
   */
  const ctx = await fakeCtx();
  assert.equal(await exists(ctx.archiveRoot), false, '前置：归档根不存在');

  assert.equal(
    isForgedRoleFile('.reviews/t/plan/2026-09-14-t-gemini.md', ctx.projectRoot, ctx.archiveRoot, DEFAULT_DRIVER),
    true,
    '归档根解析不出时应退化为词法比较，而不是放行',
  );

  const r = await hookPreWrite(ctx, writeInput('.reviews/t/plan/2026-09-14-t-glm.md'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

test('悬空软链：指向归档内尚未创建的文件，仍被拦', async () => {
  /*
   * 审查意见 AGY-02。realpathSync 对悬空软链同样抛 ENOENT，若直接进回溯逻辑，
   * 这条软链会被当成「doc 下一个还不存在的普通文件」而放行——
   * 而 Write 会沿链把文件在归档内创建出来。
   */
  const ctx = await fakeCtx();
  await fs.mkdir(path.join(ctx.projectRoot, 'doc'), { recursive: true });
  await fs.mkdir(path.join(ctx.archiveRoot, 't/plan'), { recursive: true });

  const notYetCreated = path.join(ctx.archiveRoot, 't/plan/2026-09-14-t-gemini.md');
  const dangling = path.join(ctx.projectRoot, 'doc/2026-09-14-t-gemini.md');
  await fs.symlink(notYetCreated, dangling);
  assert.equal(await exists(notYetCreated), false, '前置：目标确实还不存在');

  assert.equal(
    isForgedRoleFile(dangling, ctx.projectRoot, ctx.archiveRoot, DEFAULT_DRIVER),
    true,
    '悬空软链的落点在归档内，必须拦',
  );
  const r = await hookPreWrite(ctx, writeInput(dangling));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

// ── 当轮 Driver 解析（EV-68）──

/**
 * 在夹具归档里落一份**合法的** `trivium.run.v2` 运行留痕。
 *
 * 用写侧 `newRunMeta` 而不是手写字面量：手写夹具会与写侧各自漂移，
 * 而 `readRunMeta` 会对 v2 做 schema 校验，形状不合就返回 null——
 * 那时用例会以「留痕损坏」的形态绿/红，测的就不是本意了（与 archive.test.ts 同款理由）。
 */
async function seedRunMeta(
  ctx: Ctx, topic: string, stage: 'plan' | 'code' | 'bug', runId: string, driver: AgentId,
): Promise<void> {
  const dir = path.join(ctx.archiveRoot, topic, stage, '_meta');
  await fs.mkdir(dir, { recursive: true });
  const meta = newRunMeta({
    runId, topic, stage, rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: ['gemini', 'glm'],
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's',
    denyPaths: [], driftPolicy: 'warn', driver,
  });
  await fs.writeFile(path.join(dir, `run-${runId}.json`), JSON.stringify(meta));
}

test('方向①：非缺省 Driver 写得出自己的裁决件', async () => {
  const ctx = await fakeCtx();
  await seedRunMeta(ctx, 't', 'code', 'R1', 'codex');
  const f = path.join(ctx.archiveRoot, 't/code/2026-09-19-t-response-codex.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(r.exitCode, EXIT.OK, 'codex 是当轮 Driver，-codex.md 是它的交卷文件，必须放行');
});

test('方向②：当轮 Driver 不得伪造审核者产出（claude 此轮是审核者）', async () => {
  const ctx = await fakeCtx();
  await seedRunMeta(ctx, 't', 'code', 'R1', 'codex');
  const f = path.join(ctx.archiveRoot, 't/code/2026-09-19-t-claude.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, 'claude 此轮是审核者，Driver 不得手写它的产出');
});

/*
 * **陈旧闸门项不得影响判定**（计划双审 CODEX-01 ≡ AGY-01）。
 *
 * 这是本步最重要的一条断言。上一版计划把 `state.json` 的 `GateEntry.driver`
 * 定为第 1 级来源，而 `review.ts` 的四处 `setGateChecked` 全都不传 driver，
 * 唯一写它的两处以「裁决件已落盘」为前置——Driver 写裁决件正发生在那之前。
 * 叠加 `setGate` upsert「沿用前一条的值」，同槽位重跑换 Driver 时闸门项里
 * 留着的是**上一轮**的 driver。若判定采信它，方向①当场反向。
 */
test('陈旧闸门项不影响当轮判定：留痕说了算', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'code', state: 'idle',
    runId: 'R0', driver: 'claude', heartbeatStaleMs: STALE,
  });
  await seedRunMeta(ctx, 't', 'code', 'R1', 'codex');

  const f = path.join(ctx.archiveRoot, 't/code/2026-09-19-t-response-codex.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(
    r.exitCode, EXIT.OK,
    '闸门项记着上一轮的 claude，本轮留痕记的是 codex——判定必须按留痕走，否则 Driver 交不了卷',
  );
});

/*
 * **归档外软链 + 非缺省 Driver**：定位阶段必须与 `isInsideArchiveResolved` 同口径。
 *
 * 这条锁的是 `locateArchiveTarget` 里那条 realpath 回退分支的**必要性**。
 * 软链的词法路径在 `doc/` 下，只试词法必然定位落空、回落缺省 Driver，
 * 于是 `-claude.md` 被判成「Driver 自己的产出」而放行——而当轮 Driver 其实是 codex，
 * claude 是审核者。既有的悬空软链用例锁不住这一格：它用的是 `-gemini.md`，
 * 在缺省保护集内，两种实现都会拦（变异实跑验证过）。
 */
test('归档外软链指向归档内：当轮 Driver 仍按落点所属阶段的留痕判定', async () => {
  const ctx = await fakeCtx();
  await fs.mkdir(path.join(ctx.projectRoot, 'doc'), { recursive: true });
  await fs.mkdir(path.join(ctx.archiveRoot, 't/code'), { recursive: true });
  await seedRunMeta(ctx, 't', 'code', 'R1', 'codex');

  const real = path.join(ctx.archiveRoot, 't/code/2026-09-19-t-claude.md');
  await fs.writeFile(real, 'x');
  const link = path.join(ctx.projectRoot, 'doc/2026-09-19-t-claude.md');
  await fs.symlink(real, link);

  const r = await hookPreWrite(ctx, writeInput(link));
  assert.equal(
    r.exitCode, EXIT.GATE_BLOCK,
    '落点在 code 阶段、该阶段留痕记的 Driver 是 codex，故 -claude.md 是审核者产出，必须拦',
  );
});

/*
 * 回落两条**成对**出现才钉得住「按缺省 Driver 判定」（计划双审 GLM-02）。
 * 只有正向那条时，「回落到缺省」与「取不到就放行一切」不可区分。
 */
test('回落·正：该阶段无留痕时，缺省 Driver 的产出放行', async () => {
  const ctx = await fakeCtx();
  await fs.mkdir(path.join(ctx.archiveRoot, 't/plan'), { recursive: true });
  const f = path.join(ctx.archiveRoot, 't/plan/2026-09-19-t-claude.md');
  assert.equal((await hookPreWrite(ctx, writeInput(f))).exitCode, EXIT.OK);
});

test('回落·负：该阶段无留痕时，非缺省角色的后缀仍被拦', async () => {
  const ctx = await fakeCtx();
  await fs.mkdir(path.join(ctx.archiveRoot, 't/plan'), { recursive: true });
  const f = path.join(ctx.archiveRoot, 't/plan/2026-09-19-t-codex.md');
  assert.equal(
    (await hookPreWrite(ctx, writeInput(f))).exitCode, EXIT.GATE_BLOCK,
    '回落是「按缺省 Driver 判定」，不是「放行一切」',
  );
});

/*
 * 留痕存在却一份都读不出来 → **硬失败**，与 `cmdGate` 同口径
 * （计划双审 CODEX-06 ≡ AGY-04）：那是「留痕坏了」，不能判成「按缺省 Driver 算」。
 */
test('留痕损坏：不按缺省 Driver 继续，硬失败', async () => {
  const ctx = await fakeCtx();
  const dir = path.join(ctx.archiveRoot, 't/code/_meta');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'run-R1.json'), '{ not valid run meta }');

  /*
   * 目标**必须**取缺省 Driver 自己的后缀。
   *
   * 第一版这里写的是 `-response-codex.md`，而那条断言**没有鉴别力**：
   * 若实现退化成「留痕坏了就按缺省 Driver 判」，`-codex.md` 在缺省保护集内，
   * 照样退 2，用例照样绿（变异实跑验证过）——两种实现殊途同归，什么也没证明。
   * 这正是本轮 GLM-02 点出的那一族问题，换成 `-claude.md` 才能区分：
   *   · 正确实现（硬失败）→ 退 2
   *   · 退化实现（按缺省判）→ `-claude.md` 不在缺省保护集内 → 退 0
   */
  const f = path.join(ctx.archiveRoot, 't/code/2026-09-19-t-claude.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(
    r.exitCode, EXIT.GATE_BLOCK,
    '留痕坏了就判不出当轮 Driver，不能按缺省继续——那会把「留痕坏了」判成「按缺省算」',
  );
  assert.match(
    JSON.stringify(r.json), /读不出来/,
    '文案要说清是留痕坏了，而不是让人以为自己写错了文件名',
  );
});

/*
 * **归档外与非角色后缀的写入，退出码不因本步新增的读取而改变**（计划双审 CODEX-05）。
 *
 * 关掉写锁的项目今天在业务写入前根本不读任何状态文件。若把 driver 解析写在
 * 函数开头，一个坏掉的 state.json 会让这些写入从退 0 变退 2。
 */
test('非角色工件的写入不触发当轮 Driver 解析，退出码不变', async () => {
  const ctx = await fakeCtx();
  ctx.config.gate.block_business_write_when_awaiting_approval = false;

  /*
   * 夹具里**必须**种一份读不出的留痕，否则这条用例没有鉴别力（代码双审 CODEX-05 ≡ GLM-03）。
   *
   * 第一版写的是「空归档 + 写 src/a.ts，断言退 0」——把 `resolveRoundDriver` 无条件提到
   * 函数开头，那条路径也只会拿到 `scanned === 0` → 缺省 Driver → 后缀不匹配 → 退 0，
   * 用例照绿。能让它红的只有「无条件 deny」这种不现实的退化，而它要防的回归
   * （短路被拆掉、无关写入开始读留痕）恰好不会让它红。
   *
   * 种了损坏留痕之后：短路正确 ⇒ 压根不读 ⇒ ALLOW；解析若被前置 ⇒ 撞 corrupt ⇒ 退 2。
   * 目标取归档**内**的非角色工件，这样连「归档外」那一支都绕开，锁的就是后缀这一支。
   */
  const dir = path.join(ctx.archiveRoot, 't/code/_meta');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'run-RBAD.json'), '{ not valid run meta }');

  const notes = path.join(ctx.archiveRoot, 't/code/notes.txt');
  assert.equal((await hookPreWrite(ctx, writeInput(notes))).exitCode, EXIT.OK);

  // 归档外的普通业务文件同理
  const biz = path.join(ctx.projectRoot, 'src/a.ts');
  assert.equal((await hookPreWrite(ctx, writeInput(biz))).exitCode, EXIT.OK);
});

/*
 * **较新的留痕读不出时不得退回更旧的那一份**（代码双审 GLM-01 ≡ CODEX-01）。
 *
 * `latestRunMeta` 是 newest-first、取第一份可读者，所以「最新那份坏了、上一份能读」
 * 会正常返回一个 meta——那是**上一轮**的 Driver。采信它，本步否掉 `state.json`
 * 闸门项时列的两条后果会原样重现，只是换成留痕版。
 */
test('较新留痕损坏：不退回上一轮 Driver，硬失败', async () => {
  const ctx = await fakeCtx();
  // 旧的一份可读、记 codex；新的一份坏掉（run id 字典序更大 = 更新）
  await seedRunMeta(ctx, 't', 'code', 'R1', 'codex');
  await fs.writeFile(
    path.join(ctx.archiveRoot, 't/code/_meta', 'run-R2.json'), '{ broken }',
  );

  /*
   * 目标取 `-response-codex.md`：退回上一轮（codex）会**放行**，硬失败则退 2。
   * 若这里取 `-claude.md`，退回 codex 同样会拦，两种实现殊途同归——
   * 与本文件另外两条用例踩过的是同一个坑。
   */
  const f = path.join(ctx.archiveRoot, 't/code/2026-09-19-t-response-codex.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, '最新一份读不出来就判不了当轮身份，不能退回上一轮');
  assert.match(JSON.stringify(r.json), /R2/, '文案要点名是哪几份读不出来');
});

/*
 * **阶段目录是软链（合法阶段名）时按落点那一侧的留痕判定。**
 *
 * 夹具取 `t/plan -> t/code`——**阶段名必须合法**。第 1 版用的是 `t/mirror`，
 * 而 `mirror` 不在 STAGES 里，`stageSegmentsUnder` 的白名单守卫直接返回 null，
 * 词法分支压根不命中、必然回退 realpath：那条用例测的不是它声称的机制
 * （第 2 轮代码双审 CODEX-02 指出）。
 */
test('阶段目录是软链：按落点所在阶段的留痕判定', async () => {
  const ctx = await fakeCtx();
  await seedRunMeta(ctx, 't', 'code', 'R1', 'codex');

  // t/plan -> t/code（真实目录只有 code；此格下词法侧的 _meta 会沿同一条软链落到同一处）
  await fs.symlink(path.join(ctx.archiveRoot, 't/code'), path.join(ctx.archiveRoot, 't/plan'));

  const f = path.join(ctx.archiveRoot, 't/plan/2026-09-19-t-claude.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(
    r.exitCode, EXIT.GATE_BLOCK,
    '落点实际在 code 阶段、该阶段 Driver 是 codex，故 -claude.md 是审核者产出',
  );
});

/*
 * **文件级软链：两种解析顺序在这里真的不等价**（第 2 轮 AGY-01 ≡ CODEX-02）。
 *
 * 第 1 轮我把 realpath 优先判成「表达性修正、无可观测差异」——错了。
 * 这一格两个阶段各有自己的 `_meta`（不像阶段目录软链那样是同一个物理目录），
 * 于是词法定位 `t/plan`、realpath 定位 `t/code`，读到的是**不同的留痕**。
 *
 * 词法优先会按 plan 的 Driver（claude）判 `-claude.md` 为「Driver 自己的产出」而放行，
 * 写入却沿软链落到 code 阶段，覆写那一阶段受保护的审核者产出。
 * **把 `locateArchiveTarget` 改回词法优先，本用例必红**——这才是它的鉴别力。
 */
test('文件级软链跨阶段：按 realpath 侧的阶段判定，不按词法侧', async () => {
  const ctx = await fakeCtx();
  await seedRunMeta(ctx, 't', 'plan', 'R1', DEFAULT_DRIVER); // plan 阶段 Driver = claude
  await seedRunMeta(ctx, 't', 'code', 'R1', 'codex');        // code 阶段 Driver = codex

  const real = path.join(ctx.archiveRoot, 't/code/2026-09-19-t-claude.md');
  await fs.writeFile(real, 'x');
  const link = path.join(ctx.archiveRoot, 't/plan/2026-09-19-t-claude.md');
  await fs.symlink(real, link);

  const r = await hookPreWrite(ctx, writeInput(link));
  assert.equal(
    r.exitCode, EXIT.GATE_BLOCK,
    '写入实际落在 code 阶段，该阶段 Driver 是 codex ⇒ -claude.md 是审核者产出，必须拦',
  );
});

/*
 * **归档内软链指向归档外：不得采信归档外的留痕**（第 2 轮 GLM-01，major）。
 *
 * 这是「按留痕定 driver」引入的通道，构造实测复现过：
 * 归档外预置一份合法 run 留痕（driver 任选）→ 把它软链成归档内的一个阶段目录 →
 * 写该阶段下的审核者后缀文件。若 `locateArchiveTarget` 在 realpath 落到归档外时
 * **回落词法定位**，`latestRunMeta` 就会沿软链读到攻击者的留痕，
 * 保护集变成「全集减攻击者自选的 driver」，伪件放行。
 *
 * 改动前不存在这条路：那时保护集是静态的、与留痕无关。
 * 去掉 `locateArchiveTarget` 里的归档内守卫，本用例必红。
 */
test('归档内阶段目录软链指向归档外：伪留痕不得被采信', async () => {
  const ctx = await fakeCtx();

  // 归档外的伪留痕：声称当轮 Driver 是 glm，好让 -glm.md 变成「Driver 自己的产出」
  const outside = path.join(ctx.projectRoot, 'doc/evil');
  await fs.mkdir(path.join(outside, '_meta'), { recursive: true });
  await fs.writeFile(
    path.join(outside, '_meta', 'run-EVIL.json'),
    JSON.stringify(newRunMeta({
      runId: 'EVIL', topic: 't2', stage: 'code', rerunIndex: 1, command: 'x',
      promptHint: null, taskGoal: null, criticsSelected: ['gemini'],
      treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's',
      denyPaths: [], driftPolicy: 'warn', driver: 'glm',
    })),
  );

  await fs.mkdir(path.join(ctx.archiveRoot, 't2'), { recursive: true });
  await fs.symlink(outside, path.join(ctx.archiveRoot, 't2/code'));

  const f = path.join(ctx.archiveRoot, 't2/code/2026-09-19-t2-glm.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(
    r.exitCode, EXIT.GATE_BLOCK,
    'driver 的来源不得被软链引出归档根——落在归档外即按缺省 Driver 判定，glm 仍在保护集内',
  );
});

test('父目录尚不存在的合法新建不被误杀', async () => {
  // 审查意见 AGY-r2-02：ENOENT 就判「归档内」会锁死 doc/ 下新建子目录的写入
  const ctx = await fakeCtx();
  assert.equal(
    isForgedRoleFile('doc/new_sub/2026-09-14-t-glm.md', ctx.projectRoot, ctx.archiveRoot, DEFAULT_DRIVER),
    false,
  );
});

test('RV-B1 边界：git add 本就不在 WRITE_LIKE 里，与撤回的豁免无关', async () => {
  const ctx = await fakeCtx();
  /*
   * `git add` 不是写命令形态（它只动索引，不创建也不修改文件），`hookPreBash` 在
   * `writeLike` 那一关就放行了，压根到不了保护集判定——这是**既有行为**，
   * 与 RV-B1 的加入和撤回都无关。
   * 防线不在这里：伪造 `-gemini.md` 必须先写出来，而写这一步（Edit/Write 与 Bash 写命令）
   * 两条路都拦；真把它提交进去则由 hookPreCommit 的留痕完整性锚兜住。
   */
  assert.equal((await hookPreBash(ctx, bashInput('git add .reviews/t/plan/a-gemini.md'))).exitCode, EXIT.OK);
});

// ── hook-pre-commit（AGY-03：作用域）──

test('无活跃流水线主题时，日常 git commit 放行（AGY-03）', async () => {
  const ctx = await fakeCtx();
  assert.equal((await hookPreCommit(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

test('本会话有未裁决阶段时拦提交并说明缺什么', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '登录重构', stage: 'code',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookPreCommit(ctx, { session_id: SESSION });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(r.stderr ?? '', /登录重构\/code/);
  assert.match(r.stderr ?? '', /gate\.block_commit: false/, '应告知如何关闭');
});

test('未裁决即拦提交，**不分会话**（审查意见 AGY-05）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'code',
    state: 'review_done_awaiting_disposition', sessionId: 'S-OTHER', heartbeatStaleMs: STALE,
  });
  /*
   * 写锁按会话是 RV-05 的刻意设计（避免跨会话误伤），但「裁决是否齐备」是
   * **仓库的属性、不是会话的属性**——换个会话、或直接在终端里 git commit，
   * 未裁决的意见并不会因此变成已裁决。旧行为在这里放行，等于留了一条
   * 「换个会话就能提交」的绕过路径。
   */
  assert.equal((await hookPreCommit(ctx, { session_id: SESSION })).exitCode, EXIT.GATE_BLOCK);
  // 连 session_id 都没有（纯终端提交）同样拦
  assert.equal((await hookPreCommit(ctx, {})).exitCode, EXIT.GATE_BLOCK);
});

test('等待审批的闸门不拦提交（那不是「裁决未完成」）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreCommit(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

test('block_commit=false 时不拦', async () => {
  const ctx = await fakeCtx();
  ctx.config.gate.block_commit = false;
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'code',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreCommit(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

// ── hook-pre-commit：_meta/ 位置判据（M10a 第 2 步 EV-55 §3.1.2，§3.3）──

/**
 * 这一族此前**完全没有测试**（`immutableChangeReason` / `checkArchiveIntegrity`
 * 只在 `hookPreCommit` 内部私有调用，仓库里此前没有一条用例真的提交过、
 * 又改动过一份 `_meta/` 工件）。判据从「后缀枚举」改成「位置」之后，
 * 这里补上最有价值的那几格：一种**旧枚举压根不认识**的新 `_meta` 文件类型、
 * 两个排除项（`changes.diff` 便利副本、`running` 态 `run-*.json`）。
 */
async function gitCtx(): Promise<Ctx> {
  const ctx = await fakeCtx();
  await initFixtureRepo(ctx.projectRoot);
  return ctx;
}

async function commitAll(root: string, message: string): Promise<void> {
  await run('git', ['add', '-A'], { cwd: root });
  await run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message, '--no-verify'], {
    cwd: root,
  });
}

test('_meta/ 下一种旧枚举不认识的新工件类型：提交后改动即拦（判据从后缀改成位置）', async () => {
  const ctx = await fakeCtx();
  const metaDir = path.join(ctx.archiveRoot, 'T', 'plan', '_meta');
  await fs.mkdir(metaDir, { recursive: true });
  // 故意起一个不匹配旧 IMMUTABLE_META 正则（review-*.json / brief-*.md / changes-*.diff）的文件名
  const target = path.join(metaDir, 'trace-20260101T000000Z.json');
  await fs.writeFile(target, '{"v":1}\n');
  await initFixtureRepo(ctx.projectRoot); // 把上面写的文件一并纳入首个提交

  await fs.writeFile(target, '{"v":2}\n'); // 已提交后原地改动
  const r = await hookPreCommit(ctx, { session_id: SESSION });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, `_meta/ 下的新工件类型也该被位置判据拦下：\n${r.stderr}`);
  assert.match(r.stderr ?? '', /trace-20260101T000000Z\.json/);
});

test('changes.diff 便利副本：提交后改动可以提交（每轮覆盖写，位置判据的排除项）', async () => {
  const ctx = await gitCtx();
  const metaDir = path.join(ctx.archiveRoot, 'T', 'code', '_meta');
  await fs.mkdir(metaDir, { recursive: true });
  const alias = path.join(metaDir, 'changes.diff');
  await fs.writeFile(alias, 'diff v1\n');
  await commitAll(ctx.projectRoot, 'seed changes.diff');

  await fs.writeFile(alias, 'diff v2\n'); // 下一轮覆盖写
  const r = await hookPreCommit(ctx, { session_id: SESSION });
  assert.equal(r.exitCode, EXIT.OK, `changes.diff 是每轮覆盖的便利副本，不应被拦：\n${r.stderr}`);
});

test('run-*.json：running 态收尾回写可以提交，success 态原地改动被拦（两条例外求值顺序）', async () => {
  const ctx = await gitCtx();
  const metaDir = path.join(ctx.archiveRoot, 'T', 'plan', '_meta');
  await fs.mkdir(metaDir, { recursive: true });

  // ① running → 收尾回写：不拦
  const runningRun = path.join(metaDir, 'run-20260101T000000Z.json');
  await fs.writeFile(runningRun, JSON.stringify({ status: 'running' }) + '\n');
  await commitAll(ctx.projectRoot, 'seed running run.json');
  await fs.writeFile(runningRun, JSON.stringify({ status: 'success' }) + '\n');
  const r1 = await hookPreCommit(ctx, { session_id: SESSION });
  assert.equal(r1.exitCode, EXIT.OK, `running 态收尾回写不应被拦：\n${r1.stderr}`);
  await commitAll(ctx.projectRoot, 'finish run.json');

  // ② 已收尾（success）的 run.json 再被原地改动：拦
  await fs.writeFile(runningRun, JSON.stringify({ status: 'success', tampered: true }) + '\n');
  const r2 = await hookPreCommit(ctx, { session_id: SESSION });
  assert.equal(r2.exitCode, EXIT.GATE_BLOCK, `已收尾的 run.json 被改动必须拦：\n${r2.stderr}`);
  assert.match(r2.stderr ?? '', /run-20260101T000000Z\.json/);
});

test('running 态运行清单：收尾只许追加登记，删改已登记条目或改 run_id 即拦（代码双审 r3 CODEX-01 ≡ GLM-01）', () => {
  const head = JSON.stringify({
    run_id: 'R1', status: 'running',
    artifacts: [{ path: 'T/plan/_meta/brief-glm-R1.md', sha256: 'aaa' }],
  });
  const finish = (over: Record<string, unknown>): string =>
    JSON.stringify({ run_id: 'R1', status: 'success', artifacts: [{ path: 'T/plan/_meta/brief-glm-R1.md', sha256: 'aaa' }], ...over });

  // 正常收尾：追加新条目
  assert.equal(
    runningRewriteViolation(head, finish({
      artifacts: [{ path: 'T/plan/_meta/brief-glm-R1.md', sha256: 'aaa' }, { path: 'T/plan/x-glm.md', sha256: 'bbb' }],
    })),
    null,
  );
  // 改已登记条目的 sha / 删条目 / 改 run_id / 写坏 / 读不出
  assert.match(runningRewriteViolation(head, finish({ artifacts: [{ path: 'T/plan/_meta/brief-glm-R1.md', sha256: 'zzz' }] })) ?? '', /改写了已登记条目/);
  assert.match(runningRewriteViolation(head, finish({ artifacts: [] })) ?? '', /删掉了已登记条目/);
  assert.match(runningRewriteViolation(head, finish({ run_id: 'R2' })) ?? '', /run_id/);
  assert.match(runningRewriteViolation(head, '{坏') ?? '', /不可解析/);
  assert.match(runningRewriteViolation(head, null) ?? '', /读不出来/);
});

test('running 窗口的篡改链：中途提交后同步改审查文档与登记 sha，提交锚必须拦（代码双审 r3 CODEX-01）', async () => {
  /*
   * 上一版 running 分支只看 HEAD 的 status：中途提交过一次 running 态清单之后，
   * 同一次提交里改审查文档正文、再把清单里它的 sha 改成新值，锚② 读到的是被同步改过的期望值，
   * 自证清白；提交锚的后缀支又已删除——整条链退 0。收窄后改写已登记条目即拦。
   */
  const ctx = await gitCtx();
  const planDir = path.join(ctx.archiveRoot, 'T', 'plan');
  const metaDir = path.join(planDir, '_meta');
  await fs.mkdir(metaDir, { recursive: true });
  const doc = path.join(planDir, '2026-09-23-T-glm.md');
  await fs.writeFile(doc, '原始意见\n');
  const { createHash } = await import('node:crypto');
  const sha = async (f: string): Promise<string> => createHash('sha256').update(await fs.readFile(f)).digest('hex');
  const runPath = path.join(metaDir, 'run-R1.json');
  const manifest = (docSha: string): string =>
    JSON.stringify({ run_id: 'R1', status: 'running', artifacts: [{ path: 'T/plan/2026-09-23-T-glm.md', sha256: docSha }] }) + '\n';
  await fs.writeFile(runPath, manifest(await sha(doc)));
  await commitAll(ctx.projectRoot, 'mid-run commit');

  await fs.writeFile(doc, '被改过的意见\n');
  await fs.writeFile(runPath, manifest(await sha(doc)));
  const r = await hookPreCommit(ctx, { session_id: SESSION });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, `running 窗口内改写已登记条目必须拦：\n${r.stderr}`);
  assert.match(r.stderr ?? '', /改写了已登记条目/);
});

test('git --shallow-file 同样是取值分离的全局选项（代码双审 r3 GLM-05）', () => {
  assert.equal(looksLikeWriteCommand('git --shallow-file x restore -- .reviews/t/plan/_meta/run-R1.json'), true);
});

test('非缺省 Driver 的原稿与裁决件：提交后原地改可以提交（代码双审 r2 CODEX-03 的鉴别用例）', async () => {
  /*
   * 提交锚上一版第一支是跨时间后缀判据（全集减**缺省** Driver），`-codex.md` 在保护集内——
   * codex 当 Driver 时它自己的原稿与裁决件会被判「改动即伪造」。复原那一支这里就红。
   * 未登记进任何 artifacts[]（没有 run.json），所以锚② 也不管：它们本就可变。
   */
  const ctx = await gitCtx();
  const planDir = path.join(ctx.archiveRoot, 'T', 'plan');
  const codeDir = path.join(ctx.archiveRoot, 'T', 'code');
  await fs.mkdir(planDir, { recursive: true });
  await fs.mkdir(codeDir, { recursive: true });
  const draft = path.join(planDir, '2026-09-23-T-codex.md');
  const verdict = path.join(codeDir, '2026-09-23-T-response-codex.md');
  const revised = path.join(planDir, '2026-09-23-T-revised-codex.md');
  for (const f of [draft, verdict, revised]) await fs.writeFile(f, 'v1\n');
  await commitAll(ctx.projectRoot, 'seed codex-driver artifacts');

  for (const f of [draft, verdict, revised]) await fs.writeFile(f, 'v2\n');
  const r = await hookPreCommit(ctx, { session_id: SESSION });
  assert.equal(r.exitCode, EXIT.OK, `非缺省 Driver 修改自己的原稿 / 裁决件不应被拦：\n${r.stderr}`);
});

test('git 取值型全局选项不能让恢复 / 改写命令绕过写命令判据（代码双审 r2 CODEX-01）', async () => {
  /*
   * 上一版 git 分支的选项前缀只吃 `--git-dir=x` 这种自带取值的形态：
   * `git -c k=v restore …` 的取值那个词不以 `-` 开头，前缀断掉，整条判「不像写命令」，
   * `hookPreBash` 第一道门放行。既有负例 `git -c core.editor="rm …" commit` 能拦，
   * 是靠取值里的 `rm` 字面蒙中的，不算覆盖——这里的取值都不含任何写动词。
   */
  const ctx = await fakeCtx();
  for (const cmd of [
    'git -c core.quotePath=false restore -- .reviews/t/plan/_meta/run-R1.json',
    'git -C /proj checkout -- .reviews/t/plan/a-gemini.md',
    'git --git-dir .git restore -- .reviews/t/plan/_meta/review-glm-R1.json',
    'git -c core.pager="less -R" -C . checkout -- .reviews/t/task.json',
    'git --work-tree . -c core.quotePath=false reset --hard',
  ]) {
    assert.equal(looksLikeWriteCommand(cmd), true, `应判为写命令：${cmd}`);
  }
  for (const cmd of [
    'git -c core.quotePath=false restore -- .reviews/t/plan/_meta/run-R1.json',
    'git -C /proj checkout -- .reviews/t/plan/a-gemini.md',
    'git --git-dir .git restore -- .reviews/t/plan/_meta/review-glm-R1.json',
  ]) {
    assert.equal((await hookPreBash(ctx, bashInput(cmd))).exitCode, EXIT.GATE_BLOCK, `应被拦：${cmd}`);
  }
  // 收紧不能变成误拦：只读子命令照样放行
  for (const cmd of [
    'git -c core.quotePath=false log --oneline',
    'git -C /proj status --porcelain',
    'git -c core.quotePath=false diff HEAD -- .reviews/t/plan/_meta/run-R1.json',
    'git --git-dir .git show HEAD:.reviews/t/task.json',
  ]) {
    assert.equal(looksLikeWriteCommand(cmd), false, `不应判为写命令：${cmd}`);
  }
});

// ── hook-stop（三层防死循环）──

test('裁决未完成时阻止收工，并给出该怎么做', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookStop(ctx, { session_id: SESSION });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.equal(r.json?.['decision'], 'block');
  assert.match(String(r.json?.['reason']), /trivium.disposition.v1/);
});

test('闸门未记录会话 id 时收工拦截照样生效', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', heartbeatStaleMs: STALE,
  });
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.GATE_BLOCK);
});

test('明确属于其它会话的待裁决闸门不拦本会话收工（RV-05）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S-OTHER', heartbeatStaleMs: STALE,
  });
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

test('awaiting_approval 是期望的停点，放行收工', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

test('第一层防死循环：stop_hook_active 时早退', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookStop(ctx, { session_id: SESSION, stop_hook_active: true });
  assert.equal(r.exitCode, EXIT.OK);
});

test('第二层防死循环：超过每阶段阻断上限后放行', async () => {
  const ctx = await fakeCtx();
  ctx.config.gate.stop_hook_max_blocks = 2;
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.GATE_BLOCK);
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.GATE_BLOCK);
  const third = await hookStop(ctx, { session_id: SESSION });
  assert.equal(third.exitCode, EXIT.OK, '第 3 次应放行以避免死循环');
  assert.match(third.stderr ?? '', /避免死循环/);
});

// ── hook-session-start ──

test('无待办时不注入内容', async () => {
  const ctx = await fakeCtx();
  const r = await hookSessionStart(ctx);
  assert.equal(r.exitCode, EXIT.OK);
  assert.equal(r.json, undefined);
});

test('有待审批闸门时注入清单与解除指引', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '登录重构', stage: 'plan',
    state: 'awaiting_approval', sessionId: 'S-ANY', heartbeatStaleMs: STALE,
  });
  const r = await hookSessionStart(ctx);
  const j = r.json?.['hookSpecificOutput'] as Record<string, unknown>;
  assert.match(String(j['additionalContext']), /等待人工审批/);
  assert.match(String(j['additionalContext']), /dual-approve --topic 登录重构/);
  assert.equal(r.exitCode, EXIT.OK, 'session-start 永不阻断');
});

test('有运行中的双审时提醒先 --wait', async () => {
  const ctx = await fakeCtx();
  const lockDir = path.join(ctx.triviumDir, 'lock');
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(
    path.join(lockDir, 't.lock'),
    JSON.stringify({ topic: 't', stage: 'plan', run_id: 'R9', kind: 'run', pid: 1, acquired_at: 'x' }),
  );
  const r = await hookSessionStart(ctx);
  const j = r.json?.['hookSpecificOutput'] as Record<string, unknown>;
  assert.match(String(j['additionalContext']), /review --wait R9/);
});

test('状态读不到的运行目录单独成行，不因没抹别的目录而静默（代码双审 r1 CODEX-04 ≡ GLM-02）', async () => {
  const ctx = await fakeCtx();
  const { repoId } = await import('../../src/trivium/review.js');
  ctx.config.runtime.run_root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-hook-runs-'));
  const dir = path.join(ctx.config.runtime.run_root, repoId(ctx.projectRoot), 'R-nostatus');
  // 有侧目录、没有 status.json：清扫不做不可逆抹除，只计数——计数必须被人看见
  await fs.mkdir(path.join(dir, 'glm', 'out'), { recursive: true });
  const r = await hookSessionStart(ctx);
  const j = r.json?.['hookSpecificOutput'] as Record<string, unknown>;
  assert.ok(j, '只有 unknown 也要注入待办，不能早退成静默');
  assert.match(String(j['additionalContext']), /状态读不到/);
  assert.match(String(j['additionalContext']), /R-nostatus/, '要给出路径，人才知道去查哪儿');
  assert.equal(r.exitCode, EXIT.OK, 'session-start 永不阻断');
});

// ── 三档退出码（GLM-07 / AGY-02）──

test('config.yaml 缺失 → exit 0（no-op 覆盖「判定不了」）', async () => {
  const ctx = await fakeCtx({ withConfig: false });
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await runHook('hook-pre-write', async () => ctx, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.OK, '未初始化的项目必须 no-op，即使 state.json 里有闸门');
});

test('loadCtx 抛错（config 损坏或不在 git 仓库）→ exit 0', async () => {
  const r = await runHook('hook-pre-write', async () => {
    throw new Error('config 解析失败');
  }, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.OK);
});

test('明确判定拦截 → exit 2（唯一返回 2 的路径）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await runHook('hook-pre-write', async () => ctx, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

test('state.json 被搅坏 → 三个拦截型 Hook 一律 exit 2（fail-closed），session-start 只提示', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.triviumDir, 'state.json'), '{ 这不是 JSON', 'utf8');
  /*
   * 原先 readState 解析失败静默回落成空状态：`echo x > .trivium/state.json` 就能让
   * 全部闸门瞬间消失，写锁、收工拦截、提交拦截同时解除。它是 Hook 的唯一判定依据。
   */
  for (const name of ['hook-pre-write', 'hook-pre-commit', 'hook-stop'] as const) {
    const r = await runHook(name, async () => ctx, {
      session_id: SESSION, tool_name: 'Bash',
      tool_input: { file_path: 'src/a.ts', command: 'git commit -m x' },
    });
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `${name} 在判定依据损坏时必须拦`);
    assert.match(r.stderr ?? '', /闸门状态文件不可读/);
  }
  const s = await runHook('hook-session-start', async () => ctx, { session_id: SESSION });
  assert.equal(s.exitCode, EXIT.OK, 'session-start 永不阻断');
  assert.match(String((s.json?.['hookSpecificOutput'] as Record<string, unknown>)['additionalContext']), /不可读/);
});

test('Driver 不得用 Write 覆盖 .trivium/state.json 与 lock/（那等于自己解闸）', async () => {
  const ctx = await fakeCtx();
  for (const p of ['.trivium/state.json', '.trivium/lock/t.lock', path.join(ctx.triviumDir, 'state.json')]) {
    const r = await hookPreWrite(ctx, writeInput(p));
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `${p} 应被拒`);
    assert.match(r.stderr ?? '', /dual-approve/);
  }
  // config.yaml 是用户自己的配置，不在此列
  assert.equal((await hookPreWrite(ctx, writeInput('.trivium/config.yaml'))).exitCode, EXIT.OK);
});

test('hook 内部程序缺陷 → exit 1（非阻断）', async () => {
  const ctx = await fakeCtx();
  // 让 state.json 变成目录，触发读取异常路径之外的真实错误
  const r = await runHook('hook-pre-write', async () => ctx, {
    session_id: SESSION,
    tool_name: 'Write',
    // tool_input 给个会让 path 处理抛错的值
    tool_input: { file_path: '\0非法路径' },
  });
  // 该输入不一定抛错；关键是不返回 2
  assert.notEqual(r.exitCode, EXIT.GATE_BLOCK);
});

// ─────────── hook-pre-commit 的命令自检 ───────────

/** 造一个「有未裁决闸门」的上下文，作用域设为 global 以免会话过滤干扰 */
async function pendingCtx(): Promise<Ctx> {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '闸门主题', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  ctx.config.gate.approval_lock_scope = 'global';
  return ctx;
}

test('hook-pre-commit 只拦提交，不拦其它 Bash 命令', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '闸门主题', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  ctx.config.gate.approval_lock_scope = 'global';

  const blocked = await hookPreCommit(ctx, {
    tool_name: 'Bash', session_id: 'S1',
    tool_input: { command: 'git commit -m "x"' },
  });
  assert.equal(blocked.exitCode, EXIT.GATE_BLOCK, '裁决未齐备时提交必须被拦');

  // `git log --format=commit` 是关键用例：拿正则硬凑会把它误判成提交
  for (const cmd of [
    'npm test',
    'git status',
    'git log --format=commit',
    'git log --oneline | grep commit',
    'git -C /tmp/x status',
    'ls -la',
  ]) {
    const r = await hookPreCommit(ctx, {
      tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
    });
    assert.equal(r.exitCode, EXIT.OK, `「${cmd}」不是提交，不该被拦`);
  }
});

test('GLM-02：引号包裹整段的提交（sh -c 与 bash -lc）不得 fail-open', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '闸门主题', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  ctx.config.gate.approval_lock_scope = 'global';
  /*
   * tokenize 把引号内的空格保留进同一 token，于是整段里没有任何 token 等于 `git`。
   * 原先 parseGitSegment 直接返回 null，提交在闸门与留痕完整性检查之前就被放行。
   */
  for (const cmd of [
    "sh -c 'git commit -m x'",
    'bash -lc "git commit -am fix"',
    "sh -c 'cd . && git commit -m x'",
    "zsh -c 'git -C . commit -m x'",
  ]) {
    const r = await hookPreCommit(ctx, { tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd } });
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `裁决未齐备，应拦：${cmd}`);
    assert.match(r.stderr ?? '', /尚未逐条裁决/);
  }
  // 引号包裹但明确打在项目外的提交仍不误拦
  const outside = await hookPreCommit(ctx, {
    tool_name: 'Bash', session_id: 'S1',
    tool_input: { command: `cd ${path.join(os.tmpdir(), 'other-repo')} && sh -c 'git commit -m x'` },
  });
  assert.equal(outside.exitCode, EXIT.OK, '别的仓库的提交不该被本项目闸门拦下');
});

test('已知过拦：引号里出现 git commit 也会被拦（取保守一侧）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '闸门主题', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  ctx.config.gate.approval_lock_scope = 'global';
  /*
   * 这是**有意记录**的过拦，不是遗漏：不做完整 shell 词法分析就分不清
   * `echo git commit` 与真提交。宁可误拦一条 echo，也不能漏过一次违规提交。
   * 若将来确有困扰，正解是引入真正的词法分析，而不是放宽判据。
   */
  const r = await hookPreCommit(ctx, {
    tool_name: 'Bash', session_id: 'S1', tool_input: { command: 'echo git commit' },
  });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

test('hook-pre-commit 拿不到命令行时按「是提交」处理', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '闸门主题', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  ctx.config.gate.approval_lock_scope = 'global';
  // 宁可误拦也不放过：Hook 的职责是拦住违规提交
  const r = await hookPreCommit(ctx, { tool_name: 'Bash', session_id: 'S1' });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

test('hook-pre-commit 识别复合命令里打在本项目上的提交', async () => {
  const ctx = await pendingCtx();
  for (const cmd of [
    'npm test && git commit -m y',
    'git commit --amend',
    'git -c user.name=x commit -m y',
    `git -C ${'${ctx.projectRoot}'} commit -m y`.replace('${ctx.projectRoot}', ctx.projectRoot),
    `cd ${ctx.projectRoot} && git commit -m y`,
    'cd src && git commit -m y', // 相对 cd 仍在项目内
  ]) {
    const r = await hookPreCommit(ctx, {
      tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
    });
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `「${cmd}」应被识别为本项目的提交`);
  }
});

// ── 跨仓库误拦（实测暴露）──

test('打在别的仓库上的提交不该被本项目的闸门拦下', async () => {
  const ctx = await pendingCtx();
  /*
   * 实测踩到：一条 `cd /tmp/夹具 && git init && git commit …` 被**本项目**的闸门
   * 拦下，而那次提交与本项目的归档状态毫无关系。
   * 原实现只看命令串里有没有 `git commit`，完全不看目标仓库——
   * 等于本项目的闸门会拦住你对任何其它仓库的提交。
   */
  for (const cmd of [
    'git -C /tmp/别的仓库 commit -m y',
    'cd /tmp/别的仓库 && git commit -m y',
    'cd /tmp/夹具 && git init -q . && git -c user.email=t@t commit -q -m base',
    'git --git-dir=/tmp/别的仓库/.git --work-tree=/tmp/别的仓库 commit -m y',
  ]) {
    const r = await hookPreCommit(ctx, {
      tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
    });
    assert.equal(r.exitCode, EXIT.OK, `「${cmd}」打在项目外，不该拦：${r.stderr ?? ''}`);
  }
});

test('子命令不是字面量或经 alias 定义：按「是提交」保守处理', async () => {
  const ctx = await pendingCtx();
  for (const cmd of [
    'S=commit; git $S -m y',
    'git -c alias.ci=commit ci -m y',
    'git `echo commit` -m y',
  ]) {
    const r = await hookPreCommit(ctx, { tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd } });
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `「${cmd}」推断不出子命令，应保守拦下`);
  }
  // alias 指向别的子命令不误拦
  const ok = await hookPreCommit(ctx, { tool_name: 'Bash', session_id: 'S1', tool_input: { command: 'git -c alias.st=status st' } });
  assert.equal(ok.exitCode, EXIT.OK);
});

test('收工阻断超限放行时，提示走 systemMessage 让用户看得到', async () => {
  const ctx = await fakeCtx();
  ctx.config.gate.stop_hook_max_blocks = 1;
  await setGate({ triviumDir: ctx.triviumDir, topic: 't', stage: 'plan', state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE });
  await hookStop(ctx, { session_id: SESSION });
  const r = await hookStop(ctx, { session_id: SESSION });
  assert.equal(r.exitCode, EXIT.OK);
  assert.match(String(r.json?.['systemMessage']), /避免死循环/, 'exit 0 的 stderr 用户看不到');
});

test('session-start：读不到 status 的 running 闸门，超过 TTL 才回收', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: 't', stage: 'plan', state: 'running', runId: 'R-gone', heartbeatStaleMs: STALE });
  // 刚建的不动
  await hookSessionStart(ctx);
  const { getGate } = await import('../../src/trivium/state.js');
  assert.equal((await getGate(ctx.triviumDir, 't', 'plan'))?.state, 'running');
  // 把 since 拨到 25 小时前（TTL 默认 24h）
  const sp = path.join(ctx.triviumDir, 'state.json');
  const st = JSON.parse(await fs.readFile(sp, 'utf8')) as { gates: Record<string, { since: string }> };
  st.gates['t/plan']!.since = new Date(Date.now() - 25 * 3_600_000).toISOString();
  await fs.writeFile(sp, JSON.stringify(st), 'utf8');
  await hookSessionStart(ctx);
  assert.equal((await getGate(ctx.triviumDir, 't', 'plan'))?.state, 'idle', '过了 TTL 的孤儿 running 闸门应回收，否则永久显示进行中');
});

test('推断不出目标仓库时一律按项目内处理', async () => {
  const ctx = await pendingCtx();
  /*
   * 从命令串推断目标仓库天然不可能严密（变量、子 shell、`cd -`……）。
   * 保守方向是**宁可多拦**：漏拦一次违规提交的代价，远大于多拦一条命令。
   */
  for (const cmd of [
    'cd $SOME_DIR && git commit -m y',
    'cd - && git commit -m y',
    'cd && git commit -m y',
    'git -C "$REPO" commit -m y',
  ]) {
    const r = await hookPreCommit(ctx, {
      tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
    });
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `「${cmd}」推断不出目标，应保守拦下`);
  }
});

test('先去项目外提交、再回项目内提交 → 仍然拦', async () => {
  const ctx = await pendingCtx();
  const cmd = `cd /tmp/别处 && git commit -m a && cd ${ctx.projectRoot} && git commit -m b`;
  const r = await hookPreCommit(ctx, {
    tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
  });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, '只要有一段打在本项目上就该拦');
});

test('带空格的路径也能正确判断在不在项目内', async () => {
  const ctx = await pendingCtx();
  const outside = await hookPreCommit(ctx, {
    tool_name: 'Bash', session_id: 'S1',
    tool_input: { command: 'cd "/tmp/有 空格的目录" && git commit -m y' },
  });
  assert.equal(outside.exitCode, EXIT.OK);
});

// ── D3：Bash 侧角色后缀改全集字面保护（M10a 第 5 步段一，计划 r2 §3.0；r7 §3.2 / §3.3 / A3）──
//
// 此前 Bash 侧取「全集减缺省 Driver」：M10a 第 3 步翻开 `driverEnabled` 之后，非缺省轮次里
// 缺省 Driver 的后缀（`-claude.md`）恰是**审核者**产出，却在 Bash 侧无字面保护。
// Bash 拿不到 run 上下文，唯一不依赖「当轮」的取值是全集。
//
// 负例 B1～B4 取 r7 §3.3 点名的四种形态、一律用 `-claude.md`：那是 D3 前后唯一翻转的一格，
// 用别家后缀构造的用例在 D3 之前就红，证明不了 D3（变异 MD3a 靠的就是这一点）。
// 正例 P1～P3 锁「只读提及、`git add`、skill 的正常 `--start` 调用」不被误伤——
// 全集保护最容易伤到的就是 Driver 自己的日常动作。

const OWN = '.reviews/t/plan/2026-09-23-t-claude.md';

test('D3 · B1～B4：提到 -claude.md 的写形态命令一律拦（缺省 Driver 自己的后缀也拦）', async () => {
  const ctx = await fakeCtx();
  for (const [c, why] of [
    [`cp ${OWN} .reviews/t/plan/2026-09-23-t-r2-claude.md`, 'B1 克隆原稿'],
    [`node skills/dual-critic/scripts/trivium.cjs review --start --entry B --stage plan --topic t --plan-file ${OWN} --focus x > out.txt`, 'B2 带重定向的 --start'],
    [`node skills/dual-critic/scripts/trivium.cjs review --start --entry B --stage plan --topic t --plan-file ${OWN} --focus '重点看 rm 与 mv'`, 'B3 焦点含写动词字面'],
    [`git restore ${OWN}`, 'B4 恢复命令带后缀文件'],
  ] as const) {
    const r = await hookPreBash(ctx, bashInput(c));
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `${why}：应拦`);
    assert.match(r.stderr ?? '', /编排器独占/, `${why}：拦下时给的是同一份说明`);
  }
});

test('D3 · B5：四家后缀逐一都拦（遍历注册表，防第五家登记时漏）', async () => {
  const ctx = await fakeCtx();
  for (const id of ALL_AGENT_IDS) {
    const r = await hookPreBash(ctx, bashInput(`rm .reviews/t/plan/2026-09-23-t-${id}.md`));
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `-${id}.md 应在 Bash 侧受字面保护`);
  }
});

test('D3 · P1～P3：只读提及、git add、不含写动词的 --start 都放行', async () => {
  const ctx = await fakeCtx();
  for (const [c, why] of [
    [`cat ${OWN}`, 'P1 只读提及'],
    [`grep -n 裁决 ${OWN}`, 'P1 只读提及（grep）'],
    [`git add ${OWN}`, 'P2 git add 不在写命令判据里'],
    [`node skills/dual-critic/scripts/trivium.cjs review --start --entry B --stage plan --topic t --plan-file ${OWN} --focus '重点看判据'`, 'P3 skill 的正常调用形态'],
  ] as const) {
    assert.equal((await hookPreBash(ctx, bashInput(c))).exitCode, EXIT.OK, `${why}：不该拦`);
  }
});

test('D3 · M1：拦截文案列出的后缀与判据同源（全集四家，含缺省 Driver）', async () => {
  const ctx = await fakeCtx();
  const r = await hookPreBash(ctx, bashInput(`rm ${OWN}`));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  /*
   * 只解析列举那一行：文案首行会回显被拦的命令，命令里本就有 `-claude.md`，
   * 全文匹配会让「列表漏了 claude」照样绿——变异 MD3b 就咬不住了。
   */
  const line = (r.stderr ?? '').split('\n').find((l) => l.includes('角色工件的后缀'));
  assert.ok(line, '拦截文案要有列举后缀的那一行');
  const listed = [...line.matchAll(/-([a-z]+)\.md/g)].map((m) => m[1]);
  for (const id of ALL_AGENT_IDS) {
    assert.ok(listed.includes(id), `拦截文案应列出 -${id}.md——文案与判据两处独立取值时，只改一处就会少列`);
  }
  assert.ok(ALL_AGENT_IDS.includes(DEFAULT_DRIVER), '前提：缺省 Driver 是已登记 Agent');
});
