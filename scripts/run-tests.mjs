/**
 * 测试运行入口（`npm test` / `npm run test:unit`）：给 `node --test` 补 `--test-timeout`。
 *
 * 为什么不直接写进 npm scripts：`--test-timeout` 要 Node ≥ 20.3，而本包 engines 是 ≥ 18——
 * 按 `--help` 探测后追加，旧 Node 上退回原样（不因旗标不存在而拒绝运行）。
 *
 * 动机（1.2.8，win32 实测）：全量套件在满载下出现过整点无推进的挂死（lock 族 EV-153 附近，
 * 65 分钟零新进程，单跑全绿）。node:test 缺省没有按用例超时——挂住的用例应变成带名字的红，
 * 而不是让整个套件无声冻结。按用例 10 分钟：远超任何合法慢测上界，又远好于无界等待。
 * 定点调试仍按 AGENTS.md 直接 `node --test <文件>`，不受影响。
 */
import { spawnSync } from 'node:child_process';

const help = spawnSync(process.execPath, ['--help'], { encoding: 'utf8' }).stdout ?? '';
const args = ['--test', ...(help.includes('--test-timeout') ? ['--test-timeout=600000'] : []), ...process.argv.slice(2)];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
