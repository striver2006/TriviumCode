/**
 * 措施 b（设计 §10.1 / BACKLOG EV-01）：命令文本字面扫描。
 *
 * **用例名与 `adapters/base.ts` 的已知形态清单一一对应**（`[F-n]` 前缀）。
 * 计划双审 GLM-07 要求把论域钉成可审计的闭集：不写数量，写清单；
 * 清单改了这里必须跟着改，`known-forms` 那条守卫会红。
 *
 * 为什么不写「五类」这个数字：起草计划时我从 `CLAUDE.md` 里 **RV-B1**（git commit
 * 的 Bash 拦截）搬了「五类形态」这个说法过来，那是**另一件事**的计数，
 * 与本措施毫无关系。数字随清单长度自然得出，不再单独出现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { checkPeerLeakViaCommand } from '../../src/trivium/adapters/base.js';

import { IS_WIN } from '../helpers/platform.js';

// Windows 移植：win32 的 path.isAbsolute 不认 '/proj' 这类盘相对形态；引号串里的 POSIX 绝对路径统一补 ${ABS} 盘符根（macOS 上为空串，字面不变）
const ABS = IS_WIN ? 'D:' : '';

const ROOT = `${ABS}/Users/x/proj`;
/** 典型 deny 条目：一份对端产物（文件）与一个运行目录（目录） */
const DENY = [
  `${ROOT}/.reviews/t/code/2026-01-01-t-gemini.md`,
  `${ROOT}/.trivium`,
];

function hit(cmd: string): boolean {
  return checkPeerLeakViaCommand([cmd], DENY, ROOT).leaked;
}

/* ── 已知形态：必检 ────────────────────────────────────────────────── */

test('[F-1] 绝对路径直引', () => {
  assert.equal(hit(`cat ${ROOT}/.reviews/t/code/2026-01-01-t-gemini.md`), true);
});

test('[F-2] 项目相对路径直引（含 ./ 前缀）', () => {
  assert.equal(hit('cat .reviews/t/code/2026-01-01-t-gemini.md'), true);
  assert.equal(hit('head -1 ./.reviews/t/code/2026-01-01-t-gemini.md'), true);
});

test('[F-3] git 对象库取值 —— 措施 a 看不见的那条通道', () => {
  /*
   * 这一条是整个措施 b 的存在理由：`git show HEAD:<path>` **不产生文件系统读取**，
   * 轨迹的 read_paths 里什么都没有，路径侧核验对它的效力是零。
   */
  assert.equal(hit('git show HEAD:.reviews/t/code/2026-01-01-t-gemini.md'), true);
  assert.equal(hit('git cat-file -p 9f2a1c3:.reviews/t/code/2026-01-01-t-gemini.md'), true);
});

test('[F-4] 目录级条目命中：deny 里是目录，命令读它下面的文件', () => {
  assert.equal(hit('ls -la .trivium/'), true);
  assert.equal(hit(`cat ${ROOT}/.trivium/state.json`), true);
});

test('[F-5] 引号与转义包裹', () => {
  assert.equal(hit(`cat "${ROOT}/.reviews/t/code/2026-01-01-t-gemini.md"`), true);
  assert.equal(hit("cat '.reviews/t/code/2026-01-01-t-gemini.md'"), true);
  assert.equal(hit('cat `echo .reviews/t/code/2026-01-01-t-gemini.md`'), true);
});

test('【误报】F-6 的回退层级里夹了实体目录段，不得命中', () => {
  /*
   * r2 双审 AGY-01 ≡ GLM-03。初版的逃树兜底是「归一后跑出项目树 ⇒ 判命中」，
   * 于是下面三条全部误命中——而**注释写的与实现完全相反**
   * （注释说「仍在项目树内就算命中」）。
   *
   * glm 定位了误报族在哪：`sensitive_globs` 派生的**短名**条目（`.env` / `id_rsa`）
   * 会作为**别的项目**的文件名逐字出现；run-id 档案名几乎撞不上。
   * 并给了反例——`../OtherProject/.env` 从**任何**树内 cwd 都到不了本项目的 deny，
   * 保守判定在此处换不来检出、只付出误作废。
   *
   * 收窄判据：deny 拼写之前的段必须**仅由 `..` / `.` 组成**。
   */
  assert.equal(hit('cat ../other-project/.reviews/t/code/2026-01-01-t-gemini.md'), false);
  assert.equal(hit('cat ../../some/.trivium/x'), false);
  // `.env` 不在本文件 DENY 里，该形态的断言移到 F-6 正例那条（用了自己的 deny 集）
});

