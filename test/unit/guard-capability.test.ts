/**
 * 适配层契约泛化：`TraceCapability` 的分档判定（M8 第 2 步 · 设计 §11.1）。
 *
 * 覆盖点对应 r3 裁决 §4.2：
 *   - `effectiveReadPaths` 的四组提取口径（r3 双审 blocker 的落点）；
 *   - `checkEvidence` 的 `toolTotal` 分档与 `min_project_reads` 折减；
 *   - `readonlyBreach` **两档一律由写事件判定**（r2 blocker 的锁）；
 *   - 措施 a 不吃回填（措施 b 独立承担命令通道）；
 *   - 两条核验通道的档位记**能力恒态**；
 *   - `CriticResult` 本体不被回填污染。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  checkEvidence,
  effectiveReadPaths,
  effectiveMinProjectReads,
  extractPathTokens,
  TOOL_TRACE_CAPABILITY,
  type TraceCapability,
} from '../../src/trivium/adapters/base.js';
import { judgeSide, matchConsulted } from '../../src/trivium/guard.js';
import { TRIVIUM_DIR, defaultConfig } from '../../src/trivium/config.js';
import type { CriticRequest, CriticResult, Review } from '../../src/trivium/types.js';

const ROOT = '/proj';
const COMMAND_TRACE: TraceCapability = { traceShape: 'command-trace', rejectionRecorded: false };

const REQ: CriticRequest = {
  critic: 'gemini',
  stage: 'plan',
  model: 'm',
  timeout_s: 60,
  min_tool_calls: 5,
  min_project_reads: 3,
  subject_path: `${ROOT}/.reviews/t/plan/2026-09-15-t-claude.md`,
  brief_path: `${ROOT}/.reviews/t/plan/_meta/brief-gemini-R1.md`,
  project_root: ROOT,
  deny_paths: ['.reviews/t/plan/2026-09-15-t-glm.md'],
  out_dir: '/runs/out',
  brief_text: '',
} as unknown as CriticRequest;

const OPTS = { archiveRootAbs: `${ROOT}/.reviews` };

function result(over: Partial<CriticResult> = {}): CriticResult {
  return {
    critic: 'gemini',
    status: 'ok',
    exit_code: 0,
    duration_s: 1,
    raw_stdout_path: '',
    trace_path: 't',
    review_json: null,
    raw_response_text: null,
    model_effective: 'm',
    model_effective_source: 'envelope',
    model_provider: null,
    profile_requested: null,
    tool_calls: {},
    read_paths: [],
    search_hit_paths: null,
    /*
     * 覆盖率两项：**结构化轨迹的两家适配器现在都报它**（设计 10.1.1 第②层）。
     * 夹具跟着报，否则走的是「该侧没报数」那一支、档位落 unavailable——
     * 那一支现在只留给旧留痕，拿它当结构化轨迹侧的常态会把用例测在别的分支上。
     */
    path_bearing_reads: 1,
    path_bearing_reads_with_path: 1,
    write_events: [],
    command_texts: [],
    evidence_ok: false,
    fail_reason: null,
    session_id: null,
    cli_version: null,
    peer_deny_applied: false,
    deny_skipped: 0,
    deny_rule_count: 0,
    deny_bytes: 0,
    command_line: '',
    ...over,
  };
}

// ── 提取口径（r3 blocker 的四组裁定）────────────────────────────────

test('提取：剥掉 /bin/zsh -lc 子 shell 封装后才拿得到路径（r3 blocker）', () => {
  // 不剥这一层，整段子命令会塌成一个引号 token，路径一个都提不出来
  assert.deepEqual(extractPathTokens(`/bin/zsh -lc 'head -n 1 ${ROOT}/src/a.ts'`), [`${ROOT}/src/a.ts`]);
  assert.deepEqual(extractPathTokens(`/bin/bash -c "cat src/b.ts"`), ['src/b.ts']);
});

test('提取：裸项目相对路径计入，与措施 b 的 F-2 同口径（r3 blocker）', () => {
  assert.deepEqual(extractPathTokens('cat src/a.ts'), ['src/a.ts']);
  assert.deepEqual(extractPathTokens('cat ./src/b.ts'), ['./src/b.ts']);
});

