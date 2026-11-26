/**
 * 驾驶舱编排（FR-2/3/4/5 的宿主侧）。
 *
 * 职责：装配表单数据 → 前置链（resolve→preflight→确认→claim）→ 注入终端（M1）
 * → 运行监控（M1/M3 同路径）→ 续话中继 / 中止 / 打开产物。全部 IO 在宿主侧，
 * Webview 只渲染（postMessage 快照式推送，幂等）。
 *
 * 生命周期（代码审 CLAUDE-07/CODEX-05）：本类持有全局监听的 Disposable 句柄，
 * 面板关闭即退订；extension.ts 维持单例。所有异步路径在 await 后复查 disposed，
 * 关闭后不再安装任何 watcher/定时器。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { promises as fs } from 'node:fs';
import type { TriviumServices } from '../services';
import { cockpitHtml } from './cockpitHtml';
import { assembleEntryCommand, findSkillDoc, type EntryKind } from '../launch/entryCommand';
import { claimAfterConfirm, runResolveAndPreflight, type PrechainReport, type PrechainFlags } from '../launch/prechain';
import { carrierOf, type CarrierDescriptor } from '../launch/carriers';
import { resolveGlmInteractive, type InteractiveProgram } from '../launch/glmInteractive';
import { readDriverCatalog, driverArgs, emptyCatalog, type DriverChoice } from '../launch/driverModels';
import { launchSignature, terminalKey, type LaunchOptions } from '../launch/terminalRelay';
import { StdoutTail } from '../monitor/stdoutTail';
import { RunWatch } from '../monitor/statusWatch';
import { ReviewWatch, type ReviewFile } from '../monitor/reviewWatch';
import { locateRunDir, locateRunDirWithRetry } from '../monitor/runDiscovery';
import type { StatusRender } from '../monitor/statusModel';
import { phaseLabel, sideStateLabel } from '../monitor/statusModel';
import { buildHealth } from '../env/health';
import { worstVerdict, type SchemaVerdict } from '../env/versionCheck';
import type { ScopeState } from '../reviews/annotationHub';
import { openDiffFor } from '../reviews/diffView';
import { diffMember } from '../reviews/diffParse';
import { verdictLabel } from '../reviews/reviewParse';
import type { GateCheckOutput } from '../cli/commands';
import { gateCardsOf, mergeGateCheck, noVoteNote, type GateCardModel } from '../approval/gateAreaModel';
import { summarizeWorktreeHint, authoritativeFiles, type GitRunner, type WorktreeHint } from '../approval/worktreeSummary';
import { buildGapModel, type GapModel, type Verdict } from '../disposition/gateGapModel';
import { readRunMeta, allFallbackIds, expectedAddresses, resolveDriverId, criticOfId } from '../disposition/runMeta';
import {
  renderDisposition, renderRepaired, renderFrontMatter, parseDispositionDoc, draftFileName, saveDraft, safeCell, appendRowByColumns,
  type DraftRow, type ParsedDisposition, type SurgeryOps,
} from '../disposition/dispositionDraft';
import { assemblyOf, presetFromAssembly } from '../presets/presetModel';

interface FormState extends DriverChoice {
  driver: string;
  critics: string[];
  entry: string;
  body: string;
  topic: string;
  maxRounds?: number;
  profile?: string;
  ctxPaths: string[];
  extraFlags: string;
}

interface RunCard {
  runId: string;
  topic: string | null;
  stage: string | null;
  phase: string;
  phaseLabel: string;
  terminal: boolean;
  /** 闸门已回落但尚未取到 CLI 终态（CLAUDE-06：不再伪装运行中） */
  ended: boolean;
  sides: { critic: string; state: string; stateLabel: string; model: string | null; elapsedS: number | null }[];
  stale: boolean;
  note: string | null;
  message: string | null;
  artifacts: string[];
  reviewFiles: { name: string; absPath: string; role: string | null }[];
  logTail: string | null;
  /** FR-6a：批注宿主的逐侧意见摘要（仅该 run 为焦点回放时有值） */
  findingsSummary: Array<{ critic: string; verdictLabel: string; counts: Record<string, number>; state: string; notice: string | null }> | null;
  /** FR-6a：焦点 run 的逐条意见（含漂移/降级标注与解析级别；relPath 供 Diff/跳转，CLAUDE-01）。
   *  CLAUDE-05：已按逐家开关过滤（组头计数仍为全量）；secondary 为次级位置文本（CLAUDE-03） */
  findings: Array<{
    critic: string; id: string; severity: string; location: string; problem: string;
    level: string; label: string | null; consistency: string;
    relPath: string | null; file: string | null; startLine: number | null; endLine: number | null; inChangeset: boolean;
    secondary: string[];
  }> | null;
  /** 当前逐家开关状态（空数组 = 全部启用；驱动 Webview 分组头 checkbox，CLAUDE-05） */
  enabledCritics: string[] | null;
  /** 一致性未校验提示（plan 阶段/git 不可用，D2′：列表侧注明） */
  consistencyNote: string | null;
  /** 装配超限提示（CLAUDE-11） */
  buildNotice: string | null;
}

interface RunEntry {
  stdout: StdoutTail;
  watch: RunWatch;
  reviewWatch: ReviewWatch | null;
  render: StatusRender | null;
  stale: boolean;
  note: string | null;
  reviewFiles: ReviewFile[];
  logTail: string | null;
  endNote: string | null;
  ended: boolean;
}

