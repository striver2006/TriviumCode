/**
 * 进程内调 `cancelRun` / `waitRun` 的用例夹具（取消与失联的凭据准入核CLI代码双审 r1 CODEX-07 抽出）。
 *
 * `test/integration/run-protocol.test.ts` 与 `test/unit/scrub-admission.test.ts` 原先各抄一份逐字同形的 `fakeCtx` / `captureStderr`；
 * `Ctx` 形状一改，漏改的那份不会报错，只会让用例静默变松。运行目录的布置（活 worker 的 `seedRun`、死 worker 带载体与归档的
 * `seedDeadRun`）语义不同，各留在自己的文件里。
 */
import path from 'node:path';
import { defaultConfig } from '../../src/trivium/config.js';
import type { Ctx } from '../../src/trivium/types.js';
import { scratchDir } from './scratch.js';

/** 一个 mkdtemp 下的最小 Ctx：运行根、归档根、`.trivium` 都在它里面；目录经 `scratchDir` 登记、本进程退出时删（EV-208） */
export async function fakeCtx(prefix = 'trivium-proto-'): Promise<Ctx> {
  const root = await scratchDir(prefix);
  const cfg = defaultConfig();
  cfg.runtime.run_root = path.join(root, 'runs');
  return {
    config: cfg,
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.' + 'trivium'),
    sources: ['<test>'],
  };
}

/** 进程内捕获 stderr（step / warn 都走它），fn 结束后原样恢复 */
export async function captureStderr<T>(fn: () => Promise<T>): Promise<{ value: T; err: string }> {
  const orig = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  try {
    return { value: await fn(), err };
  } finally {
    process.stderr.write = orig;
  }
}