test('[F-6] 锚定前缀：完整字面量在场，只是左边不是分隔符', () => {
  /*
   * 三种形态，r1 双审时**全部漏检**（GLM-01，两侧独立指出其中一部分）。
   *
   * 为什么它们不该算盲区：B-1 的定义是「完整字面量从不出现」，
   * 而这里字面量**逐字在场**，只是前面挂了个锚。更要紧的是 `../` ——
   * 那是 agent 在子目录工作时**最自然**的写法，属威胁模型承诺必检的
   * 「非对抗穿透」。把它记成盲区就是把承诺面缩到实现的形状上，方向反了。
   */
  assert.equal(hit('cat ../.reviews/t/code/2026-01-01-t-gemini.md'), true, '子目录相对写法');
  assert.equal(hit('cat $VAR/.reviews/t/code/2026-01-01-t-gemini.md'), true, '变量锚定');
  assert.equal(
    hit(`cat ${ROOT}/test/../.reviews/t/code/2026-01-01-t-gemini.md`), true,
    '绝对路径内嵌 ..（归一后就是 deny 条目）',
  );
  assert.equal(
    hit('cat sub/../../.reviews/t/code/2026-01-01-t-gemini.md'), true,
    '绕了一圈仍是纯回退层级',
  );
  /*
   * `.env` 不在本文件的 DENY 里，得用自己的 deny 集——
   * 起草这条时我直接用了 `hit()`，断言必红：**前提没核实**。
   * 这正是本轮立的那条纪律要防的：写下「应当命中」之前先确认它凭什么能命中。
   */
  const denyEnv = ['.env'];
  const hEnv = (c: string): boolean => checkPeerLeakViaCommand([c], denyEnv, ROOT).leaked;
  assert.equal(
    hEnv('cat ../.env'), true,
    '前置段是纯回退层级 ⇒ 命中。子目录 cwd 下 `cat ../.env` 读的就是项目那个 .env',
  );
  assert.equal(
    hEnv('cat ../OtherProject/.env'), false,
    '与上一条的区别只在那个实体目录段——这是 glm 点名的真实误报族',
  );
});

test('【误报】`~` 可静态展开，不得因含 ~ 就一律判命中', () => {
  /*
   * r2 双审 AGY-02 ≡ GLM-02，**本轮最该记的一条**。
   *
   * 初版把 `~` 归进 UNRESOLVABLE，在归一判定**之前**就 return true。
   * 而 `os.homedir()` 是**静态已知事实**——`spellingsOf` 自己就在用它做 F-7 的展开，
   * 把它塞进「不可静态解析」是归并错误。
   *
   * **更要紧的是**：我在 r1 应答 §2.1 白纸黑字承诺过
   * 「`~/.trivium/…` 归一后是 HOME 下的路径，不等于项目内条目」这条防线保住了——
   * 而实现里它不存在，**测试也没有任何一个方向钉住它**（GLM-02 的原话是
   * 「补一条负断言当场就会红」）。这条用例就是那条负断言。
   */
  assert.equal(hit('cat ~/.trivium/config.yaml'), false, '用户全局配置，不是对端产物');
  assert.equal(hit('cat ~/notes/.env'), false, '家目录下的无关 .env');
  assert.equal(hit('ls ~/.config/nvim'), false);
});

