/**
 * 四份 JSON Schema 的运行时校验器（设计 §6 / PROTOCOL §一）。
 *
 * `review.v1` 由 parse.ts 自己持有（它还要把错误回喂给模型）；其余集中在这里：
 *   - `config.v1`      → loadCtx 四级合并之后校验（M12：原先完全不校验，`gate: "off"` 静默 fail-open）
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
import configSchema from '../../skills/dual-critic/schema/config.v1.json' with { type: 'json' };
import runV1Schema from '../../skills/dual-critic/schema/run.v1.json' with { type: 'json' };
import runV2Schema from '../../skills/dual-critic/schema/run.v2.json' with { type: 'json' };
import dispositionSchema from '../../skills/dual-critic/schema/disposition.v1.json' with { type: 'json' };
import { agentById, isAgentId } from './agents/registry.js';

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

export function validateConfig(data: unknown): string[] {
  const v = compile('config', configSchema as object);
  return v(data) ? [] : formatErrors(v.errors);
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