test('提取：git 对象语法取出路径，通配不展开', () => {
  assert.deepEqual(extractPathTokens('git show HEAD:README.md'), ['README.md']);
  assert.deepEqual(extractPathTokens('cat src/*.ts'), [], '通配需要文件系统状态，判定层不做 I/O');
});

test('提取：写目标位不计入读证据，但同一条命令里的读取源保留', () => {
  assert.deepEqual(extractPathTokens('echo hi > out.txt'), []);
  assert.deepEqual(
    extractPathTokens('grep foo src/a.ts > out.txt'),
    ['src/a.ts'],
    '命令级分类会把真实读取一并丢掉，所以按 token 级排除',
  );
  assert.deepEqual(extractPathTokens('cp src/a.ts src/b.ts'), ['src/a.ts'], 'cp 的目标位是写入点');
  assert.deepEqual(extractPathTokens('sed -i s/x/y/ src/a.ts'), [], 'sed -i 就地改写，目标是写入点');
});

// ── r6 双审实测出的反例，逐条锁死 ────────────────────────────────

test('提取：fd 前缀重定向的目标不算读证据（r6 AGY-01 ≡ GLM-02a）', () => {
  assert.deepEqual(extractPathTokens('echo hi 2>out.txt'), [], '2> 紧贴写法');
  assert.deepEqual(extractPathTokens('echo hi 2>>x.log'), [], '2>> 同族');
  assert.deepEqual(extractPathTokens('grep -rn foo src/d.ts 2>/dev/null'), ['src/d.ts'], '读取源保留');
});

test('提取：写动词按命令段判定，不跨管道与分号（r6 GLM-02b）', () => {
  assert.deepEqual(
    extractPathTokens('cat foo.ts | tee out.txt'),
    ['foo.ts'],
    '管道后的 tee 目标位要排除——整条取首 token 当动词时它不生效',
  );
  assert.deepEqual(
    extractPathTokens('cp src/a.ts dst/b.ts; cat src/c.ts'),
    ['src/a.ts', 'src/c.ts'],
    '原实现在这条上双向错：漏掉 src/c.ts 的真实读取，却把写目标 dst/b.ts 计入',
  );
});

test('提取：动词取 basename，绝对路径动词同样生效（r6 AGY-01）', () => {
  assert.deepEqual(
    extractPathTokens('/bin/cp src/a.ts dst/b.ts'),
    ['src/a.ts'],
    '按全路径查表会整条漏掉，且 /bin/cp 自身含 / 会被当成读取路径',
  );
});

test('提取：版本区间与断尾路径不得虚构成读证据（r6 GLM-03）', () => {
  assert.deepEqual(
    extractPathTokens('git log v1.3.8..v1.3.9'),
    [],
    '.9 会命中扩展名判型——版本区间是审查员最高频的命令形态之一',
  );
  assert.deepEqual(
    extractPathTokens('cat "my notes/a.ts"'),
    [],
    '带空格路径按引号替换法会被切成 my 与 notes/a.ts，半截假路径比漏报更坏',
  );
});

test('提取：引号内的段分隔符不得击穿分段（r7 AGY-01 ≡ GLM-02）', () => {
  assert.deepEqual(
    extractPathTokens("sed -i 's/|/x/' src/a.ts"),
    [],
    '引号内的 | 若错切命令，sed 的动词上下文丢失，写目标反被计成读取——' +
      '上一轮刚加的「首个非旗标参数是脚本」规则会连同上下文一起失效',
  );
  /*
   * 引号内是**模式/脚本**时不付漏报代价：整段变空格后命令回到单段，
   * 动词与读取源都正确。但这不能推广成「引号内本来就不是路径」——
   * 引号内是含分隔符的**路径**时照样丢，见下面 r8 GLM-02 的锁例。
   */
  assert.deepEqual(
    extractPathTokens("grep '};' src/a.ts"),
    ['src/a.ts'],
    '丢掉的是引号内的模式，真实读取照常提得出',
  );
  assert.deepEqual(extractPathTokens("grep -e '|' src/a.ts"), ['src/a.ts']);
  assert.deepEqual(extractPathTokens("rg 'foo|' f.ts"), ['f.ts']);
});