test('[F-7] 家目录写法：deny 是展开后的绝对路径，命令写 ~ 或 $HOME', () => {
  /*
   * 通道③的运行目录（`~/.trivium/runs`）经 expandHome 以**展开后的绝对路径**
   * 进 deny 集，而审查员看到 BRIEF 里的绝对路径后改写成 `~/…` 是自然动作。
   * r1 双审前 `ls ~/.trivium/runs` 漏检（AGY-03 ≡ GLM-02）——
   * 而 EV-01 明写措施 b 是**通道③在检测侧的唯一覆盖**。
   */
  // Windows 移植：家目录拼接走 path.join（win32 反斜杠；正斜杠写法由 spellings 的 posix 变体覆盖）
  const runRoot = path.join(os.homedir(), '.trivium/runs');
  const deny = [runRoot];
  const h2 = (c: string): boolean => checkPeerLeakViaCommand([c], deny, ROOT).leaked;
  assert.equal(h2(`ls ${runRoot}`), true, '展开态');
  assert.equal(h2('ls ~/.trivium/runs'), true, '~ 写法');
  assert.equal(h2('ls $HOME/.trivium/runs'), true, '$HOME 写法');
  assert.equal(h2('ls ${HOME}/.trivium/runs'), true, '${HOME} 写法');

  /*
   * `~user/` 形态（r3 双审 AGY-01 ≡ GLM-04）。
   *
   * **它当初是漏检，不是保守命中**——而我在那一轮的送审焦点里写的正是
   * 「`~user/` 归入保守命中，这个边界对不对」，**拿一个不存在的行为去问审查员**。
   *
   * 修的时候还先错了一层：给 `hitsAt` 加保守分支没用，因为四种派生拼写
   * 一个都不在 `~username/.trivium/runs` 里，扫描进不到那儿。真正的兜底是
   * `tildeUserHit` 单独扫 `~<name>/<后缀>` 再接到本机 HOME 下比。
   */
  assert.equal(h2('ls ~someone/.trivium/runs'), true, '他人家目录：解析不了，保守命中');
  assert.equal(
    h2(`ls ~${os.homedir().split(/[\\/]/).pop()}/.trivium/runs/abc`), true,
    '自查登录名：由同一条兜底覆盖，不必另派生拼写',
  );
  assert.equal(h2('ls ~someone/.config/nvim'), false, '后缀落不到 deny 之下的，不得误命中');

  /*
   * 正则的五类边界（r4 双审 AGY-01 + GLM-06）。根因是**我手写了第二套字符类**，
   * 与 `CMD_BOUNDARY` 各说各话；现在从同一份定义派生。
   */
  assert.equal(h2('echo ~;cat/.trivium/runs'), false, '①分号混进用户名段');
  assert.equal(h2('echo ~&&x/.trivium/runs'), false, '①&& 同族（九种控制符全试过）');
  assert.equal(h2('diff {other,~user/.trivium/runs}'), true, '②后缀不得吞掉右花括号');
  assert.equal(h2('npm i pkg@1.0~alpha/.trivium/runs'), false, '③~ 前必须有词首边界');
  assert.equal(h2('echo a~b/.trivium/runs'), false, '④词中 ~：shell 只在词首展开');
  assert.equal(h2('ls ~$HOME/.trivium/runs'), false, '⑤~$… 不是任何 shell 的合法登录名');
});

test('[F-6] 替换标记外壳被回扫切掉的形态', () => {
  /*
   * r4 双审 GLM-02，实测复现四条。`(`、`{`、反引号都在 CMD_BOUNDARY 里，
   * 于是 `cat $(pwd)/<rel>` 回扫出的 token 只剩 `/<rel>`——
   * **`UNRESOLVABLE` 永远看不到它本要保守处理的那个 `$`**。
   * `$VAR/` 能命中纯属巧合：`$` 不是边界字符，留在 token 里了。
   *
   * 判据看的是**闭合侧** `)` `}`：回扫止于路径左边最近的边界字符，
   * 而 `$(pwd)/x` 里那个字符是 `)`。起草时写成开启侧 `(` `{`，
   * 结果只有反引号（开闭同字符）侥幸修好，是重跑核实脚本才发现的。
   */
  assert.equal(hit('cat ${VAR}/.reviews/t/code/2026-01-01-t-gemini.md'), true, '${VAR}/');
  assert.equal(hit('cat $(pwd)/.reviews/t/code/2026-01-01-t-gemini.md'), true, '$(pwd)/');
  assert.equal(hit('cat `pwd`/.reviews/t/code/2026-01-01-t-gemini.md'), true, '反引号');
  assert.equal(
    hit('cat $(git rev-parse --show-toplevel)/.trivium/state.json'), true,
    'agent 在任意 cwd 读项目根的教科书写法——非对抗形态，承诺必检',
  );
});

