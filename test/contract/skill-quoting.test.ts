import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';

/**
 * skill 的引号指引与 CLI 解析器同批（EV-18；计划双审 CODEX-08 / AGY-03 / GLM-06）。
 *
 * 旧指引教 Driver 给正文「补字面双引号」——那是给已删除的分词器准备的。新解析器不剥引号，
 * 补了就原样进 BRIEF。旧措辞留在任何一条 skill 里，就是一条会被照做的错指令。
 * 新指引只教一种机械可靠的形态：整段单引号包裹，内部单引号写成 `'\''`，其余不转义。
 */
const readSkill = (name: string): string =>
  readFileSync(path.join(REPO_ROOT, 'skills', name, 'SKILL.md'), 'utf8');

for (const name of ['dual-review-plan', 'dual-review-code', 'dual-review-bug', 'dual-run']) {
  test(`${name}：不再教「补字面双引号」，改教单引号包裹与 '\\'' 转义`, () => {
    const md = readSkill(name);
    assert.doesNotMatch(md, /字面双引号/, '旧指令残留：Driver 会照做，把一对引号送进 BRIEF');
    assert.doesNotMatch(md, /拼成一整串再重新分词/, '「为什么 shell 引号不管用」那段描述的机制已不存在');
    assert.match(md, /单引号/, '要教单引号包裹');
    assert.match(md, /'\\''/, "要给出内部单引号的唯一写法 '\\''");
    assert.doesNotMatch(md, /改用双引号并/, '不得建议在含单引号时换双引号并转义——那把 shell 展开的风险交给了模型手工转义');
    assert.match(md, /不要改用双引号/, '要把这条禁令写明');
  });
}

test('dual-approve：交代附言走 --reason，不把自由文字拼成位置参数（EV-24）', () => {
  const md = readSkill('dual-approve');
  assert.match(md, /--reason/);
  assert.match(md, /位置参数/, '要说明多余位置参数会退 64，这样 Driver 见到报错知道原因');
});
