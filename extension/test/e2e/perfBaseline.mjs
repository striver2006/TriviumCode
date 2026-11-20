// 检出已冻结的基线树，仅接上同一分批输出桩。原核心与插件业务文件不作修改。
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export async function baseline(base) {
  const out = path.join(base, 'baseline');
  await fs.mkdir(out);
  const archive = path.join(base, 'baseline.tar');
  execFileSync('git', ['archive', '--output', archive, '589525fd'], { cwd: root });
  execFileSync('tar', ['xf', archive, '-C', out]);
  await fs.symlink(path.join(root, 'node_modules'), path.join(out, 'node_modules'), 'dir');
  const rel = 'src/trivium/adapters/';
  const stub = await fs.readFile(path.join(root, rel, 'stub.ts'), 'utf8');
  await fs.writeFile(path.join(out, rel, 'stub.ts'), stub.replace('ctx.attempt ?? 1', '1'));
  const src = await fs.readFile(path.join(root, rel, 'stub-stdout.ts'), 'utf8');
  await fs.writeFile(path.join(out, rel, 'stub-stdout.ts'), src
    .replace("import { runReviewProcess } from '../live-stdout.js';", "import { run } from '../util/exec.js';")
    .replace('runReviewProcess({ path: file, attempt }, ', 'run(')
    .replace('  return file;', "  await fs.writeFile(file, r.stdout, 'utf8');\n  return file;"));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: out, stdio: 'pipe' });
  return path.join(out, 'skills/dual-critic');
}