test('[F-8] brace expansion', () => {
  assert.equal(hit('diff {.reviews/t/code/2026-01-01-t-gemini.md,other.md}'), true);
  assert.equal(hit('cat {other,.reviews/t/code/2026-01-01-t-gemini.md}'), true);
});

test('known-forms：清单里的每一类都有用例，且每一类都真的能命中', () => {
  /*
   * 这条守着「清单」与「实现」不分叉。它不是同义反复——上面五条各测各的形态，
   * 这条测的是**集合**：任何一类被实现漏掉，这里会红在具体那一行上。
   *
   * 起草时我差点把它写成「用例数 === 5」——那种断言按构造恒真，
   * 改坏实现不会红（本项目已四次栽在「绿测试证明不了任何事」上）。
   */
  const forms: Record<string, string> = {
    'F-1 绝对路径': `cat ${ROOT}/.reviews/t/code/2026-01-01-t-gemini.md`,
    'F-2 项目相对': 'cat .reviews/t/code/2026-01-01-t-gemini.md',
    'F-3 git 对象库': 'git show HEAD:.reviews/t/code/2026-01-01-t-gemini.md',
    'F-4 目录级': 'ls .trivium/',
    'F-5 引号包裹': `cat "${ROOT}/.reviews/t/code/2026-01-01-t-gemini.md"`,
    'F-6 锚定前缀': 'cat ../.reviews/t/code/2026-01-01-t-gemini.md',
    'F-8 brace': 'diff {.reviews/t/code/2026-01-01-t-gemini.md,x}',
    // 词内引号切分：完整字面量被一对引号从中间打断，不删引号就扫不出来
    'F-9 引号切分': 'cat ".reviews/t/code"/2026-01-01-t-gemini.md',
  };
  // F-7（家目录写法）用的是另一套 deny 条目（展开态 `$HOME` 绝对路径），
  // 正例在它自己那条用例里；本表只收能用 DENY 这套条目直接构造的形态。
  // r5 AGY-02：F-9 原先也漏在表外——它能用 DENY 构造，没有留在表外的理由。
  // 「清单与用例不分叉」由 known-forms-parity 那条契约测试守，不靠这张表
  for (const [name, cmd] of Object.entries(forms)) {
    assert.equal(hit(cmd), true, `${name} 应被检出：${cmd}`);
  }
});

/* ── 边界：不得误命中 ──────────────────────────────────────────────── */

test('【误报】同前缀的兄弟目录不得命中', () => {
  /*
   * `.trivium` 是 deny 条目，`.trivium-backup` 不是。纯 startsWith 会误伤，
   * 而误伤的后果是一次本该采纳的审查被判作废——比漏报更容易被当成系统故障。
   * 路径侧的 checkPeerLeak 早有同款守卫（其注释点名了这个坑），这里是命令侧的对应物。
   */
  assert.equal(hit('ls .trivium-backup/'), false);
  assert.equal(hit(`cat ${ROOT}/.trivium-backup/config.yaml`), false);
});

test('【误报】同名文件在别的仓库里，不得因项目相对写法命中', () => {
  assert.equal(hit(`cat ${ABS}/Users/other/repo/.reviews/t/code/2026-01-01-t-gemini.md`), false);
});

test('【误报】文件名是更长路径的一段尾巴，不得命中', () => {
  assert.equal(hit(`cat ${ABS}/tmp/backup-.reviews/t/code/2026-01-01-t-gemini.md`), false);
});

test('读自己的产出不算泄漏', () => {
  assert.equal(hit('cat .reviews/t/code/2026-01-01-t-claude.md'), false);
  assert.equal(hit('git log --oneline -5'), false);
});

/* ── macOS 的 /private 前缀：两侧归一必须一致 ──────────────────────── */

