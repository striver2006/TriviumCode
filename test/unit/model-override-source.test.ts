/**
 * EV-123：副本源路径的唯一出处，与按能力判侧的只警告检查。
 *
 * `zcodeOverrideSourcePath()` 读 `os.homedir()`，POSIX 下它读 `$HOME`：每条用例把 `HOME` 钉到
 * mkdtemp 的临时目录，用完恢复，不碰开发机真实的 `~/.zcode/cli/config.json`。
 * 两个世界缺一不可：只有「不摆文件」的世界时，「共用一处路径」与「各写一份路径」观测相同，
 * P6（缺省值另写一个路径）就杀不死（r1 双审 CODEX-05）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { defaultConfig } from '../../src/trivium/config.js';
import { prepareZcodeHome, zcodeAdapter, zcodeOverrideSourcePath } from '../../src/trivium/adapters/zcode.js';
import { checkModelOverrideSource, displayHomePath } from '../../src/trivium/preflight.js';
import { agentById } from '../../src/trivium/agents/registry.js';
import type { CriticAdapter } from '../../src/trivium/adapters/base.js';
import { scratchDir } from '../helpers/scratch.js';

async function withHome<T>(populate: boolean, fn: (home: string) => Promise<T>): Promise<T> {
  const home = await scratchDir('trivium-ovr-home-');
  if (populate) {
    await fs.mkdir(path.join(home, '.zcode/cli'), { recursive: true });
    await fs.writeFile(path.join(home, '.zcode/cli/config.json'), '{}\n');
  }
  const saved = process.env['HOME'];
  process.env['HOME'] = home;
  try {
    return await fn(home);
  } finally {
    if (saved === undefined) delete process.env['HOME'];
    else process.env['HOME'] = saved;
  }
}

const adapterCtx = () => ({ cfg: defaultConfig(), nodePath: process.execPath });

test('唯一出处·世界 A（HOME 下不摆副本源）：三处都指向同一路径，都判「不在」', async () => {
  await withHome(false, async (home) => {
    const p = zcodeOverrideSourcePath();
    assert.equal(p, path.join(home, '.zcode/cli/config.json'));
    assert.equal(zcodeAdapter.modelOverrideSource?.(), p, '适配器的可选成员必须回到同一出处');
    const runDir = await scratchDir('trivium-ovr-run-');
    const prep = await prepareZcodeHome(runDir, 'GLM-5.3');
    assert.equal(prep.cause, 'source_missing', '不传 srcConfig 时缺省值就是这个路径');
    assert.equal(await zcodeAdapter.authProbe!(adapterCtx(), runDir).fingerprint(), null);
  });
});

test('唯一出处·世界 B（HOME 下摆着副本源）：缺省值与指纹读的都是它', async () => {
  await withHome(true, async () => {
    const runDir = await scratchDir('trivium-ovr-run-');
    // 不给模型：过了存在性判定就走 no_model 出口，不必构造一份完整的 provider 配置
    const prep = await prepareZcodeHome(runDir, null);
    assert.notEqual(prep.cause, 'source_missing', '副本源在却判缺失 ⇒ 缺省值没走唯一出处');
    assert.equal(prep.cause, 'no_model');
    assert.notEqual(await zcodeAdapter.authProbe!(adapterCtx(), runDir).fingerprint(), null);
  });
});

const fake = (src: string): CriticAdapter => ({ modelOverrideSource: () => src }) as unknown as CriticAdapter;

test('checkModelOverrideSource：文件不在 ⇒ 一条 ok:true 的 warn 项，路径以 ~/ 展示、侧名取自注册表', async () => {
  await withHome(false, async (home) => {
    const src = zcodeOverrideSourcePath();
    const out = await checkModelOverrideSource(['glm'], { glm: fake(src) });
    assert.equal(out.length, 1);
    const [w] = out;
    assert.equal(w!.ok, true, '只警告、不拒跑');
    assert.equal(w!.warn, true);
    assert.match(w!.detail, /^⚠️ /);
    assert.ok(w!.detail.includes('~/.zcode/cli/config.json'), w!.detail);
    assert.ok(!w!.detail.includes(home), '不得带出临时 HOME 的绝对路径（evidence 里不带用户名）');
    const agent = agentById('glm')!;
    assert.equal(w!.name, `${agent.display} 模型覆盖副本源`);
    assert.ok(w!.detail.includes(`${agent.id} 侧`) && w!.detail.includes(agent.cliName), '侧名与 CLI 名经注册表插值');
    // 措辞只陈述构造性事实：条件句，不断言结局
    assert.ok(w!.detail.includes('若在它缺位时拉起'), '预检时当轮可能压根没选该侧，必须是条件句');
    assert.ok(w!.detail.includes('回读不到生效模型时它不出声'), '收尾兜底有前提，要说出来');
  });
});

test('checkModelOverrideSource：文件在、未入选、没有该成员 ⇒ 都不出项', async () => {
  await withHome(true, async () => {
    const src = zcodeOverrideSourcePath();
    assert.deepEqual(await checkModelOverrideSource(['glm'], { glm: fake(src) }), [], '文件在');
  });
  await withHome(false, async () => {
    const src = zcodeOverrideSourcePath();
    assert.deepEqual(await checkModelOverrideSource(['codex', 'gemini'], { glm: fake(src) }), [], '未入选');
    const noMember = { availability: () => ({ ok: true }) } as unknown as CriticAdapter;
    assert.deepEqual(await checkModelOverrideSource(['glm'], { glm: noMember }), [], '按能力判侧：没有该成员就不查');
  });
});

test('checkModelOverrideSource 缺省用真实适配器表：只有 zcode 那一侧实现了该成员', async () => {
  await withHome(false, async () => {
    const out = await checkModelOverrideSource(['codex', 'gemini', 'glm']);
    assert.equal(out.length, 1, out.map((c) => c.name).join('、'));
    assert.ok(out[0]!.detail.startsWith('⚠️ glm 侧'));
  });
});

test('displayHomePath：家目录之下显示为 ~/，之外原样', async () => {
  await withHome(false, async (home) => {
    assert.equal(displayHomePath(path.join(home, 'a/b.json')), '~/a/b.json');
    assert.equal(displayHomePath('/etc/hosts'), '/etc/hosts');
    assert.equal(displayHomePath(`${home}-sibling/x`), `${home}-sibling/x`, '同前缀的兄弟目录不算家目录之下');
  });
});
