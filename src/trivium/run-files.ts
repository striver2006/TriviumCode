/**
 * 运行目录 `<运行根>/<项目槽>/<runId>/` 这一层上**编排器自己写的文件**。
 *
 * ## 为什么单独一个零依赖模块
 *
 * 这份清单有两个互相够不着的消费方：
 *
 * - `run-protocol.ts` / `status.ts`：**写**这些文件；
 * - `freeze.ts` 的禁读分类：判定读到它们属「己方运行时材料」（设计 §10.1.1 的 ②′），
 *   不判该侧作废。
 *
 * 而依赖方向是 `run-protocol → review → freeze`——freeze 引不回去。
 * 于是上一版在 freeze 里**又手抄了一份**四个文件名的字面量集合，
 * 与真正的写入点没有任何机器联系：那边新增一个运行时文件、或改个名，
 * 这边不会报错，只会让审查员读自己那轮的材料时被判作废（r2 代码双审 AGY-05 ≡ GLM-07）。
 *
 * 现在写入点与判定点共用本模块，**再加一条反向对账测试**
 * （`test/unit/run-files-parity.test.ts`）扫这两个模块里 `path.join(runDir, '<字面量>')`
 * 的写法，防的是「新增文件时绕开本模块直接拼字面量」——那是常量化管不到的形态。
 *
 * 本模块**不得引入任何本仓库内的依赖**：它要能被依赖链上任意一端安全引用。
 */

/** 运行目录那一层的编排器文件，键是用途、值是文件名 */
export const RUN_DIR_FILES = {
  /** `--start` 写给工作进程的交接包 */
  request: 'request.json',
  /** 工作进程 pid（status.json 尚未落盘时的兜底 pid 来源） */
  workerPid: 'worker.pid',
  /** 工作进程 stdio 的重定向目标 */
  workerLog: 'worker.log',
  /** 心跳与两侧进展 */
  status: 'status.json',
} as const;

export const RUN_DIR_FILE_NAMES: readonly string[] = Object.values(RUN_DIR_FILES);

/**
 * `writeAtomic` 的临时文件后缀（`<目标名>.tmp-<pid>-<毫秒>`）。
 *
 * **判定必须认得它**：`status.json` 每次心跳都经原子写落盘，那一瞬间运行目录里
 * 有一个 `status.json.tmp-1234-1700000000000`。审查员的一次目录列举撞上它，
 * 按文件名匹配的白名单认不出来，该侧就被判成「读到对端运行输出」而作废——
 * 一个与内容无关、与时机有关的随机误伤，而且极难复现。
 *
 * 与 `util/fsx.ts` 的 `writeAtomic` 由 `run-files-parity` 契约测试对账。
 */
export const ATOMIC_TMP_SUFFIX = /\.tmp-\d+-\d+$/;

/** 这个文件名是不是运行目录那一层的编排器文件（含它的原子写临时态） */
export function isRunDirFile(name: string): boolean {
  return RUN_DIR_FILE_NAMES.includes(name.replace(ATOMIC_TMP_SUFFIX, ''));
}
