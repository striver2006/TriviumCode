import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { diffAgainst, initFixtureRepo } from '../../src/trivium/util/git.js';

/**
 * 未跟踪文件进补丁的边角（审查意见 GLM-04）。
 *
 * 这一族 bug 的共同形状是**静默残缺**：某个未跟踪文件没能生成补丁，
 * 循环只判 `if (d.stdout)` 就跳过它，于是一份缺了文件的补丁带着正常的
 * `# base:` / `# files:` 头部落盘，成为两侧共同的 subject_sha256。
 * 两侧「认真审完」的是一段不完整的变更——比不审更糟，因为留痕看起来没问题。
 */

async function repo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-untracked-'));
  await fs.writeFile(path.join(dir, 'tracked.ts'), 'export const a = 1;\n');
  await initFixtureRepo(dir);
  return dir;
}

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
