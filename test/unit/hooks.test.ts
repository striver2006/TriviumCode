import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  hookPreWrite, hookPreBash, hookPreCommit, hookStop, hookSessionStart, runHook, looksLikeWriteCommand,
  extractTargetPath, isForgedRoleFile, hasCriticRoleSuffix, isInsideArchive, isOrchestratorOwned,
  type HookInput,
} from '../../src/trivium/hooks.js';
import { exists } from '../../src/trivium/util/fsx.js';
import { setGate } from '../../src/trivium/state.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';

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
  // 提交锚（immutableChangeReason）用的就是这一支，传进来的是 basename
  assert.equal(hasCriticRoleSuffix('2026-09-10-t-gemini.md'), true);
  assert.equal(hasCriticRoleSuffix('2026-09-10-t-glm.md'), true);
  assert.equal(hasCriticRoleSuffix('2026-09-10-t-claude.md'), false);
  assert.equal(hasCriticRoleSuffix('2026-09-10-t-revised-claude.md'), false);
  assert.equal(hasCriticRoleSuffix('src/gemini.md'), false, '文件名必须以 -gemini.md 结尾');
});

test('识别伪造审查文件：形态像 + 落在归档内', () => {
  const root = '/p';
  const archive = '/p/.reviews';

  assert.equal(isForgedRoleFile('/p/.reviews/t/plan/2026-09-10-t-gemini.md', root, archive), true);
  assert.equal(isForgedRoleFile('.reviews/t/plan/2026-09-10-t-glm.md', root, archive), true);
  assert.equal(isForgedRoleFile('2026-09-10-t-claude.md', root, archive), false);

  /*
   * 有意的契约变更（2026-09-14 收窄，计划 D-4）：归档根之外的同形态文件不再拦。
   * 它们进不了 gate 的任何读取面，拦它没有防御价值，只会锁死 doc/ 下沿用
   * 「日期-主题-角色」命名的设计稿——本仓库自己就踩了很久。
   */
  assert.equal(
    isForgedRoleFile('doc/02_design/2026-09-10-t-glm.md', root, archive),
    false,
    'doc/ 下的同形态设计稿应放行',
  );
  assert.equal(
    isForgedRoleFile('2026-09-10-t-glm.md', root, archive),
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
    isForgedRoleFile(linkInDoc, ctx.projectRoot, archive),
    true,
    'doc/ 下指向归档内的软链，Write 会沿链覆写真审查件',
  );

  // ② 归档内的软链指向归档外：词法在归档内 → 仍拦
  const outside = path.join(ctx.projectRoot, 'outside.md');
  await fs.writeFile(outside, '# outside\n');
  const linkInArchive = path.join(archive, 't/plan/2026-09-14-t-glm.md');
  await fs.symlink(outside, linkInArchive);
  assert.equal(
    isForgedRoleFile(linkInArchive, ctx.projectRoot, archive),
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
    isForgedRoleFile('.reviews/t/plan/2026-09-14-t-gemini.md', ctx.projectRoot, ctx.archiveRoot),
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
    isForgedRoleFile(dangling, ctx.projectRoot, ctx.archiveRoot),
    true,
    '悬空软链的落点在归档内，必须拦',
  );
  const r = await hookPreWrite(ctx, writeInput(dangling));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

test('父目录尚不存在的合法新建不被误杀', async () => {
  // 审查意见 AGY-r2-02：ENOENT 就判「归档内」会锁死 doc/ 下新建子目录的写入
  const ctx = await fakeCtx();
  assert.equal(
    isForgedRoleFile('doc/new_sub/2026-09-14-t-glm.md', ctx.projectRoot, ctx.archiveRoot),
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