test('提取：目录目标与 URL 不是读证据（r7 GLM-04）', () => {
  assert.deepEqual(extractPathTokens('cd src/x'), [], 'cd 的参数是目录，一个字节都没读');
  assert.deepEqual(extractPathTokens('git -C src/x log'), [], '-C 的参数是工作目录');
  assert.deepEqual(extractPathTokens('mkdir -p dist/x'), []);
  assert.deepEqual(
    extractPathTokens('curl https://example.com/x'),
    [],
    'URL 会被 git 对象正则剥成 //example.com/x，归一后落进项目根下虚构一条读取',
  );
});

test('阈值：配置 0 表示显式关闭，不得在 command-trace 侧被反向抬升（r6 AGY-03 ≡ GLM-05）', () => {
  assert.equal(effectiveMinProjectReads(0, COMMAND_TRACE), 0);
  assert.equal(effectiveMinProjectReads(0, TOOL_TRACE_CAPABILITY), 0);
});

// ── effectiveReadPaths ────────────────────────────────────────────

test('tool-trace 的有效路径逐项等于 read_paths（相等，不是包含）', () => {
  const r = result({ read_paths: [`${ROOT}/src/a.ts`], command_texts: ['cat src/zzz.ts'] });
  assert.deepEqual(
    effectiveReadPaths(r, TOOL_TRACE_CAPABILITY, ROOT),
    [`${ROOT}/src/a.ts`],
    'tool-trace 侧不做回填，命令文本里的路径不得混进来',
  );
});

test('command-trace 的有效路径 = read_paths ∪ 命令提取，裸相对按项目根归一', () => {
  const r = result({ read_paths: [`${ROOT}/src/a.ts`], command_texts: ['cat src/b.ts'] });
  const eff = effectiveReadPaths(r, COMMAND_TRACE, ROOT);
  assert.ok(eff.includes(`${ROOT}/src/a.ts`), '原有结构化路径保留');
  assert.ok(eff.includes(`${ROOT}/src/b.ts`), '裸相对按 projectRoot 归一后进入');
});

test('回填：~ / $HOME 在归一前展开，否则 consulted 交叉核对必然对不上（r6 AGY-05）', () => {
  const home = os.homedir();
  const r = result({ read_paths: [], command_texts: [`cat ~/Work/x/a.ts`, `cat $HOME/y/b.ts`] });
  const eff = effectiveReadPaths(r, COMMAND_TRACE, ROOT);
  assert.ok(
    eff.some((p) => p === `${home}/Work/x/a.ts`),
    'path.resolve 会把 ~/x 当裸相对路径解析成 <projectRoot>/~/x——那条路径根本不存在',
  );
  assert.ok(eff.some((p) => p === `${home}/y/b.ts`));
  assert.ok(!eff.some((p) => p.includes('/~/')), '归一结果里不得残留未展开的 ~');
});

test('回填是派生视图，绝不回写 CriticResult（诚实记录不被污染）', () => {
  const r = result({ read_paths: [], command_texts: ['cat src/a.ts'] });
  effectiveReadPaths(r, COMMAND_TRACE, ROOT);
  assert.deepEqual(r.read_paths, [], 'read_paths 记的是适配器实际采到什么，推导结果不得写回');
});

/*
 * ── 重定向目标不得进回填（EV-79 缺口二的**危害出口**） ──
 *
 * 回填的消费方只有三处：`checkEvidence` 的 `no_trace` 与 `projectReads`、
 * `judgeSide` 的 consulted 交叉核对（措施 a 不吃回填，见本文件上方那组用例）。
 *
 * 所以「重定向目标以读取身份进路径面」的真实危害是**证据自证**：
 * 一条从未读过的路径，只要被某次重定向当过目标，就能让 consulted 里的虚假声明
 * 下面三条分别打：`effectiveReadPaths`（两个出口的共同直接输入）、
 * `matchConsulted`（consulted 交叉核对的真出口）、`checkEvidence` 的 `projectReads`
 * （证据面的真出口）——只钉 `extractPathTokens` 的正负输出
 * 守的是中间函数，与「为什么必须连读面一起修」这条理由脱钩。
 */