test('项目根带 /private 前缀时，项目相对写法仍要能命中', () => {
  /*
   * **这条是被故障注入用例逼出来的，不是我想到的。**
   *
   * `normalizeAbs` 会剥掉 macOS 的 `/private`（`/private/var/…` → `/var/…`），
   * 而 `spellingsOf` 起初拿 `nodePath.resolve(projectRoot)` 的**原样**去比前缀，
   * 于是在临时目录下 `startsWith` 恒假、项目相对写法一个都派生不出来。
   *
   * 上面那 17 条全绿——因为它们用的是干净的 `/Users/x/proj`，两边都不带 `/private`，
   * 恰好绕开了差异。**测试数据的「干净」本身就能藏 bug。**
   */
  const privRoot = `${ABS}/private/var/folders/ab/T/trivium-fx-XYZ`;
  const deny = ['.env', '.trivium'];
  const cmds = deny.map((p) => `git show HEAD:${p}`);
  const r = checkPeerLeakViaCommand(cmds, deny, privRoot);
  assert.equal(r.leaked, true);
  assert.equal(r.hits.length, 2);
});

test('deny 条目本身带 /private 的绝对路径，命令照原样写也要命中', () => {
  const privRoot = `${ABS}/private/var/folders/ab/T/trivium-fx-XYZ`;
  const denyAbs = `${privRoot}-runs`;
  assert.equal(
    checkPeerLeakViaCommand([`ls ${denyAbs}`], [denyAbs], privRoot).leaked, true,
  );
});

/* ── 空集与返回形态 ───────────────────────────────────────────────── */

test('没有命令、或没有禁读条目时，恒不命中且不抛', () => {
  assert.deepEqual(checkPeerLeakViaCommand([], DENY, ROOT), {
    leaked: false,
    hits: [],
    matches: [],
  });
  assert.deepEqual(checkPeerLeakViaCommand(['cat x'], [], ROOT), {
    leaked: false,
    hits: [],
    matches: [],
  });
});

test('命中要带上**是哪个条目、命令里那个路径归一到哪**', () => {
  /*
   * r2 代码双审的阻断一：只返回命令原文的话，调用方判不了这条命令碰的是哪一档，
   * 只能拿条目本身分类——而条目是整棵树，与路径通道逐条命中分类**不是同一个谓词**。
   *
   * 这里咬住的正是那份信息：`entry` 说撞的是哪棵树，`resolved` 说碰的是哪个文件。
   * 分档用后者：同一棵运行根下，己方材料与对端输出分属两档。
   */
  const cmd = 'git show HEAD:.reviews/t/code/2026-01-01-t-gemini.md';
  const { matches } = checkPeerLeakViaCommand([cmd, 'ls'], DENY, ROOT);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.command, cmd);
  assert.equal(matches[0]!.hits.length, 1);
  assert.equal(
    matches[0]!.hits[0]!.resolved,
    path.normalize(`${ROOT}/.reviews/t/code/2026-01-01-t-gemini.md`),
    'resolved 要是命令里那个路径本身，不是条目',
  );
});

test('返回的是**命令原文**而不是命中的路径', () => {
  /*
   * 这是刻意的：`git show HEAD:<path>` 与 `cat <path>` 在留痕上必须区分得开——
   * 两者的性质差别正是措施 b 存在的理由。只报路径的话，排查的人看不出
   * 「deny 生效了为什么还漏」。
   */
  const cmd = 'git show HEAD:.reviews/t/code/2026-01-01-t-gemini.md';
  const r = checkPeerLeakViaCommand([cmd, 'ls'], DENY, ROOT);
  assert.deepEqual(r.hits, [cmd]);
});

test('多条命令命中时去重', () => {
  const cmd = 'cat .reviews/t/code/2026-01-01-t-gemini.md';
  const r = checkPeerLeakViaCommand([cmd, cmd, 'ls .trivium/'], DENY, ROOT);
  assert.equal(r.hits.length, 2);
});

/* ── 明确检测不到的：把边界锁成断言，而不是只写在文档里 ──────────── */

/*
 * 把盲区写成**会红的断言**而不是只写进注释：哪天有人「顺手」扩了匹配面，
 * 这些会红，那时必须回到 §10.1 重新掂量承诺面，而不是默默扩大它。
 *
 * **起草这组时我写错了两条，实测才发现**——两个方向都错：
 * 一是把「变量拼接」整类判成盲区（实际只有**分段**拼接躲得过，
 * 整条赋值里带完整字面量是能检出的）；二是举 `git log -p -- .reviews` 当例子，
 * 而 `.reviews` 根本不在 deny 里，那个例子什么都证明不了。
 * 盲区写成断言的价值正在这里：**它会红在我的错误认知上**，散文不会。
 */

