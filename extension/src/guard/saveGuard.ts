/**
 * 保存防护与三色灯（FR-10，计划 r2 §D4；服务级，onStartupFinished 激活即装配）。
 *
 * ## API 边界（决定一切形态，交付说明如实声明）
 * VS Code **没有**取消保存的 API；`onWillSaveTextDocument` 的 waitUntil 共享 1.5 秒
 * 预算、超时保存照常继续、监听器三次失常被停用（@types/vscode index.d.ts:14533-14546）。
 * 因此本插件承诺「事前预警 + 事中警示 + 事后一键恢复」，**不承诺阻止写盘**：
 *
 * 1. 编辑期预警（事前）：锁态≠绿（含 unreadable）且业务文件被修改时弹 modal（每文档
 *    会话内一次，去重）——不在保存事件内，无时间预算约束；
 * 2. 保存瞬间警示（事中）：will-save 命中违规保存时，**同步经 e.waitUntil 挂起保存**
 *    直到磁盘快照读取完成（代码审 r1 CLAUDE-01/AGY-02/CODEX-01：快照必须先于落盘，
 *    否则基线失真或恢复提示不出现）；快照为原始字节 Buffer + 原 mode（CODEX-02/03：
 *    不经 UTF-8 文本往返、恢复不清执行位）；随后发非阻塞 toast；
 * 3. 保存后一键恢复（事后）：保存完成即弹带「恢复」按钮的警告；点击 → 按字节原子写回
 *    + 恢复原 mode + `workbench.action.files.revert` 重载盘上内容（AGY-03：revert 清
 *    除 dirty，autoSave 下不会死循环保存；不用 applyEdit——它会置 dirty）。
 *    快照读取失败/超时则放弃该次恢复（不发布错误基线，CODEX-01）。
 *
 * reason 分流（AGY-01）：Manual/AfterDelay/FocusOut 一律走 2+3 段（自动保存不轰炸）；
 * modal 只出现在第 1 段。
 *
 * 放行规则（顺序短路）：scheme≠file；不在工作区根下；relPath 以 `.reviews/`、
 * `.trivium/`（编排器写入区）、`.vscode/`（VS Code 设置文件——任务书硬约束；其下
 * 受跟踪文件的改动仍会被编排器快照捕获，属用户显式自担）开头；灯=绿。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { lampOf, guardLevelOf, type LampState } from '../approval/lampModel';
import type { StateWatch } from '../monitor/stateWatch';

interface Snapshot0 {
  /** 保存前磁盘内容的原始字节（CODEX-02：非 UTF-8 文件不做文本往返） */
  bytes: Buffer;
  /** 保存前文件 mode（CODEX-03：恢复不清执行位） */
  mode: number | null;
  savedAt: number;
}

export class SaveGuard implements vscode.Disposable {
  private readonly lamp: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  /** 编辑期预警去重（文档 uri → 已警示） */
  private readonly warnedDocs = new Set<string>();
  /** 待恢复快照（uri → 保存前磁盘内容；每文档只留最近一次） */
  private readonly snapshots = new Map<string, Snapshot0>();
  /** 保存代次（uri → 最新已开始的保存序号；r3 CODEX-03：迟到读取按代次丢弃） */
  private readonly saveSeq = new Map<string, number>();
  /** 已完成落盘的代次（uri → 最新已 did-save 的序号；r4 CODEX-02：关接收窗口） */
  private readonly saveSeqDone = new Map<string, number>();
  /** 保存完成时（did-save 后）的磁盘基线（uri → bytes；恢复前核对未被外部改动，r4 CODEX-01） */
  private readonly savedBaseline = new Map<string, Buffer>();
  private current: LampState = lampOf({ activeStates: [], unreadable: false });
  private lastSnapshotRaw = { activeStates: [] as string[], unreadable: false };
  private disposed = false;
  /** 测试可观测面 */
  toastLog: string[] = [];
  /** 测试可观测面：waitUntil 是否被调用（CLAUDE-01 竞态回归） */
  waitUntilCalls = 0;