test('回填：双流重定向的目标不进有效读取路径（证据面出口）', () => {
  const r = result({
    read_paths: [],
    command_texts: [
      'echo secret &> src/leak.txt',
      'echo secret >& src/leak2.txt',
      'echo secret 2>& src/leak3.txt',
      'echo secret >>& src/leak4.txt',
    ],
  });
  const eff = effectiveReadPaths(r, COMMAND_TRACE, ROOT);
  for (const n of ['leak', 'leak2', 'leak3', 'leak4']) {
    assert.ok(
      !eff.includes(`${ROOT}/src/${n}.txt`),
      `重定向目标是写入点、不是读取证据，不得计进 projectReads：${n}.txt`,
    );
  }
  assert.deepEqual(eff, [], '这四条命令没有任何真实读取');
});

test('回填：重定向目标不得坐实虚假的 consulted 声明（交叉核对出口）', () => {
  /*
   * 审查员从未读过 src/never-read.ts，只是把它当过一次重定向目标。
   * 若该目标进了回填，consulted 里写上它就能通过 judgeSide 的交叉核对——
   * 这正是本主题要堵的「证据自证」。
   *
   * **断言打到真出口**（代码双审 CODEX-10 ≡ AGY-01）：只断言 effectiveReadPaths
   * 是止步于「出口的直接输入」，差一跳。下面把它喂进 matchConsulted，
   * 断言那条虚假声明确实落进 missing——与 grep-hits.test.ts 同款口径。
   */
  const r = result({
    read_paths: [`${ROOT}/src/a.ts`],
    command_texts: ['cat src/a.ts', 'echo x &> src/never-read.ts'],
  });
  const eff = effectiveReadPaths(r, COMMAND_TRACE, ROOT);
  assert.ok(eff.includes(`${ROOT}/src/a.ts`), '真实读取仍在');
  assert.ok(
    !eff.includes(`${ROOT}/src/never-read.ts`),
    '只当过重定向目标的路径不得成为“读过”的证据',
  );

  // 真出口：虚假声明进 missing，真实读取进 matched
  const m = matchConsulted(['src/a.ts', 'src/never-read.ts'], eff, [ROOT]);
  assert.ok(m.matched.includes('src/a.ts'), '真读过的仍能被坐实');
  assert.ok(
    m.missing.includes('src/never-read.ts'),
    '只当过写目标的路径必须落进 missing——否则 consulted 可以自证',
  );
});

test('回填：重定向目标不得计进 projectReads（证据面出口）', () => {
  /*
   * 第三处消费方（代码双审 CODEX-08）：上一轮只把 consulted 那一侧打到了真出口，
   * `checkEvidence` 的 `projectReads` 仍停在直接输入——正是本主题自己批评过的「差一跳」。
   * 项目内读取计数会渲染进 run 元数据与留痕，虚假坐实同样成立。
   *
   * 构造：`read_paths` 为空、`command_texts` 只放双流重定向 ⇒ 没有任何真实读取
   * ⇒ `projectReads` 必须是 0。若重定向目标混进回填，这里会变成 4。
   */
  const r = result({
    read_paths: [],
    command_texts: [
      'echo secret &> src/leak.txt',
      'echo secret >& src/leak2.txt',
      'echo secret 2>& src/leak3.txt',
      'echo secret >>& src/leak4.txt',
    ],
    tool_calls: { read: 0, grep: 0, glob: 0, run_command: 4 },
  });
  const ev = checkEvidence(r, REQ, { ...OPTS, capability: COMMAND_TRACE });
  assert.equal(ev.projectReads, 0, '四条命令没有任何真实读取，写目标不得充数');
});

// ── checkEvidence 分档 ────────────────────────────────────────────

test('toolTotal：command-trace 计入 run_command，tool-trace 不计', () => {
  const r = result({
    tool_calls: { read: 0, grep: 0, glob: 0, run_command: 6 },
    command_texts: [`cat ${ROOT}/src/a.ts`, `cat ${ROOT}/src/b.ts`],
  });

  const cmd = checkEvidence(r, REQ, { ...OPTS, capability: COMMAND_TRACE });
  assert.ok(
    !cmd.reasons.some((x) => x.startsWith('insufficient_evidence')),
    'command-trace 侧读文件就是跑 shell，不计 run_command 就必然误判证据不足',
  );

  const tool = checkEvidence(r, REQ, { ...OPTS, capability: TOOL_TRACE_CAPABILITY });
  assert.ok(
    tool.reasons.some((x) => x.startsWith('insufficient_evidence')),
    'tool-trace 侧的 run_command 是写事件信号，计进证据就是把失守当读取',
  );
});

