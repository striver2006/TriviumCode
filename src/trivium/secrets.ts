import { EXIT, TriviumError } from './exit-codes.js';
/**
 * 落盘前的密钥扫描（设计 §10.5 / NFR-04）。
 *
 * `archive` 在把任何 Markdown / JSON 写进 `.reviews/` 之前必须先过这里，命中即**拒绝落盘**。
 * 归档是要进 Git 的，一旦写入就等于永久泄露。
 *
 * 规则来源包含 M0 实测：本机 `~/.zcode/v2/config.json` 里的 provider 凭据为明文存储，
 * 形态正是 ZCode 的 `<apiKeyId>.<apiKeySecret>` 与裸 JWT——这类内容一旦被审查员摘录进结论
 * 就会随归档进库（坑清单 P-09）。本文件只保存**正则形态**，不保存任何真实密钥值。
 */

export interface SecretFinding {
  /** 规则名，用于报错时告诉人「命中了什么」 */
  rule: string;
  /** 1 起的行号 */
  line: number;
  /** 脱敏预览：只保留首尾各 4 字符 */
  preview: string;
}

interface Rule {
  name: string;
  re: RegExp;
  /** 命中后的额外判定，用于压低误报 */
  confirm?: (m: RegExpExecArray) => boolean;
  /**
   * 脱敏时只换这一组（值），保留键名与引号——供 `redactSecrets` 用。
   * 不设则整个匹配替换（那些规则的匹配本身就是凭据，如 JWT、`sk-…`）。
   */
  secretGroup?: number;
  /**
   * 跨行规则：在**全文**上扫一次，行号按匹配起点算。
   *
   * 逐行扫对 PEM 私钥这一族不够用——标记行与正文分处不同行，只看一行就无法区分
   * 「贴了私钥」与「在谈论私钥」。
   */
  document?: boolean;
  /**
   * 脱敏时改用这条正则（检出只需定位，脱敏要吃掉整段正文）。
   * 不设则脱敏与检出同一条。
   */
  redactRe?: RegExp;
  /** 用 `redactRe` 时的替换串。整段抹掉后 `redact()` 的首尾预览已无意义，换成可读的占位 */
  redactWith?: string;
}

/**
 * 赋值形态里值两侧的引号：允许 JSON 转义过的 `\"`。
 *
 * 运行目录里的 `stdout.jsonl` / `trace.json` 是 JSON，模型输出里的 `token = "…"` 落进去
 * 会变成 `token = \"…\"`——原正则的 `["']?` 遇到反斜杠就断了，整条凭据对扫描器隐形
 * （本轮用例第一次跑就抓到）。归档侧的 `_meta/*.json` 同形。
 */
const Q = String.raw`(?:\\*["'])?`; // `\\*`：允许任意层转义——JSON 里再嵌一段 JSON 会变成 `\\"`（代码双审 r1 CODEX-07）

/**
 * 赋值形态的键名两侧同样允许引号。
 *
 * 上一版只给**值**侧加了引号容差，于是标准 JSON 对象 `{"api_key": "…"}` 整条隐形——
 * 键名后面是 `"` 再 `:`，`\s*[:=]` 直接断掉（代码双审 r2 实测：TOML 形态命中、JSON 形态零命中）。
 * 而运行目录里的 `stdout.json`、`trace.json`、`auth.json` 全是标准 JSON。
 */
const KEY = (names: string) => String.raw`${Q}\b(?:${names})\b${Q}\s*[:=]\s*${Q}`;

/*
 * ── PEM 私钥：判据是「标记 + 正文」，不是「标记」──
 *
 * 上一版只认 BEGIN 标记行，两个方向都不对：
 *
 * **误报**（代码双审 r2 的实撞）：任何**谈论** PEM 的文本都命中——审查员读了本文件的
 * PEM 处理代码，在结论里引用一句标记行，整份审查文档就被归档闸拒绝落盘。三侧 23/12/6 分钟
 * 的配额烧完、结论全丢，而其中一条恰恰是下面这个漏报的发现。「提到锁」不等于「把钥匙贴出来」。
 *
 * **漏报**：标签写死枚举 `RSA|EC|DSA|OPENSSH|PGP`，于是 `-----BEGIN ENCRYPTED PRIVATE KEY-----`
 * （pkcs8 加密私钥，openssl 默认产物之一）对「命中即删」与归档闸**完全隐形**。
 *
 * 改成：标签通配（`BEGIN … PRIVATE KEY`），**且**其后必须出现一段 40+ 的连续 base64——
 * 那是密钥材料本身，真私钥必然带它，讨论性引用必然不带。这不是放宽：它同时堵上了枚举漏洞。
 *
 * 换行既可能是真换行，也可能是 JSON 字符串里的字面 `\n`（反斜杠 + n），两种都要跨得过去。
 */
