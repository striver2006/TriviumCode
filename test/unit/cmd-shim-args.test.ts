/**
 * Windows 上经 .cmd/.bat 垫片调用 CLI 时的参数判定（双平台统一时补，后台安全审查 Command Injection）。
 *
 * cmd.exe 在 `/s /c` 之后重新解析整行，参数里的 & | < > ^ % ! 或内嵌引号能拼出额外命令；`run()` 遇到这类参数
 * 不拉起、返回派生失败。判定是纯函数，两个平台都跑；拒绝路径本身只在 win32 上走（垫片只在 win32 上经 cmd.exe）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmdShimUnsafeArgIndex } from '../../src/trivium/util/exec.js';

test('C1 普通参数（路径、模型名、旗标、中文、空格、括号）放行', () => {
  assert.equal(cmdShimUnsafeArgIndex(['C:\\Program Files (x86)\\npm\\agy.cmd', '--model', 'gpt-6.1-sol', '-p', '审一下 src/a.ts 的改动']), null);
  assert.equal(cmdShimUnsafeArgIndex([]), null);
});

test('C2 含任一 cmd 元字符即拒，给出第一个出问题的序号', () => {
  for (const meta of ['"', '%', '!', '^', '&', '|', '<', '>', '\r', '\n']) {
    assert.equal(cmdShimUnsafeArgIndex(['agy.cmd', '-p', `前文${meta}后文`]), 2, `元字符 ${JSON.stringify(meta)} 要被拒`);
  }
  assert.equal(cmdShimUnsafeArgIndex(['agy.cmd', 'a & calc', 'b | x']), 1, '取第一个');
  assert.equal(cmdShimUnsafeArgIndex(['C:\\100%\\agy.cmd', 'ok']), 0, '入口路径本身也要查');
});
