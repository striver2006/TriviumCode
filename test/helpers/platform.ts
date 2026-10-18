/**
 * 测试的平台取齐件（Windows 移植，设计 §7.1）。
 *
 * 测试里所有 `/bin/sh`、`/bin/ps`、`/usr/bin/which` 一类 POSIX 字面量一律换成本模块的取法；
 * POSIX 专属语义（进程组信号、僵尸、执行位）用 skip 辅助按平台跳过并注明原因，
 * Windows 侧的等价用例（PowerShell 身份、taskkill 树杀、取消标记 watcher）另写在专门文件里。
 */
import { IS_WIN, resolvePosixShellSync } from '../../src/trivium/util/platform.js';

export { IS_WIN };

/**
 * POSIX sh 的跨平台取法：win32 用 Git for Windows 的 sh.exe（定位不到时退裸名 `sh`，
 * 让错误信息指向 PATH，而不是硬编码一个不存在的路径）；POSIX 仍为 `/bin/sh`。
 */
export const SH: string = IS_WIN ? (resolvePosixShellSync() ?? 'sh') : '/bin/sh';

/** POSIX 专属语义的用例在 win32 上跳过；返回值直接给 node:test 的 skip */
export const skipOnWin = (reason: string): string | false => (IS_WIN ? reason : false);

/** Windows 专属用例在其它平台跳过（macOS/Linux 上不跑） */
export const winOnly = (reason: string): string | false => (IS_WIN ? false : reason);
