/**
 * 批注宿主（FR-6b/6c 的装配层，r2 计划 D3′/D4′）。
 *
 * 服务级单例（services 持有，activate 建、deactivate 释放）：
 * - scope = {topic, stage}，scope 内单一焦点 run（活跃 run 最新者；新 run 出现
 *   自动切换；历史树点击回放任意 run）；
 * - metaWatch 随 scope 启停（CODEX-03/AGY-01：独立于驾驶舱面板——面板关闭或
 *   M3 从未打开，侧完成落盘照样进批注）；
 * - 切换呈现 = 全清重建（线程逐 dispose + diagnostics.clear()）——无残影无孤儿；
 * - 快照一致性两层判据（CLAUDE-01/CODEX-02）：挂载前静态 git blob 比对
 *   （code 阶段 + 冻结 head sha，文本归一化比对）+ 挂载后动态 hash 重校验
 *   （onDidChange/Save 命中挂载文件 → 重算 → 失配触发重锚或显式标注）；
 * - 文件关闭不主动清理（CODEX-06/CLAUDE-03 语义：Comments 线程随 VS Code 文档
 *   生命周期管理，Diagnostics 按 Problems 语义常驻——归属为 scope 非孤儿）；
 *   主动清理只在 scope/run 切换与 dispose。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseReviewFile, type ParsedReview } from './reviewParse';
import { extractAnchorTexts, normalizeLocation, resolveLocation, type FileConsistency } from './locationResolve';
import { buildAnnotationModels, findingsSummary, type ResolvedFinding, type DiagnosticModel, type DiagLevel } from './annotationModel';
import { parseChangesDiff, diffMember, resolveBaseRef, applyHunks, type ParsedChangesDiff } from './diffParse';
import { MetaWatch } from './metaWatch';

export interface ScopeState {
  topic: string;
  stage: string;
  /** 焦点 run（null = scope 空闲） */
  runId: string | null;
  /** 各 run 的逐侧摘要（驾驶舱 run 卡与历史树消费） */
  summaries: Array<{ runId: string; sides: ReturnType<typeof findingsSummary> }>;
  threads: number;
  diagnostics: number;
  /** 超限提示（CLAUDE-11）：总量折叠 / 单文件溢出（用户可见） */
  notice: string | null;
}

/** 内置 git 扩展最小 API（软依赖；diffView 同款判定，见 D5′） */
interface GitApi {
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

export class AnnotationHub implements vscode.Disposable {
  readonly controller: vscode.CommentController;
  private readonly diagnostics: vscode.DiagnosticCollection;

  private scope: { topic: string; stage: string } | null = null;
/** scope 代次（CODEX-02：setScope 递增；在途摄取捕获后代次不符即整次丢弃） */
  private scopeSeq = 0;
  /** 请求代次（CODEX-01：setScope 递增；setActiveRun 捕获后不符即弃——交错回放保护） */
  private requestSeq = 0;
  private focusRunId: string | null = null;
  /** 装配超限提示（CLAUDE-11） */
  private buildNotice: string | null = null;
  /** scope 内全部解析件：runId → critic → ParsedReview */
  private readonly reviewsByRun = new Map<string, Map<string, ParsedReview>>();
  /** scope 内 changes.diff：runId → 解析结果 */
  private readonly diffsByRun = new Map<string, ParsedChangesDiff>();
  private metaWatch: MetaWatch | null = null;
  private metaDir = '';
  /** 逐家开关（空集合 = 全部启用） */
  private enabledCritics = new Set<string>();
  /** 挂载文件 hash（relPath → sha1(挂载时内容)）——动态重校验基线 */
  private mountedHashes = new Map<string, string>();
  /** 静态一致性结论（relPath → FileConsistency；scope 切换清空） */
  private consistency = new Map<string, FileConsistency>();
  private checkedFiles = new Set<string>();
  /** 已建线程句柄（重建时逐个 dispose） */
  private threads: vscode.CommentThread[] = [];
  private rebuildSeq = 0;
  private disposed = false;
  private readonly listeners = new Set<(state: ScopeState) => void>();
  private readonly docListeners: vscode.Disposable[] = [];

