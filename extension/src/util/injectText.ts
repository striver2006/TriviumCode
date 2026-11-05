/**
 * 注入正文整形（r2 计划 D1′，AGY-01 裁决落点）。
 *
 * 入口命令的参数契约是 `<正文> [旗标]`——正文是**聊天输入**，不是 shell 参数：
 * 不做引号包裹、不做 shell 转义；但 TTY 注入对多行不友好，需要单行化，
 * 且正文以 `--` 开头时可能被解析器当旗标吞掉（与 CLI 的 swallowedTextHint 同源风险），
 * 要在 UI 层给出警示。
 */

/** 单行化：连续空白（含换行、制表）压成单个空格；首尾去空白 */
export function flattenBody(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export interface InjectTextResult {
  /** 整形后的正文 */
  text: string;
  /** 给 UI 的警示（空数组表示无） */
  warnings: string[];
}

/** 整形注入正文：单行化 + 可疑形态警示（纯函数） */
export function prepareBody(raw: string): InjectTextResult {
  const warnings: string[] = [];
  const text = flattenBody(raw);
  if (!text) {
    warnings.push('正文为空：入口命令会缺少任务目标/焦点，解析将退 64。');
  }
  if (/^--[A-Za-z]/.test(text)) {
    warnings.push(
      '正文以 --xxx 开头：可能被入口命令解析器当成旗标连同后一个词吞掉，' +
        '请调整措辞（例如先写一句说明再写旗标字样）。',
    );
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > 2048) {
    warnings.push(
      `正文约 ${(bytes / 1024).toFixed(1)}KB：TTY 注入长文本可能被吞或截断，` +
        '建议精简正文，详细材料用 --context 传文件路径。',
    );
  }
  return { text, warnings };
}