test('min_project_reads 对 command-trace 族折减，并如实回报生效值', () => {
  assert.equal(effectiveMinProjectReads(3, TOOL_TRACE_CAPABILITY), 3);
  assert.equal(effectiveMinProjectReads(3, COMMAND_TRACE), 2, '提取系统性偏低，沿用原值等于设不可达的闸');

  const r = result({
    tool_calls: { run_command: 6 },
    command_texts: [`cat ${ROOT}/src/a.ts`, `cat ${ROOT}/src/b.ts`],
  });
  const ev = checkEvidence(r, REQ, { ...OPTS, capability: COMMAND_TRACE });
  assert.equal(ev.projectReads, 2);
  assert.equal(ev.minProjectReads, 2, '生效阈值要能被留痕读到，否则两族一过一不过像 bug');
  assert.ok(!ev.reasons.some((x) => x.startsWith('no_project_context')));
});

test('no_trace 由 toolTotal 分档覆盖：command-trace 侧有命令就不触发（r3 GLM-04）', () => {
  const r = result({ trace_path: null, tool_calls: { run_command: 6 }, command_texts: [`cat ${ROOT}/src/a.ts`] });
  const ev = checkEvidence(r, REQ, { ...OPTS, capability: COMMAND_TRACE });
  assert.ok(!ev.reasons.some((x) => x.startsWith('no_trace')));
});

// ── judgeSide 的分档判定 ──────────────────────────────────────────

const cfg = defaultConfig();

function judge(over: Partial<CriticResult>, cap?: TraceCapability, review: Review | null = null) {
  return judgeSide(cfg, 'gemini', result(over), review, REQ, {
    degraded: [],
    archiveRootAbs: OPTS.archiveRootAbs,
    projectRoot: ROOT,
    triviumDir: `${ROOT}/${TRIVIUM_DIR}`,
    runRoot: '/tmp/runs',
    ...(cap ? { capability: cap } : {}),
  });
}

test('rejectionRecorded=false + 有写事件 ⇒ 仍判失守（r2 blocker 的锁）', () => {
  const v = judge({ write_events: ['shell:rm -rf src'] }, COMMAND_TRACE);
  assert.equal(
    v.readonlyBreach,
    true,
    'P-C2 只说被拒的命令不留痕；成功执行的写命令照常留痕，那是真阳性，不得压成 false',
  );
  assert.equal(v.verification.readonly, 'unavailable', '档位记能力恒态，与本次是否检出写事件无关');
});

test('rejectionRecorded=false + 无写事件 ⇒ 不判失守，但档位为 unavailable', () => {
  const v = judge({}, COMMAND_TRACE);
  assert.equal(v.readonlyBreach, false);
  assert.equal(v.verification.readonly, 'unavailable', '「没检出」在该侧排除不了「试过但被拒」');
});

test('结构化轨迹两家的档位与判定与本步之前逐字等价', () => {
  const v = judge({ write_events: ['write_file(a)'] }, TOOL_TRACE_CAPABILITY);
  assert.equal(v.readonlyBreach, true);
  assert.equal(v.verification.readonly, 'ok');
  assert.equal(v.verification.path, 'ok');
});

test('措施 a 不吃回填：只在命令里提到 deny 条目时，命中走措施 b 而非 a', () => {
  const deny = REQ.deny_paths[0]!;
  const v = judge({ command_texts: [`git show HEAD:${deny}`] }, COMMAND_TRACE);
  assert.deepEqual(v.peerHits, [], '命令里提到不等于文件系统读到——掺进措施 a 会削弱它的断言');
  assert.equal(v.peerCommandHits.length, 1, '命令通道由措施 b 独立承担');
  assert.equal(v.peerArtifactRead, true, '两条通道同等处置：任一命中该侧即作废');
});