  constructor(
    private readonly workspaceRoot: string,
    private readonly archiveRoot = '.reviews',
  ) {
    this.controller = vscode.comments.createCommentController('trivium.reviews', 'TriviumCode 审查意见');
    this.controller.options = { placeHolder: 'TriviumCode 审查意见（只读回放）' };
    this.diagnostics = vscode.languages.createDiagnosticCollection('trivium.reviews');
    this.docListeners.push(
      vscode.workspace.onDidChangeTextDocument((e) => void this.onDocChanged(e.document)),
      vscode.workspace.onDidSaveTextDocument((doc) => void this.onDocChanged(doc)),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // CODEX-03：使在途代次全部失效——停用后尚未返回的读取不得再触碰
    // 已释放的 CommentController / DiagnosticCollection
    this.rebuildSeq++;
    this.scopeSeq++;
    this.docListeners.forEach((d) => d.dispose());
    this.docListeners.length = 0;
    this.metaWatch?.dispose();
    this.metaWatch = null;
    for (const t of this.threads) t.dispose();
    this.threads = [];
    this.diagnostics.dispose();
    this.controller.dispose();
    this.listeners.clear();
  }

  /** 订阅 scope 状态变化（驾驶舱刷新；面板开关不影响监听本身）。返回退订句柄 */
  onScopeChange(listener: (state: ScopeState) => void): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  // ── scope 与 run 管理 ────────────────────────────────────────────────────

  /** 设置 scope：全清旧批注 → 挂 metaWatch → 初始 ingest → 焦点取最新 run */
  async setScope(topic: string, stage: string): Promise<void> {
    if (this.disposed) return;
    if (this.scope?.topic === topic && this.scope.stage === stage) return;
    this.scopeSeq++; // CODEX-02：旧 scope 的在途摄取整次作废
    this.requestSeq++; // CODEX-01：旧回放请求（setActiveRun 链）一并作废
    this.rebuildSeq++; // 在途装配同样作废
    this.scope = { topic, stage };
    this.reviewsByRun.clear();
    this.diffsByRun.clear();
    this.mountedHashes.clear();
    this.consistency.clear();
    this.checkedFiles.clear();
    this.focusRunId = null;
    // 切换即清展示快照：新 rebuild 完成前 findingsOfFocusRun 不得残留旧 scope 数据
    this.lastResolved = [];
    this.lastDiagnostics = [];
    this.buildNotice = null;
    this.metaWatch?.dispose();
    this.metaDir = path.join(this.workspaceRoot, this.archiveRoot, topic, stage, '_meta');
    this.metaWatch = new MetaWatch(this.metaDir);
    this.metaWatch.onChange(() => void this.ingestMetaDir());
    await this.ingestMetaDir();
  }

  /** 活跃 run 告知（驾驶舱 attachRun / 历史树点击共用）：更新焦点并广播 */
  async setActiveRun(runId: string): Promise<void> {
    if (this.disposed || !this.scope) return;
    const reqAtStart = this.requestSeq; // CODEX-01：交错回放保护——期间发生新 setScope 即弃
    if (!this.reviewsByRun.has(runId) && !this.diffsByRun.has(runId)) {
      await this.ingestMetaDir(); // 目录可能已有该 run 工件
    }
    if (this.disposed || reqAtStart !== this.requestSeq) return;
    if (this.focusRunId === runId) return;
    this.focusRunId = runId;
    await this.rebuild();
  }

  get currentRunId(): string | null {
    return this.focusRunId;
  }

  get currentScope(): { topic: string; stage: string } | null {
    return this.scope ? { ...this.scope } : null;
  }

  /** scope 内 run 清单（runId 降序 = 最新在前） */
  runIds(): string[] {
    return [...this.reviewsByRun.keys(), ...this.diffsByRun.keys()].filter((v, i, a) => a.indexOf(v) === i).sort().reverse();
  }

  /** 逐家开关（空集合 = 全部） */
  async setEnabledCritics(critics: Set<string>): Promise<void> {
    this.enabledCritics = new Set(critics);
    await this.rebuild();
  }

  getEnabledCritics(): Set<string> {
    return new Set(this.enabledCritics);
  }

  /** scope 内出现过的审查者（QuickPick 用） */
  criticsInScope(): string[] {
    const out = new Set<string>();
    for (const by of this.reviewsByRun.values()) for (const r of by.values()) out.add(r.status.critic);
    return [...out].sort();
  }

  /** changes.diff 获取（Diff 视图命令用） */
  diffOf(runId: string | null): ParsedChangesDiff | null {
    if (runId) return this.diffsByRun.get(runId) ?? null;
    return this.diffsByRun.get(this.focusRunId ?? '') ?? null;
  }

  /** 焦点 run 的解析件（驾驶舱意见列表用） */
  reviewsOfFocusRun(): Map<string, ParsedReview> {
    return this.reviewsByRun.get(this.focusRunId ?? '') ?? new Map();
  }

  /** 焦点 run 的 findings 摘要（驾驶舱 run 卡） */
  focusSummaries(): ReturnType<typeof findingsSummary> {
    return findingsSummary([...this.reviewsOfFocusRun().values()]);
  }

  /** 焦点 run 的逐条意见（驾驶舱列表；解析级别/漂移标注/一致性/次级位置） */
  findingsOfFocusRun(): Array<{
    critic: string; id: string; severity: string; location: string; problem: string;
    level: string; label: string | null; consistency: string;
    relPath: string | null; startLine: number | null; endLine: number | null;
    secondary: string[];
  }> {
    return this.lastResolved.map((rf) => {
      const a = rf.resolution.anchors[0] ?? null;
      return {
        critic: rf.critic,
        id: rf.finding.id,
        severity: rf.finding.severity,
        location: rf.finding.location,
        problem: rf.finding.problem,
        level: a ? a.level : rf.resolution.kind === 'missing-file' ? 'missing' : rf.resolution.kind,
        label: a?.label ?? (rf.resolution.kind === 'missing-file' ? `文件缺失：${rf.resolution.missingRelPath}` : rf.resolution.kind === 'outside' ? '路径越界（工作区外）' : rf.resolution.kind === 'doc' ? '非文件位置' : null),
        consistency: rf.resolution.consistency.state,
        relPath: a?.relPath ?? rf.resolution.missingRelPath,
        startLine: a?.level === 'line' ? a.line?.start ?? null : null,
        endLine: a?.level === 'line' ? a.line?.end ?? null : null,
        secondary: rf.resolution.anchors.slice(1).map((x) => x.label ?? x.relPath), // CLAUDE-03
      };
    });
  }

  /** 焦点 run 一致性是否全部未校验（列表侧「一致性未校验」提示，D2′） */
  consistencyAllUnknown(): boolean {
    return this.lastResolved.length > 0 && this.lastResolved.every((rf) => rf.resolution.consistency.state === 'unknown');
  }

  /** 可观测面：线程快照（集成测试断言；VS Code 无公开枚举 API，事实 20） */
  threadsSnapshot(): Array<{ file: string; relPath: string; startLine: number; endLine: number; label: string; comments: Array<{ critic: string; severity: string }>; driftNotes: string[] }> {
    return this.threads.map((t) => ({
      file: t.uri.fsPath,
      relPath: path.relative(this.workspaceRoot, t.uri.fsPath),
      startLine: (t.range?.start.line ?? 0) + 1,
      endLine: (t.range?.end.line ?? 0) + 1,
      label: (t.label ?? '') as string,
      comments: [...t.comments].map((c) => ({ critic: c.author.name, severity: String(c.contextValue ?? '') })),
      driftNotes: (t.contextValue ?? '').split('|').filter(Boolean),
    }));
  }

  /** 诊断可观测面（languages.getDiagnostics 亦可查，此处给模型级视图） */
  diagnosticsSnapshot(): DiagnosticModel[] {
    return this.lastDiagnostics;
  }

  private lastDiagnostics: DiagnosticModel[] = [];
  /** 焦点 run 的逐条解析结果（驾驶舱意见列表消费；纯数据不含 VS Code 对象） */
  private lastResolved: ResolvedFinding[] = [];

  // ── 数据摄取 ─────────────────────────────────────────────────────────────

  /** 全量读 `_meta/`：review-*.json 与 changes-*.diff（代次守卫：CODEX-02） */
  async ingestMetaDir(): Promise<void> {
    if (this.disposed || !this.scope) return;
    const seqAtStart = this.scopeSeq;
    const dirAtStart = this.metaDir;
    const stale = (): boolean => this.disposed || seqAtStart !== this.scopeSeq || dirAtStart !== this.metaDir;
    let names: string[];
    try {
      names = await fs.readdir(dirAtStart);
    } catch {
      if (!stale()) await this.rebuild();
      return;
    }
    const before = new Set([...this.reviewsByRun.keys(), ...this.diffsByRun.keys()]);
    for (const name of names) {
      const text = await fs.readFile(path.join(dirAtStart, name), 'utf8').catch(() => null);
      if (stale()) return; // 摄取期间 scope 已切换：整次丢弃，不污染新 scope 缓存
      if (text === null) continue;
      if (/^review-.+\.json$/.test(name)) {
        const parsed = parseReviewFile(name, text);
        if (parsed.status.state === 'unrecognized') continue;
        let by = this.reviewsByRun.get(parsed.status.runId);
        if (!by) {
          by = new Map();
          this.reviewsByRun.set(parsed.status.runId, by);
        }
        by.set(parsed.status.critic, parsed);
      } else if (/^changes-.*\.diff$/.test(name)) {
        const parsed = parseChangesDiff(text);
        const runId = parsed.runId;
        if (runId) this.diffsByRun.set(runId, parsed);
      }
    }
    // 焦点规则（D4′）：focus 为空/无效 → 取最新；**出现更新的 run**（重审新轮，
    // 活跃场景）→ 自动切新；旧 run 迟到的侧文件不弹走已选焦点（历史回放保护）
    const all = this.runIds(); // 降序
    const newlySeen = all.filter((r) => !before.has(r));
    if (this.focusRunId === null || !before.has(this.focusRunId) && !all.includes(this.focusRunId)) {
      this.focusRunId = all[0] ?? null;
    } else {
      const newer = newlySeen.find((r) => r > (this.focusRunId ?? ''));
      if (newer) this.focusRunId = newer;
    }
    if (!stale()) await this.rebuild();
  }

  // ── 装配（全清重建，幂等） ───────────────────────────────────────────────

  private async rebuild(): Promise<void> {
    if (this.disposed || !this.scope) return;
    const seq = ++this.rebuildSeq;
    const scopeSeqAtStart = this.scopeSeq;
    const focus = this.focusRunId;
    const by = focus !== null ? this.reviewsByRun.get(focus) : undefined;
    const reviews = [...(by?.values() ?? [])];
    const stale = (): boolean => this.disposed || seq !== this.rebuildSeq || scopeSeqAtStart !== this.scopeSeq;

    // ① 收集涉及文件（纯函数归一，无 IO）——静态校验的前置
    const files = new Set<string>();
    for (const review of reviews) {
      for (const f of review.findings) {
        const norm = normalizeLocation(f.location, this.workspaceRoot);
        if (norm.kind === 'file') for (const a of norm.anchors) files.add(a.relPath);
      }
    }

    // ② 静态一致性（CLAUDE-03/CODEX-04：**先校验后解析**，首次挂载即见结论；
    //    CODEX-05：per-file 进度，无 diff/无文件不标记，迟到侧新文件可补检）
    await this.ensureConsistencyChecked(focus, files);
    if (stale()) return;

    // ③ 逐 finding 解析锚点（consistency 缓存已热）
    const resolved: ResolvedFinding[] = [];
    const readFile = async (relPath: string): Promise<string | null> => {
      try {
        return await fs.readFile(path.join(this.workspaceRoot, relPath), 'utf8');
      } catch {
        return null;
      }
    };
    for (const review of reviews) {
      for (const f of review.findings) {
        const resolution = await resolveLocation(f.location, this.workspaceRoot, {
          readFile,
          consistency: (rel) => this.consistency.get(`${focus}:${rel}`) ?? { state: 'unknown', note: null },
          anchorTexts: extractAnchorTexts(f.problem, f.evidence),
        });
        resolved.push({ critic: review.status.critic, runId: review.status.runId, finding: f, resolution });
      }
    }
    if (stale()) return; // 竞态：scope/run/dispose 又变了，丢弃本次装配

    // ④ 装配（CLAUDE-07：maxTotalFindings 读配置；CLAUDE-11：超限提示进 ScopeState）
    const built = buildAnnotationModels(resolved, {
      enabledCritics: this.enabledCritics.size > 0 ? this.enabledCritics : null,
      maxThreadsPerFile: maxThreadsPerFile(),
      maxTotalFindings: maxTotalFindings(),
    });
    if (stale()) return;
    this.lastResolved = resolved;
    this.buildNotice = built.totalSuppressed
      ? `意见总量超过上限（trivium.reviews.maxTotalFindings=${maxTotalFindings()}），行内批注已折叠为仅 Problems`
      : built.overflow.length > 0
        ? `线程超上限仅进 Problems：${built.overflow.map((o) => `${o.file} 溢出 ${o.count} 条`).join('；')}`
        : null;

    // 全清旧线程与诊断（切换呈现策略：无残影）
    for (const t of this.threads) t.dispose();
    this.threads = [];
    this.diagnostics.clear();
    this.lastDiagnostics = built.diagnostics;

    // 记录挂载文件 hash（动态重校验基线）——仅建了对象的文件
    const mountedFiles = new Set<string>([...built.threads.map((t) => t.file), ...built.diagnostics.map((d) => d.file)]);
    for (const rel of mountedFiles) {
      const content = await readFile(rel);
      if (content !== null) this.mountedHashes.set(rel, sha1(content));
    }
    if (stale()) return;

    // 装配线程（同一文件的线程一次建好）
    for (const tm of built.threads) {
      const uri = vscode.Uri.file(path.join(this.workspaceRoot, tm.file));
      const range = new vscode.Range(Math.max(0, tm.startLine - 1), 0, Math.max(0, tm.endLine - 1), 0);
      const comments = tm.comments.map((c) => ({
        body: new vscode.MarkdownString(c.body),
        author: { name: c.critic },
        mode: vscode.CommentMode.Preview,
        contextValue: c.severity,
      }));
      const thread = this.controller.createCommentThread(uri, range, comments);
      thread.label = tm.label;
      thread.contextValue = tm.driftNotes.join('|');
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      this.threads.push(thread);
    }

    // 装配诊断（per file 聚合）
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const dm of built.diagnostics) {
      let list = byFile.get(dm.file);
      if (!list) {
        list = [];
        byFile.set(dm.file, list);
      }
      const range = new vscode.Range(Math.max(0, dm.startLine - 1), 0, Math.max(0, dm.endLine - 1), 0);
      const diag = new vscode.Diagnostic(range, dm.message, diagLevelOf(dm.level));
      diag.source = 'TriviumCode 审查';
      diag.code = dm.code;
      list.push(diag);
    }
    for (const [file, list] of byFile) {
      this.diagnostics.set(vscode.Uri.file(path.join(this.workspaceRoot, file)), list);
    }

    this.emitState();
  }

