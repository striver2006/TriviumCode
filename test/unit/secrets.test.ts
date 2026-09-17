import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSecrets, assertNoSecrets, redactSecrets, scanDiffSecrets } from '../../src/trivium/secrets.js';

/*
 * ── 本文件的假凭据一律**运行时拼接**，静态文本里不得出现完整形态 ──
 *
 * 这个文件测的是密钥扫描器，夹具必须与真凭据同形。而它会进送审包：审查员逐字读到这些行，
 * 再把其中一段摘进结论，那份审查文档就会被归档闸拒绝落盘——整轮审查作废，三侧配额全烧掉。
 * 本主题的 code 阶段 r2 就是这么没的（那次是 PEM 标记，同一形状）。
 *
 * 拼接只影响源码文本，运行时拼出来的仍是完整形态，被测性质一点不打折；
 * 而审查员无论怎么摘录，手里都不会有一段完整凭据。
 */
const seg = (...parts: string[]): string => parts.join('');
const FAKE = {
  anthropic: seg('sk-', 'ant-', 'api03-', 'AbCdEfGh', 'IjKlMnOp', 'QrStUvWx', 'Yz0123456789'),
  github: seg('ghp', '_', 'AbCdEfGh', 'IjKlMnOp', 'QrStUvWx', 'Yz0123456789'),
  aws: seg('AKI', 'A', 'IOSFODNN', '7EXAMPLE'),
  google: seg('AIz', 'a', 'SyD_1234', '567890ab', 'cdefghij', 'klmnopqrstu'),
  jwtHead: seg('eyJhbGciOi', 'JIUzI1NiIs', 'InR5cCI6Ikp', 'XVCJ9'),
  jwtBody: seg('eyJzdWIiOi', 'IxMjM0NTY3', 'ODkwIn0'),
  jwtSig: seg('dBjftJeZ4C', 'VPmB92K27u', 'hbUJU1p1r_', 'wW1gFWFOEjXk'),
  zcodeId: seg('01234567', '89abcdef', '01234567', '89abcdef'),
  zcodeSecret: seg('Qx7mZp2L', 'k9Rt4Wv1'),
};
const FAKE_JWT = [FAKE.jwtHead, FAKE.jwtBody, FAKE.jwtSig].join('.');

test('干净文本不误报', () => {
  const clean = [
    '# 计划评审',
    '本次改动涉及 src/auth/oidc.ts:88，建议补充回滚路径。',
    'const timeout = 900; // seconds',
    'ZCODE_API_KEY=your_zcode_api_key_id.your_zcode_secret',   // .env.example 的占位符
    'api_key = "xxxxxxxxxxxxxxxxxxxxxxxx"',
  ].join('\n');
  assert.deepEqual(scanSecrets(clean), []);
});

test('识别 ZCode <id>.<secret> 形态凭据', () => {
  // 构造的假凭据：32 位 hex + 16 位随机串，形态与真实一致，值是编造的
  const line = `"apiKey": "${FAKE.zcodeId}.${FAKE.zcodeSecret}"`;
  const hits = scanSecrets(line);
  assert.ok(hits.some((h) => h.rule === 'zcode-api-key'), 'ZCode 的专用形态要被认出来');
  assert.ok(hits.every((h) => h.line === 1));
  /*
   * 同一处被两条规则命中是**对的**：键名带引号的 JSON 形态（`"apiKey": "…"`）现在也走
   * 兜底的 generic-secret-assignment——上一版它整条隐形，而运行目录里全是标准 JSON
   * （代码双审 r2 AGY-04）。拒绝落盘只需一条命中，多一条只是多说一句为什么。
   */
  assert.ok(hits.some((h) => h.rule === 'generic-secret-assignment'), '标准 JSON 键名形态不该再隐形');
});

test('识别 JWT', () => {
  const hits = scanSecrets(`token: ${FAKE_JWT}`);
  assert.ok(hits.some((h) => h.rule === 'jwt'), '应命中 jwt 规则');
});

test('预览已脱敏，不回显原文', () => {
  const hit = scanSecrets(FAKE_JWT).find((h) => h.rule === 'jwt');
  assert.ok(hit);
  assert.ok(!hit!.preview.includes(FAKE.jwtHead.slice(4)), '预览不得包含密钥中段');
  assert.ok(hit!.preview.includes('…'), '预览应带省略号');
});

