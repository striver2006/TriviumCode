/**
 * 共享读取面检查（EV-240）的测试隔离：让 doctor / preflight 的那一次只读扫描读空夹具，不读真实家目录
 * （M12 批次 5，计划双审 CODEX-01 / GLM-01）。
 *
 * 扫描的家目录只有一个来源（`entryScanEnv()`：注入口 → `TRIVIUM_ENTRY_SCAN_HOME` → `os.homedir()`），
 * 所以隔离也只在一处做：
 *
 * - 经 `fixture.ts` 的 `cli()` 跑打包产物：`cli()` 缺省就把该变量指向本进程的空夹具；
 * - 进程内直调 `runDoctor` / `runPreflight` 的测试文件：在文件顶部调一次 {@link isolateEntryScanHome}。
 *
 * `entry-scan-isolation` 的对账用例守这两条：直调却没调本函数的文件当场红。
 */
import { ENTRY_SCAN_HOME_ENV } from '../../src/trivium/entry-collisions.js';
import { scratchDirSync } from './scratch.js';

let empty: string | null = null;

/** 本测试进程的空家目录夹具（惰性建一次，测试文件进程退出时随 `scratchDir` 登记删除） */
export function emptyEntryScanHome(): string {
  empty ??= scratchDirSync('trivium-escan-');
  return empty;
}

/** 把本进程的扫描家目录钉到空夹具；返回夹具路径。进程内直调与本进程派生的子进程都继承它 */
export function isolateEntryScanHome(): string {
  const home = emptyEntryScanHome();
  process.env[ENTRY_SCAN_HOME_ENV] = home;
  return home;
}