  /**
   * 静态一致性比对（CLAUDE-02 修正语义 / CODEX-05 per-file 进度 / CODEX-06 缓存含 runId）：
   * 重建**送审工作树内容**比对——base blob（base 字面 HEAD 时即冻结 head sha）应用该文件
   * 补丁段 → 送审内容，与工作区文本归一化比较。变更集外/新增/无补丁段文件无送审快照，
   * 诚实 unknown；plan 阶段（无 diff）整体 unknown（列表侧注明「未校验」）。
   */
  private async ensureConsistencyChecked(runId: string | null, files: Set<string>): Promise<void> {
    if (!this.scope || runId === null || files.size === 0) return; // 不做任何整轮标记（CODEX-05）
    const diff = this.diffsByRun.get(runId) ?? null;
    const baseRef = diff ? resolveBaseRef(diff) : null;
    if (!diff || !baseRef) return; // 无 diff / base 无法冻结（自定义 ref 字面量）→ 全部保持待检
    const api = await gitApi();
    if (!api) return;

    for (const rel of files) {
      const key = `${runId}:${rel}`; // CODEX-06：缓存身份含 run——切轮回放不串用
      if (this.checkedFiles.has(key)) continue;
      const member = diffMember(diff, rel);
      const fileUri = vscode.Uri.file(path.join(this.workspaceRoot, rel));
      try {
        if (!member || member.added || member.deleted || member.hunks.length === 0) {
          this.consistency.set(key, { state: 'unknown', note: member?.added ? '本轮新增文件，无送审前快照' : '不在变更集（无送审快照），未校验' });
        } else {
          // CODEX-04：末尾换行容差；工作区内容**buffer 优先**——已打开且未保存的编辑
          // 是用户当前所见（r2/CODEX-02 语义：编辑即失效重检，重检不得回读旧磁盘内容）
          const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === fileUri.fsPath);
          const wsText = stripTrailingNewline(normalizeText(
            openDoc !== undefined ? openDoc.getText() : Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8'),
          ));
          const baseText = normalizeText(Buffer.from(await vscode.workspace.fs.readFile(api.toGitUri(fileUri, baseRef))).toString('utf8'));
          const sentText = stripTrailingNewline(normalizeText(applyHunks(baseText, member.hunks)));
          this.consistency.set(key, wsText === sentText
            ? { state: 'consistent', note: null }
            : { state: 'mismatch', note: `工作区文件与送审版本（${baseRef.slice(0, 8)} + 补丁）不一致` });
        }
      } catch {
        this.consistency.set(key, { state: 'unknown', note: '基线对象不可读，未校验' });
      }
      this.checkedFiles.add(key); // 仅实际完成检查的文件记录（CODEX-05：迟到侧新文件可补检）
    }
  }

