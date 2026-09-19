// 在本仓 HEAD 的编译产物上复现 M9 第 6 步第 2 轮验收 claude 侧的 CLAUDE-01 / CLAUDE-02。
// 用法：node verify-claude-findings-on-head.mjs   （先 node scripts/build.mjs --with-tests）
const m = await import('/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/adapters/base.js');
const root = '/tmp/fake-project-root';
const cases = [
  ['CLAUDE-01 对照：短旗标', 'rm -rf src/existing-dir'],
  ['CLAUDE-01 主张：长旗标 + 递归', 'rm -r --force src/existing-dir'],
  ['CLAUDE-01 对照：无 -f 的递归删除', 'rm -r src/existing-dir'],
  ['CLAUDE-02 主张：仅 &> 作写入手段', 'echo secret &> src/leak.txt'],
  ['CLAUDE-02 主张：仅 &>> 作写入手段', 'echo secret &>> src/leak.txt'],
  ['CLAUDE-02 对照：普通 >', 'echo x > src/a.ts'],
  ['CLAUDE-02 对照：现有用例形态', 'echo x > src/a.ts &> /dev/null'],
];
for (const [label, cmd] of cases) {
  const r = m.classifyWriteCommands([cmd], root);
  console.log(`${label}\n  $ ${cmd}\n  writes=${JSON.stringify(r.writes)} suspected=${JSON.stringify(r.suspected.map((s) => s.why))}`);
}