test('command-trace 侧的 path 档位为 unavailable（措施 a 无输入可扫）', () => {
  const v = judge({}, COMMAND_TRACE);
  assert.equal(
    v.verification.path,
    'unavailable',
    'peerHits 恒空与「扫过没命中」在留痕里同形，必须靠档位分开',
  );
});

test('consulted 交叉核对吃回填后的路径，否则 command-trace 侧每轮误报', () => {
  const review = {
    consulted: ['src/a.ts', 'src/b.ts'],
    findings: [],
    summary: '本轮无意见，已核对全部消费点。',
    not_covered: ['未跑构建'],
  } as unknown as Review;
  const over = { command_texts: ['cat src/a.ts', 'cat src/b.ts'] };
  assert.equal(judge(over, COMMAND_TRACE, review).consultedUnverified, false);
  assert.equal(
    judge(over, TOOL_TRACE_CAPABILITY, review).consultedUnverified,
    true,
    '不回填时 read_paths 恒空，如实填报的审查员反被判编造',
  );
});

test('未传 capability 时按结构化轨迹判——本步之前的唯一形态，行为等价', () => {
  const v = judge({ write_events: ['write_file(a)'] });
  assert.equal(v.readonlyBreach, true);
  assert.equal(v.verification.readonly, 'ok');
  assert.equal(v.verification.path, 'ok');
});

// ── 归因分流的两个边界（r6 AGY-02）──────────────────────────────

test('归因扣除：尾段子串不相干文件不得被误扣（r7 AGY-03 ≡ GLM-01）', async () => {
  const { judgeRun } = await import('../../src/trivium/guard.js');
  const nodePath = await import('node:path');
  const { promises: fs } = await import('node:fs');
  const { initFixtureRepo, workTreeHash } = await import('../../src/trivium/util/git.js');

  const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'trivium-subhit-'));
  await fs.writeFile(nodePath.join(dir, 'subject.ts'), 'export const s = 1;\n');
  // 漂移文件名是另一条证据路径的**尾段子串**：data.ts ⊂ metadata.ts
  await fs.writeFile(nodePath.join(dir, 'data.ts'), 'export const d = 1;\n');
  await initFixtureRepo(dir);
  const before = await workTreeHash(dir);
  await fs.writeFile(nodePath.join(dir, 'data.ts'), 'export const d = 2;\n');
  const after = await workTreeHash(dir);

  const req = {
    run_id: 'R', topic: 't', stage: 'plan' as const, critic: 'gemini' as const,
    project_root: dir, subject_path: nodePath.join(dir, 'subject.ts'), deny_paths: [],
    out_dir: '/x', brief_path: '/b', brief_text: 'B', model: 'M',
    timeout_s: 900, schema_path: '/s', min_tool_calls: 5, min_project_reads: 3,
  } as unknown as CriticRequest;

  const v = await judgeRun({
    cfg,
    degraded: {},
    projectRoot: dir,
    archiveRootAbs: nodePath.join(dir, '.reviews'),
    archiveRootRel: '.reviews',
    before: {
      gitHead: null, treeHash: before, dirty: false, subjectSha256: 'S',
      subjectPath: req.subject_path, denyPaths: [], diffText: null, takenAt: 'now',
    },
    afterTreeHash: after,
    afterSubjectSha256: 'S',
    relatedPaths: [],
    results: {
      // 证据里的是 metadata.ts，与漂移的 data.ts 是**不同文件**
      gemini: result({ write_events: [`write_to_file(${dir}/src/metadata.ts)`] }),
    },
    reviews: { gemini: null },
    requests: { gemini: req },
    capabilities: { gemini: COMMAND_TRACE },
  });

  assert.ok(
    v.unattributedDriftFiles.includes('data.ts'),
    '裸 includes 会让 "write_to_file(…/metadata.ts)".includes("data.ts") 判真，' +
      '于是这个不相干文件被扣出 unattributed 桶——而 fingerprintChangedFiles 已整批置空，' +
      '它会在 run.json 的两个清单里同时消失',
  );
});