const PEM_LABEL = String.raw`-----BEGIN[^\n-]{0,40}PRIVATE KEY[^\n-]{0,20}-----`;
const PEM_END = String.raw`-----END[^\n-]{0,40}PRIVATE KEY[^\n-]{0,20}-----`;
/** 换行：真换行，或 JSON 字符串里的字面 `\n`（可能被嵌套转义成 `\\n`） */
const NL = String.raw`(?:\\+[rn]|[\r\n])`;
/**
 * 标记与正文之间**只允许**换行与 PEM 头部行（`Proc-Type:` / `DEK-Info:`），不允许跨任意内容。
 *
 * 上一版用 `[\s\S]{0,400}?` 当窗口，等于「标记之后 400 字符内任意位置有一段长串」——
 * 而本项目的留痕里 `sha256:`/`tree:` 哈希密度极高，于是**谈论 PEM 的审查文档照旧被拒**
 * （三侧独立实测复现：标记 + 一个 sha256 即命中）。窗口换成正文起点，误报面收回到「真的贴了正文」。
 */
const PEM_GAP = String.raw`(?:[ \t]*${NL}+(?:[A-Za-z][A-Za-z-]{2,20}:[^\r\n]{0,80}${NL}+)*)`;
/**
 * 密钥材料：40+ 连续 base64，**且其中至少有一个非十六进制字符**。
 *
 * 纯 hex 的 40/64 位串是 git SHA-1 与 SHA-256，本项目到处都是；真 base64 密钥材料
 * 前 40 个字符全部落在 `[0-9a-fA-F]` 的概率是 4^-40，排除它几乎不损失检出面。
 */
const PEM_BODY = String.raw`(?=[A-Za-z0-9+/]{40})[A-Za-z0-9+/]{0,39}[g-zG-Z+/][A-Za-z0-9+/]*`;
/** 检出：标记本身（lookahead 不吞正文，preview 只暴露标记） */
const PEM_DETECT = new RegExp(`${PEM_LABEL}(?=${PEM_GAP}${PEM_BODY})`, 'g');
/**
 * 脱敏：从标记吃到正文末尾（有 END 就连 END 一起）。
 *
 * 尾部**不**用 `$` 兜底：私钥被截断时用 `$` 会把文件后半段一并抹掉。
 * 正文段只吃 base64 与换行——**不吃引号与逗号**：上一版的 `[\s\S]` 窗口会把相邻的 JSON
 * 字段整个吞进占位串（实测：一个 `"hash"` 字段凭空消失，而 JSON 仍然合法，于是无人发现）。
 */
const PEM_REDACT = new RegExp(
  `${PEM_LABEL}${PEM_GAP}${PEM_BODY}[A-Za-z0-9+/=]*(?:${NL}+[A-Za-z0-9+/=]+)*(?:${NL}*${PEM_END})?`,
  'g',
);
/**
 * 占位串。**刻意不含密钥材料**，于是它自身不再命中上面的判据——
 * 脱敏后的日志再进扫描不会被二次命中，本文件的源码也能正常进送审包。
 */
const PEM_PLACEHOLDER = '-----BEGIN PRIVATE KEY----- <redacted> -----END PRIVATE KEY-----';

/** 熵检测：过低熵的「密钥样子」的字符串多半是占位符（your_key_here、xxxxxxxx） */
function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** 明显的占位符，不算命中 */
const PLACEHOLDER = /^(your[_-]|example|placeholder|dummy|sample|test[_-]?key|xxx+|<.*>|\.\.\.)/i;

