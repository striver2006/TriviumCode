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
import type { TriviumServices } from '../services';
import { cockpitHtml } from './cockpitHtml';
import { assembleEntryCommand, findSkillDoc, type EntryKind } from '../launch/entryCommand';
import { claimAfterConfirm, runResolveAndPreflight, type PrechainReport, type PrechainFlags } from '../launch/prechain';
import { carrierOf, parseWrapperNodePath } from '../launch/carriers';
import { RunWatch } from '../monitor/statusWatch';
import { ReviewWatch, type ReviewFile } from '../monitor/reviewWatch';
import { locateRunDir, locateRunDirWithRetry } from '../monitor/runDiscovery';
import type { StatusRender } from '../monitor/statusModel';
import { phaseLabel, sideStateLabel } from '../monitor/statusModel';
import { buildHealth } from '../env/health';
import { worstVerdict, type SchemaVerdict } from '../env/versionCheck';

interface FormState {
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
}

interface RunEntry {
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
  /** 发现中的 run（CODEX-06：并发事件去重） */
  private readonly discovering = new Set<string>();
  /** 重试耗尽后的低频重发现（CLAUDE-04） */
  private readonly pendingRuns = new Map<string, { topic: string; stage: string; timer: ReturnType<typeof setInterval> }>();
  private currentSessionKey: string | null = null;
  private lastCommandText: string | null = null;
  private mode: 'M1' | 'M3' = 'M3';
  /** 数据版本不兼容 → 只读降级（CODEX-07/AGY-04）：禁点火 */
  private degradedReason: string | null = null;
  private readonly schemaVerdicts: SchemaVerdict[] = [];
  /** 前置链成功时冻结的表单快照 + 解析主题（CLAUDE-08：确认与点火绑定） */
  private frozenForm: FormState | null = null;
  private frozenTopic: string | null = null;
  private readonly serviceDisposables: vscode.Disposable[] = [];
  private disposed = false;

