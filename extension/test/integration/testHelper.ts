/** 集成测试共享助手：从环境变量还原夹具路径（夹具由启动脚本在建） */
import assert from 'node:assert/strict';
import path from 'node:path';
import { TriviumEnv } from '../../src/env/config';
import { buildFixture, waitFor, type Fixture } from './fixtureLib';

export const RUN_ID = '20261106T000000Z';
export const bucketOf = (root: string): string => `${root.split('/').pop()}-ab12cd34`;

export function fxRoot(): string {
  const r = process.env['TRIVIUM_EXT_FIXTURE'];
  assert.ok(r, 'TRIVIUM_EXT_FIXTURE 未设置（应由 runIntegration.mjs 传入）');
  return r;
}

export interface FxPaths {
  root: string;
  statePath: string;
  stubResponses: string;
  runRoot: string;
  runDir: string;
  runId: string;
  tuiDirectOut: string;
  tuiScriptOut: string;
  /** 原子替换写 state.json（模拟编排器） */
  writeState(gates: Record<string, unknown>): Promise<void>;
  /** 原子替换写 run 目录 status.json */
  writeStatus(obj: Record<string, unknown>): Promise<void>;
}

export async function fxPaths(): Promise<FxPaths> {
  const root = fxRoot();
  const env = new TriviumEnv(root);
  const cfg = await env.loadConfig();
  assert.ok(cfg.runRoot, '夹具 config 应有 run_root');
  const statePath = path.join(root, '.trivium', 'state.json');
  const statusPath = path.join(cfg.runRoot!, bucketOf(root), RUN_ID, 'status.json');
  const atomicWrite = async (p: string, text: string): Promise<void> => {
    const { promises: fs } = await import('node:fs');
    const tmp = `${p}.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, p);
  };
  return {
    root,
    statePath,
    stubResponses: path.join(root, '.trivium', 'stub', 'responses.json'),
    runRoot: cfg.runRoot!,
    runDir: path.join(cfg.runRoot!, bucketOf(root), RUN_ID),
    runId: RUN_ID,
    tuiDirectOut: path.join(root, 'fake-bin', 'tui-direct.out'),
    tuiScriptOut: path.join(root, 'fake-bin', 'tui-script.out'),
    writeState: (gates) => atomicWrite(statePath, JSON.stringify({ schema: 'trivium.state.v1', updated_at: new Date().toISOString(), gates }, null, 2)),
    writeStatus: (obj) => atomicWrite(statusPath, JSON.stringify(obj, null, 2)),
  };
}

/** 夹具类型再导出（省得每个测试文件重复 import 路径） */
export type { Fixture };
export { buildFixture, waitFor };