function looksReal(token: string): boolean {
  if (PLACEHOLDER.test(token)) return false;
  if (/^(.)\1+$/.test(token)) return false; // aaaaaa
  return shannonEntropy(token) >= 3.0;
}

/**
 * 源码声明的裸方法调用不是凭据字面值。仅确认「声明 + 裸标识符 + 无参方法调用」
 * 这一完整形态；不按项目/类名放行，不豁免带引号的值、普通配置或专用凭据规则。
 * 通用规则只吃到点号前的长标识符，必须结合两侧文本才能避免把类名当随机串。
 */
function isDeclaredMethodCall(m: RegExpExecArray): boolean {
  if (m.input === undefined || m.index === undefined) return false;
  if (!/(?:^|[\s;{}])(?:final|const|let|var)[ \t]+$/.test(m.input.slice(0, m.index))) return false;
  if (!/^[A-Za-z_]\w*[ \t]*=[ \t]*[A-Za-z_$]\w*$/.test(m[0])) return false;
  return /^[ \t]*\.[ \t]*[A-Za-z_$]\w*[ \t]*\([ \t]*\)[ \t]*;/.test(
    m.input.slice(m.index + m[0].length),
  );
}

const RULES: Rule[] = [
  {
    // ZCode 凭据：<apiKeyId>.<apiKeySecret>，中间有且仅有一个句点（设计 §3.3）
    name: 'zcode-api-key',
    re: /\b([0-9a-f]{24,64})\.([A-Za-z0-9]{12,64})\b/g,
    confirm: (m) => looksReal(m[2] ?? ''),
  },
  {
    // JWT：三段 base64url
    name: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    name: 'anthropic-key',
    re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    name: 'openai-key',
    re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: 'google-api-key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    name: 'github-token',
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    name: 'aws-access-key-id',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: 'slack-token',
    re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    name: 'private-key-block',
    re: PEM_DETECT,
    document: true,
    redactRe: PEM_REDACT,
    redactWith: PEM_PLACEHOLDER,
  },
  {
    /*
     * TOML 里的 provider 凭据赋值（M8 第 3 步，J9）。
     *
     * **为什么兜底规则扫不到它**：下面那条 `generic-secret-assignment` 要求
     * `\b(?:api_key|secret|token|…)\b`，而本机 codex 配置里的键名是
     * `experimental_bearer_token`——`token` 前面是下划线，是 word 字符，
     * **词边界不成立**，于是整条明文凭据对扫描器隐形。
     *
     * 这一条前移到本步而不是留到下一步（决策 D-3）：本步的 `prepareCodexHome`
     * 会把带明文 token 的 config.toml 与 auth.json 拷进运行目录，
     * 「产生风险的那一步」与「覆盖风险的那一步」之间不该隔着一轮双审。
     *
     * **规则名按凭据形态取，刻意避开 Agent id 字面**：`codex` 恰好既是 cliName
     * 又是 AgentId，写进规则名会被 `registry-parity` 的字面量对账命中
     * （`probes/codex.ts` 那条豁免的理由里预言过这种撞名）。而现有的
     * `zcode-api-key` 不命中，是因为 `zcode` 是 cliName、对应的 AgentId 是 glm——
     * codex 没有这个侥幸。按形态命名后，规则本身也更通用：任何 TOML provider
     * 配置都适用，不限于某一家。
     */
    name: 'toml-bearer-token',
    re: new RegExp(
      String.raw`${Q}\b[\w.]*(?:bearer_token|access_token|refresh_token|id_token)\b${Q}\s*[:=]\s*${Q}([A-Za-z0-9_\-+/.]{16,})${Q}`,
      'gi',
    ),
    confirm: (m) => looksReal(m[1] ?? ''),
    secretGroup: 1,
  },
  {
    // 兜底：形如 api_key = "…" / token: '…' / {"api_key": "…"} 的长随机串赋值
    name: 'generic-secret-assignment',
    re: new RegExp(
      `${KEY('api[_-]?key|secret|token|password|passwd|credential')}([A-Za-z0-9_\\-+/]{20,})${Q}`,
      'gi',
    ),
    confirm: (m) => looksReal(m[1] ?? '') && !isDeclaredMethodCall(m),
    secretGroup: 1,
  },
];