export class Cockpit implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private readonly runs = new Map<string, RunEntry>();
  /** 重开面板时补读刚看过的运行，只留路径索引，不保留句柄或输出正文。 */
  private readonly recentRuns = new Map<string, { dir: string; topic: string; stage: string }>();
  /** 发现中的 run（CODEX-06：并发事件去重） */
  private readonly discovering = new Set<string>();
  /** 重试耗尽后的低频重发现（CLAUDE-04） */
  private readonly pendingRuns = new Map<string, { topic: string; stage: string; timer: ReturnType<typeof setInterval> }>();
  private currentSessionKey: string | null = null;
  private igniting = false;
  private prechainRevision = 0;
  private conflictId = 0;
  private conflict: { id: number; key: string; terminal: vscode.Terminal; signature: string } | null = null;
  private frozenLaunch: string | null = null;
  private mode: 'M1' | 'M3' = 'M3';
  /** 数据版本不兼容 → 只读降级（CODEX-07/AGY-04）：禁点火 */
  private degradedReason: string | null = null;
  private readonly schemaVerdicts: SchemaVerdict[] = [];
  /** 前置链成功时冻结的表单快照 + 解析主题（CLAUDE-08：确认与点火绑定） */
  private frozenForm: FormState | null = null;
  private frozenTopic: string | null = null;
  private readonly serviceDisposables: vscode.Disposable[] = [];
  /** FR-6a：批注宿主 scope 状态（订阅刷新；面板关闭不影响 Hub 本身，D4′） */
  private hubState: ScopeState | null = null;
  private disposed = false;
  // ── Phase 3（FR-8/FR-9/FR-11）──────────────────────────────────────────
  /**
   * 闸门区：gate --check 结果缓存。值带 runId 身份、键含 runId（代码审 r1
   * CLAUDE-07/AGY-04/CODEX-05：raf→aa 或同主题新轮次不得复用上一轮的计票/缺口）。
   */
  private readonly gateCheckCache = new Map<string, { runId: string; check: GateCheckOutput | null; hint: WorktreeHint | null }>();
  /** 审批动作在途集合（防双击，代码审 r1 CLAUDE-14） */
  private readonly gateActionBusy = new Set<string>();
  /** 裁决台会话（null=未打开） */
  private deskSession: {
    topic: string;
    stage: string;
    model: GapModel;
    /** 表单输入（id → 裁决；每行全量携带；removeable 行带 removed 标志） */
    rows: Map<string, { verdict: Verdict | null; reason: string; action: string; removed?: boolean }>;
    /** 用户可编辑的 addresses（派生初值，CLAUDE-12/AGY-06：派生为空时的手工兜底通道） */
    addresses: string[];
    /** 修复形态：现有件载入时的全文（写回 hash 比对用）与解析结果（原文手术用） */
    loadedText: string | null;
    parsed: ParsedDisposition | null;
    /** 已确认的预览（落盘只落这份内容，CLAUDE-05：表单变更即失效） */
    confirmedPreview: { text: string; path: string; formHash: string } | null;
    /** severity 回填（id → 展示标签） */
    severityOf: Map<string, string>;
  } | null = null;

  constructor(private readonly services: TriviumServices) {
    this.serviceDisposables.push(
      services.stateWatch.onChange((snap, ended) => {
        if (snap.schemaReason) this.reportSchemaIssue(snap.schemaReason); // CODEX-07
        const prevActive = new Map(this.lastGateSnapshot.map((g) => [`${g.topic}/${g.stage}`, g]));
        this.lastGateSnapshot = snap.active.map((g) => ({
          topic: g.topic,
          stage: g.stage,
          state: g.state,
          runId: g.runId,
          since: g.since,
          rerunIndex: g.rerunIndex,
        }));
        // 状态或 runId 迁移 → 失效对应闸门卡缓存（不展示上一轮的计票/缺口；
        // r3 AGY-02：runId 轮转时连旧 runId 的缓存条目一并清理）
        let gatesChanged = prevActive.size !== this.lastGateSnapshot.length;
        for (const g of this.lastGateSnapshot) {
          const prev = prevActive.get(`${g.topic}/${g.stage}`);
          if (!prev || prev.runId !== g.runId || prev.state !== g.state) {
            gatesChanged = true;
            this.gateCheckCache.delete(`${g.topic}/${g.stage}/${g.runId}`);
            if (prev && prev.runId !== g.runId) this.gateCheckCache.delete(`${g.topic}/${g.stage}/${prev.runId}`);
          }
        }
        void this.syncRuns(snap.active.map((g) => ({ runId: g.runId, topic: g.topic, stage: g.stage })));
        for (const e of ended) this.markEnded(e.runId, e.endState);
        // gate --check 可能原子重写同一状态。只在卡片身份或状态改变时重取，
        // 否则自身的文件事件会不断废弃在途结果，使批准按钮迟迟不能显示。
        if (gatesChanged) void this.pushGateArea(snap);
      }),
      services.relay.onSessionClosed((key) => {
        if (key === this.currentSessionKey) {
          this.setMode('M3');
          this.post({ type: 'banner', kind: 'info', text: '协同终端已关闭：驾驶舱切换为 M3，继续监控已启动的运行。后续轮次或计划定稿需要恢复 Driver 会话。' });
        }
      }),
      // FR-6a：Hub scope 变化 → 重推 run 卡（意见列表实时刷新；服务级监听，
      // 面板关闭期间侧完成落盘照样推进 Hub，重开面板即见）
      services.annotationHub.onScopeChange((state) => {
        this.hubState = state;
        void this.pushRuns();
        void this.fillDeskSeverity(); // 裁决台开着时同步回填 severity
      }),
    );
  }

  async open(): Promise<void> {
    if (this.disposed) return;
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel('triviumCockpit', 'Trivium 驾驶舱', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    });
    this.panel.webview.html = cockpitHtml(getNonce(), this.panel.webview.cspSource);
    // 面板关闭 ≠ 实例销毁（CLAUDE-01/AGY-r2-01/CODEX-01）：只做面板级清理，
    // 实例与服务订阅保留，再次 open 重建面板与监控（订阅回放带回活跃 run）
    this.panel.webview.onDidReceiveMessage((m) => void this.onMessage(m));
    this.panel.onDidChangeViewState(({ webviewPanel }) => {
      for (const run of this.runs.values()) run.stdout.show(webviewPanel.visible);
      if (webviewPanel.visible) void this.pushRuns();
    });
    this.panel.onDidDispose(() => {
      this.panel = null;
      this.conflict = null;
      this.prechainRevision++;
      this.frozenForm = null;
      this.disposeRuns();
    });
    // 订阅可能晚于 StateWatch 初始扫描（构造竞态）：打开面板时显式重扫一次，
    // 保证活跃 run 一定能进看板（回放 + 重扫双保险）
    await this.services.stateWatch.rescan();
    await this.sendInit();
    for (const [id, ref] of this.recentRuns) {
      const status = await fs.stat(path.join(ref.dir, 'status.json')).catch(() => null);
      if (!status?.isFile()) this.recentRuns.delete(id);
      else if (!this.runs.has(id) && !this.discovering.has(id)) await this.attachRun(ref.dir, id, ref.topic, ref.stage, false);
    }
  }

  /** 扩展停用时的最终销毁（面板关闭走 disposeRuns，见 open()） */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.serviceDisposables) d.dispose();
    this.serviceDisposables.length = 0;
    this.disposeRuns();
    this.panel?.dispose();
    this.panel = null;
  }

  /** 测试可观测面：run 条目摘要（集成测试断言用，不做业务） */
  runStates(): Array<{ runId: string; ended: boolean; note: string | null; endNote: string | null }> {
    return [...this.runs.entries()].map(([runId, e]) => ({
      runId,
      ended: e.ended,
      note: e.note,
      endNote: e.endNote,
    }));
  }

  get isPanelOpen(): boolean {
    return this.panel !== null;
  }

  /** 测试通道：显式关闭面板（触发 onDidDispose 的面板级清理路径） */
  closePanelForTest(): void {
    this.panel?.dispose();
  }

  /** 测试可观测面：run 卡片快照（FR-6a 意见列表数据断言用） */
  async cardsForTest(): Promise<RunCard[]> {
    return this.runCards();
  }

  // ── 初始化与消息 ─────────────────────────────────────────────────────────

  private async sendInit(): Promise<void> {
    const probe = await this.services.env.loadProbe();
    const cfg = await this.services.env.loadConfig();
    const { checkSchema } = await import('../env/versionCheck');
    this.addSchemaVerdict(checkSchema(cfg.schema, 'config'));
    this.post({
      type: 'init',
      health: buildHealth(probe),
      profileNames: cfg.profileNames,
      mode: this.mode,
      runs: await this.runCards(),
    });
    await this.pushGateArea(); // FR-9：打开面板即见闸门区（订阅回放已带一次，双保险）
    await this.pushPresets(); // FR-11
  }

  /** 三源（config/state/status）schema 结论汇总 → 命中即降级只读（CODEX-07） */
  private addSchemaVerdict(v: SchemaVerdict): void {
    this.schemaVerdicts.push(v);
    const worst = worstVerdict(this.schemaVerdicts);
    if (worst.kind !== 'ok' && this.degradedReason === null) {
      this.degradedReason = `数据版本可能不兼容（${worst.reason}）：已降级只读监控，点火已禁用。`;
      this.post({ type: 'banner', kind: 'warn', text: this.degradedReason });
      this.post({ type: 'degraded', degraded: true });
    }
  }

  private reportSchemaIssue(reason: string): void {
    this.addSchemaVerdict({ kind: 'incompatible', reason });
  }

  private async onMessage(m: Record<string, unknown>): Promise<void> {
    if (this.disposed) return;
    switch (m['type']) {
      case 'ready':
        for (const run of this.runs.values()) run.stdout.show(this.panel?.visible === true, true);
        break;
      case 'stdout-resync':
        this.runs.get(String(m['runId']))?.stdout.show(this.panel?.visible === true, true);
        break;
      case 'open-stdout': {
        const file = await this.runs.get(String(m['runId']))?.stdout.completePath(String(m['critic']), Number(m['attempt']));
        if (file) await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
        else vscode.window.showWarningMessage('该次完整 stdout 已清理或无法核实文件身份');
        break;
      }
      case 'driver-catalog': {
        const carrier = carrierOf(String(m.driver));
        if (!carrier) break;
        const panel = this.panel;
        let catalog;
        try {
          const program = await this.interactiveProgram(carrier);
          catalog = await readDriverCatalog(carrier.agentId, program, this.services.root, this.terminalEnv());
        } catch (error) { catalog = emptyCatalog(error instanceof Error ? error.message : String(error)); }
        if (this.panel === panel) this.post({ type: 'driver-catalog', driver: carrier.agentId, request: m.request, catalog });
        break;
      }
      case 'keep-terminal': {
        const conflict = this.conflict;
        if (!conflict || m.id !== conflict.id) break;
        this.conflict = null;
        const session = this.services.relay.find(conflict.key);
        if (session && session.terminal === conflict.terminal && session.terminal.exitStatus === undefined) {
          session.terminal.show(true);
          this.currentSessionKey = session.key;
          this.setMode(session.entrySent ? 'M1' : 'M3');
          this.post({ type: 'session-command', cmdText: session.launch.entryText });
        }
        break;
      }
      case 'form-changed':
        this.conflict = null;
        this.prechainRevision++;
        this.frozenForm = null;
        break;
      case 'prechain':
        await this.handlePrechain(m['form'] as unknown as FormState, m.request);
        break;
      case 'ignite':
        await this.handleIgnite(m['form'] as unknown as FormState, String(m['topic'] ?? ''), m.conflictId);
        break;
      case 'resend':
        await this.handleResend();
        break;
      case 'relay':
        await this.handleRelay(String(m['text'] ?? ''));
        break;
      case 'cancel':
        await this.handleCancel(String(m['runId'] ?? ''));
        break;
      case 'copy':
        void vscode.env.clipboard.writeText(String(m['text'] ?? ''));
        vscode.window.showInformationMessage('已复制到剪贴板');
        break;
      case 'pick-context': {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true,
          canSelectFolders: true,
          defaultUri: vscode.Uri.file(this.services.root),
          openLabel: '加入 context',
        });
        if (picked) this.post({ type: 'ctx-picked', paths: picked.map((u) => u.fsPath) });
        break;
      }
      case 'open-file':
        try {
          await vscode.window.showTextDocument(vscode.Uri.file(String(m['path'])), { preview: true });
        } catch {
          vscode.window.showErrorMessage(`打不开文件：${String(m['path'])}`);
        }
        break;
      case 'open-finding': {
        // FR-6a/6b：点击意见 → 跳转到解析后的行区间（与批注同源）
        const file = String(m['file'] ?? '');
        const start = Number(m['startLine'] ?? 1);
        const end = Number(m['endLine'] ?? start);
        if (!file) break;
        try {
          const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
          const s = Math.max(0, Math.min(start - 1, editor.document.lineCount - 1));
          const e = Math.max(s, Math.min(end - 1, editor.document.lineCount - 1));
          editor.revealRange(new vscode.Range(s, 0, e, 0), vscode.TextEditorRevealType.InCenter);
          editor.selection = new vscode.Selection(s, 0, e, 0);
        } catch {
          vscode.window.showErrorMessage(`打不开文件：${file}`);
        }
        break;
      }
      case 'open-diff': {
        // FR-6d：意见关联变更的 Diff 视图（冻结基线；降级明示）
        const relPath = String(m['relPath'] ?? '');
        const runId = m['runId'] ? String(m['runId']) : null;
        const start = m['startLine'] !== undefined ? Number(m['startLine']) : undefined;
        const end = m['endLine'] !== undefined ? Number(m['endLine']) : undefined;
        if (!relPath) break;
        const diff = this.services.annotationHub.diffOf(runId);
        const outcome = await openDiffFor(this.services.root, diff, relPath, start !== undefined ? { startLine: start, endLine: end ?? start } : undefined);
        this.post({ type: 'banner', kind: 'info', text: `Trivium Diff：${outcome.note}` });
        break;
      }
      case 'toggle-critic': {
        // FR-6b：逐家开关（切换即全量重建，幂等）
        const critic = String(m['critic'] ?? '');
        if (!critic) break;
        const current = this.services.annotationHub.getEnabledCritics();
        if (current.size === 0) {
          // 首次关闭：全集合减去该家（inScope 为准）
          const all = new Set(this.services.annotationHub.criticsInScope());
          all.delete(critic);
          await this.services.annotationHub.setEnabledCritics(all);
        } else if (current.has(critic)) {
          current.delete(critic);
          await this.services.annotationHub.setEnabledCritics(current);
        } else {
          current.add(critic);
          await this.services.annotationHub.setEnabledCritics(current);
        }
        break;
      }
      case 'focus-run': {
        // FR-6a：卡片上切换回放轮次（与状态栏同一入口）
        const runId = String(m['runId'] ?? '');
        if (runId) await this.services.annotationHub.setActiveRun(runId);
        break;
      }
      case 'refresh-health':
        await this.refreshHealth(false);
        break;
      case 'doctor-static':
        await this.refreshHealth(true);
        break;
      case 'entry-changed':
        await this.pushArgHint(String(m['entry'] ?? 'A'));
        break;
      // ── Phase 3：闸门区（FR-9）──
      case 'gate-refresh':
        await this.refreshGateCard(String(m['topic'] ?? ''), String(m['stage'] ?? ''));
        break;
      case 'approve-req':
        await this.handleApprove(String(m['topic'] ?? ''), String(m['stage'] ?? ''));
        break;
      case 'reject-req':
        await this.handleReject(String(m['topic'] ?? ''), String(m['stage'] ?? ''), String(m['reason'] ?? ''));
        break;
      case 'abandon-req':
        await this.handleAbandon(String(m['topic'] ?? ''), String(m['stage'] ?? ''));
        break;
      // ── Phase 3：裁决台（FR-8）──
      case 'gate-open':
        await this.openDesk(String(m['topic'] ?? ''), String(m['stage'] ?? ''));
        break;
      case 'desk-close':
        this.deskSession = null;
        this.post({ type: 'desk-closed' });
        break;
      case 'desk-update': {
        // 表单全量回传（每行 {id, verdict, reason, action, removed?}）；校验留待 preview/save，
        // 不阻断输入；任何变更使已确认预览失效（CLAUDE-05）
        if (this.deskSession) {
          const rows = (m['rows'] as Array<{ id: string; verdict: string | null; reason: string; action: string; removed?: boolean }>) ?? [];
          for (const r of rows) {
            const v = r.verdict === '接受' || r.verdict === '驳回' || r.verdict === '暂缓' ? r.verdict : null;
            this.deskSession.rows.set(r.id, { verdict: v, reason: r.reason ?? '', action: r.action ?? '', removed: r.removed === true });
          }
          const before = this.deskSession.confirmedPreview;
          if (before !== null && before.formHash !== this.deskFormHash()) {
            this.deskSession.confirmedPreview = null; // 真实变更 → 预览失效，须重新预览确认
          }
        }
        break;
      }
      case 'desk-addresses': {
        // addresses 手工编辑（CLAUDE-12/AGY-06：派生失败时的兜底通道；每行一项）
        if (this.deskSession) {
          const text = String(m['text'] ?? '');
          this.deskSession.addresses = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
          this.deskSession.confirmedPreview = null;
        }
        break;
      }
      case 'desk-preview':
        await this.previewDesk();
        break;
      case 'desk-save':
        await this.saveDesk();
        break;
      case 'locate-finding':
        await this.locateFinding(String(m['id'] ?? ''));
        break;
      // ── Phase 3：预设（FR-11）──
      case 'preset-list':
        await this.pushPresets();
        break;
      case 'preset-save':
        await this.savePreset(String(m['name'] ?? ''), String(m['scope'] ?? 'workspace'), m['form'] as unknown as FormState);
        break;
      case 'preset-save-req': {
        // Webview 沙箱禁用 window.prompt（r2 AGY-02）：名称输入走宿主 InputBox
        const scope = m['scope'] === 'global' ? 'global' : 'workspace';
        const name = await vscode.window.showInputBox({
          prompt: `预设名称（存入${scope === 'global' ? '用户级（跨工作区）' : '工作区级'}）`,
          placeHolder: '如：三审严格档',
        });
        if (name === undefined || name.trim() === '') {
          if (name !== undefined) this.post({ type: 'preset-result', ok: false, note: '预设名不能为空。' });
          return;
        }
        await this.savePreset(name, scope, m['form'] as unknown as FormState);
        break;
      }
      case 'preset-delete-req': {
        // 删除确认走宿主 modal（r2 CLAUDE-09/CODEX-10）
        const name = String(m['name'] ?? '');
        const scope = m['scope'] === 'global' ? 'global' : 'workspace';
        const yes = await vscode.window.showWarningMessage(
          `确认删除预设「${name}」（${scope === 'global' ? '用户级' : '工作区级'}）？`,
          { modal: true },
          '删除',
        );
        if (yes !== '删除') return;
        await this.deletePreset(name, scope);
        break;
      }
      case 'preset-load':
        await this.loadPreset(String(m['name'] ?? ''), String(m['scope'] ?? 'workspace'));
        break;
      case 'preset-delete':
        await this.deletePreset(String(m['name'] ?? ''), String(m['scope'] ?? 'workspace'));
        break;
    }
  }

  private async refreshHealth(doctor: boolean): Promise<void> {
    if (doctor) {
      const r = await this.services.cmds.doctorStatic();
      this.post({
        type: 'banner',
        kind: r.out?.ok ? 'info' : 'warn',
        text: r.out?.ok ? '静态重探完成（--no-model-calls，零配额）。' : `静态重探失败（退出码 ${r.code}）；探针缓存可能已过期，可在终端跑 trivium doctor。`,
      });
    }
    const probe = await this.services.env.loadProbe();
    this.post({ type: 'health', health: buildHealth(probe) });
  }

  private async pushArgHint(entry: string): Promise<void> {
    const form = this.frozenForm;
    if (!form) return;
    const doc = await findSkillDoc(form.driver as never, entry as EntryKind, this.services.repoRoot);
    this.post({ type: 'arg-hint', text: doc?.argHint ?? null });
  }

  // ── 前置链与点火 ──────────────────────────────────────────────────────────

  private async interactiveProgram(carrier: CarrierDescriptor): Promise<InteractiveProgram> {
    if (!vscode.workspace.isTrusted) throw new Error('请先确认当前工作区可信，再查询或启动 Driver。');
    const probe = await this.services.env.loadProbe();
    if (carrier.agentId === 'glm') {
      const cfg = vscode.workspace.getConfiguration('trivium.launch', vscode.Uri.file(this.services.root));
      return resolveGlmInteractive({ trusted: vscode.workspace.isTrusted, configuredPath: cfg.get<string>('glmInteractivePath'),
        configuredNode: cfg.get<string>('glmNodePath'), cli: probe?.cli.zcode, wrapper: this.services.cli.wrapperPath() });
    }
    const entrypoint = probe?.cli[carrier.cliKey]?.entrypoint;
    if (typeof entrypoint !== 'string' || !path.isAbsolute(entrypoint)) throw new Error(`探针无 ${carrier.display} 绝对入口，请先运行 doctor。`);
    return { source: '探针', launchMode: carrier.launchMode, entrypoint };
  }

  private terminalEnv(): NodeJS.ProcessEnv {
    const root = this.services.root;
    const platform = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'windows' : 'linux';
    const overrides = vscode.workspace.getConfiguration('terminal.integrated', vscode.Uri.file(root))
      .get<Record<string, string | null>>('env.' + platform);
    const env = { ...process.env };
    for (const [name, value] of Object.entries(overrides ?? {})) {
      if (value === null) delete env[name];
      else env[name] = value.replace(/\$\{(workspaceFolder|userHome|env:([^}]+))\}/g, (_, variable, key) =>
        variable === 'workspaceFolder' ? root : variable === 'userHome' ? homedir() : process.env[key] ?? '');
    }
    return env;
  }

  private async prepareLaunch(form: FormState) {
    const carrier = carrierOf(form.driver);
    if (!carrier) throw new Error('未知 Driver。');
    const program = await this.interactiveProgram(carrier);
    const files = await Promise.all([program.entrypoint, ...(program.nodePath ? [program.nodePath] : [])].map(async file => {
      const real = await fs.realpath(file);
      const stat = await fs.stat(real);
      if (!stat.isFile()) throw new Error('Driver 入口不是文件。');
      await fs.access(real, program.launchMode === 'shellCommand' && file === program.entrypoint ? fs.constants.R_OK : fs.constants.X_OK);
      return [real, stat.size, stat.mtimeMs];
    }));
    const env = this.terminalEnv();
    // 两项默认时没有待验证的覆盖，也无需等供应商的在线目录。
    const catalog = form.driver !== 'glm' && form.driverModel === undefined && form.driverEffort === undefined
      ? emptyCatalog('') : await readDriverCatalog(carrier.agentId, program, this.services.root, env);
    const nativeArgs = driverArgs(carrier.agentId, catalog, form);
    const model = catalog.models.find(m => m.id === form.driverModel);
    const routes = Object.entries(env).filter(([name]) => /^(HOME$|CODEX_HOME$|CLAUDE_CONFIG_DIR$|ANTHROPIC_|GEMINI_|ANTIGRAVITY_|JETSKI_|ZCODE_)/.test(name)).sort();
    // 会话只存摘要；供应商环境可能包含凭据，不发送到 Webview 或日志。
    const programIdentity = createHash('sha256').update(JSON.stringify([files, routes, catalog.provider,
      model?.label ?? catalog.defaultModel, form.driverEffort ?? catalog.defaultEffort])).digest('hex');
    return { carrier, program: { ...program, nativeArgs, programIdentity } };
  }

  private async handlePrechain(form: FormState, request: unknown): Promise<void> {
    const revision = ++this.prechainRevision;
    this.conflict = null;
    this.frozenForm = null;
    this.frozenTopic = null;
    this.frozenLaunch = null;
    try {
      if (this.degradedReason) throw new Error(this.degradedReason);
      if (!(await this.services.cli.wrapperExists())) throw new Error('未找到 .trivium/bin/trivium wrapper，请先初始化工作区。');
      const flags = prechainFlagsOf(form);
      const { program } = await this.prepareLaunch(form);
      const report = await runResolveAndPreflight(this.services.cmds, { entry: form.entry as EntryKind, body: form.body, flags });
      if (this.disposed || revision !== this.prechainRevision) return;
      const cmd = assembleEntryCommand({ agentId: form.driver as never, entry: form.entry as EntryKind,
        body: form.body, flags: cliFlagsForCommand(form) });
      if (!report.failed) {
        this.frozenForm = form;
        this.frozenTopic = report.topic;
        this.frozenLaunch = launchSignature(program);
      }
      this.post({ type: 'prechain-result', request, report, cmdText: cmd.text });
      if (!report.failed) await this.pushArgHint(form.entry);
    } catch (error) {
      if (revision === this.prechainRevision) this.post({ type: 'prechain-result', request,
        report: failedReport('preflight', null, error instanceof Error ? error.message : String(error)) });
    }
  }

  private async handleIgnite(form: FormState, topic: string, conflictId: unknown): Promise<void> {
    if (this.igniting) return;
    const frozen = this.frozenForm;
    const valid = () => !this.disposed && frozen && frozen === this.frozenForm && this.frozenTopic === topic && formEquals(frozen, form);
    if (!valid()) {
      this.post({ type: 'banner', kind: 'warn', text: '请先按当前装配重新执行前置链，再点火。' });
      return;
    }
    this.igniting = true;
    try {
      const { carrier, program } = await this.prepareLaunch(form);
      const signature = launchSignature(program);
      if (signature !== this.frozenLaunch) throw new Error('交互入口或参数在预检后发生变化，请重新执行前置链。');
      if (!valid()) return;
      const key = terminalKey(form.driver, topic, form.entry);
      const existing = this.services.relay.find(key);
      const glm = carrier.agentId === 'glm';
      let openNewBeside: vscode.Terminal | undefined;
      if (existing && existing.terminal.exitStatus === undefined) {
        if (launchSignature(existing.launch) !== signature) {
          if (!this.conflict || this.conflict.id !== conflictId || this.conflict.terminal !== existing.terminal ||
              this.conflict.signature !== signature) {
            this.conflict = { id: ++this.conflictId, key, terminal: existing.terminal, signature };
            this.post({ type: 'launch-conflict', id: this.conflict.id, before: choiceDescription(existing.launch),
              after: choiceDescription({ ...program, ...form }) });
            return;
          }
          this.conflict = null;
          openNewBeside = existing.terminal;
        } else if (glm) {
          existing.terminal.show();
          this.currentSessionKey = key;
          this.setMode(existing.entrySent ? 'M1' : 'M3');
          this.post({ type: 'ignite-result', ok: existing.entrySent, cmdText: existing.launch.entryText,
            message: (existing.entrySent ? '已返回原 GLM 会话。' : '原终端尚未收到入口，请确认就绪后重新注入。') + launchDescription(existing.launch) });
          return;
        }
      }
      const claim = await claimAfterConfirm(this.services.cmds, form.entry as EntryKind, topic, form.driver);
      if (!valid()) return;
      if (claim.step === 'claim' && claim.state === 'failed') throw new Error(`认领失败（退出码 ${claim.code}）：${claim.message}`);
      const cmd = assembleEntryCommand({ agentId: carrier.agentId, entry: form.entry as EntryKind,
        body: form.body, flags: cliFlagsForCommand(form) });
      for (const w of cmd.warnings) this.post({ type: 'banner', kind: 'warn', text: w });
      const settings = launchSettingsFor(carrier.agentId, glm ? vscode.Uri.file(this.services.root) : undefined);
      const session = await this.services.relay.ensureSession({
        agentId: carrier.agentId, display: carrier.display, topic, entry: form.entry, ...program, entryText: cmd.text,
        driverModel: form.driverModel, driverEffort: form.driverEffort, cwd: this.services.root, waitForZcodeTurn: settings.waitForZcodeTurn,
      }, openNewBeside);
      if (this.disposed) return;
      this.currentSessionKey = session.key;
      session.launch.entryText = cmd.text;
      this.post({ type: 'session-command', cmdText: cmd.text });
      if (glm) this.post({ type: 'banner', kind: 'info', text: 'GLM 终端已打开，正在等待入口注入。' });
      const sent = await this.services.relay.injectText(session, cmd.text, settings, settings.readyDelayMs, glm);
      this.setMode(sent ? 'M1' : 'M3');
      this.post({ type: 'ignite-result', ok: sent, cmdText: cmd.text, terminalName: session.terminal.name,
        message: sent ? '已向终端送入入口。' + choiceDescription(session.launch) : '协同终端已关闭，请重新点火。' });
    } catch (error) {
      this.post({ type: 'banner', kind: 'warn', text: '点火未完成：' + (error instanceof Error ? error.message : String(error)) });
    } finally { this.igniting = false; }
  }

  private async handleResend(): Promise<void> {
    if (this.conflict) return;
    if (!this.currentSessionKey) {
      this.post({ type: 'banner', kind: 'warn', text: '尚无可重发的注入：先完成点火。' });
      return;
    }
    const session = this.services.relay.find(this.currentSessionKey);
    if (!session) {
      this.post({ type: 'banner', kind: 'warn', text: '协同终端已关闭：请重新点火（新开会话），或复制命令条手动执行。' });
      return;
    }
    const glm = session.launch.agentId === 'glm';
    if (session.injecting || this.igniting) {
      this.post({type:'banner', kind:'info', text:'正在注入，请等待本次发送完成。'});
      return;
    }
    const settings = launchSettingsFor(session.launch.agentId, glm ? vscode.Uri.file(this.services.root) : undefined);
    try {
      const text = session.launch.entryText;
      if (!text) return;
      const sent = await this.services.relay.injectText(session, text, settings, 300);
      if (sent && glm) this.setMode('M1');
      this.post({ type:'banner', kind:sent ? 'info' : 'warn', text:sent ? '已重新注入协同终端。' : '重发时协同终端已关闭。' });
    } catch (error) {
      this.post({type:'banner', kind:'warn', text:'重新注入失败：' + (error instanceof Error ? error.message : String(error))});
    }
  }

  private async handleRelay(text: string): Promise<void> {
    if (!this.currentSessionKey) {
      this.post({ type: 'relay-result', ok: false, note: '无协同终端（M3 纯监控）：请在终端直接输入。' });
      return;
    }
    const session = this.services.relay.find(this.currentSessionKey);
    if (!session) {
      this.post({ type: 'relay-result', ok: false, note: '协同终端已关闭：请在终端直接输入。' });
      return;
    }
    if (session.launch.agentId === 'glm' && (session.injecting || !session.entrySent)) {
      this.post({type:'relay-result', ok:false, note:'GLM 入口尚未送入，请等待点火或重新注入完成。'});
      return;
    }
    const settings = launchSettingsFor(this.currentSessionKey.split('|')[0]!, this.currentSessionKey.startsWith('glm|') ? vscode.Uri.file(this.services.root) : undefined);
    try {
      if (settings.waitForZcodeTurn) this.post({ type: 'banner', kind: 'info', text: '续话待发送，ZCode 当前轮结束后自动提交。' });
      await this.services.relay.relay(session, text, settings);
    } catch (error) {
      this.post({ type: 'relay-result', ok: false, note: '续话未提交：' + (error instanceof Error ? error.message : String(error)) });
      return;
    }
    this.post({ type: 'relay-result', ok: true, note: '已中继到协同终端（尽力而为；TUI 兼容差时请在终端直输）。' });
  }

  private async handleCancel(runId: string): Promise<void> {
    const yes = await vscode.window.showWarningMessage(`确认中止运行 ${runId}？工作进程与审查员 CLI 会被终止。`, { modal: true }, '中止');
    if (yes !== '中止') return;
    const r = await this.services.cmds.reviewCancel(runId);
    this.post({
      type: 'cancel-result',
      ok: r.code === 0,
      note: r.code === 0 ? `已发出 --cancel：${firstLine(r.stdout) || '运行转 cancelled'}` : `--cancel 失败（退出码 ${r.code}）：${firstLine(r.stderr)}`,
    });
  }

  // ── 闸门区（FR-9，计划 r2 §D2）─────────────────────────────────────────

  /** 闸门区请求代次（latest-wins：状态迁移触发新拉取时，旧响应整批丢弃，r2 CLAUDE-05/CODEX-06） */
  private gateAreaEpoch = 0;

  /** state.json 快照 → 闸门区卡片（含 gate --check 缓存合并与拉取；缓存键含 runId） */
  private async pushGateArea(snap?: { active: Array<{ topic: string; stage: string; state: string; runId: string; since: string | null; rerunIndex: number | null }> }): Promise<void> {
    if (this.disposed || !this.panel) return;
    const epoch = ++this.gateAreaEpoch;
    const active = snap?.active ?? (await this.readActiveGates());
    if (epoch !== this.gateAreaEpoch) return; // 已有更新一轮在跑
    const cards = gateCardsOf(
      active.map((g) => ({ ...g, key: `${g.topic}/${g.stage}` })),
    );
    const out: Array<GateCardModel & { hint: WorktreeHint | null }> = [];
    for (const c of cards) {
      const key = `${c.topic}/${c.stage}/${c.runId}`;
      let cached = this.gateCheckCache.get(key);
      if (!cached) {
        const r = await this.services.cmds.gateCheck(c.topic, c.stage);
        if (this.disposed || epoch !== this.gateAreaEpoch) return;
        // 异步返回后核对运行身份与当前状态（raf→aa 同 runId 迁移也丢弃旧响应，r2 CODEX-06）
        const now = this.lastGateSnapshot.find((g) => g.topic === c.topic && g.stage === c.stage);
        if (!now || now.runId !== c.runId || now.state !== c.state) continue;
        const hint = c.mode === 'aa' ? await this.hintWorktree() : null;
        if (this.disposed || epoch !== this.gateAreaEpoch) return;
        cached = { runId: c.runId, check: r.out, hint };
        this.gateCheckCache.set(key, cached);
      }
      out.push({ ...c, ...mergeGateCheck(cached.check), rejectReason: '', hint: cached.hint });
    }
    this.post({ type: 'gate-area', cards: out, noVoteNote: noVoteNote() });
  }

  /** 手动刷新一张卡（gate --check + 提示性摘要重拉） */
  private async refreshGateCard(topic: string, stage: string): Promise<void> {
    if (!topic || !stage) return;
    for (const k of [...this.gateCheckCache.keys()]) {
      if (k.startsWith(`${topic}/${stage}/`)) this.gateCheckCache.delete(k);
    }
    await this.pushGateArea();
  }

  /** 最近一次 state 快照的活跃闸门（onChange 时记录；测试与兜底轮询共用） */
  private lastGateSnapshot: Array<{ topic: string; stage: string; state: string; runId: string; since: string | null; rerunIndex: number | null }> = [];

  private async readActiveGates(): Promise<Array<{ topic: string; stage: string; state: string; runId: string; since: string | null; rerunIndex: number | null }>> {
    await this.services.stateWatch.rescan(); // rescan 触发 onChange → lastGateSnapshot 已更新
    return this.lastGateSnapshot;
  }

  /** 只读 git status 提示性摘要（口径与盲区见 worktreeSummary.ts 头注） */
  private async hintWorktree(): Promise<WorktreeHint | null> {
    return summarizeWorktreeHint(gitRunnerOf(this.services.root));
  }

  /** 动作在途守卫（CLAUDE-14：防双击——在途时拒绝重复消息，完成或失败都释放） */
  private async withGateAction<T>(topic: string, stage: string, kind: string, body: () => Promise<T>): Promise<void> {
    const key = `${topic}/${stage}`;
    if (this.gateActionBusy.has(key)) {
      this.post({ type: 'gate-action', kind, busy: false, ok: false, note: `${kind} 正在执行中：请等待完成（防双击）。` });
      return;
    }
    this.gateActionBusy.add(key);
    this.post({ type: 'gate-action', kind, busy: true });
    try {
      await body();
    } finally {
      this.gateActionBusy.delete(key);
    }
  }

  /** 批准：带外点击 → approve --json；成功后展示权威工作树摘要（worktree_summary） */
  private async handleApprove(topic: string, stage: string): Promise<void> {
    await this.withGateAction(topic, stage, 'approve', async () => {
    const r = await this.services.cmds.approve({ topic, stage });
    if (this.disposed) return;
    const wts = r.out?.worktree_summary?.[stage];
    const auth = authoritativeFiles(wts);
    this.post({
      type: 'gate-action',
      kind: 'approve',
      busy: false,
      ok: r.code === 0,
      note:
        r.code === 0
          ? `已批准 ${topic}/${stage}：闸门解除，业务写锁释放。`
          : `approve 失败（退出码 ${r.code}）：${firstLine(r.stderr) || firstLine(r.stdout) || '复核未过或闸门状态不允许'}`,
      authoritative: auth,
    });
    await this.services.stateWatch.rescan();
    });
  }

  /** 拒绝：理由必填由前端先行拦截（不代填）；approve --reject --reason */
  private async handleReject(topic: string, stage: string, reason: string): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed === '') {
      this.post({ type: 'gate-action', kind: 'reject', busy: false, ok: false, note: '拒绝必须填写理由（人工输入，不做自动填充）。' });
      return;
    }
    await this.withGateAction(topic, stage, 'reject', async () => {
    const r = await this.services.cmds.approve({ topic, stage, reject: true, rejectReason: trimmed });
    if (this.disposed) return;
    this.post({
      type: 'gate-action',
      kind: 'reject',
      busy: false,
      ok: r.code === 0,
      note:
        r.code === 0
          ? `已拒绝 ${topic}/${stage}：闸门解除，工件保留。`
          : `拒绝失败（退出码 ${r.code}）：${firstLine(r.stderr) || firstLine(r.stdout)}`,
    });
    await this.services.stateWatch.rescan();
    });
  }

  /** 放弃：二次确认后 abandon --topic --stage（显式 stage，防批量误伤其它阶段） */
  private async handleAbandon(topic: string, stage: string): Promise<void> {
    const yes = this.autoConfirm
      ? '放弃'
      : await vscode.window.showWarningMessage(
          `确认放弃 ${topic}/${stage} 的闸门？将解除业务写锁，已有工件全部保留。`,
          { modal: true, detail: '放弃后本轮人工停点关闭；主题可重新发起。' },
          '放弃',
        );
    if (yes !== '放弃') {
      this.post({ type: 'gate-action', kind: 'abandon', busy: false, ok: false, note: '已取消放弃。' });
      return;
    }
    await this.withGateAction(topic, stage, 'abandon', async () => {
    const r = await this.services.cmds.abandon(topic, stage);
    if (this.disposed) return;
    this.post({
      type: 'gate-action',
      kind: 'abandon',
      busy: false,
      ok: r.code === 0,
      note:
        r.code === 0
          ? `已放弃 ${topic}/${stage}：闸门关闭、工件保留。`
          : `abandon 失败（退出码 ${r.code}）：${firstLine(r.stderr) || firstLine(r.stdout)}`,
    });
    await this.services.stateWatch.rescan();
    });
  }

  // ── 裁决台（FR-8，计划 r2 §D1）─────────────────────────────────────────

  /** 进入裁决台：gate --check + runMeta 派生 + 现有件解析 → UI 模型 */
  private async openDesk(topic: string, stage: string): Promise<void> {
    if (!topic || !stage) return;
    const r = await this.services.cmds.gateCheck(topic, stage);
    if (this.disposed) return;
    if (!r.out) {
      this.post({ type: 'desk-state', ok: false, error: `gate --check 读不到输出（退出码 ${r.code}）：${firstLine(r.stderr)}` });
      return;
    }
    const metaDir = path.join(this.services.root, '.reviews', topic, stage, '_meta');
    const fsApi = { readFile: (p: string) => fs.readFile(p, 'utf8') };
    const meta = await readRunMeta(fsApi, metaDir, r.out.run_id);
    const fallbackExpected = meta ? await allFallbackIds(fsApi, meta, metaDir) : [];
    const driver = await resolveDriverId(fsApi, meta, path.join(this.services.root, '.reviews'), topic, stage);
    const addresses = meta ? expectedAddresses(meta, topic, stage) : [];
    // 修复形态：读现有件（预填 + 只读行 + 原文手术基线）
    let existingRows: ReturnType<typeof parseDispositionDoc>['rows'] = [];
    let loadedText: string | null = null;
    let parsed: ParsedDisposition | null = null;
    if (r.out.disposition) {
      try {
        loadedText = await fs.readFile(r.out.disposition, 'utf8');
        parsed = parseDispositionDoc(loadedText);
        existingRows = parsed.rows;
      } catch {
        loadedText = null; // 读不出则按无现有内容处理（gate 兜底会再报）
      }
    }
    const model = buildGapModel({ check: r.out, topic, stage, meta, fallbackExpected, driver, addresses, existingRows });
    const rows = new Map<string, { verdict: Verdict | null; reason: string; action: string; removed?: boolean }>();
    for (const item of model.items) {
      rows.set(item.id, {
        verdict: item.existing?.verdict ?? null,
        reason: item.existing?.reason ?? '',
        action: item.existing?.action ?? '',
        removed: item.removeable, // unknown 类默认勾选删除（gate 期望该编号从表里消失）
      });
    }
    this.deskSession = {
      topic, stage, model, rows,
      addresses: [...addresses],
      loadedText, parsed,
      confirmedPreview: null,
      severityOf: new Map(),
    };
    // 侧数据面：severity 回填 + 联动批注共用（scope 对齐本闸门）
    void this.services.annotationHub.setScope(topic, stage).then(() => this.services.annotationHub.setActiveRun(r.out!.run_id));
    this.post({ type: 'desk-state', ok: true, model, session: { rows: [...rows.entries()].map(([id, v]) => ({ id, ...v })) } });
  }

  /** Hub scope 就绪后回填 severity（展示层增强，缺失显示「—」） */
  private async fillDeskSeverity(): Promise<void> {
    const s = this.deskSession;
    if (!s) return;
    const findings = this.services.annotationHub.findingsOfFocusRun();
    for (const f of findings) {
      if (!s.severityOf.has(f.id)) s.severityOf.set(f.id, f.severity);
    }
    if (this.panel) this.post({ type: 'desk-severity', map: [...s.severityOf.entries()] });
  }

  /** 表单校验：删除行豁免、items 允许为空（纯结构修复）、空洞词仅警示（CLAUDE-06） */
  private validateDesk(): { ok: boolean; errors: string[]; warnings: string[]; rows: DraftRow[]; removedIds: string[] } {
    const s = this.deskSession;
    if (!s) return { ok: false, errors: ['裁决台未打开'], warnings: [], rows: [], removedIds: [] };
    const errors: string[] = [];
    const warnings: string[] = [];
    const rows: DraftRow[] = [];
    const removedIds: string[] = [];
    for (const item of s.model.items) {
      const input = s.rows.get(item.id);
      if (!input) continue;
      if (input.removed && item.removeable) {
        removedIds.push(item.id); // 删除行：不要求裁决与理由（CODEX-06）
        continue;
      }
      if (input.verdict === null) {
        errors.push(`${item.id}：未选择裁决（接受/驳回/暂缓）或删除该行`);
        continue;
      }
      if (input.verdict === '暂缓' && !item.deferAllowed) {
        errors.push(`${item.id}：本轮策略不允许暂缓，请改选接受或驳回`);
      }
      if (input.reason.trim() === '') {
        errors.push(`${item.id}：${input.verdict}必须填写非空理由（三种裁决都要求，gate 契约）`);
      } else if (isHollow(input.reason)) {
        // CLAUDE-06：不阻断——reason_policy 是编排器配置面，插件只提示
        warnings.push(`${item.id}：理由「${input.reason.trim()}」可能被判空洞词，最终由编排器按 reason_policy 判定`);
      }
      if (item.requireAction && input.verdict === '接受' && input.action.trim() === '') {
        errors.push(`${item.id}：接受项必须填写落点/修改计划`);
      }
      rows.push({
        id: item.id,
        critic: item.critic,
        severity: s.severityOf.get(item.id) ?? null,
        verdict: input.verdict,
        reason: input.reason.trim(),
        action: input.action.trim() === '' ? null : input.action.trim(),
      });
    }
    // addresses：空数组必然被 gate 拒（minItems 1）——派生失败时禁止落盘并给指引（CLAUDE-12）
    if (s.addresses.filter((a) => a.trim() !== '').length === 0) {
      errors.push('addresses 为空（run 元数据读不出或无有效侧）：请在下方的 addresses 编辑框手工填入本轮审查文档文件名（每行一项），或修复 _meta/run-<runId>.json 后重开裁决台。');
    }
    // 纯结构修复（CLAUDE-03/CODEX-07）：items 空但存在结构缺口或只读行时允许生成
    const structuralRepair = s.model.form === 'repair' && (s.model.structural.length > 0 || s.model.readonlyRows.length > 0);
    // 零意见首写（r2 CLAUDE-06/CODEX-09、r3 CLAUDE-03/CODEX-06）：draft 且期望集真空
    // ——gate 允许 expectedCount=0 的空表，missing_disposition 仍要求落件；
    // 与「元数据缺失、无从知道期望集」的区分由 addresses 非空校验承担
    const emptyDraft = s.model.form === 'draft' && s.model.items.length === 0;
    const hasContent = rows.length > 0 || removedIds.length > 0 || structuralRepair || emptyDraft;
    if (!hasContent) errors.push('没有可生成的内容（无待裁条目、无结构缺口、无既有合法行）。');
    return { ok: errors.length === 0 && hasContent, errors, warnings, rows, removedIds };
  }

  /** 表单指纹：任何变更使已确认预览失效（CLAUDE-05） */
  private deskFormHash(): string | null {
    const s = this.deskSession;
    if (!s) return null;
    return JSON.stringify({ rows: [...s.rows.entries()], addresses: s.addresses });
  }

  private async previewDesk(): Promise<void> {
    const s = this.deskSession;
    if (!s) return;
    const v = this.validateDesk();
    if (!v.ok) {
      this.post({ type: 'desk-preview', ok: false, errors: v.errors, warnings: v.warnings });
      return;
    }
    if (!s.model.driver) {
      this.post({ type: 'desk-preview', ok: false, errors: ['无法定位当轮 Driver id（run 元数据与阶段认领都缺）：草稿生成禁用——不猜（role 填错的代价是闸门 bad_front_matter）。'] });
      return;
    }
    const { text, fileName, abs } = await this.renderDeskDraft(s, v);
    s.confirmedPreview = { text, path: abs, formHash: this.deskFormHash() ?? '' };
    this.post({ type: 'desk-preview', ok: true, text, fileName, path: abs, form: s.model.form, warnings: v.warnings, removedIds: v.removedIds });
  }

  /** 渲染：起草=全新生成；修复=原文手术（front-matter 与表外正文原样保留） */
  private async renderDeskDraft(
    s: NonNullable<Cockpit['deskSession']>,
    v: { rows: DraftRow[]; removedIds: string[] },
  ): Promise<{ text: string; fileName: string; abs: string }> {
    const fm = { topic: s.topic, stage: s.stage, runId: s.model.runId, driver: s.model.driver!.driver, addresses: s.addresses.filter((a) => a.trim() !== '') };
    if (s.model.form === 'repair' && s.parsed) {
      // 原文手术：只改被修复行（按原表列结构逐列替换，r2 CODEX-07）、剔除删除行、
      // 追加新增行；front-matter 与表外正文原样保留（CLAUDE-04/CODEX-08）。
      // surgery=null（无表头/unparsable_table 极端形态）也写回 dispositionPath：
      // 原文整体保留 + 重建 front-matter 与标准表头（r2 CLAUDE-03）。
      const sg = s.parsed.surgery;
      const knownIds = new Set(s.parsed.rows.map((r) => r.id));
      const replaceRows = new Map<string, { verdict: string; reason: string; action: string | null }>();
      const appendLines: string[] = [];
      for (const row of v.rows) {
        if (knownIds.has(row.id)) {
          replaceRows.set(row.id, { verdict: row.verdict, reason: row.reason, action: row.action });
        } else {
          // 追加行按原表列映射生成（r3 CODEX-04：三列最小表/任意列序不失位）；
          // 无表头重建分支按标准六列（该分支整表重建）
          appendLines.push(sg ? appendRowByColumns(sg, row) : `| ${safeCell(row.id)} | ${safeCell(row.critic ?? '—')} | ${safeCell(row.severity ?? '—')} | ${row.verdict} | ${safeCell(row.reason)} | ${safeCell(row.action ?? '—')} |`);
        }
      }
      const structuralCodes = new Set(s.model.structural.map((x) => x.code));
      const needFm = structuralCodes.has('bad_front_matter') || s.parsed.frontMatter['schema'] !== 'trivium.disposition.v1';
      // r4 CODEX-04：原表无落点列（actionAt=null）而表单存在接受的结构化行——落点无处
      // 安放，整表升格标准六列（表头 + 全部数据行按新列映射重排）
      const needActionCol = sg !== null && sg.actionAt === null && v.rows.some((r) => r.verdict === '接受');
      // r4 CODEX-05：表头**可识别**的 unparsable（行内裁决词坏等）不换表头只修行；
      // 换表头仅限表头不可识别（surgery=null）与需要升格列两种
      const needHeader = sg === null || needActionCol;
      const headerLines = [`| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | ${s.stage === 'code' ? '修改计划' : '落点'} |`, '| :--- | :--- | :--- | :--- | :--- | :--- |'];
      void structuralCodes;
      const abs = s.model.dispositionPath ?? path.join(this.services.root, '.reviews', s.topic, s.stage, 'repaired.md');
      if (!sg) {
        // 无表头重建（r3 CLAUDE-01/CODEX-05）：新 front-matter + 标准表头 + **本次表单
        // 确认的全部裁决行**（新增/修复都进新表——修复行此前在坏表里解析不出，
        // 一律按新表重写）；坏表原文剔除（已无法按行定位），其余表外正文保留。
        // 坏表区剔除（r4 CLAUDE-04）：剥掉残缺 front-matter 块（若有）与以 | 起始的
        // 连续行块（坏表启发式），其余表外正文保留
        const stripBroken = (raw: string): string => {
          let t = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
          t = t.replace(/^---[^\n]*\n?/, '');
          const kept: string[] = [];
          let inTable = false;
          for (const line of t.split(/\r?\n/)) {
            const isBar = line.trim().startsWith('|');
            if (isBar) { inTable = true; continue; }
            if (inTable && line.trim() === '') { inTable = false; kept.push(line); continue; }
            inTable = false;
            kept.push(line);
          }
          return kept.join('\n').trim();
        };
        const base = stripBroken(s.loadedText ?? '');
        const bodyRows = v.rows.map((row) =>
          `| ${safeCell(row.id)} | ${safeCell(row.critic ?? '—')} | ${safeCell(row.severity ?? '—')} | ${row.verdict} | ${safeCell(row.reason)} | ${safeCell(row.action ?? '—')} |`,
        );
        const text = `---\n${renderFrontMatter(fm)}\n---\n\n${headerLines.join('\n')}\n${bodyRows.join('\n')}\n\n${base}\n`.replace(/\n{3,}/g, '\n\n');
        void needHeader;
        return { text, fileName: path.basename(abs), abs };
      }
      if (needActionCol) {
        // 升格路径（r4 CODEX-04 → r5 CODEX-02 修订）：**手术式**扩展——只把目标表的
        // 表头/对齐行换成标准六列、数据行按新列映射重排，表外正文与附录原样保留
        // （plan/bug 的 revised 件常含完整修订方案，不得整份重建）
        const replaceAll = new Map<string, { verdict: string; reason: string; action: string | null }>();
        for (const row of v.rows) replaceAll.set(row.id, { verdict: row.verdict, reason: row.reason, action: row.action });
        for (const ro of s.model.readonlyRows) {
          replaceAll.set(ro.id, { verdict: ro.verdict, reason: ro.reason, action: ro.action });
        }
        // 逐行按原表列读出原文值，再按标准六列重排（额外列并入理由尾部备注，不丢内容）
        const upgradedRows: string[] = [];
        for (const [id] of sg.rowLineOf) {
          const orig = sg.lines[sg.rowLineOf.get(id)!]!;
          const cells = orig.split('|').slice(1, -1).map((c) => c.trim());
          const val = (at: number | null): string => (at !== null && at < cells.length ? cells[at]! : '');
          const next = replaceAll.get(id);
          const extraCols = cells
            .filter((_, i) => i !== sg.idAt && i !== sg.verdictAt && i !== sg.reasonAt && i !== sg.criticAt && i !== sg.severityAt && i !== sg.actionAt)
            .filter((c) => c !== '' && c !== '—');
          const reason = next ? next.reason : val(sg.reasonAt);
          const extraNote = extraCols.length > 0 ? `${reason}（原表附加列：${extraCols.join('；')}）` : reason;
          upgradedRows.push(`| ${safeCell(id)} | ${safeCell(val(sg.criticAt) || '—')} | ${safeCell(val(sg.severityAt) || '—')} | ${next ? next.verdict : val(sg.verdictAt)} | ${safeCell(extraNote)} | ${safeCell(next?.action ?? val(sg.actionAt) ?? '—') || '—'} |`);
        }
        // 表头/对齐行经 renderRepaired 替换（正文保留），数据行按行号手术重排
        const text = renderRepaired(s.parsed, {
          replaceRows: new Map(),
          removeIds: new Set(),
          appendLines: [],
          newFrontMatter: needFm ? renderFrontMatter(fm) : null,
          newHeaderLines: headerLines,
        });
        const linesArr = text.split('\n');
        const rowLines = [...sg.rowLineOf.values()].sort((a, b) => a - b);
        for (let i = 0; i < rowLines.length; i++) {
          linesArr[rowLines[i]!] = upgradedRows[i] ?? linesArr[rowLines[i]!]!;
        }
        return { text: linesArr.join('\n'), fileName: path.basename(abs), abs };
      }
      const ops: SurgeryOps = {
        replaceRows,
        removeIds: new Set(v.removedIds),
        appendLines,
        newFrontMatter: needFm ? renderFrontMatter(fm) : null,
        newHeaderLines: null,
      };
      const text = renderRepaired(s.parsed, ops);
      return { text, fileName: path.basename(abs), abs };
    }
    const fileName = draftFileName({ topic: s.topic, rerunIndex: s.model.rerunIndex, stage: s.stage, driver: s.model.driver!.driver });
    const text = renderDisposition({ ...fm, rows: v.rows, titleNote: deskTitleNote(s.stage) });
    return { text, fileName, abs: path.join(this.services.root, '.reviews', s.topic, s.stage, fileName) };
  }

  /** 确认落盘（唯一写例外）：只落已确认预览，表单变更后必须重新预览（CLAUDE-05） */
  private async saveDesk(): Promise<void> {
    const s = this.deskSession;
    if (!s) return;
    const preview = s.confirmedPreview;
    if (!preview) {
      this.post({ type: 'desk-result', ok: false, note: '请先生成预览并确认，再点击落盘（落盘内容与预览严格绑定）。' });
      return;
    }
    if (preview.formHash !== this.deskFormHash()) {
      s.confirmedPreview = null;
      this.post({ type: 'desk-result', ok: false, note: '表单在预览确认后已变更：请重新生成预览（防落盘内容与所见不一致）。' });
      return;
    }
    const outcome = await saveDraft(
      {
        readFile: (p) => fs.readFile(p, 'utf8'),
        createExclusive: async (p, t) => {
          try {
            const fh = await fs.open(p, 'wx');
            await fh.writeFile(t, 'utf8');
            await fh.close();
            return true;
          } catch (e) {
            if ((e as { code?: string }).code === 'EEXIST') return false;
            throw e;
          }
        },
        replaceExclusive: async (p, t) => {
          const tmp = `${p}.trivium-desk-${Date.now()}`;
          await fs.writeFile(tmp, t, 'utf8');
          await fs.rename(tmp, p);
        },
      },
      preview.path,
      preview.text,
      s.model.form === 'repair' && s.loadedText !== null ? { kind: 'replace' as const, loadedText: s.loadedText } : { kind: 'create' as const },
    );
    if (!outcome.ok) {
      this.post({ type: 'desk-result', ok: false, note: outcome.hint, error: outcome.error });
      return;
    }
    // 落盘即复核：闸门不过即回修复模式（闭环，无手工编辑）
    const check = await this.services.cmds.gateCheck(s.topic, s.stage);
    for (const k of [...this.gateCheckCache.keys()]) {
      if (k.startsWith(`${s.topic}/${s.stage}/`)) this.gateCheckCache.delete(k);
    }
    if (this.disposed) return;
    const pass = check.out?.ok === true;
    this.post({
      type: 'desk-result',
      ok: true,
      path: outcome.path,
      mode: outcome.mode,
      gatePass: pass,
      note: pass
        ? `已落盘并通过闸门校验：${path.relative(this.services.root, outcome.path)}`
        : `已落盘，但闸门仍有缺口（${check.out?.failures.map((f) => f.code).join('、') ?? '未知'}）：回到裁决台按缺口继续修复。`,
      failures: check.out?.failures ?? [],
    });
    s.confirmedPreview = null;
    if (!pass) await this.openDesk(s.topic, s.stage);
    await this.pushGateArea();
  }

  private async locateFinding(id: string): Promise<void> {
    if (!id) return;
    const findings = this.services.annotationHub.findingsOfFocusRun();
    const hit = findings.find((f) => f.id === id);
    if (!hit) {
      vscode.window.showInformationMessage(`未找到 ${id} 的批注锚点（可能在结构化工件之外或该侧未落盘）：${criticOfId(id) ?? '未知来源'} 侧。`);
      return;
    }
    if (hit.relPath !== null && hit.startLine !== null) {
      const file = path.join(this.services.root, hit.relPath);
      try {
        const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
        const s = Math.max(0, Math.min(hit.startLine - 1, editor.document.lineCount - 1));
        const e = Math.max(s, Math.min((hit.endLine ?? hit.startLine) - 1, editor.document.lineCount - 1));
        editor.revealRange(new vscode.Range(s, 0, e, 0), vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(s, 0, e, 0);
        return;
      } catch {
        /* 打不开按 location 文本提示 */
      }
    }
    vscode.window.showInformationMessage(`${id} 的位置：${hit.location}（无行锚，未能跳转）`);
  }

  // ── 预设（FR-11，计划 r2 §D5）──────────────────────────────────────────

  private async pushPresets(): Promise<void> {
    const list = await this.services.presets.list();
    this.post({ type: 'presets', list });
  }

  private async savePreset(name: string, scope: string, form: FormState): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '') {
      this.post({ type: 'preset-result', ok: false, note: '预设名不能为空。' });
      return;
    }
    const preset = presetFromAssembly(trimmed, scope === 'global' ? 'global' : 'workspace', {
      driver: form.driver, driverModel: form.driverModel, driverEffort: form.driverEffort,
      critics: form.critics,
      entry: form.entry,
      maxRounds: form.maxRounds,
      profile: form.profile,
      extraFlags: form.extraFlags,
      ctxPaths: form.ctxPaths,
    });
    const r = await this.services.presets.save(preset);
    this.post({ type: 'preset-result', ok: r.ok, note: r.ok ? `已保存预设「${trimmed}」（${scope === 'global' ? '用户级' : '工作区级'}）。不含主题与正文——加载不会覆盖当前输入。` : (r.hint ?? '保存失败') });
    await this.pushPresets();
  }

  private async loadPreset(name: string, scope: string): Promise<void> {
    const p = await this.services.presets.get(name, scope === 'global' ? 'global' : 'workspace');
    if (!p) {
      this.post({ type: 'preset-result', ok: false, note: `预设「${name}」不存在（可能刚被删除）。` });
      return;
    }
    // 跨工作区加载：ctxPaths 逐项校验存在性（失效标注跳过，不阻塞回填）
    const fields = assemblyOf(p);
    const { filterStaleCtxPaths } = await import('../presets/presetModel');
    const { keep, stale } = await filterStaleCtxPaths(
      async (abs) => {
        try {
          await fs.access(abs);
          return true;
        } catch {
          return false;
        }
      },
      fields.ctxPaths,
      this.services.root,
    );
    this.post({
      type: 'preset-applied',
      fields: { ...fields, ctxPaths: keep },
      staleNote: stale.length > 0 ? `已跳过 ${stale.length} 个不存在于本工作区的 context 路径（${stale.join('、')}）。` : null,
      note: `已加载预设「${name}」：装配参数已回填，请重跑前置链（表单已变更）。`,
    });
  }

  private async deletePreset(name: string, scope: string): Promise<void> {
    const ok = await this.services.presets.remove(name, scope === 'global' ? 'global' : 'workspace');
    this.post({ type: 'preset-result', ok, note: ok ? `已删除预设「${name}」。` : `未找到预设「${name}」。` });
    await this.pushPresets();
  }

  // ── 测试可观测面（Phase 3；集成测试断言用，不做业务） ────────────────────

  /** 闸门区当前卡片（含缓存合并结果） */
  async gateAreaForTest(): Promise<GateCardModel[]> {
    const active = await this.readActiveGates();
    const cards = gateCardsOf(active.map((g) => ({ ...g, key: `${g.topic}/${g.stage}` })));
    const out: GateCardModel[] = [];
    for (const c of cards) {
      const key = `${c.topic}/${c.stage}/${c.runId}`;
      // 等缓存就绪（pushGateArea 异步拉取完成；期间 epoch 竞争会重拉，最多等 15s）
      let cached = this.gateCheckCache.get(key);
      const deadline = Date.now() + 15_000;
      while (!cached && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        cached = this.gateCheckCache.get(key);
      }
      out.push({ ...c, ...mergeGateCheck(cached?.check ?? null), rejectReason: '' });
    }
    return out;
  }

  /** 裁决台会话快照 */
  deskForTest(): { form: string; topic: string; stage: string; items: number; rows: Array<{ id: string; verdict: string | null; reason: string; action: string }>; driver: string | null } | null {
    const s = this.deskSession;
    if (!s) return null;
    return {
      form: s.model.form,
      topic: s.topic,
      stage: s.stage,
      items: s.model.items.length,
      rows: [...s.rows.entries()].map(([id, v]) => ({ id, verdict: v.verdict, reason: v.reason, action: v.action })),
      driver: s.model.driver?.driver ?? null,
    };
  }

  /** 测试通道：直接注入 webview 消息（模拟按钮点击） */
  async handleMessageForTest(m: Record<string, unknown>): Promise<void> {
    await this.onMessage(m);
  }

  /** 测试旗：自动通过放弃等二次确认（避免无头测试挂起在 modal） */
  set autoConfirmForTest(v: boolean) {
    this.autoConfirm = v;
  }
  private autoConfirm = false;

  // ── 运行监控 ─────────────────────────────────────────────────────────────

  private async syncRuns(active: { runId: string; topic: string; stage: string }[]): Promise<void> {
    if (this.disposed) return;
    const seen = new Set<string>();
    for (const g of active) {
      seen.add(g.runId);
      if (this.runs.has(g.runId) || this.discovering.has(g.runId)) continue; // CODEX-06
      this.discovering.add(g.runId);
      const cfg = await this.services.env.loadConfig();
      const runRoot = cfg.runRoot ?? '';
      const dir = await locateRunDirWithRetry(
        runRoot,
        g.runId,
        { intervalMs: 200, rounds: 3 },
        { repoHint: path.basename(this.services.root), expectTopic: g.topic }, // CODEX-02
      );
      this.discovering.delete(g.runId);
      if (this.disposed) return; // CODEX-05：关闭后不安装资源
      if (!dir) {
        // CLAUDE-04：登记低频重发现（30s 一次，至发现或 dispose）
        this.schedulePendingRetry(g.runId, g.topic, g.stage);
        continue;
      }
      this.cancelPendingRetry(g.runId);
      await this.attachRun(dir, g.runId, g.topic, g.stage);
    }
    // 活跃列表里消失且未 cross-check 的 run：闸门回落收尾（CLAUDE-04：零快照也走复核+清理）
    for (const [runId, entry] of this.runs) {
      if (!seen.has(runId) && !entry.watch.isCrossChecked && !(entry.render?.terminal ?? false)) {
        await this.finalizeEndedRun(runId, entry, '闸门已回落（运行结束或失败回 idle）');
      }
    }
    await this.pushRuns();
  }

  /**
   * 闸门回落的统一收尾（CLAUDE-04）：无论是否已有文件快照，都复核一次
   * `review --status`——成功按 CLI 构造终稿、失败明确注明；随后释放该 run
   * 的全部监控资源（RunWatch/ReviewWatch）。
   */
  private async finalizeEndedRun(runId: string, entry: RunEntry, reason: string): Promise<void> {
    entry.ended = true;
    let finalPhase: string | null = null;
    let finalArtifacts: string[] | null = null;
    let probeFailed = false;
    try {
      const r = await this.services.cmds.reviewStatus(runId);
      if (r.out) {
        const nested = r.out.status ?? {};
        finalPhase = nested.phase ?? r.out.phase ?? null;
        finalArtifacts = nested.artifacts ?? r.out.artifacts ?? null;
      }
    } catch {
      probeFailed = true;
    }
    if (this.disposed) return;
    if (finalPhase) {
      const base = entry.render;
      entry.render = base
        ? { ...base, phase: finalPhase, terminal: true, artifacts: finalArtifacts ?? base.artifacts }
        : null;
      entry.endNote = `${reason}；--status 复核为 ${finalPhase}。`;
    } else {
      entry.endNote = probeFailed
        ? `${reason}；终态复核调用失败：以最后快照展示。`
        : `${reason}；终态以 --status 复核为准。`;
    }
    entry.stdout.update(entry.render?.sides ?? [], finalPhase ?? 'unknown', true);
    entry.watch.dispose();
    entry.reviewWatch?.dispose();
    await this.pushRuns();
  }

  private schedulePendingRetry(runId: string, topic: string, stage: string): void {
    if (this.disposed || this.pendingRuns.has(runId)) return;
    this.post({ type: 'banner', kind: 'warn', text: `闸门 ${topic}/${stage} 已 running，但运行目录归属未定（${runId}）：每 30s 重试发现，直至定位或面板关闭。` });
    const timer = setInterval(() => {
      if (this.disposed) {
        this.cancelPendingRetry(runId);
        return;
      }
      void (async () => {
        const cfg = await this.services.env.loadConfig();
        const dir = await locateRunDir(cfg.runRoot ?? '', runId, {
          repoHint: path.basename(this.services.root),
          expectTopic: topic,
        });
        if (dir) {
          this.cancelPendingRetry(runId);
          if (!this.disposed && !this.runs.has(runId)) this.attachRun(dir, runId, topic, stage);
          await this.pushRuns();
        }
      })();
    }, 30_000);
    this.pendingRuns.set(runId, { topic, stage, timer });
  }

  private cancelPendingRetry(runId: string): void {
    const p = this.pendingRuns.get(runId);
    if (p) {
      clearInterval(p.timer);
      this.pendingRuns.delete(runId);
    }
  }

  private async attachRun(runDir: string, runId: string, topic: string, stage: string, focus = true): Promise<void> {
    if (this.disposed || this.runs.has(runId)) return;
    const cfg = await this.services.env.loadConfig();
    if (this.disposed || this.runs.has(runId)) return; // await 后复查（CODEX-05）
    const limit = Math.max(1024, Math.min(256 * 1024, logTailBytes() || 65536));
    const stdout = new StdoutTail(runDir, limit, patch => {
      if (!this.panel?.visible) return Promise.resolve(false);
      return this.panel.webview.postMessage({ type: 'stdout', runId, topic, limit, ...patch });
    });
    stdout.show(this.panel?.visible === true);
    const entry: RunEntry = {
      stdout,
      watch: null as never,
      reviewWatch: null,
      render: null,
      stale: false,
      note: null,
      reviewFiles: [],
      logTail: null,
      endNote: null,
      ended: false,
    };
    entry.watch = new RunWatch(
      {
        runDir,
        runId,
        heartbeatStaleS: cfg.heartbeatStaleS,
        heartbeatIntervalS: heartbeatIntervalS(),
        logTailBytes: logTailBytes(),
        statusProbe: async (id) => {
          const r = await this.services.cmds.reviewStatus(id);
          if (!r.out) return null;
          // CLAUDE-05：artifacts 在嵌套 status 内，防御式双读
          const nested = r.out.status ?? {};
          return {
            phase: nested.phase ?? r.out.phase ?? null,
            artifacts: nested.artifacts ?? r.out.artifacts ?? null,
          };
        },
      },
      {
        onRender: (render, extra) => {
          entry.render = render;
          stdout.update(render.sides, render.phase, entry.ended || render.terminal);
          entry.stale = extra.stale;
          entry.note = extra.note ?? null; // CLAUDE-06：瞬态提示全量替换（恢复后清除旧警示）
          void this.pushRuns();
        },
        onFinal: (render, note) => {
          entry.render = render;
          entry.endNote = note;
          entry.ended = true;
          stdout.update(render.sides, render.phase, true);
          entry.reviewWatch?.dispose();
          void this.pushRuns();
        },
        onSchemaIssue: (reason) => this.reportSchemaIssue(reason), // CODEX-07
        onLog: (tail) => {
          entry.logTail = tail;
          void this.pushRuns();
        },
      },
    );
    const stageDir = path.join(this.services.root, '.reviews', topic, stage || 'plan');
    entry.reviewWatch = new ReviewWatch(stageDir);
    entry.reviewWatch.onChange((files) => {
      entry.reviewFiles = files.filter((f) => !f.name.startsWith('_'));
      void this.pushRuns();
    });
    this.runs.set(runId, entry);
    this.recentRuns.set(runId, { dir: runDir, topic, stage });
    while (this.recentRuns.size > 8) {
      const oldest = this.recentRuns.keys().next().value;
      if (oldest === undefined) break;
      this.recentRuns.delete(oldest);
      const previous = this.runs.get(oldest);
      if (previous?.ended) {
        previous.stdout.dispose();
        previous.watch.dispose();
        previous.reviewWatch?.dispose();
        this.runs.delete(oldest);
      }
    }
    // FR-6/7：活跃 run → 批注 scope 跟随（新 run 自动成为焦点回放；D4′）
    if (focus) void this.services.annotationHub.setScope(topic, stage || 'plan').then(() =>
      this.services.annotationHub.setActiveRun(runId),
    );
    await this.pushRuns();
  }

  private async markEnded(runId: string, endState: string): Promise<void> {
    const entry = this.runs.get(runId);
    if (entry && !entry.watch.isCrossChecked && !(entry.render?.terminal ?? false)) {
      await this.finalizeEndedRun(runId, entry, `闸门回落为 ${endState}`);
      return;
    }
    if (entry) entry.ended = true;
    await this.pushRuns();
  }

  private async runCards(): Promise<RunCard[]> {
    const cards: RunCard[] = [];
    const hub = this.services.annotationHub;
    const buildFocusData = (): Pick<RunCard, 'findingsSummary' | 'findings' | 'consistencyNote' | 'buildNotice' | 'enabledCritics'> => {
      const diff = hub.diffOf(null);
      const enabled = hub.getEnabledCritics();
      const isEnabled = (critic: string): boolean => enabled.size === 0 || enabled.has(critic);
      return {
        findingsSummary: hub.focusSummaries().map((s) => ({
          critic: s.critic,
          verdictLabel: verdictLabel(s.verdict as never),
          counts: s.counts as Record<string, number>,
          state: s.state,
          notice: s.notice,
        })),
        // CLAUDE-05：列表与批注同口径过滤（关掉的侧不列条目；组头计数仍全量，可再点开）
        findings: hub.findingsOfFocusRun().filter((f) => isEnabled(f.critic)).map((f) => ({
          critic: f.critic,
          id: f.id,
          severity: f.severity,
          location: f.location,
          problem: f.problem.length > 200 ? `${f.problem.slice(0, 200)}…` : f.problem,
          level: f.level,
          label: f.label,
          consistency: f.consistency,
          relPath: f.relPath, // CLAUDE-01：Diff 按钮与位置显示的真实相对路径
          file: f.relPath !== null ? path.join(this.services.root, f.relPath) : null,
          startLine: f.startLine,
          endLine: f.endLine,
          inChangeset: f.relPath !== null && diff !== null && diffMember(diff, f.relPath) !== null,
          secondary: f.secondary, // CLAUDE-03：次级位置文本
        })),
        consistencyNote: hub.consistencyAllUnknown() ? '行号一致性未校验（plan 阶段或 git 不可用）：界内行号直接采信' : null,
        buildNotice: this.hubState?.notice ?? null,
        enabledCritics: enabled.size === 0 ? null : [...enabled],
      };
    };
    for (const [runId, e] of this.runs) {
      const r = e.render;
      const ended = e.ended;
      const phase = r?.phase ?? 'unknown';
      // FR-6a：该 run 是焦点回放时附逐侧摘要与逐条意见
      const isFocus = this.hubState !== null && this.hubState.runId === runId;
      const focusData = isFocus ? buildFocusData() : { findingsSummary: null, findings: null, consistencyNote: null, buildNotice: null, enabledCritics: null };
      cards.push({
        runId,
        topic: r?.topic ?? null,
        stage: r?.stage ?? null,
        phase,
        ended,
        phaseLabel: ended && !(r?.terminal ?? false) ? `${phaseLabel(phase)}（已结束，待终态复核）` : phaseLabel(phase),
        terminal: (r?.terminal ?? false) || ended, // ended 即不再提供中止（CLAUDE-06）
        sides: (r?.sides ?? []).map((s) => ({
          critic: s.critic,
          state: s.state,
          stateLabel: sideStateLabel(s.state),
          model: s.model,
          elapsedS: s.elapsedS,
        })),
        stale: e.stale,
        note: [e.note, e.endNote].filter(Boolean).join(' ｜ ') || null,
        message: r?.message ?? null,
        artifacts: r?.artifacts ?? [],
        reviewFiles: e.reviewFiles.map((f) => ({ name: f.name, absPath: f.absPath, role: f.role })),
        logTail: e.logTail,
        ...focusData,
      });
    }
    // CLAUDE-04/CODEX-07：历史回放卡——焦点 run 不在活跃看板（扩展重启后回放归档）
    // 时由 Hub 数据生成一张回放卡，意见列表/降级标注照常可见
    const focusRunId = this.hubState?.runId ?? null;
    if (focusRunId !== null && this.hubState?.topic && !this.runs.has(focusRunId)) {
      const summary = this.hubState.summaries.find((s) => s.runId === focusRunId);
      cards.push({
        runId: focusRunId,
        topic: this.hubState.topic,
        stage: this.hubState.stage,
        phase: 'replay',
        phaseLabel: '历史回放',
        ended: true,
        terminal: true,
        sides: [],
        stale: false,
        note: (summary ? `回放归档运行（${summary.sides.length} 侧工件）` : '回放归档运行') + ' · 此归档未附实时 stdout',
        message: null,
        artifacts: [],
        reviewFiles: [],
        logTail: null,
        ...buildFocusData(),
      });
    }
    return cards;
  }

  private async pushRuns(): Promise<void> {
    if (this.disposed || !this.panel?.visible) return; // AGY-r2-02：面板未开不跑检索不广播
    const runs = await this.runCards();
    if (this.panel?.visible) this.post({ type: 'runs', runs });
  }

  private setMode(mode: 'M1' | 'M3'): void {
    this.mode = mode;
    this.post({ type: 'mode', mode });
  }

  private post(msg: Record<string, unknown>): void {
    void this.panel?.webview.postMessage(msg);
  }

  private disposeRuns(): void {
    for (const e of this.runs.values()) {
      e.stdout.dispose();
      e.watch.dispose();
      e.reviewWatch?.dispose();
    }
    this.runs.clear();
    for (const runId of [...this.pendingRuns.keys()]) this.cancelPendingRetry(runId);
  }
}