test('多种前缀 token 均可识别', () => {
  const cases: [string, string][] = [
    [FAKE.anthropic, 'anthropic-key'],
    [FAKE.github, 'github-token'],
    [FAKE.aws, 'aws-access-key-id'],
    [FAKE.google, 'google-api-key'],
    // PEM 要连密钥材料一起给：光一行标记是「谈论私钥」，不是私钥（见本文件下方 PEM 专段）
    [fakePem('RSA'), 'private-key-block'],
  ];
  for (const [sample, rule] of cases) {
    const hits = scanSecrets(sample);
    assert.ok(hits.some((h) => h.rule === rule), `${rule} 应命中：${sample.slice(0, 12)}…`);
  }
});

/*
 * ── PEM 的判据是「标记 + 密钥材料」，不是「标记」（代码双审 r2 的实撞 + 其结论里的漏报发现）──
 *
 * 误报方向：谈论 PEM 的文本不该被当成贴了私钥。这不是洁癖——上一版把讨论性引用判成命中，
 * 于是任何审查这段代码的文档都无法落盘，三侧配额烧完、结论全丢。
 * 漏报方向：标签枚举写死 RSA|EC|DSA|OPENSSH|PGP，pkcs8 的 ENCRYPTED PRIVATE KEY 完全隐形。
 */
