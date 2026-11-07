/**
 * 状态栏三色灯模型（FR-10，计划 r2 §D4；纯函数）。
 *
 * 🔴 审查中锁闭：任一闸门 running，或 state.json 存在但解析失败（unreadable——
 *     CLAUDE-02：损坏不能当「无闸门」静默绿灯，按锁闭保守处理）；
 * 🟡 闸门等待：无 running 但存在 review_done_awaiting_disposition / awaiting_approval；
 * 🟢 自由编辑：其余（无活跃闸门；approved/rejected/abandoned 终态经 RunEnded 回落）。
 */
export type LampColor = 'green' | 'yellow' | 'red';

export interface LampInput {
  /** 活跃闸门（ACTIVE_GATE_STATES 过滤后的 state 集合） */
  activeStates: string[];
  /** state.json 存在但解析失败（与「文件不存在」严格区分） */
  unreadable: boolean;
}

export interface LampState {
  color: LampColor;
  label: string;
  tooltip: string;
}

export function lampOf(input: LampInput): LampState {
  if (input.unreadable) {
    return {
      color: 'red',
      label: 'Trivium ⚠ 状态不可读',
      tooltip: 'state.json 存在但解析失败：无法确认是否审查中，按锁闭保守处理（保存将受警示）。请排查 .trivium/state.json。',
    };
  }
  if (input.activeStates.includes('running')) {
    return {
      color: 'red',
      label: 'Trivium 🔴 审查中',
      tooltip: '双审进行中：保存业务文件可能造成快照漂移、整轮作废（编辑与保存时会有警示）。',
    };
  }
  if (input.activeStates.length > 0) {
    return {
      color: 'yellow',
      label: 'Trivium 🟡 闸门等待',
      tooltip: '等待裁决或人工审批：驾驶舱的闸门区可处理；此期间保存业务文件会有警示。',
    };
  }
  return { color: 'green', label: 'Trivium 🟢 自由编辑', tooltip: '无活跃双审闸门。' };
}

/** 灯色 → 保存防护的拦截等级（green 放行；yellow/red 走警示路径） */
export function guardLevelOf(color: LampColor): 'free' | 'guarded' {
  return color === 'green' ? 'free' : 'guarded';
}
