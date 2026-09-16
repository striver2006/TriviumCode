/**
 * 四份 JSON Schema 的运行时校验器（设计 §6 / PROTOCOL §一）。
 *
 * `review.v1` 由 parse.ts 自己持有（它还要把错误回喂给模型）；其余集中在这里：
 *   - `config.v2`      → loadCtx 四级合并之后校验（M12：原先完全不校验，`gate: "off"` 静默 fail-open）。
 *                        v1 不在这里：它在 `config.ts` 由 `migrateConfigV1` 迁成 v2 之后才进校验，
 *                        使校验只面对一种形状
 *   - `run.v2`         → writeRunMeta 写前校验；留痕核对把不合 schema 的 run.json 当作「不可读」
 *   - `run.v1`         → **历史契约，只读不写**（M7b 第 3 步）。既有归档是不可变工件（P6），
 *                        必须按写入时的规范解读，故 v1 校验器长期保留
 *   - `disposition.v1` → gate 校验裁决件 front-matter
 * 原先后两份从未被任何代码加载——PROTOCOL 声称的「ajv 强校验」只有 review 一份成立。
 *
 * schema 通过 `resolveJsonModule` 内联进打包产物，运行期零 node_modules（AD-12）。
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import configSchema from '../../skills/dual-critic/schema/config.v2.json' with { type: 'json' };
import runV1Schema from '../../skills/dual-critic/schema/run.v1.json' with { type: 'json' };
import runV2Schema from '../../skills/dual-critic/schema/run.v2.json' with { type: 'json' };
import dispositionSchema from '../../skills/dual-critic/schema/disposition.v1.json' with { type: 'json' };
import {
  ALL_AGENT_IDS,
  ALL_CLI_NAMES,
  CRITIC_AGENT_IDS,
  agentById,
  isAgentId,
} from './agents/registry.js';
import { DEFAULT_MAX_CRITICS } from './types.js';

let ajv: Ajv2020 | undefined;
const cache = new Map<string, ValidateFunction>();

function compile(id: string, schema: object): ValidateFunction {
  const hit = cache.get(id);
  if (hit) return hit;
  ajv ??= new Ajv2020({ allErrors: true, strict: false });
  const v = ajv.compile(schema);
  cache.set(id, v);
  return v;
}

export function formatErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  return errors.map((e) => {
    const at = e.instancePath ? e.instancePath.replace(/^\//, '').replace(/\//g, '.') : '(根)';
    const extra =
      e.keyword === 'additionalProperties'
        ? `：未知字段「${String((e.params as { additionalProperty?: string }).additionalProperty)}」`
        : e.keyword === 'enum'
          ? `：只接受 ${JSON.stringify((e.params as { allowedValues?: unknown[] }).allowedValues)}`
          : '';
    return `${at} ${e.message ?? '不合法'}${extra}`;
  });
}

/**
 * 校验 `trivium.config.v2`。
 *
 * **两段式，与 `validateRunMeta` 同构**：ajv 校形状，注册表校身份。
 * 理由也相同——Agent id 与 vendor 的唯一来源是注册表（纪律 7），
 * 在 schema 里抄第二份，新增一家时改一漏二不会报错。
 */
export function validateConfig(data: unknown): string[] {
  const v = compile('config.v2', configSchema as object);
  if (!v(data)) {
    /*
     * ajv 失败时**也要跑一次身份检查**（审查意见 GLM-04）。
     *
     * 两段式的天然断档在这里：`agents.claude` 会被 `oneOf` 在 ajv 阶段就拒掉，
     * 压根到不了下面的补校层，于是用户只拿到一串「不匹配任何分支」的机读错误，
     * 完全看不出真正的原因是「该 Agent 的配置形状要等 M9 / M10 才定义」。
     *
     * 附加而不是替换 ajv 的错误：形状问题可能不止这一个，盖掉别的更糟。
     */
    return [...formatErrors(v.errors), ...checkConfigAgents(data)];
  }
  return checkConfigAgents(data);
}

/**
 * `config.v2` 的 `agents` 段当前**已定义形状**的 vendor —— **从 schema 现取，不另写一份**。
 *
 * 与注册表的「已登记」是两回事：登记表示这家存在，有形状才表示它能被配置。
 *
 * 上一版是手写的 `new Set(['antigravity', 'zcode'])`，注释还写着「随 M8 / M9 / M10
 * 加入 oneOf 时，这里同步加一个值——**两处要一起改**」。那句话把一个第二事实源
 * 当成纪律来维护：新增一家时只改 schema 不改这里，症状是它的配置段被 ajv 放行
 * 之后，又被这里以「形状尚未定义」拒掉——一条自相矛盾的错误；只改这里不改 schema
 * 则反过来。M7b 第 6 步的桩夹具正是在这里卡住的（桩 Agent 要被 `--critics` 选中
 * 就必须有配置段，而配置段要过两道各写一份的关）。
 *
 * 判别式 `vendor: { const }` 本就是 schema 里**允许**出现的形态（它是形状判别式，
 * 不是身份枚举——见 registry-parity 对两者的区分），所以现取即可，不必再抄。
 */
