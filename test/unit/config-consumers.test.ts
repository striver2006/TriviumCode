/**
 * 配置项与消费方的对账（2026-09-16，BACKLOG EV-26 那一批）。
 *
 * ## 这条测试为什么存在
 *
 * `review.block_severities` 曾经有完整的类型定义、默认值、schema 校验与三处文档，
 * **全仓零消费方**——它进了每个项目 `init` 出来的配置文件，用户改它不会有任何效果。
 * 这不是孤例：`instructionFiles`（EV-06）与 `readonly_commands`（EV-15）同形，
 * 后者还顶着设计两处「把不存在的机制当前提」的论证。
 *
 * 存量逐条裁另立主题。本条只做**防新增**：新加的配置项若没有任何代码读它，
 * 必须显式进 `KNOWN_DEAD` 并写明理由与去向，否则当场红。
 *
 * ## 判据的边界（如实写明，不当成完备）
 *
 * 判据是**属性访问形态**：`src/` 下除定义处以外出现过 `.<键名>`。
 * 取这个形态而不是裸键名，是因为裸键名会把**注释**算成消费方——
 * 三处注释提到 `readonly_commands`（都在说它没有消费方），裸匹配会让它被判成「活的」。
 *
 * 已知边界，两个方向都有：
 *   - **漏报**（判成活的、其实是死的）：注释里若写 `cfg.某键` 会命中。
 *     风险低——新增配置项时没人会先在注释里写属性访问。
 *   - **误报**（判成死的、其实是活的）：解构赋值 `const { parallel } = cfg.review`
 *     不带点，会被判成无消费方。目前全仓没有这种写法；真出现时把它加进
 *     `KNOWN_DEAD` 是错的，正确做法是改判据——所以这条边界写在这里而不是留给发现者猜。
 *
 * 更强的判据需要统一的配置访问器（现在全是 `cfg.review.xxx` 直接取值），
 * 那是一次跨模块重构，不在本批范围内，已登记待议。
 * **这条测试的目标是「防新增」，不是「完备地找出所有死配置」**——
 * 而它第一次运行就抓出了**七个**此前无人登记的存量（见 `KNOWN_DEAD` 里标 EV-30 的那些），
 * 是原先已知的两个（`block_severities`、`readonly_commands`）的三倍多。
 * 这个强度对目标绰绰有余，也说明这一类缺陷的真实规模比任何人估计的都大。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { defaultConfig } from '../../src/trivium/config.js';
import { REPO_ROOT } from '../helpers/fixture.js';

/**
 * 已知无消费方、且**有意暂留**的配置项。
 *
 * **这份清单只许缩短，不许变长**——变长就是又放进来一个假承诺。
 * 新增配置项时若想加进来，先回答：为什么现在不接线、什么时候接、不接的话为什么不删。
 */
const KNOWN_DEAD: { key: string; why: string }[] = [
  {
    key: 'readonly_commands',
    why:
      'BACKLOG EV-15：零消费方，且设计 §10.1 与 §18.1 #21 两处把它当已存在的机制来论证。' +
      '删它要连带改写那两处设计措辞，已判定不在本批范围内（另立主题逐条裁）',
  },
  /*
   * 以下七条是本条测试**第一次运行时抓出来的**，此前没有任何登记。
   * 它们与被删的 `block_severities` 同形：类型定义与默认值齐全、`src/` 下零消费方。
   * 本批只做防新增，存量逐条裁另立主题（BACKLOG EV-30）。
   */
  {
    key: 'deny_via_cli',
    why:
      'EV-30：本该控制「要不要向 CLI 注入路径级 deny」（设计 §10.1 机制③(b)），' +
      '而注入与否实际由探针的 path_deny.supported 决定，这个开关从未被读过。' +
      '删或接线要先定：探针说不支持时，用户把它设成 auto 意味着什么',
  },
  {
    key: 'forbid_chars',
    why:
      'EV-30：本该用于主题名字符校验，而校验实际走 topic.ts 的独立实现。' +
      '两处规则若不一致，用户改配置不会有效果——与 max_len 同段而后者有消费方，容易误以为都生效',
  },
  {
    key: 'max_check_retries',
    why:
      'EV-30：**七条里最该优先处理的**——skill 文档正拿它当真实行为向 Driver 承诺' +
      '（「最多重试 max_check_retries（默认 3）次」），而代码里没有任何重试计数。' +
      '这不只是死配置，是一句写在流程文档里的假承诺',
  },
  {
    key: 'parallel',
    why:
      'EV-30：本该控制并行/串行执行，而 runner 恒并行。设成 false 不会串行——' +
      '调试单侧问题时最可能被用到的开关，恰恰是无效的',
  },
  {
    key: 'require_adjudication',
    why:
      'EV-30：本该控制「闸门要不要强制逐条裁决」，而 gate 恒强制。' +
      '把它设成 false 不会放松任何检查——好在方向是「配置比实际更宽松」，不是反过来',
  },
  {
    key: 'max_turns',
    why: 'EV-30：zcode 侧的轮次上限，适配器从未读它。唯一命中是 probes/claude.ts 的一句注释',
  },
  {
    key: 'unsupported_override',
    why:
      'EV-30：本该控制「模型覆盖不被支持时报错还是回落」，而 zcode 适配器走的是探针的 ' +
      'model_override 档位。用户设 reject 不会让它报错',
  },
];