  // ── 动态重校验（挂载后编辑） ─────────────────────────────────────────────

  private async onDocChanged(doc: vscode.TextDocument): Promise<void> {
    if (this.disposed || !this.scope) return;
    const rel = path.relative(this.workspaceRoot, doc.uri.fsPath);
    const mounted = this.mountedHashes.get(rel);
    if (mounted === undefined) return;
    const current = sha1(doc.getText());
    if (current === mounted) return;
    // 文件已编辑（CLAUDE-01/CODEX-02 动态判据）。CODEX-02：该路径**全部 run** 的静态
    // 结论与已检标记一并失效（切回其它回放轮时重检得真值）；edited 标当前回放轮
    const runId = this.focusRunId;
    for (const k of [...this.consistency.keys()]) {
      if (k.endsWith(`:${rel}`)) {
        this.consistency.delete(k);
        this.checkedFiles.delete(k);
      }
    }
    if (runId !== null) this.consistency.set(`${runId}:${rel}`, { state: 'edited', note: '文件已在批注挂载后被编辑' });
    this.mountedHashes.delete(rel); // 旧基线失效（rebuild 会以新内容重建基线）
    await this.rebuild();
  }

  private emitState(): void {
    const state: ScopeState = {
      topic: this.scope?.topic ?? '',
      stage: this.scope?.stage ?? '',
      runId: this.focusRunId,
      summaries: this.runIds().map((runId) => ({ runId, sides: findingsSummary([...(this.reviewsByRun.get(runId)?.values() ?? [])]) })),
      threads: this.threads.length,
      diagnostics: this.lastDiagnostics.length,
      /** 超限提示（CLAUDE-11：总量折叠 / 单文件溢出，用户可见） */
      notice: this.buildNotice,
    };
    for (const l of this.listeners) l(state);
  }
}