// ── 配置读取与工具 ──────────────────────────────────────────────────────────

function launchDescription(program: { source?: string; entrypoint: string; nodePath?: string | null }): string {
  return `来源：${program.source}；入口：${program.entrypoint}` + (program.nodePath ? '；Node：' + program.nodePath : '（直接启动）');
}

function choiceDescription(o: Pick<LaunchOptions, 'driverModel' | 'driverEffort' | 'source' | 'entrypoint' | 'nodePath'>): string {
  return `模型 ${o.driverModel ?? '沿用 CLI 默认'}，思考强度 ${o.driverEffort ?? '沿用 CLI 默认'}。 ` + launchDescription(o);
}

function launchSettingsFor(agentId: string, resource?: vscode.Uri): { readyDelayMs: number; sendMode: 'execute' | 'split' | 'manual'; segmentBytes: number; waitForZcodeTurn: boolean } {
  const cfg = vscode.workspace.getConfiguration('trivium.launch', resource);
  const overrides = cfg.get<Record<string, { readyDelayMs?: number; sendMode?: string; segmentBytes?: number }>>('carrierOverrides') ?? {};
  const ov = overrides[agentId] ?? {};
  const selected = ov.sendMode ?? cfg.get<string>('sendMode', 'auto');
  const sendMode = selected === 'execute' || selected === 'split' || selected === 'manual'
    ? selected : carrierOf(agentId)?.separateEnter ? 'split' : 'execute';
  return {
    readyDelayMs: ov.readyDelayMs ?? cfg.get<number>('readyDelayMs', 3000),
    sendMode,
    waitForZcodeTurn: agentId === 'glm' && selected === 'auto',
    segmentBytes: ov.segmentBytes ?? cfg.get<number>('segmentBytes', 512),
  };
}