  constructor(private readonly services: TriviumServices) {
    this.serviceDisposables.push(
      services.stateWatch.onChange((snap, ended) => {
        if (snap.schemaReason) this.reportSchemaIssue(snap.schemaReason); // CODEX-07
        void this.syncRuns(snap.active.map((g) => ({ runId: g.runId, topic: g.topic, stage: g.stage })));
        for (const e of ended) this.markEnded(e.runId, e.endState);
      }),
      services.relay.onSessionClosed((key) => {
        if (key === this.currentSessionKey) {
          this.setMode('M3');
          this.post({ type: 'banner', kind: 'info', text: '协同终端已关闭：驾驶舱降级为 M3 纯监控（流水线不受影响，循环由 Driver 会话持有）。' });
        }
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
    this.panel.onDidDispose(() => {
      this.panel = null;
      this.disposeRuns();
    });
    // 订阅可能晚于 StateWatch 初始扫描（构造竞态）：打开面板时显式重扫一次，
    // 保证活跃 run 一定能进看板（回放 + 重扫双保险）
    await this.services.stateWatch.rescan();
    await this.sendInit();
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
        break;
      case 'prechain':
        await this.handlePrechain(m['form'] as unknown as FormState);
        break;
      case 'ignite':
        await this.handleIgnite(m['form'] as unknown as FormState, String(m['topic'] ?? ''));
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
      case 'refresh-health':
        await this.refreshHealth(false);
        break;
      case 'doctor-static':
        await this.refreshHealth(true);
        break;
      case 'entry-changed':
        await this.pushArgHint(String(m['entry'] ?? 'A'));
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

  private async handlePrechain(form: FormState): Promise<void> {
    this.frozenForm = null; // 重新前置链即解除旧冻结
    this.frozenTopic = null;
    if (this.degradedReason) {
      this.post({ type: 'prechain-result', report: failedReport('resolve', null, this.degradedReason), frozen: false });
      return;
    }
    if (!(await this.services.cli.wrapperExists())) {
      this.post({ type: 'prechain-result', report: failedReport('resolve', null, '未找到 .trivium/bin/trivium wrapper：本工作区尚未初始化 TriviumCode。'), frozen: false });
      return;
    }
    const report = await runResolveAndPreflight(this.services.cmds, {
      entry: form.entry as EntryKind,
      body: form.body,
      flags: prechainFlagsOf(form),
    });
    const cmd = assembleEntryCommand({
      agentId: form.driver as never,
      entry: form.entry as EntryKind,
      body: form.body,
      flags: cliFlagsForCommand(form),
    });
    this.post({ type: 'prechain-result', report: report as PrechainReport, cmdText: cmd.text });
    if (!report.failed) {
      // CLAUDE-08：冻结表单快照与解析主题，点火只接受与快照一致的表单
      this.frozenForm = form;
      this.frozenTopic = report.topic;
      this.lastCommandText = cmd.text;
      const doc = await findSkillDoc(form.driver as never, form.entry as EntryKind, this.services.repoRoot);
      this.post({ type: 'arg-hint', text: doc?.argHint ?? null });
    }
  }

  private async handleIgnite(form: FormState, topic: string): Promise<void> {
    // CLAUDE-08：表单与前置链快照不一致 → 拒绝点火（防「认领 A 主题、注入 B」）
    if (!this.frozenForm || !this.frozenTopic) {
      this.post({ type: 'ignite-result', ok: false, message: '尚未完成前置链：先执行步骤 ①。', cmdText: this.lastCommandText ?? '' });
      return;
    }
    if (topic !== this.frozenTopic || !formEquals(form, this.frozenForm)) {
      this.post({
        type: 'ignite-result',
        ok: false,
        message: '表单在确认后已变更（主题/正文/旗标等）：请重新执行前置链再点火。',
        cmdText: this.lastCommandText ?? '',
      });
      return;
    }
    const claim = await claimAfterConfirm(this.services.cmds, form.entry as EntryKind, topic, form.driver);
    if (this.disposed) return; // CODEX-05：await 后复查生命周期（停用后不再建终端/注入）
    if (claim.step === 'claim' && claim.state === 'failed') {
      this.post({ type: 'ignite-result', ok: false, message: `认领失败（退出码 ${claim.code}）：${claim.message}`, cmdText: this.lastCommandText ?? '' });
      return;
    }
    const carrier = carrierOf(form.driver);
    if (!carrier) {
      this.post({ type: 'ignite-result', ok: false, message: `未知 Driver：${form.driver}`, cmdText: '' });
      return;
    }
    const probe = await this.services.env.loadProbe();
    if (this.disposed) return; // CODEX-05
    const cli = probe?.cli[carrier.cliKey];
    const entrypoint = (cli?.['entrypoint'] as string | undefined) ?? null;
    if (!entrypoint) {
      this.post({ type: 'ignite-result', ok: false, message: `探针无 ${carrier.display} 入口（先跑 doctor 探测）`, cmdText: this.lastCommandText ?? '' });
      return;
    }
    const cmd = assembleEntryCommand({
      agentId: carrier.agentId,
      entry: form.entry as EntryKind,
      body: form.body,
      flags: cliFlagsForCommand(form),
    });
    this.lastCommandText = cmd.text;
    for (const w of cmd.warnings) this.post({ type: 'banner', kind: 'warn', text: w });

    const settings = launchSettingsFor(carrier.agentId);
    // CLAUDE-02：解释器只认绝对路径（zcode 探针 runner 的 'node' 是能力标识不是路径）；
    // 拿不到绝对路径就明示失败，不静默回落 PATH
    let nodePath: string | null = null;
    if (carrier.launchMode === 'shellCommand') {
      nodePath = await resolveAbsoluteNode(cli, this.services.cli.wrapperPath());
      if (!nodePath) {
        this.post({
          type: 'ignite-result',
          ok: false,
          message: `无法确定 ${carrier.display}（脚本类入口）的解释器绝对路径（探针 runner 非路径、wrapper 也解析不出 node）：请用下方命令条手动执行。`,
          cmdText: cmd.text,
        });
        return;
      }
    }
    const session = await this.services.relay.ensureSession({
      agentId: carrier.agentId,
      display: carrier.display,
      topic,
      entry: form.entry,
      entrypoint,
      launchMode: carrier.launchMode,
      cwd: this.services.root,
      nodePath,
    });
    if (this.disposed) return; // CODEX-05：停用后不再注入
    this.currentSessionKey = session.key;
    await this.services.relay.injectText(session, cmd.text, settings, settings.readyDelayMs);
    this.setMode('M1');
    this.post({
      type: 'ignite-result',
      ok: true,
      terminalName: `Trivium · ${carrier.display} · ${topic}`,
      cmdText: cmd.text,
    });
  }

  private async handleResend(): Promise<void> {
    if (!this.lastCommandText || !this.currentSessionKey) {
      this.post({ type: 'banner', kind: 'warn', text: '尚无可重发的注入：先完成点火。' });
      return;
    }
    const session = this.services.relay.find(this.currentSessionKey);
    if (!session) {
      this.post({ type: 'banner', kind: 'warn', text: '协同终端已关闭：请重新点火（新开会话），或复制命令条手动执行。' });
      return;
    }
    const settings = launchSettingsFor(this.currentSessionKey.split('|')[0]!);
    await this.services.relay.injectText(session, this.lastCommandText, settings, 300);
    this.post({ type: 'banner', kind: 'info', text: '已重新注入协同终端。' });
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
    await this.services.relay.relay(session, text);
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

  private async attachRun(runDir: string, runId: string, topic: string, stage: string): Promise<void> {
    if (this.disposed || this.runs.has(runId)) return;
    const cfg = await this.services.env.loadConfig();
    if (this.disposed || this.runs.has(runId)) return; // await 后复查（CODEX-05）
    const entry: RunEntry = {
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
          entry.stale = extra.stale;
          entry.note = extra.note ?? null; // CLAUDE-06：瞬态提示全量替换（恢复后清除旧警示）
          void this.pushRuns();
        },
        onFinal: (render, note) => {
          entry.render = render;
          entry.endNote = note;
          entry.ended = true;
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
    for (const [runId, e] of this.runs) {
      const r = e.render;
      const ended = e.ended;
      const phase = r?.phase ?? 'unknown';
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
      });
    }
    return cards;
  }

  private async pushRuns(): Promise<void> {
    if (this.disposed || !this.panel) return; // AGY-r2-02：面板未开不跑检索不广播
    this.post({ type: 'runs', runs: await this.runCards() });
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
      e.watch.dispose();
      e.reviewWatch?.dispose();
    }
    this.runs.clear();
    for (const runId of [...this.pendingRuns.keys()]) this.cancelPendingRetry(runId);
  }
}

// ── 配置读取与工具 ──────────────────────────────────────────────────────────

function launchSettingsFor(agentId: string): { readyDelayMs: number; sendMode: 'execute' | 'split' | 'manual'; segmentBytes: number } {
  const cfg = vscode.workspace.getConfiguration('trivium.launch');
  const overrides = cfg.get<Record<string, { readyDelayMs?: number; sendMode?: string; segmentBytes?: number }>>('carrierOverrides') ?? {};
  const ov = overrides[agentId] ?? {};
  return {
    readyDelayMs: ov.readyDelayMs ?? cfg.get<number>('readyDelayMs', 3000),
    sendMode: (ov.sendMode as 'execute' | 'split' | 'manual') ?? (cfg.get<string>('sendMode', 'execute') as 'execute'),
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
  return out;
}

/** 表单一致性（CLAUDE-08）：用于点火校验的逐字段比较 */
function formEquals(a: FormState, b: FormState): boolean {
  return (
    a.driver === b.driver &&
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

/** CLAUDE-02：解释器绝对路径——探针 runner 仅当其为绝对路径时采用，否则解析 wrapper */
async function resolveAbsoluteNode(
  cli: Record<string, unknown> | undefined,
  wrapperPath: string,
): Promise<string | null> {
  const runner = cli?.['version_probe'] as Record<string, unknown> | undefined;
  const runnerVal = typeof runner?.['runner'] === 'string' ? runner['runner'] : null;
  const { isAbsolute } = await import('node:path');
  if (runnerVal && isAbsolute(runnerVal)) return runnerVal;
  try {
    const { promises: fs } = await import('node:fs');
    return parseWrapperNodePath(await fs.readFile(wrapperPath, 'utf8'));
  } catch {
    return null;
  }
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
