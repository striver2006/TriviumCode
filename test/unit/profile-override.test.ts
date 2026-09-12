import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProfileOverride, defaultConfig } from '../../src/trivium/config.js';
import { routeModel } from '../../src/trivium/adapters/base.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Config } from '../../src/trivium/types.js';

/**
 * `--profile` 换本次运行的模型档位（AGY-04 ≡ GLM-05）。
 *
 * 这个参数原先悬空：argument-hint 声明了、`splitArguments` 也认识，
 * 但 `cli.ts` 全部子命令都不解析它——声明了一个不存在的能力，
 * 用户传了即被静默丢弃。项目负责人拍板「保留即实现」后接上本函数。
 */

function cfg(): Config {
  const c = defaultConfig();
  c.profiles = {
    default: { gemini: { plan: 'g-pro', code: 'g-flash', bug: 'g-pro' },
               glm: { plan: 'GLM-5.3', code: 'GLM-5.3-Flash', bug: 'GLM-5.3' } },
    flash: { gemini: { plan: 'g-low', code: 'g-low', bug: 'g-low' },
             glm: { plan: 'GLM-Flash', code: 'GLM-Flash', bug: 'GLM-Flash' } },
  };
  c.active_profile = 'default';
  return c;
}

test('换档后 routeModel 取的是新档位的模型', () => {
  const c = applyProfileOverride(cfg(), 'flash');
  assert.equal(c.active_profile, 'flash');
  assert.deepEqual(routeModel(c, 'gemini', 'code'), { model: 'g-low', source: 'profile' });
  assert.deepEqual(routeModel(c, 'glm', 'plan'), { model: 'GLM-Flash', source: 'profile' });
});

test('不传时原样返回，不动 active_profile', () => {
  const base = cfg();
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(applyProfileOverride(base, v).active_profile, 'default');
  }
});

test('档位不存在退 64 并列出可用值——不静默回退到 default', () => {
  assert.throws(
    () => applyProfileOverride(cfg(), '压根没有的档位'),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE);
      assert.match(e.message, /不存在/);
      assert.match(e.message, /default/, '要列出可用档位，否则用户不知道能填什么');
      assert.match(e.message, /flash/);
      return true;
    },
  );
});

test('--model-* 优先于档位：更具体的赢', () => {
  const c = applyProfileOverride(cfg(), 'flash');
  assert.deepEqual(
    routeModel(c, 'gemini', 'code', { cli: 'g-pro-explicit' }),
    { model: 'g-pro-explicit', source: 'cli' },
    '显式指定的具体模型不该被档位覆盖——档位只提供默认值表',
  );
});

test('不改动传入的 config 对象本身（避免跨调用污染）', () => {
  const original = cfg();
  const switched = applyProfileOverride(original, 'flash');
  assert.equal(original.active_profile, 'default');
  assert.equal(switched.active_profile, 'flash');
});

test('档位值像是自由文本时，报错要点破「它被旗标吞了」', () => {
  assert.throws(
    () => applyProfileOverride(cfg(), '真正生效的任务目标'),
    (e: { message: string }) => {
      assert.match(e.message, /任务目标或焦点的一部分/,
        '只说「档位不存在」时，用户以为自己填错了档位名——实情是他压根没想传这个参数');
      assert.match(e.message, /双引号/, '要给出可操作的修法');
      return true;
    },
  );
});

test('档位值是正常标识符时不加这句提示——避免噪音', () => {
  assert.throws(
    () => applyProfileOverride(cfg(), 'typo-profile'),
    (e: { message: string }) => {
      assert.doesNotMatch(e.message, /任务目标或焦点的一部分/);
      assert.match(e.message, /不存在/);
      return true;
    },
  );
});