function configurableVendors(): ReadonlySet<string> {
  const shapes = (configSchema as {
    properties?: { agents?: { additionalProperties?: { oneOf?: { properties?: { vendor?: { const?: unknown } } }[] } } };
  }).properties?.agents?.additionalProperties?.oneOf ?? [];
  const out = new Set<string>();
  for (const shape of shapes) {
    const v = shape.properties?.vendor?.const;
    if (typeof v === 'string') out.add(v);
  }
  if (out.size === 0) {
    // 取空说明 schema 的结构变了而本函数没跟上。静默返回空集会把**每一个**配置段
    // 都判成「形状尚未定义」——一条指向错误方向的报错。宁可在这里就说清真实原因。
    throw new Error(
      'config.v2.json 的 agents.additionalProperties.oneOf 里取不到任何 vendor 判别式，' +
        'schemas.ts 的 configurableVendors() 需要跟随 schema 结构一并更新。',
    );
  }
  return out;
}

/**
 * 配置里与 Agent 身份有关的跨字段规则（设计 13.1.1 / 计划 §3.2「约束二」）。
 *
 * 这三条 JSON Schema 都表达不了：前两条要查注册表，第三条要跨字段比对。
 * 与 `config.ts` 的既有纪律一致——**非法值明确报错，不静默落回默认**。
 */
function checkConfigAgents(data: unknown): string[] {
  const c = data as {
    agents?: Record<string, { vendor?: unknown }>;
    review?: { default_critics?: unknown; max_critics?: unknown };
    probe?: { cli?: Record<string, unknown> };
  };
  const problems: string[] = [];
  const agents = c.agents ?? {};

  /*
   * 探针段的键必须是已登记的 CLI 名——**两段式的第二段**（纪律 12，审查意见 GLM-08）。
   *
   * M6 第 1 步给 `probe.cli` 加了 `commonProbe` 的 ajv 形状校验，但只做了第一段。
   * 缺了这一段的后果不是报错而是**静默不生效**：一个形状完整的未登记键
   * （例如从 zcode 段复制改名）过得了 ajv，`preflight` / `doctor` 按 `ALL_CLI_NAMES`
   * 遍历时把它忽略，而 `guard` 若按盘上实有键遍历还会消费它的 `scratch_paths`——
   * 一个没人登记的键能影响只读失守判定。`agents` 段的未登记键是明确报错的，
   * 两处防护强度不该差这么多。
   */
  for (const key of Object.keys(c.probe?.cli ?? {})) {
    if (!ALL_CLI_NAMES.includes(key)) {
      problems.push(
        `probe.cli.${key} 不是已登记的 CLI 名。探针段按 cliName 索引，` +
          `键集的唯一来源是 agents/registry.ts；当前已登记：${ALL_CLI_NAMES.join('、')}`,
      );
    }
  }

  for (const [id, seg] of Object.entries(agents)) {
    const agent = agentById(id);
    /*
     * 键只要求「是已登记 Agent」，**不要求 criticEnabled**（设计 13.1.1）：
     * Driver 自身也需要配置容身之处。M7b 计划稿 §3.2 写的是「必须 criticEnabled」，
     * 以设计为准——那条会把未来的 Driver 段一并拒掉。
     */
    if (!agent) {
      /*
       * 列出已登记 id 时要顺带说明**哪些现在还配不了**（审查意见 GLM-04）。
       *
       * 不说的话这条错误会把用户引向下一个错误：他看到「已登记：claude、codex、
       * gemini、glm」就照着改成 `claude`，而 `claude` 的配置形状要等 M9 / M10 才定义，
       * ajv 的 `oneOf` 会用一条机读错误拒掉它——用户完全看不出真正的原因。
       */
      const vendors = configurableVendors();
      const configurable = ALL_AGENT_IDS.filter((x) => vendors.has(agentById(x)!.vendor));
      const pending = ALL_AGENT_IDS.filter((x) => !configurable.includes(x));
      problems.push(
        `agents.${id} 不是已登记的 Agent id。当前可配置：${configurable.join('、')}` +
          (pending.length > 0
            ? `；${pending.join('、')} 虽已登记，但配置形状尚未定义（随 M8 / M9 / M10），现在还不能配`
            : ''),
      );
      continue;
    }
    if (!configurableVendors().has(agent.vendor)) {
      problems.push(
        `agents.${id} 的配置形状尚未定义（随 M8 / M9 / M10 加入），当前版本不能配置它。` +
          '登记在注册表里只表示「这家存在」，不表示「它已经能被配置」',
      );
      continue;
    }
    if (seg?.vendor !== agent.vendor) {
      problems.push(
        `agents.${id}.vendor 与注册表不符：配的是 ${JSON.stringify(seg?.vendor)}，` +
          `登记的是 ${agent.vendor}。vendor 决定适配器路由与禁读矩阵，错配会发给另一家 CLI`,
      );
    }
  }

  const picked = c.review?.default_critics;
  if (Array.isArray(picked)) {
    const max =
      typeof c.review?.max_critics === 'number' ? c.review.max_critics : DEFAULT_MAX_CRITICS;
    if (picked.length > max) {
      problems.push(`review.default_critics 有 ${picked.length} 项，超过 max_critics=${max}`);
    }
    for (const id of picked) {
      if (typeof id !== 'string') {
        problems.push(`review.default_critics 含非字符串项：${JSON.stringify(id)}`);
        continue;
      }
      /*
       * **这里才是 criticEnabled 的约束点**：能被选为审核者的必须是启用了审核者
       * 能力的 Agent。登记但未启用（当前的 codex / claude）出现在这里要报错，
       * 而不是静默忽略——静默会让用户以为第三家已经在跑了。
       */
      if (!CRITIC_AGENT_IDS.includes(id as never)) {
        problems.push(
          `review.default_critics 的「${id}」不是当前可用的审核者` +
            `（可用：${CRITIC_AGENT_IDS.join('、')}）`,
        );
        continue;
      }
      if (!(id in agents)) {
        problems.push(`review.default_critics 的「${id}」在 agents 里没有配置段`);
      }
    }
  }
  return problems;
}