  constructor(
    private readonly workspaceRoot: string,
    stateWatch: StateWatch,
    private readonly enabled: () => boolean = () => vscode.workspace.getConfiguration('trivium.guard').get<boolean>('saveGuard', true),
    /** 测试注入：静默 UI（不弹 modal/toast，只记 toastLog）——集成测试避免无头环境挂起 */
    private readonly silentUi = false,
  ) {
    this.lamp = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.lamp.command = 'trivium.openCockpit';
    this.disposables.push(
      this.lamp,
      stateWatch.onChange((snap) => {
        this.lastSnapshotRaw = {
          activeStates: snap.active.map((g) => g.state),
          unreadable: snap.unreadable,
        };
        this.updateLamp();
      }),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocChanged(e.document)),
      vscode.workspace.onWillSaveTextDocument((e) => {
        // CLAUDE-01/AGY-02/CODEX-01：同步注册 waitUntil——快照读取先于 VS Code 落盘；
        // 读取失败/超时由 onWillSave 内部消化（放弃恢复，不阻断保存）。
        // r3 CODEX-03：每次保存开始即取号，读取完成时若已有更新的保存开始则丢弃。
        this.waitUntilCalls += 1;
        const seq = (this.saveSeq.get(e.document.uri.toString()) ?? 0) + 1;
        this.saveSeq.set(e.document.uri.toString(), seq);
        // r4 CLAUDE-01：新保存开始即作废旧快照——本轮基线未知前，旧快照不得再作为
        // 恢复入口（第二次保存读取失败时，绝不能拿第一次的基线去「撤销」它）
        this.snapshots.delete(e.document.uri.toString());
        this.savedBaseline.delete(e.document.uri.toString());
        e.waitUntil(this.onWillSave(e.document, seq));
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => void this.onDidSave(doc)),
    );
    this.updateLamp();
  }

  /** 当前灯态（测试可观测面） */
  get lampState(): LampState {
    return this.current;
  }

  /** 待恢复快照数（测试可观测面） */
  get pendingSnapshots(): number {
    return this.snapshots.size;
  }

  /** 保存目标是否受防护（测试入口；对 closed 文档同样可判） */
  isProtected(uri: vscode.Uri): boolean {
    if (!this.enabled()) return false;
    if (guardLevelOf(this.current.color) === 'free') return false;
    if (uri.scheme !== 'file') return false;
    const rel = path.relative(this.workspaceRoot, uri.fsPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false; // 工作区外
    const norm = rel.split(path.sep).join('/');
    if (norm.startsWith('.reviews/') || norm.startsWith('.trivium/') || norm.startsWith('.vscode/')) return false;
    return true;
  }

  private updateLamp(): void {
    this.current = lampOf(this.lastSnapshotRaw);
    this.lamp.text = this.current.label;
    this.lamp.tooltip = this.current.tooltip;
    this.lamp.backgroundColor =
      this.current.color === 'red'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : this.current.color === 'yellow'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
    this.lamp.show();
  }

  // ── 第 1 段：编辑期预警（modal；每文档一次） ─────────────────────────────

  private onDocChanged(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== 'file') return;
    if (this.warnedDocs.has(doc.uri.toString())) return;
    if (!this.isProtected(doc.uri)) return;
    this.warnedDocs.add(doc.uri.toString());
    const rel = path.relative(this.workspaceRoot, doc.uri.fsPath);
    const msg = `编辑期预警：审查期间修改业务文件 ${rel}（保存时可能造成快照漂移、整轮作废）。`;
    this.toastLog.push(msg);
    if (this.silentUi) return;
    void vscode.window
      .showWarningMessage(
        `审查期间修改业务文件 ${rel}：保存时可能造成快照漂移、整轮作废（状态栏红灯/黄灯提示中）。`,
        { modal: true, detail: '如需修改请等本轮审查结束；关闭本提示不会解除警示，保存时仍会有警告与一键恢复。' },
      )
      .then(() => undefined);
  }

  // ── 第 2 段：保存瞬间警示（经 waitUntil 挂起保存直到快照完成） ───────────