test('PEM：只有标记行（谈论它）不命中；带密钥材料才命中', () => {
  const talk = [
    '规则 `private-key-block` 匹配 -----BEGIN RSA PRIVATE KEY----- 这样的标记行。',
    "const MARK = '-----BEGIN', 'PRIVATE KEY-----';",
    '-----BEGIN PRIVATE KEY----- <redacted> -----END PRIVATE KEY-----',
  ].join('\n');
  assert.deepEqual(scanSecrets(talk), [], '谈论标记、以及脱敏后的占位串，都不是密钥');

  /*
   * 三侧独立实测的那一格：谈论标记 + 附近有个哈希。上一版把「标记后 400 字符内任意位置的
   * 40 连续 base64」当材料，而本项目的留痕里 sha256/sha1 随处可见——审查文档照旧被拒。
   */
  const sha256 = '894572069b5e97c17ee520f8b4489b197f3a2d6270388fd4d4b8a35219290130';
  const sha1 = '5e97c17ee520f8b4489b197f3a2d6270388fd4d4b';
  for (const hash of [sha256, sha1]) {
    const withHash = `讨论 -----BEGIN RSA PRIVATE KEY----- 的判据\n\n| snapshot | sha256:${hash} |`;
    assert.deepEqual(scanSecrets(withHash), [], `标记附近的纯 hex 哈希不是密钥材料（${hash.length} 位）`);
  }
  // 换行紧跟的也必须是「材料」而不是任意长串：纯 hex 顶在正文位上同样不算
  assert.deepEqual(scanSecrets(`-----BEGIN RSA PRIVATE KEY-----\n${sha256}`), [], '正文位上的纯 hex 仍不是材料');

  const hits = scanSecrets(fakePem('RSA'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.rule, 'private-key-block');
  assert.equal(hits[0]?.line, 1, '跨行规则的行号按匹配起点算');
});

test('PEM：标签通配，pkcs8 的 ENCRYPTED / 裸 PRIVATE KEY 都不再隐形', () => {
  for (const label of ['ENCRYPTED', '', 'OPENSSH', 'EC']) {
    const hits = scanSecrets(fakePem(label));
    assert.equal(hits.length, 1, `-----BEGIN ${label} PRIVATE KEY----- 必须命中`);
  }
});

test('PEM：截断的私钥（没有 END）照样命中，且脱敏不吞掉后面的正常内容', () => {
  const truncated = fakePem('RSA').split('\n').slice(0, 2).join('\n');
  assert.equal(scanSecrets(truncated).length, 1, '半截私钥仍是泄露');
  const r = redactSecrets(`${truncated}\n后面还有正常内容`);
  assert.ok(r.content.includes('后面还有正常内容'), '没有 END 时不得一路吞到文件末尾');
  assert.ok(!r.content.includes(truncated.split('\n')[1]!));
});

/*
 * ── 补丁只扫新增行（本轮流程被卡住时查出的第三个缺陷）──
 *
 * 删除行与上下文行的内容已经在 HEAD 里，扫它们拦不住已发生的泄露，只会拦住路过的人：
 * 动一下密钥夹具文件就送不进审查；更反过来的一例是「删掉一个真泄露的凭据」——
 * 那一行进删除侧，补丁被拒，安全修复本身过不了安全检查。
 */
test('补丁扫描：新增行里的凭据照拦，删除行与上下文行不拦', () => {
  const cred = FAKE.anthropic;
  const diff = [
    'diff --git a/x.ts b/x.ts',
    '--- a/x.ts',
    '+++ b/x.ts',
    '@@ -1,3 +1,3 @@',
    ` const ctx = "${cred}";`,   // 上下文行：HEAD 里就有
    `-const old = "${cred}";`,   // 删除行：正在把它删掉
    ' const after = 1;',
  ].join('\n');
  assert.deepEqual(scanDiffSecrets(diff), [], '既有内容与删除动作都不该被拦');
  assert.ok(scanSecrets(diff).length > 0, '前提：整份扫会命中——这正是上一版拦住删除凭据的原因');

  const added = diff.replace(`-const old = "${cred}";`, `+const added = "${cred}";`);
  const hits = scanDiffSecrets(added);
  assert.equal(hits.length, 1, '新增行里的凭据必须照拦');
  assert.equal(hits[0]?.rule, 'anthropic-key');
  assert.equal(added.split('\n')[hits[0]!.line - 1]?.startsWith('+const added'), true, '行号要指回 diff 里的那一行');
});

test('补丁扫描：`+++ b/<path>` 文件头不当成新增内容', () => {
  const diff = ['diff --git a/a b/a', '--- a/a', `+++ b/${FAKE.aws}`, '@@ -1 +1 @@', ' x'].join('\n');
  assert.deepEqual(scanDiffSecrets(diff), []);
});

test('补丁扫描：内容以 ++ 开头的新增行照扫（按 hunk 位置判，不按行首字符）', () => {
  /*
   * `++i;` 这类行在 diff 里是 `+++i;`，与文件头 `+++ b/<path>` 只差一个空格。
   * 上一版按前缀排除，把这类行整行踢出扫描论域（代码双审 r2 GLM-03 实测漏扫）。
   */
  const diff = ['diff --git a/x.c b/x.c', '--- a/x.c', '+++ b/x.c', '@@ -1 +1,2 @@', ` ++i; // ${FAKE.github}`].join('\n');
  assert.deepEqual(scanDiffSecrets(diff), [], '前提：上下文行不扫');

  const added = ['diff --git a/x.c b/x.c', '--- a/x.c', '+++ b/x.c', '@@ -1 +1,2 @@', `+++i; // ${FAKE.github}`].join('\n');
  const hits = scanDiffSecrets(added);
  assert.equal(hits.length, 1, '原始内容以 ++ 开头的新增行不得被当成文件头跳过');
  assert.equal(hits[0]?.rule, 'github-token');
});

test('补丁扫描：BRIEF 形态——hunk 外的散文整份扫，hunk 内只看新增行（CODEX-07）', () => {
  const brief = [
    '## 第 3 段 · 被审内容',
    '',
    '下面是本次补丁的节选：',
    'diff --git a/s.ts b/s.ts',
    '--- a/s.ts',
    '+++ b/s.ts',
    '@@ -1,2 +1,2 @@',
    `-const old = "${FAKE.anthropic}";`,
    ` const ctx = "${FAKE.aws}";`,
    '+const now = 1;',
    '',
    '## 第 4 段 · 任务目标',
    '把凭据从代码里挪走。',
  ].join('\n');
  assert.deepEqual(scanDiffSecrets(brief), [], 'hunk 内的删除行与上下文行不扫——否则拒绝点只是从补丁搬到 BRIEF');

  // hunk 外的散文照旧整份扫：BRIEF 的其余部分不是补丁
  const proseLeak = brief.replace('把凭据从代码里挪走。', `把 ${FAKE.google} 换掉。`);
  assert.equal(scanDiffSecrets(proseLeak).length, 1, 'hunk 外的散文必须整份扫');
});

test('assertNoSecrets 的 added-lines 模式真的接到了补丁判据上', () => {
  /*
   * 上一条只测了纯函数。落盘走的是 `assertNoSecrets(content, what, mode)`——
   * 分发那一行改错，纯函数用例照样全绿（变异⑲实测如此）。这条咬的是调用链。
   */
  const diff = ['@@ -1 +1 @@', `-const old = "${FAKE.anthropic}";`, ' const ctx = 1;'].join('\n');
  assert.doesNotThrow(() => assertNoSecrets(diff, 'x/code/_meta/changes.diff', 'added-lines'), '删除行不该拦');
  assert.throws(() => assertNoSecrets(diff, 'x/code/_meta/changes.diff', 'full'), '整份模式仍照拦——两种模式必须真的不同');
  assert.throws(
    () => assertNoSecrets(['@@ -1 +1 @@', `+const added = "${FAKE.anthropic}";`].join('\n'), 'x', 'added-lines'),
    '新增行里的凭据在补丁模式下照拦',
  );
});

test('PEM：脱敏窗口不跨结构字符，相邻 JSON 字段一个不丢', () => {
  /*
   * 上一版的 `[\s\S]{0,400}?` 窗口会把标记与材料之间的一切吞进占位串——实测一个完整的
   * `"hash"` 字段凭空消失，而 JSON 仍然合法，于是没人会发现（代码双审 r2 CODEX-02）。
   */
  const obj = { note: `提到 ${fakePem('RSA').split('\n')[0]} 而已`, hash: 'sha256:894572069b5e97c17ee520f8b4489b197f3a2d6270388fd4d4b8a35219290130', keep: '要保留的字段' };
  const r = redactSecrets(JSON.stringify(obj));
  const back = JSON.parse(r.content) as typeof obj;
  assert.equal(back.hash, obj.hash, '相邻字段不得被吞进占位串');
  assert.equal(back.keep, obj.keep);

  /*
   * 上一条只有在「材料判据也放宽」时才会红。真正咬住**窗口**的是这一条：
   * 标记在一个字段里、真 base64 材料在**另一个**字段里——宽窗口会从标记一路吃到那段材料，
   * 把中间的 `","body":"` 结构字符一并吞掉。
   */
  const split = { note: `提到 ${fakePem('RSA').split('\n')[0]} 而已`, body: fakePem('RSA').split('\n')[1]!, tail: '再一个字段' };
  const rSplit = redactSecrets(JSON.stringify(split));
  const backSplit = JSON.parse(rSplit.content) as typeof split;
  assert.equal(backSplit.tail, '再一个字段', '跨字段的窗口会把中间的结构字符吃掉');
  assert.ok(typeof backSplit.body === 'string', 'body 字段本身必须还在');

  // 真私钥落在 JSON 字符串里：整段抹掉，结构与相邻字段都完好
  const withPem = { out: fakePem('RSA'), tail: '后续字段' };
  const r2 = redactSecrets(JSON.stringify(withPem));
  const back2 = JSON.parse(r2.content) as typeof withPem;
  assert.ok(!back2.out.includes(fakePem('RSA').split('\n')[1]!), '正文必须消失');
  assert.equal(back2.tail, '后续字段');
});

test('PEM：脱敏产物再进扫描不会二次命中（占位串不含密钥材料）', () => {
  const once = redactSecrets(fakePem('RSA'));
  assert.equal(once.count, 1);
  assert.deepEqual(scanSecrets(once.content), []);
  assert.equal(redactSecrets(once.content).count, 0, '幂等');
});

test('行号定位正确', () => {
  const text = ['第一行', '第二行', `key: ${FAKE.anthropic}`].join('\n');
  const hits = scanSecrets(text);
  assert.equal(hits[0]?.line, 3);
});

test('assertNoSecrets 命中时抛出且不含原文', () => {
  const secret = FAKE.anthropic;
  assert.throws(
    () => assertNoSecrets(`token=${secret}`, 'plan/x-gemini.md'),
    (err: Error) => {
      assert.ok(err.message.includes('拒绝落盘'));
      assert.ok(err.message.includes('plan/x-gemini.md:1'));
      assert.ok(!err.message.includes(secret), '错误信息不得包含密钥原文');
      return true;
    },
  );
});

test('assertNoSecrets 干净内容不抛', () => {
  assert.doesNotThrow(() => assertNoSecrets('# 正常的审查结论\n没有密钥。', 'plan/x-glm.md'));
});

/*
 * ── 下面的假凭据一律运行时拼接、变量不叫 token / secret ──
 *
 * 本文件会进送审包，归档侧的密钥扫描扫的是 diff 原文：一行 `secret = 'sk-ant-…'`
 * 本身就命中规则，`review --start` 会拒绝冻结（它是对的，不绕）。上面既有用例里的
 * 字面量没动——新增用例放在文件末尾，别让它们进 diff 的上下文行。
 */
const fakeCred = seg('Qx7mZp2L', 'k9Rt4Wv1', 'Ab3Cd5Ef', '7Gh9Jk2M');
const fakeAnthropic = FAKE.anthropic;

/**
 * 假 PEM：**正文分段拼接**，让本文件的静态文本里没有 40+ 连续 base64。
 * 判据现在是「标记 + 密钥材料」，写成整段字面量本文件自己就会命中、进不了送审包——
 * 而这条约束正是本轮要验证的性质，所以夹具必须在运行时才拼出真形态。
 */
function fakePem(label: string): string {
  const body = [
    ['MIIEvQIBADANBgkq', 'hkiG9w0BAQEFAASC', 'BKcwggSjAgEAAoIB'].join(''),
    ['AQC7x9y8z7w6v5u4', 't3s2r1q0p9o8n7m6', 'l5k4j3i2h1g0f9e8'].join(''),
  ].join('\n');
  const mark = (kind: string) => `-----${kind}${label ? ` ${label}` : ''} ` + 'PRIVATE KEY-----';
  return `${mark('BEGIN')}\n${body}\n${mark('END')}`;
}

test('JSON 转义过的引号（\\"）不让凭据隐形——运行目录日志与 _meta 都是这个形态', () => {
  const jsonl = `{"item":{"aggregated_output":"experimental_bearer_token = \\"${fakeCred}\\""}}`;
  assert.ok(scanSecrets(jsonl).some((h) => h.rule === 'toml-bearer-token'), '转义引号后仍须命中');
  const generic = `{"r":"api_key = \\"${fakeCred}${fakeCred}\\""}`;
  assert.ok(scanSecrets(generic).some((h) => h.rule === 'generic-secret-assignment'));
});

// ── redactSecrets：运行目录日志的就地脱敏（EV-20，计划双审 CODEX-03）──

test('redactSecrets：命中处换成首尾预览，其余一字不动', () => {
  const { content, count } = redactSecrets(`前文 token=${fakeAnthropic} 后文`);
  assert.equal(count, 1);
  assert.ok(!content.includes(fakeAnthropic), '原文必须消失');
  assert.ok(content.startsWith('前文 token=') && content.endsWith(' 后文'), '上下文保留');
  assert.ok(content.includes('…'), '换成脱敏预览');
});

test('redactSecrets：干净文本原样返回、计数为 0；占位符不动（confirm 判定共用）', () => {
  const clean = 'const timeout = 900;\napi_key = "xxxxxxxxxxxxxxxxxxxxxxxx"\n';
  assert.deepEqual(redactSecrets(clean), { content: clean, count: 0 });
});

test('redactSecrets：TOML 里的 experimental_bearer_token 会被抹，JSON 字符串内脱敏后仍可解析', () => {
  const toml = `[model_providers.qwen]\nexperimental_bearer_token = "${fakeCred}"\nbase_url = "https://example.invalid/v1"\n`;
  const r = redactSecrets(toml);
  assert.ok(r.count >= 1);
  assert.ok(!r.content.includes(fakeCred));
  assert.ok(r.content.includes('experimental_bearer_token = "'), '只换值，键名与引号保留——日志还得能读');
  assert.ok(r.content.includes('base_url = "https://example.invalid/v1"'), '非密钥行不动');

  const json = JSON.stringify({ commands: [`cat cfg # experimental_bearer_token = "${fakeCred}"`] });
  const j = redactSecrets(json);
  assert.ok(!j.content.includes(fakeCred));
  assert.doesNotThrow(() => JSON.parse(j.content));

  // 两层转义：JSON 里再嵌一段 JSON（trace.json 把 stdout 的一行整体当字符串写入）（CODEX-07）
  const nested = JSON.stringify({ line: JSON.stringify({ out: `token = "${fakeCred}${fakeCred}"` }) });
  assert.ok(nested.includes('\\\\"'), '前提：确实出现了两层转义的引号');
  assert.ok(scanSecrets(nested).length > 0, '两层转义后仍须命中');
  const n = redactSecrets(nested);
  assert.ok(!n.content.includes(fakeCred));
  assert.doesNotThrow(() => JSON.parse(JSON.parse(n.content).line as string), '两层结构都保留');
});

test('redactSecrets：PEM 私钥整段抹除，不只抹 BEGIN 标记行（CODEX-03）', () => {
  const pem = fakePem('RSA');
  const bodyHead = pem.split('\n')[1]!;
  const r = redactSecrets(`前文\n${pem}\n后文`);
  assert.ok(!r.content.includes(bodyHead), '正文必须消失');
  assert.ok(r.content.includes('前文') && r.content.includes('后文'), '正文之外的内容一字不动');
  assert.ok(r.content.includes('<redacted>'));

  // JSON 字符串里的 PEM：换行是字面 \n，同样整段抹
  const inJson = JSON.stringify({ out: pem });
  const j = redactSecrets(inJson);
  assert.ok(!j.content.includes(bodyHead));
  assert.doesNotThrow(() => JSON.parse(j.content));
  assert.doesNotThrow(() => JSON.parse(j.content), '脱敏只动字符串值内部，结构不变');
});