function heartbeatIntervalS(): number {
  return vscode.workspace.getConfiguration('trivium.monitor').get<number>('heartbeatIntervalS', 30);
}

function logTailBytes(): number {
  return vscode.workspace.getConfiguration('trivium.monitor').get<number>('logTailBytes', 65536);
}

/** 表单 → 前置链旗标 */
function prechainFlagsOf(form: FormState): PrechainFlags {
  return {
    driver: form.driver,
    critics: form.critics,
    maxRounds: form.maxRounds,
    topic: form.topic || undefined,
    extra: extraFlagList(form),
  };
}

/** 表单 → CLI 旗标（与 prechain.buildCliFlags 同口径） */
function cliFlagsForCommand(form: FormState): string[] {
  const flags: string[] = ['--driver', form.driver, '--critics', form.critics.join(',')];
  if (form.maxRounds !== undefined && !Number.isNaN(form.maxRounds)) flags.push('--max-rounds', String(form.maxRounds));
  if (form.topic) flags.push('--topic', form.topic);
  flags.push(...extraFlagList(form));
  return flags;
}

function extraFlagList(form: FormState): string[] {
  const out: string[] = [];
  if (form.profile) out.push('--profile', form.profile);
  if (form.ctxPaths.length > 0) out.push('--context', form.ctxPaths.join(','));
  if (form.extraFlags) {
    for (const tok of form.extraFlags.split(/\s+/).filter(Boolean)) out.push(tok);
  }
  if (form.driverModel) {
    const declared = out.includes('--driver-model');
    if (out.some((token, i) => token.startsWith('--driver-model=') || (token === '--driver-model' && out[i + 1] !== form.driverModel))) {
      throw new Error('额外旗标中的 --driver-model 与所选 Driver 模型冲突，请移除重复声明。');
    }
    if (!declared) out.push('--driver-model', form.driverModel);
  }
  return out;
}