test('【已知盲区 B-1】分段拼接 —— 完整字面量从不出现', () => {
  assert.equal(hit('P=.reviews/t; cat $P/code/2026-01-01-t-gemini.md'), false);
});

test('【非盲区】整条赋值里带完整字面量，是能检出的', () => {
  // 与 B-1 的差别只在字面量完不完整；它在命令文本里就检得出，与变量无关
  assert.equal(hit('P=.reviews/t/code/2026-01-01-t-gemini.md; cat $P'), true);
});

test('【已知盲区 B-2】目录级 git 读取 —— 非蓄意也会撞上的两条之一', () => {
  /*
   * `git log -p -- <目录>` 会把该目录下全部历史内容吐出来（含对端产物），
   * 而命令文本里只有目录名、没有文件名。这是 §10.1「git 通道保留能力而非封死」
   * 那条取舍的代价：要收窄它得在**执行侧**限制能跑哪些命令，不是在这里加机制。
   *
   * 另一条非蓄意盲区是 B-5（见下），它是 F-6 收窄的代价。
   *
   * > 别把这句写成「收窄它的旋钮是裁 `readonly_commands`」——
   * > 那份清单从未有过消费方、已于 2026-10-01 删除（EV-15 结案），说它是旋钮就是在宣称一个不存在的机制。
   * > 这句死论证在四处被删过，第五处就在这段注释里活到了 r5（GLM-03）。
   */
  assert.equal(hit('git log -p -- .reviews/t/code'), false, '覆盖到了该文件却不指名');
  assert.equal(hit('git log -p -- .reviews/t/code/2026-01-01-t-gemini.md'), true, '指名了就命中');
});

test('【已知盲区 B-3】glob 展开检测不到', () => {
  assert.equal(hit('cat .reviews/*/code/*-gemini.md'), false);
});

test('【误报】文件名里的点不是路径回退，不得进 F-6', () => {
  /*
   * r3 双审 AGY-03 ≡ GLM-02。F-6 入口原先放行 `before === '.'`，
   * 于是 `cat ..env`（deny 含 `.env`）走进来：回扫出的 prefix 是 `.`，
   * 归一 + 过滤后**段列表为空**，`.every()` 对空数组恒真 ⇒ 误命中。
   *
   * 去掉 `.` 分支不损失真阳性——`./<rel>` 的匹配点在斜杠**之后**，走的是 `/` 分支。
   */
  const denyEnv = ['.env', 'id_rsa'];
  const hEnv = (c: string): boolean => checkPeerLeakViaCommand([c], denyEnv, ROOT).leaked;
  assert.equal(hEnv('cat ..env'), false, '两个点开头的文件名');
  assert.equal(hEnv('cat n/...env'), false, '目录下的点串文件名');
  assert.equal(hEnv('cat .id_rsa'), false, 'deny 是 id_rsa 时的同族');
  assert.equal(hEnv('cat ./.env'), true, '对照：./ 前缀仍走 F-6 并命中');
});

test('【已知盲区 B-5】重新指名项目根：归一后落回 deny，却因前置实体段判否', () => {
  /*
   * r3 双审 GLM-03 实测证伪了我写在 `prefixIsOnlyDotHops` 注释里的全称断言
   * 「`../OtherProject/<rel>` 从**任何**树内 cwd 都到不了本项目的 deny」。
   *
   * cwd 在两层子目录（审查员常在 `src/trivium` 一级工作）时，
   * `cat ../../../proj/<rel>` 归一后正是 deny——前置段却含实体名 `proj`。
   *
   * **不真收**：对整个 token 归一再判等于把「cwd = 项目根」换成另一组同样无据的假设，
   * 结果是一层侥幸命中、三层不命中——「深度决定检出」比明确的盲区更坏。
   */
  const hEnv = (c: string): boolean => checkPeerLeakViaCommand([c], ['.env'], ROOT).leaked;
  assert.equal(hEnv('cat ../../../proj/.env'), false, '两层 cwd 下重指名项目根：漏检');
});

