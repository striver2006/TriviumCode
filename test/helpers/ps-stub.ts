/**
 * 让 `/bin/ps` 派生失败的桩（EV-153，并发写闸门偶发红计划 r2 §3 D3）。
 *
 * `util/exec.ts` 以具名导入取 `spawn`（ESM 绑定），只改 `child_process.spawn` 属性不够：要 `syncBuiltinESMExports()` 把改动同步进
 * 已实例化的具名绑定。**还原时同样要再同步一次**，否则具名绑定仍指向桩、泄漏到同文件的后续用例（计划双审 AGY-02）。
 *
 * 被拦的调用改派生一个不存在的可执行文件：`run()` 收到 'error' 以 `code: null` 收尾，`processStartTime` 得 null——与满载下
 * 派生失败（EAGAIN 等）同一结局。形态按 `processStartTime` 的取法区分：规范化形态以 `LC_ALL=C`、`TZ=UTC0` 覆盖环境，缺省形态
 * 原样继承宿主环境。桩看到的是 `run()` 合并之后的**生效环境**，所以两个键都要比：只比 `TZ` 时，宿主设了 `TZ=UTC0`（POSIX 惯用的
 * UTC 写法）就会把缺省调用误判成规范化（代码双审 CODEX-01 ≡ GLM-01）。**前提**：宿主环境没有同时设 `LC_ALL=C` 与 `TZ=UTC0`——
 * 那样两种形态的生效环境逐字相同、无从区分，`psStubWorks` 以「环境前提不满足」判红，而不是报成桩没生效。
 *
 * 桩是否真的生效要由调用方自证（`psStubWorks`）：桩在某个 Node 版本上不透传时，依赖它的用例会空转成绿（计划双审 CODEX-02）。
 *
 * **按 pid 过滤**（EV-175，取不到启动时刻当不在计划 r2 §5.1）：给了 `pids` 就只拦 `-p` 参数在其中的调用，别的 pid 与
 * `ps -axo`（进程组成员数）照常。审查员 CLI 进程组的判定（`judgeCliGroup`）也调规范化形态的 `ps`，不过滤就会让 CLI 记录
 * 一律判不了、「信号发没发」失去分辨力。不给 `pids` 即此前的行为（EV-153 的用例不动）。
 *
 * **何时开始拦**（EV-176，取消宽限期判不了仍放锁计划 r2 §5.1）：`allowFirst: N` 先放过前 N 次本该拦的调用（`--cancel` 入口那次
 * 判定放过、之后才拦 = 零信号形态）；`startArmed: false` 先一律放过、调 `arm()` 之后才拦（用例在包装的 `process.kill` 里
 * 观察到 SIGTERM / SIGKILL 时调 = 宽限期 / SIGKILL 之后形态）。两者都不给即此前的行为（装上即拦，EV-153 / EV-175 的用例不动）。
 * 放过的调用计入 `allowed`，自证靠 `allowed` / `blocked` 两个计数（这两种形态下不能用 `psStubWorks`：它自己的那次取值会
 * 吃掉放行名额或被放过）。
 */
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { processStartTime } from '../../src/trivium/util/exec.js';
import { resetEnumCacheForTest } from '../../src/trivium/util/platform.js';

export type PsForm = 'canonical' | 'legacy' | 'both';

/** 生效环境是不是规范化形态的那一份（`processStartTime(…, { canonical: true })` 覆盖的两个键） */
const isCanonicalEnv = (env: NodeJS.ProcessEnv | undefined): boolean => env?.LC_ALL === 'C' && env?.TZ === 'UTC0';

/** 宿主环境本身就等于规范化覆盖：两种形态的生效环境无从区分，桩分不出拦哪一种 */
export function psFormsIndistinguishable(): boolean {
  return isCanonicalEnv(process.env);
}

export interface PsStub {
  /** 被拦下的 `ps` 次数 */
  readonly blocked: number;
  /** 本该拦、但因 `allowFirst` 或尚未 `arm()` 而放过的次数（EV-176） */
  readonly allowed: number;
  /** 开始拦（`startArmed: false` 时用）；可重复调用 */
  arm: () => void;
  /** 复原原 `spawn` 并重新同步具名绑定；可重复调用 */
  restore: () => void;
}