function redact(s: string): string {
  if (s.length <= 12) return `${s.slice(0, 2)}…${s.slice(-2)}`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * 扫描一段文本。返回全部命中（不短路），以便一次性把问题都告诉人。
 *
 * 注意：调用方**不得**把 finding.preview 之外的原文回显到日志或归档里。
 */
export function scanSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const rule of RULES) {
      if (rule.document) continue; // 跨行规则在下面对全文扫一次
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.confirm && !rule.confirm(m)) continue;
        findings.push({ rule: rule.name, line: i + 1, preview: redact(m[0]) });
        if (m[0].length === 0) rule.re.lastIndex++; // 防零宽死循环
      }
    }
  }

  // 跨行规则：行号由匹配起点之前的换行数算出，与逐行扫的行号口径一致
  for (const rule of RULES) {
    if (!rule.document) continue;
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(content)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      if (rule.confirm && !rule.confirm(m)) continue;
      const line = content.slice(0, m.index).split('\n').length;
      findings.push({ rule: rule.name, line, preview: redact(m[0]) });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

/**
 * 就地脱敏：把命中处换成 `redact()` 的首尾预览，其余内容一字不动。
 *
 * 供运行目录里**编排器自写的日志**用（`<侧>/stdout.jsonl`、`stdout.json`、`trace.json`，
 * 见 `scrub.ts`）。它们是排障依据、不能删，但模型若在沙箱里读了自己的配置副本，
 * 明文凭据就会随命令输出逐字落在这里——2026-09-16 那次泄露的留痕正是这个形态
 * （计划双审 CODEX-03）。
 *
 * 与 `assertNoSecrets` 的分工：那边守的是**要进 Git 的归档**，命中即拒绝落盘；
 * 这边守的是**项目外的运行目录**，文件已经在盘上，能做的只有把值抹掉。
 * 规则集共用，`confirm` 判定共用——不另起一套「哪些算密钥」的口径。
 */
export function redactSecrets(content: string): { content: string; count: number } {
  let count = 0;
  let out = content;
  for (const rule of RULES) {
    /*
     * 脱敏用 `redactRe`（有的话）：检出只需定位标记，脱敏要连正文一起吃掉——
     * 只换标记等于什么都没抹，正文 base64 原样留下（代码双审 r1 CODEX-03）。
     */
    if (rule.redactRe) {
      const with_ = rule.redactWith ?? '<redacted>';
      rule.redactRe.lastIndex = 0;
      out = out.replace(rule.redactRe, () => {
        count++;
        return with_;
      });
      continue;
    }
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (...args: unknown[]) => {
      const whole = args[0] as string;
      // replace 回调的参数形态与 exec 结果不同，按 exec 的形态重建一次（末两项是 offset 与全文）
      const m = [whole, ...(args.slice(1, -2) as string[])] as unknown as RegExpExecArray;
      m.index = args[args.length - 2] as number;
      m.input = args[args.length - 1] as string;
      if (rule.confirm && !rule.confirm(m)) return whole;
      count++;
      // 赋值形态只换值、留键名与引号：日志还得能读；其余规则整个匹配就是凭据
      const g = rule.secretGroup !== undefined ? m[rule.secretGroup] : undefined;
      return g ? whole.replace(g, redact(g)) : redact(whole);
    });
  }
  return { content: out, count };
}

/**
 * 文本是否带脱敏痕迹（EV-257）：脱敏产出的全部形态都在本仓生成——`redactWith` 的 `<redacted>`
 * （含 PEM 占位符）、`scrubGatewayEnv` 的 `<redacted-env>`、`redact()` 首尾预览里唯一的分隔符 `…`。
 * 新增脱敏形态时在这里一并改；单测逐一喂各形态的实际产出锁住。
 *
 * 用途是**回读字段**的兜底判定：模型名这类结构化字段若带痕迹，说明回读被脱敏吞了，
 * 不能当回读成功记。匹配区分大小写——形态由本仓代码固定产出。
 */
export function hasRedactionMark(s: unknown): boolean {
  return typeof s === 'string' && (s.includes('<redacted') || s.includes('…'));
}

