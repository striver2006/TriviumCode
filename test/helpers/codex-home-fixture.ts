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
 * - `<profile>.config.toml`：空壳——vendorProfilesFor 的名单即传入的 profile 集（缺省家恒为 ['qwen']，与缺省 profile 对上）；
 * - `config.toml`：`model_provider = "openai"`——原生路线判据（codexNativeRouteIssue）过。
 *
 * 写入是同步的（双平台统一时改）：原先异步写、不等完成就返回目录，首个用例的子进程可能先于写入读到空家。
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { scratchDirSync } from './scratch.js';

let home: string | null = null;

/** 按给定 profile 名单造一个 codex 夹具家（每次新建，进程退出随 scratchDir 登记删除） */
export function fixtureCodexHomeWith(profiles: readonly string[]): string {
  const dir = scratchDirSync('trivium-codexhome-');
  for (const p of profiles) writeFileSync(path.join(dir, `${p}.config.toml`), '# 集成测试隔离名单（空壳）\n', 'utf8');
  writeFileSync(path.join(dir, 'config.toml'), '# 集成测试隔离基底：官方原生形态\nmodel_provider = "openai"\n', 'utf8');
  return dir;
}

/** 本测试进程的 codex 夹具家（惰性建一次，名单为 ['qwen']） */
export function fixtureCodexHome(): string {
  home ??= fixtureCodexHomeWith(['qwen']);
  return home;
}