/** 这次 `ps` 调用的 `-p` 参数是不是被拦的 pid 之一；没给 `pids` 时一律算是 */
function targetsBlockedPid(args: readonly string[] | undefined, pids: ReadonlySet<number> | null): boolean {
  if (pids === null) return true;
  const i = args?.indexOf('-p') ?? -1;
  return i >= 0 && pids.has(Number(args![i + 1]));
}

export function stubPsFailure(
  which: PsForm,
  o: { pids?: readonly number[]; allowFirst?: number; startArmed?: boolean } = {},
): PsStub {
  const orig = cp.spawn;
  const state = { blocked: 0, allowed: 0, restored: false, armed: o.startArmed ?? true, skipLeft: o.allowFirst ?? 0 };
  const pids = o.pids ? new Set(o.pids) : null;
  const stub = function (this: unknown, bin: string, args?: readonly string[], opts?: cp.SpawnOptions) {
    /*
     * win32（1.2.5）：身份路径不走 /bin/ps 而走 powershell.exe（util/platform.ts 的
     * enumerateWinProcesses）——不拦它，「规范化 ps 取不到」的桩在 win32 全部落空。
     * PowerShell 侧没有 canonical/legacy 两形态（唯一路径、恒 UTC ISO），故任何请求形态
     * 都按拦截处置；args 里没有 -p 取值，pid 过滤在 win32 不适用（调用方按全量用）。
     */
    const isWinPs = process.platform === 'win32' && bin === 'powershell.exe';
    if ((bin === '/bin/ps' || isWinPs) && (isWinPs || targetsBlockedPid(args, pids))) {
      // win32 唯一路径无两形态：按请求侧声明形态，使 canonical/legacy/both 三种桩都拦得住
      const canonical = isWinPs ? which !== 'legacy' : isCanonicalEnv(opts?.env as NodeJS.ProcessEnv | undefined);
      if (which === 'both' || (which === 'canonical') === canonical) {
        if (!state.armed || state.skipLeft > 0) {
          if (state.armed) state.skipLeft--;
          state.allowed++;
        } else {
          state.blocked++;
          return orig.call(this, '/nonexistent/trivium-test-ps', args ?? [], opts ?? {});
        }
      }
    }
    return (orig as (...a: unknown[]) => cp.ChildProcess).call(this, bin, args, opts);
  } as typeof cp.spawn;
  cp.spawn = stub;
  syncBuiltinESMExports();
  // win32：装桩即清枚举缓存——TTL 内的旧表会让桩形同虚设（同 psStubWorks 里的那次）
  resetEnumCacheForTest();
  return {
    get blocked() {
      return state.blocked;
    },
    get allowed() {
      return state.allowed;
    },
    arm: () => {
      state.armed = true;
    },
    restore: () => {
      if (state.restored) return;
      state.restored = true;
      cp.spawn = orig;
      syncBuiltinESMExports();
    },
  };
}

/**
 * 桩自证：装桩后以对应形态取一次 `pid`（缺省本进程）的启动时刻，应得 null。取到值说明桩没透传到 `exec.ts` 的具名绑定——
 * 返回可读的原因，调用方据此判红，而不是让用例在桩失效时空转绿。按 pid 过滤的桩要传被拦的那个 pid。
 */
export async function psStubWorks(which: PsForm, pid: number = process.pid): Promise<string | null> {
  if (which !== 'both' && psFormsIndistinguishable()) {
    return (
      '环境前提不满足：宿主环境已同时设 LC_ALL=C 与 TZ=UTC0，缺省与规范化两种形态的 ps 生效环境相同，桩分不出拦哪一种' +
      '（不是桩没生效；换一个未设这两个值的环境再跑）'
    );
  }
  const forms = which === 'both' ? ['canonical', 'legacy'] as const : [which];
  for (const f of forms) {
    resetEnumCacheForTest();
    const t = await processStartTime(pid, f === 'canonical' ? { canonical: true } : {});
    if (t !== null) return `桩未生效：${f} 形态仍取到 pid ${pid} 的启动时刻「${t}」（Node ${process.version} 未把 spawn 的改动同步进具名导入，或 pid 不在拦截集里）`;
  }
  return null;
}
