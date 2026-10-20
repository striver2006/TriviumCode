/**
 * 集成测试的 CODEX_HOME 隔离（1.2.7）：让 vendorProfilesFor / codexNativeRouteIssue 读夹具，
 * 不读真实 ~/.codex。
 *
 * 与 `entry-scan-home.ts` 同一族环境泄漏：defaultConfig 把 codex profile 钉在 qwen，
 * 夹具仓冻结这份缺省——「名单里有没有 qwen」「基底是不是官方」取决于跑测试的机器
 * （开发机恰有 qwen.config.toml 才绿）。隔离只在一处做：`fixture.ts` 的 `cli()` 缺省把
 * `CODEX_HOME` 指向本进程的夹具家；调用方可用 extraEnv 覆盖。
 *
 * 夹具家内容：
 * - `qwen.config.toml`：空壳——vendorProfilesFor 的名单恒为 ['qwen']，与缺省 profile 对上；
 * - `config.toml`：`model_provider = "openai"`——原生路线判据（codexNativeRouteIssue）过。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { scratchDirSync } from './scratch.js';

let home: string | null = null;

/** 本测试进程的 codex 夹具家（惰性建一次，进程退出随 scratchDir 登记删除） */
export function fixtureCodexHome(): string {
  if (home) return home;
  const dir = scratchDirSync('trivium-codexhome-');
  void (async () => {
    await fs.writeFile(path.join(dir, 'qwen.config.toml'), '# 集成测试隔离名单（空壳）\n', 'utf8');
    await fs.writeFile(path.join(dir, 'config.toml'), '# 集成测试隔离基底：官方原生形态\nmodel_provider = "openai"\n', 'utf8');
  })();
  home = dir;
  return dir;
}