/** 定义处：这些文件里出现键名是「声明」而不是「消费」，不计入 */
const DEFINITION_FILES = ['types.ts', 'config.ts'];

/**
 * 键名由用户/运行期决定的容器——它们**下一层**的键不是「配置项」。
 *
 * 例如 `profiles` 下是用户自定义的档位名、`agents` 下是 Agent id。
 * 把它们当配置项会造出永远消不掉的假阳性（档位叫什么名字，代码当然不会写死）。
 */
const DYNAMIC_CONTAINERS = new Set(['profiles', 'agents', 'auth', 'cli', 'effort']);

/**
 * 阶段名：`timeout_s.plan` 这类确实是配置项，但访问形态是 `cfg.review.timeout_s[stage]`，
 * 属性形态判据看不到它。它们由**容器键**（`timeout_s` / `min_tool_calls` …）的消费方代表——
 * 容器有人读，就说明这一族在生效。
 */
const STAGE_KEYS = new Set(['plan', 'code', 'bug']);

/** 递归收集 `src/` 下的 .ts 文件 */
async function collectSources(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await collectSources(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * 该键是否以**属性访问形态**出现过——即有代码真的读它。
 *
 * 用 `.<键>` 而不是裸键名：裸匹配会把注释算成消费方。
 * 也接受方括号取值（`cfg.review['parallel']`），那同样是读。
 */
function hasPropertyAccess(src: string, key: string): boolean {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.${k}\\b|\\[['"\`]${k}['"\`]\\]`).test(src);
}

/**
 * 递归取出配置对象里的**配置项**键名。
 *
 * 跳过两类不是配置项的键：动态容器下一层（档位名、Agent id …）与阶段名，
 * 理由见上面两个常量的说明。
 */
function configKeys(o: unknown, acc = new Set<string>(), inDynamic = false): Set<string> {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return acc;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (!inDynamic && !STAGE_KEYS.has(k)) acc.add(k);
    configKeys(v, acc, DYNAMIC_CONTAINERS.has(k));
  }
  return acc;
}

test('配置项对账：每个配置键都要有消费方，否则必须具名登记为已知死配置', async () => {
  const srcRoot = path.join(REPO_ROOT, 'src');
  const files = await collectSources(srcRoot);

  // 逐文件读一次，避免每个键都重扫全仓
  const consumers = new Map<string, string>();
  for (const f of files) {
    if (DEFINITION_FILES.includes(path.basename(f))) continue;
    consumers.set(path.relative(srcRoot, f), await fs.readFile(f, 'utf8'));
  }

  const cfg = defaultConfig() as unknown;
  const dead: string[] = [];
  for (const key of configKeys(cfg)) {
    // schema 标识不是「配置项」，跳过
    if (key === 'schema') continue;
    const used = [...consumers.values()].some((src) => hasPropertyAccess(src, key));
    if (!used) dead.push(key);
  }

  const registered = new Set(KNOWN_DEAD.map((d) => d.key));
  const unregistered = dead.filter((k) => !registered.has(k)).sort();

  assert.deepEqual(
    unregistered,
    [],
    '下列配置项在 src/ 下没有任何消费方——要么接线，要么删掉，要么进 KNOWN_DEAD 并写明理由：\n  ' +
      unregistered.join('\n  '),
  );
});

test('已知死配置清单不得留过期条目：登记了但其实有消费方，说明清单该缩短了', async () => {
  const srcRoot = path.join(REPO_ROOT, 'src');
  const files = await collectSources(srcRoot);

  const stale: string[] = [];
  for (const { key } of KNOWN_DEAD) {
    let used = false;
    for (const f of files) {
      if (DEFINITION_FILES.includes(path.basename(f))) continue;
      if (hasPropertyAccess(await fs.readFile(f, 'utf8'), key)) {
        used = true;
        break;
      }
    }
    if (used) stale.push(key);
  }

  assert.deepEqual(
    stale,
    [],
    '下列项已登记为「无消费方」，但 src/ 下确实有代码读它——请把它从 KNOWN_DEAD 里删掉：\n  ' +
      stale.join('\n  '),
  );
});

test('回归锁：被删掉的那个死配置不得再出现在默认配置或 schema 里', async () => {
  /*
   * `block_severities` 是本批删掉的那一个。它曾经三处齐全（类型、默认值、schema）
   * 而零消费方，且删除对测试套件**不可见**——新 init 的夹具用新代码生成、
   * 天然不含该键，全绿通过，破坏只发生在真实存量项目上。
   * 这条锁住「别再加回来」，而上面两条锁住「别再新增同形态的」。
   */
  const cfg = defaultConfig() as unknown;
  assert.ok(
    !configKeys(cfg).has('block_severities'),
    '默认配置里又出现了 block_severities——它已于 2026-09-16 删除（零消费方），不要加回来',
  );

  const schema = JSON.parse(
    await fs.readFile(
      path.join(REPO_ROOT, 'skills/dual-critic/schema/config.v2.json'),
      'utf8',
    ),
  ) as { properties: { review: { properties: Record<string, unknown>; required: string[] } } };
  const review = schema.properties.review;
  assert.ok(!('block_severities' in review.properties), 'config.v2 的 properties 里不该再有它');
  assert.ok(!review.required.includes('block_severities'), 'config.v2 的 required 里不该再有它');
});
