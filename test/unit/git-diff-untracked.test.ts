import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { diffAgainst, initFixtureRepo } from '../../src/trivium/util/git.js';
import { scratchDir } from '../helpers/scratch.js';

/**
 * 未跟踪文件进补丁的边角（审查意见 GLM-04）。
 *
 * 这一族 bug 的共同形状是**静默残缺**：某个未跟踪文件没能生成补丁，
 * 循环只判 `if (d.stdout)` 就跳过它，于是一份缺了文件的补丁带着正常的
 * `# base:` / `# files:` 头部落盘，成为两侧共同的 subject_sha256。
 * 两侧「认真审完」的是一段不完整的变更——比不审更糟，因为留痕看起来没问题。
 */

async function repo(): Promise<string> {
  const dir = await scratchDir('trivium-untracked-');
  await fs.writeFile(path.join(dir, 'tracked.ts'), 'export const a = 1;\n');
  await initFixtureRepo(dir);
  return dir;
}

test('sensitive_globs 命中的文件不进补丁——已跟踪的改动与未跟踪的新文件都剔除（M17）', async () => {
  const dir = await repo();
  await fs.writeFile(path.join(dir, '.env'), 'SECRET=old\n');
  await fs.mkdir(path.join(dir, 'certs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'certs/server.pem'), 'PEM-old\n');
  const { run } = await import('../../src/trivium/util/exec.js');
  await run('git', ['add', '-A'], { cwd: dir });
  await run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed', '--no-verify'], { cwd: dir });
  // 已跟踪的敏感文件被修改 + 未跟踪的新敏感文件 + 一处正常改动
  await fs.writeFile(path.join(dir, '.env'), 'SECRET=new\n');
  await fs.writeFile(path.join(dir, 'id_rsa'), 'PRIVATE\n');
  await fs.writeFile(path.join(dir, 'tracked.ts'), 'export const a = 2;\n');

  const globs = ['.env*', '**/*.pem', '**/*.key', '**/id_rsa*'];
  const diff = await diffAgainst(dir, 'HEAD', [], globs);
  assert.match(diff, /tracked\.ts/);
  assert.doesNotMatch(diff, /SECRET=new/, '已跟踪的 .env 改动不得进补丁');
  assert.doesNotMatch(diff, /PRIVATE/, '未跟踪的 id_rsa 不得进补丁');
  assert.doesNotMatch(diff, /\.env/);
});

test('`-` 前缀的未跟踪文件必须进补丁，不能被 git 当成选项吃掉', async () => {
  const dir = await repo();
  // ls-files 输出的是不带 ./ 的相对路径，所以这个文件名会直接撞上 git 的选项解析
  await fs.writeFile(path.join(dir, '-weird.txt'), 'surprise\n');

  const diff = await diffAgainst(dir, 'HEAD', []);

  assert.match(
    diff,
    /-weird\.txt/,
    '带 `-` 前缀的未跟踪文件从补丁里消失了——少了 `--` 分隔符时 git 退 129 且 stdout 为空，' +
      '旧实现只判 stdout 非空，于是静默跳过',
  );
  assert.match(diff, /surprise/, '文件进了补丁但内容没进来');
});

test('普通未跟踪文件与已跟踪变更都在补丁里', async () => {
  const dir = await repo();
  await fs.writeFile(path.join(dir, 'tracked.ts'), 'export const a = 2;\n');
  await fs.writeFile(path.join(dir, 'fresh.ts'), 'export const fresh = true;\n');

  const diff = await diffAgainst(dir, 'HEAD', []);

  assert.match(diff, /tracked\.ts/, '已跟踪文件的改动应在补丁里');
  assert.match(diff, /fresh\.ts/, '未跟踪新文件应在补丁里');
});

test('排除前缀下的未跟踪文件不进补丁', async () => {
  const dir = await repo();
  await fs.mkdir(path.join(dir, '.reviews/t'), { recursive: true });
  await fs.writeFile(path.join(dir, '.reviews/t/leak.md'), '对方的审查结论\n');
  await fs.writeFile(path.join(dir, 'real.ts'), 'export const real = 1;\n');

  const diff = await diffAgainst(dir, 'HEAD', ['.reviews']);

  assert.doesNotMatch(
    diff,
    /leak\.md/,
    '归档根下的未跟踪文件混进补丁，会让对方的审查结论经被审对象本身泄漏给审查员',
  );
  assert.match(diff, /real\.ts/, '排除不该误伤正常文件');
});

test('空的未跟踪文件不报错（退出码 0 属正常，不是失败）', async () => {
  const dir = await repo();
  await fs.writeFile(path.join(dir, 'empty.txt'), '');

  await assert.doesNotReject(
    () => diffAgainst(dir, 'HEAD', []),
    '空文件无内容差异时 git 退 0，这是正常情况，不该被当成失败抛出',
  );
});

test('坏 base 像是自由文本时，报错要点破「它被旗标吞了」', async () => {
  const dir = await repo();
  await fs.writeFile(path.join(dir, 'x.ts'), 'export const x = 1;\n');

  await assert.rejects(
    () => diffAgainst(dir, '真正进入冻结', []),
    (e: { message: string }) => {
      assert.match(e.message, /bad revision|unknown revision|fatal/i, '先如实转述 git 的话');
      assert.match(
        e.message, /任务目标或焦点的一部分/,
        '「请给出一个存在的 ref」会把用户引向错误方向——他根本没想传 --base，' +
          '那段文字是任务目标里的，被前面的 --base 吞了',
      );
      return true;
    },
  );
});

test('base 是正常 ref 写错时不加这句提示——避免噪音', async () => {
  const dir = await repo();
  await fs.writeFile(path.join(dir, 'x.ts'), 'export const x = 1;\n');

  await assert.rejects(
    () => diffAgainst(dir, 'no-such-branch', []),
    (e: { message: string }) => {
      assert.doesNotMatch(e.message, /任务目标或焦点的一部分/);
      return true;
    },
  );
});
