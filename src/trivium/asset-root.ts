/**
 * skill 资产根（运行时根）的唯一取值规则（EV-74 计划 §3.2.2；M10b 第 2 步 r5 §5.4）。
 *
 * 单独成模块，是为了让安装器（`src/install.ts`，另打一个包）与编排器**同源**取值，
 * 又不必把 `config.ts` 的整条依赖链（yaml、schema 校验）拖进安装器。
 * `config.ts` 原样再导出它，既有调用点不动。
 */
import path from 'node:path';
import os from 'node:os';

/**
 * 优先显式覆盖，其次环境变量 `TRIVIUM_ASSET_ROOT`，最后用户级安装位置。
 *
 * `env` 与 `home` 可注入：安装器的测试一律注入临时 home（r2 §3.2.3），
 * 不能让这里偷偷读 `os.homedir()` 把测试写进开发者真实的用户目录。
 */
export function resolveAssetRoot(
  override?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = os.homedir(),
): string {
  return override ?? env['TRIVIUM_ASSET_ROOT'] ?? path.join(home, '.claude/skills/dual-critic');
}