/**
 * 扫一段**可能内嵌 unified diff** 的文本：diff hunk 内只看新增行，hunk 外整份扫。
 * 行号按原文行号报，便于直接定位。
 *
 * ## 为什么补丁不能整份扫
 *
 * 补丁落盘要防的是「**这次改动**把凭据带进仓库」。而删除行与上下文行的内容**已经在 HEAD 里**，
 * 扫它们拦不住任何已经发生的泄露，只会拦住路过的人。两个具体后果，本轮都撞到了：
 *
 * - 动一下测试夹具文件（它必须与真凭据同形，否则测不了扫描器），既有夹具就作为上下文行进补丁，
 *   于是**涉及密钥模块的改动一律送不进审查**；
 * - 更反过来的一例：**删掉一个真泄露的凭据**，那一行进删除侧 → 补丁被拒 → 安全修复本身过不了安全检查。
 *
 * 新增行仍然整份扫：那才是这次要写进 Git 的东西。所以这不是放宽判据，是把判据对准它要防的事。
 *
 * ## 为什么按 hunk 判而不是按行首字符判
 *
 * 上一版用 `startsWith('+') && !startsWith('+++')` 区分新增行与文件头，把**原始内容以 `++` 开头**的
 * 新增行（`++i;`、markdown 的 `++ins++`）一并排除——那类行整行退出扫描论域（代码双审 r2 实测漏扫）。
 * `+++ b/<path>` 只出现在 `@@` 之前的文件头里，按 hunk 位置判就不会与内容混淆。
 *
 * 同一判据也用于 BRIEF：它把补丁节选逐字嵌在散文中间，hunk 外的散文必须整份扫，
 * 否则放宽只是把拒绝点从补丁搬到 BRIEF（代码双审 r2 CODEX-07）。
 *
 * 不连续的新增行会被拼成一段再扫，跨行规则（PEM）因此可能在两段不相邻的新增内容上凑出匹配——
 * 方向是多拦，不是漏拦。
 */
export function scanDiffSecrets(text: string): SecretFinding[] {
  const lines = text.split('\n');
  const kept: string[] = [];
  const lineNoOf: number[] = [];
  let inHunk = false;
  const keep = (s: string, i: number) => {
    kept.push(s);
    lineNoOf.push(i + 1);
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith('@@ ')) {
      inHunk = true;
      continue; // hunk 头只有行号信息
    }
    if (!inHunk) {
      // 文件头的路径行不是内容；其余（BRIEF 的散文）整份扫
      if (/^(?:diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |similarity index |rename )/.test(l)) continue;
      keep(l, i);
      continue;
    }
    // hunk 内：首字符是 diff 前缀
    if (l.startsWith('+')) {
      keep(l.slice(1), i);
      continue;
    }
    if (l.startsWith('-') || l.startsWith(' ') || l.startsWith('\\') || l === '') continue;
    // 不带前缀的行说明 hunk 结束（BRIEF 里补丁节选之后的散文）
    inHunk = false;
    keep(l, i);
  }
  return scanSecrets(kept.join('\n')).map((f) => ({ ...f, line: lineNoOf[f.line - 1] ?? f.line }));
}

/**
 * 供 archive 使用：命中即抛，附可读的定位信息（不含密钥原文）。
 * `mode: 'added-lines'` 用于 unified diff，判据见 `scanDiffSecrets`。
 */
export function assertNoSecrets(
  content: string,
  whatItIs: string,
  mode: 'full' | 'added-lines' = 'full',
): void {
  const hits = mode === 'added-lines' ? scanDiffSecrets(content) : scanSecrets(content);
  if (hits.length === 0) return;
  const detail = hits
    .map((h) => `  ${whatItIs}:${h.line}  [${h.rule}]  ${h.preview}`)
    .join('\n');
  // 受控错误：这是明确的判定，不是程序缺陷——cli 顶层不打堆栈，按一般失败退出
  throw new TriviumError(
    EXIT.FAIL,
    `拒绝落盘：检测到疑似密钥（归档会进 Git，写入即永久泄露）。\n${detail}\n` +
      `若确认为误报，请修改内容或调整 review.sensitive_globs 后重试；不要绕过本检查。`,
  );
}