test('归因：不可用侧超时被跳过，仍须按其能力声明判定（r6 AGY-02b）', async () => {
  const { judgeRun } = await import('../../src/trivium/guard.js');
  const { failedResult } = await import('../../src/trivium/adapters/base.js');
  const nodePath = await import('node:path');
  const { promises: fs } = await import('node:fs');
  const { initFixtureRepo, workTreeHash } = await import('../../src/trivium/util/git.js');

  const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'trivium-attrib-'));
  await fs.writeFile(nodePath.join(dir, 'a.ts'), 'export const a = 1;\n');
  await fs.writeFile(nodePath.join(dir, 'b.ts'), 'export const b = 1;\n');
  await initFixtureRepo(dir);
  const before = await workTreeHash(dir);
  /*
   * 审查期间**被审对象之外**的文件被改动 → unrelated 漂移。
   * 改 `a.ts`（= subject）会落进 `subject_drift` 分支，那一支根本不进
   * `fingerprintChangedFiles`，测不到归因分流。
   */
  await fs.writeFile(nodePath.join(dir, 'b.ts'), 'export const b = 2;\n');
  const after = await workTreeHash(dir);

  const req = {
    run_id: 'R', topic: 't', stage: 'plan' as const, critic: 'gemini' as const,
    project_root: dir, subject_path: nodePath.join(dir, 'a.ts'), deny_paths: [],
    out_dir: '/x', brief_path: '/b', brief_text: 'B', model: 'M',
    timeout_s: 900, schema_path: '/s', min_tool_calls: 5, min_project_reads: 3,
  } as unknown as CriticRequest;

  const v = await judgeRun({
    cfg,
    degraded: {},
    projectRoot: dir,
    archiveRootAbs: nodePath.join(dir, '.reviews'),
    archiveRootRel: '.reviews',
    before: {
      gitHead: null, treeHash: before, dirty: false, subjectSha256: 'S',
      subjectPath: req.subject_path, denyPaths: [], diffText: null, takenAt: 'now',
    },
    afterTreeHash: after,
    afterSubjectSha256: 'S', // 被审对象本身没变
    relatedPaths: [],
    // 该侧超时 ⇒ judgeRun 的循环会 continue，不产出 SideVerdict
    results: { gemini: failedResult('gemini', { status: 'timeout', reason: '超时' }) },
    reviews: { gemini: null },
    requests: { gemini: req },
    capabilities: { gemini: COMMAND_TRACE },
  });

  assert.equal(v.sides.gemini, undefined, '前提：超时侧确实没有 SideVerdict');
  assert.equal(
    v.fingerprintChangedFiles.length,
    0,
    '按 sides 算会有个很坏的性质：不可用侧崩得越彻底，归因越「自信」——' +
      '它一超时就不进 sides，漂移就被记成开发者手改',
  );
  assert.ok(v.unattributedDriftFiles.length > 0, '能力是静态声明，与该侧跑没跑成无关');
});

// ── r8 双审实测出的残留，逐条锁死 ──────────────────────────────

test('提取：git 范围与引用不是路径（r8 AGY-02）', () => {
  assert.deepEqual(extractPathTokens('git log origin/main..HEAD'), []);
  assert.deepEqual(extractPathTokens('git diff main..feat'), []);
  assert.deepEqual(extractPathTokens('git log origin/master'), []);
  assert.deepEqual(
    extractPathTokens('cat ../Other/x.ts'),
    ['../Other/x.ts'],
    '真实的 ../ 前缀不能被 git 范围规则误伤——它由 isUnder 在下游过滤',
  );
});

test('提取：非读取动词的参数位不计入读证据（r8 GLM-03）', () => {
  assert.deepEqual(extractPathTokens('chmod +x build.sh'), []);
  assert.deepEqual(extractPathTokens('ln -s a.ts b.ts'), []);
});

test('提取：引号内含段分隔符的**路径**同样漏报，这是已登记的代价（r8 GLM-02）', () => {
  assert.deepEqual(
    extractPathTokens("cat 'report(1).ts'"),
    [],
    '文件名含 ( 必须引号包裹，这一族与含空白路径同付漏报代价——' +
      '注释不得再写成「引号内本来就不是路径」',
  );
});

