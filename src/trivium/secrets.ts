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
}

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
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    // 兜底：形如 api_key = "…" / token: '…' 的长随机串赋值
    name: 'generic-secret-assignment',
    re: /\b(?:api[_-]?key|secret|token|password|passwd|credential)\b\s*[:=]\s*["']?([A-Za-z0-9_\-+/]{20,})["']?/gi,
    confirm: (m) => looksReal(m[1] ?? ''),
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
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.confirm && !rule.confirm(m)) continue;
        findings.push({ rule: rule.name, line: i + 1, preview: redact(m[0]) });
        if (m[0].length === 0) rule.re.lastIndex++; // 防零宽死循环
      }
    }
  }
  return findings;
}

/** 供 archive 使用：命中即抛，附可读的定位信息（不含密钥原文） */
export function assertNoSecrets(content: string, whatItIs: string): void {
  const hits = scanSecrets(content);
  if (hits.length === 0) return;
  const detail = hits
    .map((h) => `  ${whatItIs}:${h.line}  [${h.rule}]  ${h.preview}`)
    .join('\n');
  throw new Error(
    `拒绝落盘：检测到疑似密钥（归档会进 Git，写入即永久泄露）。\n${detail}\n` +
      `若确认为误报，请修改内容或调整 review.sensitive_globs 后重试；不要绕过本检查。`,
  );
}