  private async onWillSave(doc: vscode.TextDocument, seq: number): Promise<void> {
    if (!this.isProtected(doc.uri)) return;
    try {
      // 此刻盘上即保存前内容（保存被 waitUntil 挂起）；字节快照 + mode 一并留存。
      // 读取限时 1.2s（r2 CLAUDE-04/CODEX-04：超预算的迟到读取可能拿到保存后内容，
      // 宁可放弃该次恢复，不发布错误基线）
      const [bytes, st] = await Promise.race([
        Promise.all([fs.readFile(doc.uri.fsPath), fs.stat(doc.uri.fsPath)]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('snapshot-timeout')), 1_200)),
      ]);
      if (this.disposed) return;
      // 代次守卫（r3 CODEX-03）：此间又有新的保存开始 → 整次丢弃；
      // r4 CODEX-02：保存已完成（did-save 先到、预算被其它监听器耗尽）→ 同样丢弃，
      // 迟到读取不得发布没有恢复通知的快照
      if ((this.saveSeq.get(doc.uri.toString()) ?? 0) !== seq) return;
      if ((this.saveSeqDone.get(doc.uri.toString()) ?? 0) >= seq) return;
      this.snapshots.set(doc.uri.toString(), { bytes, mode: st.mode, savedAt: Date.now() });
      if (this.disposed) return;
      const rel = path.relative(this.workspaceRoot, doc.uri.fsPath);
      const msg = `⚠ 已保存到${this.current.color === 'red' ? '审查中' : '闸门期'}的业务文件：${rel}（可一键恢复到保存前）`;
      this.toastLog.push(msg);
      if (!this.silentUi) void vscode.window.showWarningMessage(msg);
    } catch {
      // 读不出/超时/新文件：无可靠基线——放弃该次恢复（r3 CLAUDE-07：文案不承诺恢复）
      const rel = path.relative(this.workspaceRoot, doc.uri.fsPath);
      const msg = `⚠ 已保存到${this.current.color === 'red' ? '审查中' : '闸门期'}的业务文件：${rel}（本次未取到保存前基线，无法一键恢复；如需回退请用 git）`;
      this.toastLog.push(msg);
      if (!this.silentUi) void vscode.window.showWarningMessage(msg);
    }
  }

  // ── 第 3 段：保存后一键恢复（显式点击；字节写回 + revert） ────────────────

  private async onDidSave(doc: vscode.TextDocument): Promise<void> {
    const uri = doc.uri.toString();
    // r4 CODEX-02：did-save 关闭本代次的快照接收窗口（此后返回的迟到读取一律丢弃）
    const seq = this.saveSeq.get(uri) ?? 0;
    if (seq > 0) this.saveSeqDone.set(uri, Math.max(this.saveSeqDone.get(uri) ?? 0, seq));
    // r5 CODEX-03：只对**存在待恢复快照**的保存读基线（绿灯/工作区外/未受防护的
    // 保存不再无条件积累 Buffer）；缓存带上限淘汰最旧
    if (this.snapshots.has(uri)) {
      try {
        this.savedBaseline.set(uri, await fs.readFile(doc.uri.fsPath));
        if (this.savedBaseline.size > 16) {
          this.savedBaseline.delete(this.savedBaseline.keys().next().value as string);
        }
      } catch {
        this.savedBaseline.delete(uri);
      }
    }
    const snap = this.snapshots.get(uri);
    if (!snap) return;
    if (this.silentUi) {
      // 测试形态：不弹选择框，等 restoreForTest 显式触发恢复
      return;
    }
    const rel = path.relative(this.workspaceRoot, doc.uri.fsPath);
    const pick = await vscode.window.showWarningMessage(
      `业务文件 ${rel} 已在${this.current.color === 'red' ? '审查中' : '闸门期'}被保存（可能造成快照漂移、整轮作废）。`,
      { modal: false },
      '恢复到保存前',
    );
    if (this.disposed) return;
    // 恢复前核对快照仍是当前代次（r2 CLAUDE-04/CODEX-05：连续保存后旧通知不得
    // 覆盖新内容——闭包里的 snap 可能已被更新或清除）
    if (pick === '恢复到保存前') {
      if (this.snapshots.get(doc.uri.toString()) === snap) {
        await this.restore(doc, snap);
      } else {
        void vscode.window.showWarningMessage('该恢复提示已过期（此间又有新的保存）：请以最新提示为准。');
      }
    } else {
      // 用户显式保留：只清**该通知所属的快照**（r3 CODEX-02：旧通知的关闭不得
      // 清掉新保存的恢复基线）；基线一并释放（r5 CODEX-03）
      if (this.snapshots.get(doc.uri.toString()) === snap) {
        this.snapshots.delete(doc.uri.toString());
        this.savedBaseline.delete(doc.uri.toString());
      }
      const keep = `已保留 ${rel} 的保存（用户选择）：漂移后果由编排器跑后复算判定。`;
      this.toastLog.push(keep);
      void vscode.window.showInformationMessage(keep);
    }
  }

  /** 测试入口：直接执行恢复（绕过弹窗） */
  async restoreForTest(doc: vscode.TextDocument): Promise<boolean> {
    const snap = this.snapshots.get(doc.uri.toString());
    if (!snap) return false;
    await this.restore(doc, snap);
    return true;
  }

  private async restore(doc: vscode.TextDocument, snap: Snapshot0): Promise<void> {
    const abs = doc.uri.fsPath;
    // 写回前最后核对（r3 CLAUDE-06/CODEX-01）：检查与写回之间仍有竞态窗口，
    // 此处收窄——快照已非当前代次则放弃
    if (this.snapshots.get(doc.uri.toString()) !== snap) {
      void vscode.window.showWarningMessage('恢复已取消：此间又有新的保存，请以最新提示为准。');
      return;
    }
    // r4 CODEX-01 / r5 AGY-01（上轮替换未命中，本轮直改）：通知等待期间磁盘被外部
    // 改动（终端/其它窗口）→ 按保存完成时的基线核对，不符则放弃恢复并提示人工裁决。
    // 编辑器内未保存的后续编辑在 revert 重载时会丢失——弹窗与交付说明均已声明。
    const baseline = this.savedBaseline.get(doc.uri.toString());
    if (baseline) {
      try {
        const now = await fs.readFile(abs);
        if (!now.equals(baseline)) {
          this.snapshots.delete(doc.uri.toString());
          this.savedBaseline.delete(doc.uri.toString());
          void vscode.window.showWarningMessage('恢复已取消：文件在保存后又被其它工具修改。请人工确认要保留哪个版本。');
          return;
        }
      } catch {
        /* 读失败按保守处理继续恢复 */
      }
    }
    // 按字节原子写回（tmp+rename 同目录；不做文本编码往返——CODEX-02）
    const tmp = `${abs}.trivium-restore-${Date.now()}`;
    await fs.writeFile(tmp, snap.bytes);
    if (snap.mode !== null) {
      try {
        await fs.chmod(tmp, snap.mode); // CODEX-03：恢复执行位等原权限
      } catch {
        /* chmod 失败不阻断写回（如实保留默认权限） */
      }
    }
    await fs.rename(tmp, abs);
    this.snapshots.delete(doc.uri.toString());
    // AGY-03：revert 重载盘上内容并清除 dirty——不用 applyEdit（它会置 dirty，
    // autoSave 下引发死循环保存）。revert 作用于活动编辑器：先把该文档带上前台。
    try {
      await vscode.window.showTextDocument(doc.uri, { preview: true, preserveFocus: false });
      await vscode.commands.executeCommand('workbench.action.files.revert');
    } catch {
      /* revert 不适用（文档已关闭等）：磁盘已恢复，编辑器按 VS Code 自身机制重载 */
    }
    const done = `已恢复 ${path.relative(this.workspaceRoot, abs)} 到保存前内容（按字节原样，含原权限）。`;
    this.toastLog.push(done);
    if (!this.silentUi) void vscode.window.showInformationMessage(done);
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.snapshots.clear();
    this.warnedDocs.clear();
  }
}