test('[F-9] 删掉引号再扫一遍：拼写被引号打断的形态', () => {
  /*
   * **这一族 r3 时我登记成了盲区 B-6，r4 双审 GLM-03 拆穿了那个理由。**
   *
   * 我写的是「剥引号要处理嵌套与转义，是另一套穷举面」——那是
   * **完整引号解析**的难度。而这里需要的只是「删掉所有引号再扫一遍」，
   * 不解析任何结构。我用一个更难的问题替换了实际问题，
   * 再以前者的难度拒绝了后者。
   *
   * 安全性方向是对的（只增不减），但**别把新增的那部分说成「恰好落在 F-5 之内」**
   * ——r5 GLM-06 指出那句不准。如实是三句：
   *
   * 1. **词内引号切分**（`cat .trivium'/state.json'`）是**正确新增**的真阳性，
   *    但它不在 F-5 承诺过的范围里——F-5 说的是整包引号路径；
   * 2. **跨词粘连不可能**：删的是引号、不是空格，`cat "a" "b"` 删完仍是两个词；
   * 3. **单引号抑制展开形**（`cat '$HOME'/<后缀>`、`echo ~'root'/<后缀>`）是
   *    **保守误报**：shell 里单引号抑制展开，实际读的是字面目录。
   *    这与 `UNRESOLVABLE` 一族的代价同性质，**已接受**。
   *
   * **反引号不动**——删它会改变命令替换的语义，那才真是另一套穷举面。
   */
  // Windows 移植：家目录拼接走 path.join（win32 反斜杠；正斜杠写法由 spellings 的 posix 变体覆盖）
  const runRoot = path.join(os.homedir(), '.trivium/runs');
  const h = (c: string): boolean => checkPeerLeakViaCommand([c], [runRoot], ROOT).leaked;
  assert.equal(h('ls "$HOME"/.trivium/runs/abc'), true, '双引号切分');
  assert.equal(h("ls '$HOME'/.trivium/runs/abc"), true, '单引号切分');
  assert.equal(h('ls $HOME/.trivium/runs/abc'), true, '对照：不带引号');

  // 上面第 1 句：**词内**切分——完整字面量被一对引号从中间打断，
  // 不删引号扫不出来，且它不在 F-5（整包引号路径）承诺的范围内
  assert.equal(hit('cat ".reviews/t/code"/2026-01-01-t-gemini.md'), true, '词内切分（双引号）');
  assert.equal(hit("cat '.reviews'/t/code/2026-01-01-t-gemini.md"), true, '词内切分（单引号）');

  // 上面第 2 句：删的是引号不是空格，跨词粘连造不出来
  assert.equal(hit('cat ".reviews/t/code/2026-01-01-t" "-gemini.md"'), false, '跨词不得粘连');
});

test('[F-9] 删引号不得冲垮既有的误报防线', () => {
  /*
   * 二次扫描是「只增不减」的，所以要确认它没把那四条负例变成命中。
   */
  assert.equal(hit('ls .trivium-backup/'), false, '同前缀兄弟目录');
  assert.equal(hit(`cat ${ABS}/Users/other/repo/.reviews/t/code/2026-01-01-t-gemini.md`), false, '他库同名');
  assert.equal(
    hit('cat "/Users/other/repo/.reviews/t/code/2026-01-01-t-gemini.md"'), false,
    '他库同名 + 引号：删引号后仍在项目外',
  );
  assert.equal(hit(`cat ${ABS}/tmp/backup-.reviews/t/code/2026-01-01-t-gemini.md`), false, '路径尾巴');
});

test('【已知盲区 B-4】编码/间接：反斜杠转义检测不到', () => {
  /*
   * 反斜杠转义原先被 F-5 的名字「引号/**转义**包裹」暗示为已覆盖，
   * 而字面扫描根本看不见它（AGY-06）——名字承诺了没做的事。
   * F-5 已改名为「引号/命令替换包裹」，这一族归 B-4。
   *
   * 这条用例的存在本身是 known-forms-parity 逼出来的：
   * B-4 在清单里、却一直没有用例，对账第一次跑就红在这儿。
   */
  assert.equal(hit('cat \\.reviews/t/code/2026-01-01-t-gemini.md'), false);
});