/** 表单一致性（CLAUDE-08）：用于点火校验的逐字段比较 */
function formEquals(a: FormState, b: FormState): boolean {
  return (
    a.driver === b.driver && a.driverModel === b.driverModel && a.driverEffort === b.driverEffort &&
    a.entry === b.entry &&
    a.body === b.body &&
    a.topic === b.topic &&
    a.maxRounds === b.maxRounds &&
    a.profile === b.profile &&
    a.extraFlags === b.extraFlags &&
    JSON.stringify(a.critics) === JSON.stringify(b.critics) &&
    JSON.stringify(a.ctxPaths) === JSON.stringify(b.ctxPaths)
  );
}

/** 只读 git runner（worktreeSummary.GitRunner 的宿主实现：spawn git、shell:false、超时收杀） */
function gitRunnerOf(cwd: string): GitRunner {
  return (args, timeoutMs) =>
    new Promise((resolve) => {
      const child = spawn('git', args, { shell: false, cwd });
      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1_000);
      }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => outChunks.push(d));
      child.stderr.on('data', (d: Buffer) => errChunks.push(d));
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ code: null, stdout: '', stderr: String(e) });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          code: timedOut ? null : code,
          stdout: Buffer.concat(outChunks).toString('utf8'),
          stderr: Buffer.concat(errChunks).toString('utf8'),
        });
      });
    });
}

/** 空洞理由词（对齐 gate.ts HOLLOW_PATTERNS 的展示层预警子集；判定权仍在编排器） */
function isHollow(reason: string): boolean {
  const r = reason.replace(/[。.，,；;、\s]/g, '');
  return /^(无需修改|不适用|已知悉|没问题|不需要|ok|na)$/i.test(r);
}

/** 裁决件正文标题的阶段措辞 */
function deskTitleNote(stage: string): string {
  return stage === 'code' ? '代码审应答' : stage === 'bug' ? '根因结论应答' : '计划审裁决';
}

function firstLine(text: string): string {
  return (text ?? '').split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
}

function failedReport(step: 'resolve' | 'preflight', code: number | null, message: string): PrechainReport {
  return {
    steps: [{ step, state: 'failed', code, message } as never],
    topic: null,
    topicInferred: null,
    taskGoal: null,
    notes: [],
    failed: true,
  };
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
