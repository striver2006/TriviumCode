/** 明确生成历史 v2 夹具；新写侧与历史读侧测试不能悄悄混用。 */
import { newRunMeta, type NewRunMetaInput } from '../../src/trivium/meta.js';
import type { RunMeta } from '../../src/trivium/types.js';
export function historicalRunMeta(input: NewRunMetaInput): RunMeta {
  const meta = newRunMeta(input);
  meta.schema = 'trivium.run.v2';
  delete meta.driver_declaration;
  delete meta.family_comparisons;
  delete meta.requested_routes;
  return meta;
}
