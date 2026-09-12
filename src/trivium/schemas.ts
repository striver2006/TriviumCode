/**
 * 四份 JSON Schema 的运行时校验器（设计 §6 / PROTOCOL §一）。
 *
 * `review.v1` 由 parse.ts 自己持有（它还要把错误回喂给模型）；其余三份集中在这里：
 *   - `config.v1`      → loadCtx 四级合并之后校验（M12：原先完全不校验，`gate: "off"` 静默 fail-open）
 *   - `run.v1`         → writeRunMeta 写前校验；留痕核对把不合 schema 的 run.json 当作「不可读」
 *   - `disposition.v1` → gate 校验裁决件 front-matter
 * 原先后两份从未被任何代码加载——PROTOCOL 声称的「ajv 强校验」只有 review 一份成立。
 *
 * schema 通过 `resolveJsonModule` 内联进打包产物，运行期零 node_modules（AD-12）。
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import configSchema from '../../skills/dual-critic/schema/config.v1.json' with { type: 'json' };
import runSchema from '../../skills/dual-critic/schema/run.v1.json' with { type: 'json' };
import dispositionSchema from '../../skills/dual-critic/schema/disposition.v1.json' with { type: 'json' };

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

export function validateRunMeta(data: unknown): string[] {
  const v = compile('run', runSchema as object);
  return v(data) ? [] : formatErrors(v.errors);
}

export function validateDispositionFrontMatter(data: unknown): string[] {
  const v = compile('disposition', dispositionSchema as object);
  return v(data) ? [] : formatErrors(v.errors);
}