// ── 工具 ───────────────────────────────────────────────────────────────────

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

/** 文本归一化（换行差异不算不一致：autocrlf 场景） */
function normalizeText(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

/** CODEX-04：末尾换行容差（git 的 `\ No newline` 两侧差异不构成 mismatch） */
function stripTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

function diagLevelOf(level: DiagLevel): vscode.DiagnosticSeverity {
  if (level === 'error') return vscode.DiagnosticSeverity.Error;
  if (level === 'warning') return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

function maxThreadsPerFile(): number {
  return vscode.workspace.getConfiguration('trivium.reviews').get<number>('maxThreadsPerFile', 200);
}

/** CLAUDE-07：总量上限同样读配置（package.json 已声明，缺省 2000） */
function maxTotalFindings(): number {
  return vscode.workspace.getConfiguration('trivium.reviews').get<number>('maxTotalFindings', 2000);
}

/** git 扩展软依赖（与 diffView 同源判定；此处独立缓存，测试各自复位） */
let gitApiCache: GitApi | null | undefined;
/** 测试注入口（测试环境 --disable-extensions 连内置 git 扩展一并禁用） */
let gitApiOverride: GitApi | null | undefined;
async function gitApi(): Promise<GitApi | null> {
  if (gitApiOverride !== undefined) return gitApiOverride;
  if (gitApiCache !== undefined) return gitApiCache;
  try {
    const ext = vscode.extensions.getExtension('vscode.git');
    if (!ext) {
      gitApiCache = null;
      return null;
    }
    const exports = (await ext.activate()) as { getAPI?: (v: number) => GitApi };
    gitApiCache = typeof exports.getAPI === 'function' ? exports.getAPI(1) : null;
  } catch {
    gitApiCache = null;
  }
  return gitApiCache;
}

/** 测试复位/注入（override 非 undefined 时恒定返回该值） */
export function resetHubGitApiCacheForTest(override?: GitApi | null): void {
  gitApiCache = undefined;
  gitApiOverride = override;
}
