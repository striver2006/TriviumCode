/** 激活与命令注册冒烟 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('插件激活', function () {
  this.timeout(30_000);

  test('激活后命令全部注册', async () => {
    const ext = vscode.extensions.getExtension('triviumcode.trivium-cockpit');
    assert.ok(ext, '扩展未被发现（检查 extensionDevelopmentPath）');
    await ext.activate();
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ['trivium.openCockpit', 'trivium.refreshHealth', 'trivium.openManual', 'trivium.openDeployManual']) {
      assert.ok(cmds.includes(c), `缺命令 ${c}`);
    }
  });
});
