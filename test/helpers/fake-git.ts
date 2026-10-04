/**
 * 假 git（EV-209）：放进 `PATH` 前面，按环境变量挑建仓的某一步失败，其余调用原样透传给真实 git。
 *
 * 步骤键（`FAKE_GIT_FAIL`）：`init`、`config.user.email`、`config.user.name`、`config.commit.gpgsign`、`add`（建仓的暂存）、
 * `commit`（只认带基线提交信息的那一次）、`index-add`（工作树哈希的暂存，带 `GIT_INDEX_FILE`）。`git()` 包装加的 `-c 键=值` 先剥掉。
 * 其余开关：
 *   - `FAKE_GIT_NTH=n`：只让第 n 次命中失败（计数写在 `FAKE_GIT_COUNTER` 指的文件里）；
 *   - `FAKE_GIT_CODE`：失败时的退出码，缺省 1；
 *   - `FAKE_GIT_STDOUT_ONLY=1`：失败时只往 stdout 写一行、stderr 为空；否则往 stderr 写 {@link FAKE_GIT_STDERR} 四行；
 *   - `FAKE_GIT_LOCK=1`：失败前在 cwd 摆只读锁 `locked/`（里面先放文件，空的只读目录锁不住），造「删不掉」；
 *   - `FAKE_GIT_LOG`：每次调用把参数追加一行，供断言「后面的步骤一次都没被调」。
 */
import path from 'node:path';
import { accessSync, constants } from 'node:fs';
import { promises as fs } from 'node:fs';

/** 失败时写进 stderr 的四行（第四行用来断言「只取头三行」） */
export const FAKE_GIT_STDERR = ['fake git line 1', 'fake git line 2', 'fake git line 3', 'fake git line 4'];
export const FAKE_GIT_STDOUT_LINE = 'fake git: nothing on stderr';

/** 建仓六步的步骤键，与 `FIXTURE_REPO_STEPS` 同序 */
export const FIXTURE_STEP_KEYS = ['init', 'config.user.email', 'config.user.name', 'config.commit.gpgsign', 'add', 'commit'] as const;

/** 模块加载时从 `PATH` 解析出的真实 git 绝对路径（用例随后会改 `PATH`） */
export const REAL_GIT: string = (() => {
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'git');
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // 下一个
    }
  }
  throw new Error('fake-git：PATH 里找不到真实 git，本组用例的前提不成立');
})();

const body = (realGit: string): string => `
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const env = process.env;
const argv = process.argv.slice(2);
if (env.FAKE_GIT_LOG) fs.appendFileSync(env.FAKE_GIT_LOG, argv.join(' ') + '\\n');
let a = argv.slice();
while (a[0] === '-c') a = a.slice(2);
function key() {
  if (a[0] === 'init') return 'init';
  if (a[0] === 'config') return 'config.' + a[1];
  if (a[0] === 'add') return env.GIT_INDEX_FILE ? 'index-add' : 'add';
  if (a[0] === 'commit' && a.includes('probe fixture baseline')) return 'commit';
  return null;
}
const k = key();
if (k !== null && env.FAKE_GIT_FAIL === k) {
  let hit = true;
  if (env.FAKE_GIT_NTH) {
    const f = env.FAKE_GIT_COUNTER;
    const n = Number(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '0') + 1;
    fs.writeFileSync(f, String(n));
    hit = n === Number(env.FAKE_GIT_NTH);
  }
  if (hit) {
    if (env.FAKE_GIT_LOCK) {
      const locked = path.join(process.cwd(), 'locked');
      fs.mkdirSync(locked);
      fs.writeFileSync(path.join(locked, 'f'), 'x');
      fs.chmodSync(locked, 0o500);
    }
    if (env.FAKE_GIT_STDOUT_ONLY) process.stdout.write(${JSON.stringify(FAKE_GIT_STDOUT_LINE)} + '\\n');
    else process.stderr.write(${JSON.stringify(FAKE_GIT_STDERR.join('\n'))} + '\\n');
    process.exit(Number(env.FAKE_GIT_CODE || '1'));
  }
}
const r = cp.spawnSync(${JSON.stringify(realGit)}, argv, { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
`;

/** 在 `binDir` 下写假 git，返回其路径 */
export async function writeFakeGit(binDir: string): Promise<string> {
  await fs.mkdir(binDir, { recursive: true });
  const p = path.join(binDir, 'git');
  await fs.writeFile(p, `#!${process.execPath}\n${body(REAL_GIT)}`, { mode: 0o755 });
  return p;
}