/**
 * 校验 `trivium.run.v2`（当前写出的形状）。
 *
 * **两段式**：先 ajv 校形状，再按注册表校身份。后半段不能塞进 schema——
 * Agent id 与厂商枚举的唯一来源是 `agents/registry.ts`（§16.2 纪律 7），
 * 在 JSON schema 里再抄一份就制造了第二个来源：新增一家时改一漏二不会报错，
 * 而症状是「第三家的 run.json 写不出去」这种要跑到运行期才发现的失败。
 * v1 的 schema 正是这么写死两家的（`critics` 恰两键 + `vendor` 恰两值），
 * 那也是本次必须升版而非原地扩展的直接原因。
 */
export function validateRunMeta(data: unknown): string[] {
  const v = compile('run.v2', runV2Schema as object);
  if (!v(data)) return formatErrors(v.errors);
  return checkAgentIdentities(data);
}

/**
 * ajv 之后的注册表身份校验：`driver` / `critics_selected` / `critics` 的键、
 * 以及各侧 `vendor` 是否与注册表一致。
 *
 * `vendor` 校的是「与该 id 登记的厂商相符」而不只是「是个已知厂商」——
 * 把 gemini 那侧的 vendor 写成 zcode 同样是被搅坏的留痕，而逐值比对能抓到它。
 */
function checkAgentIdentities(data: unknown): string[] {
  const m = data as {
    driver?: unknown;
    critics_selected?: unknown;
    critics?: Record<string, { vendor?: unknown }>;
  };
  const problems: string[] = [];

  if (typeof m.driver !== 'string' || !isAgentId(m.driver)) {
    problems.push(`driver 不是已登记的 Agent id：${JSON.stringify(m.driver)}`);
  }
  if (Array.isArray(m.critics_selected)) {
    for (const id of m.critics_selected) {
      if (typeof id !== 'string' || !isAgentId(id)) {
        problems.push(`critics_selected 含未登记的 Agent id：${JSON.stringify(id)}`);
      }
    }
  }
  for (const [id, side] of Object.entries(m.critics ?? {})) {
    const agent = agentById(id);
    if (!agent) {
      problems.push(`critics 含未登记的 Agent id：${JSON.stringify(id)}`);
      continue;
    }
    if (side?.vendor !== agent.vendor) {
      problems.push(
        `critics.${id}.vendor 与注册表不符：记的是 ${JSON.stringify(side?.vendor)}，登记的是 ${agent.vendor}`,
      );
    }
    /*
     * `critics` 的键必须取自 `critics_selected`（设计 6.7.1，审查意见 AGY-02）。
     *
     * 这是条**跨字段**约束，JSON schema 表达不了——正是两段式校验该兜住的那类。
     * 只能断言**子集，不能断言相等**：入选却整侧失联时 `critics` 少一个键是正常的
     * （那种轮次由 gate 判缺件，不由本校验器拦）；反过来「跑出了结果却不在入选集合里」
     * 才是自相矛盾的留痕。
     */
    if (Array.isArray(m.critics_selected) && !m.critics_selected.includes(id)) {
      problems.push(`critics.${id} 不在 critics_selected 里：跑出了结果的一侧必定是入选的`);
    }
  }
  return problems;
}

/**
 * 校验 `trivium.run.v1`（**历史契约，只读**）。
 *
 * 保留它不是为了兼容写侧——写侧已只出 v2——而是因为既有归档里的 v1 记录
 * 是不可变工件：按写入时的规范解读留痕，是审计系统的基本要求（P6）。
 * 拿 v2 去校验 v1 会因缺 `driver` / `critics_selected` 全判不可读，
 * 而不可读即 `EXIT.GATE_BLOCK`——本仓库的每一次提交都会被拦死。
 */
export function validateRunMetaV1(data: unknown): string[] {
  const v = compile('run.v1', runV1Schema as object);
  return v(data) ? [] : formatErrors(v.errors);
}

export function validateDispositionFrontMatter(data: unknown): string[] {
  const v = compile('disposition', dispositionSchema as object);
  return v(data) ? [] : formatErrors(v.errors);
}