test('归因扣除：斜杠对齐后缀与右端开放两族都不得误扣（r8 GLM-01 ≡ AGY-03）', async () => {
  const { judgeRun } = await import('../../src/trivium/guard.js');
  const nodePath = await import('node:path');
  const { promises: fs } = await import('node:fs');
  const { initFixtureRepo, workTreeHash } = await import('../../src/trivium/util/git.js');

  const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'trivium-bound-'));
  await fs.writeFile(nodePath.join(dir, 'subject.ts'), 'export const s = 1;\n');
  await fs.writeFile(nodePath.join(dir, 'README.md'), '# root\n');
  await initFixtureRepo(dir);
  const before = await workTreeHash(dir);
  await fs.writeFile(nodePath.join(dir, 'README.md'), '# root changed\n');
  const after = await workTreeHash(dir);

  const req = {
    run_id: 'R', topic: 't', stage: 'plan' as const, critic: 'gemini' as const,
    project_root: dir, subject_path: nodePath.join(dir, 'subject.ts'), deny_paths: [],
    out_dir: '/x', brief_path: '/b', brief_text: 'B', model: 'M',
    timeout_s: 900, schema_path: '/s', min_tool_calls: 5, min_project_reads: 3,
  } as unknown as CriticRequest;

  const v = await judgeRun({
    cfg,
    degraded: {},
    projectRoot: dir,
    archiveRootAbs: nodePath.join(dir, '.reviews'),
    archiveRootRel: '.reviews',
    before: {
      gitHead: null, treeHash: before, dirty: false, subjectSha256: 'S',
      subjectPath: req.subject_path, denyPaths: [], diffText: null, takenAt: 'now',
    },
    afterTreeHash: after,
    afterSubjectSha256: 'S',
    relatedPaths: [],
    results: {
      // 证据是**子目录下同名文件**，与漂移的根 README.md 是不同文件
      gemini: result({ write_events: [`write_to_file(${dir}/sub/README.md)`] }),
    },
    reviews: { gemini: null },
    requests: { gemini: req },
    capabilities: { gemini: COMMAND_TRACE },
  });

  assert.ok(
    v.unattributedDriftFiles.includes('README.md'),
    '只加左边界时 "/README.md" 仍是 "…/sub/README.md" 的子串——根 README.md 被误扣，' +
      '而 fingerprintChangedFiles 已整批置空，它会从 run.json 两个清单里同时消失',
  );
});

/*
 * ── 路径核验档位的三态（设计 10.1.1 第②层）──
 *
 * 这一档初版只有 ok / unavailable 两态，且**只看能力声明、不看实际拿到了什么**：
 * 声明为结构化轨迹的侧交出空的或残缺的路径集，档位照样是 ok，
 * 而 ok 在契约里的语义是「路径核验有效」。
 */

test('path 档位：必带路径的调用全都提出了路径 → ok', () => {
  const v = judge({ path_bearing_reads: 3, path_bearing_reads_with_path: 3 });
  assert.equal(v.verification.path, 'ok');
});

test('path 档位：有提不出路径的 → partial（提取器相对厂商参数名退化了）', () => {
  const v = judge({ path_bearing_reads: 3, path_bearing_reads_with_path: 1 });
  assert.equal(
    v.verification.path,
    'partial',
    '这是本项目唯一能在下一轮运行时发现厂商改参数名的信号',
  );
});

test('path 档位：该侧没报计数 → unavailable，不得记 ok', () => {
  /*
   * 「不知道提取器有没有退化」与「核验过、有效」是两件事。
   * 初版这一支 `return 'ok'`，而同一行注释写着「不知道就别说有效」——
   * 注释与实现直接相反，等于拿 ok 填「不知道」（r1 三侧独立指出）。
   */
  const v = judge({ path_bearing_reads: undefined, path_bearing_reads_with_path: undefined });
  assert.equal(v.verification.path, 'unavailable');
});

test('path 档位：分母为 0（本轮没有必带路径的调用）→ unavailable', () => {
  /*
   * 「一次都没调用过那类工具」与「调用了且全部提出路径」都会让比值看起来完美，
   * 但只有后者配叫「核验有效」。初版把前者也记 ok，于是纯搜索轮次看起来通过、
   * 实际探测面为零。
   */
  const v = judge({ path_bearing_reads: 0, path_bearing_reads_with_path: 0 });
  assert.equal(v.verification.path, 'unavailable');
});
