/**
 * CLI 退出码 → 中文语义（纯展示层，非判定逻辑）。
 *
 * 退出码协议是编排器的契约（src/trivium/exit-codes.ts），插件只消费不发明。
 * 本表是展示映射，不是第二份判定：未知码原样显示。
 */
export interface ExitCodeMeaning {
  /** 一句话定性 */
  label: string;
  /** 给用户的下一步建议 */
  hint: string;
}

const TABLE: Record<number, ExitCodeMeaning> = {
  0: { label: '成功', hint: '' },
  1: { label: '一般失败', hint: '查看输出中的错误信息。' },
  2: { label: '闸门阻断', hint: '流水线闸门判定未满足（如裁决不齐备）。' },
  64: {
    label: '参数错误',
    hint: '多为缺提示语 / 模型 slug 非法 / 主题名非法，或正文里的 --xxx 被当旗标吞掉——请把正文写得不像旗标。',
  },
  65: {
    label: '前置产物缺失',
    hint: '找不到计划 / 根因材料 / 无代码变更。入口 B/C/D 需要先有被审对象。',
  },
  69: {
    label: '环境或预检失败',
    hint: 'CLI 不可调用、未认证、探针结论过期等——可在环境健康面板重新探测（doctor）。',
  },
  70: { label: '主题被锁', hint: '同主题已有运行持锁；可在监控区查看该运行或先中止。' },
  73: { label: '运行仍在进行', hint: '这不是失败，等待或刷新状态即可。' },
  75: { label: '超时或严格模式中止', hint: '单侧失败且为严格模式，整轮中止；工件保留。' },
  76: { label: '探针部分完成', hint: 'doctor 到时限仍有段未探完；已探完的段照常落盘。' },
};

export function explainExitCode(code: number): ExitCodeMeaning {
  return (
    TABLE[code] ?? { label: `未知退出码 ${code}`, hint: '请把输出发给维护者排查。' }
  );
}
