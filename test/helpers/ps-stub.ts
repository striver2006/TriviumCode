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
 */
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { processStartTime } from '../../src/trivium/util/exec.js';

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
  /** 复原原 `spawn` 并重新同步具名绑定；可重复调用 */
  restore: () => void;
}

export function stubPsFailure(which: PsForm): PsStub {
  const orig = cp.spawn;
  const state = { blocked: 0, restored: false };
  const stub = function (this: unknown, bin: string, args?: readonly string[], opts?: cp.SpawnOptions) {
    if (bin === '/bin/ps') {
      const canonical = isCanonicalEnv(opts?.env as NodeJS.ProcessEnv | undefined);
      if (which === 'both' || (which === 'canonical') === canonical) {
        state.blocked++;
        return orig.call(this, '/nonexistent/trivium-test-ps', args ?? [], opts ?? {});
      }
    }
    return (orig as (...a: unknown[]) => cp.ChildProcess).call(this, bin, args, opts);
  } as typeof cp.spawn;
  cp.spawn = stub;
  syncBuiltinESMExports();
  return {
    get blocked() {
      return state.blocked;
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
 * 桩自证：装桩后以对应形态取一次本进程的启动时刻，应得 null。取到值说明桩没透传到 `exec.ts` 的具名绑定——
 * 返回可读的原因，调用方据此判红，而不是让用例在桩失效时空转绿。
 */
export async function psStubWorks(which: PsForm): Promise<string | null> {
  if (which !== 'both' && psFormsIndistinguishable()) {
    return (
      '环境前提不满足：宿主环境已同时设 LC_ALL=C 与 TZ=UTC0，缺省与规范化两种形态的 ps 生效环境相同，桩分不出拦哪一种' +
      '（不是桩没生效；换一个未设这两个值的环境再跑）'
    );
  }
  const forms = which === 'both' ? ['canonical', 'legacy'] as const : [which];
  for (const f of forms) {
    const t = await processStartTime(process.pid, f === 'canonical' ? { canonical: true } : {});
    if (t !== null) return `桩未生效：${f} 形态仍取到启动时刻「${t}」（Node ${process.version} 未把 spawn 的改动同步进具名导入）`;
  }
  return null;
}
