/**
 * 规范化启动时刻的**跨平台形态**判别（1.2.2，审查 CLAUDE-08 ≡ CODEX-02）。
 *
 * 「记录不跨平台」这条论证对跨平台共享 checkout（exFAT 移动盘、云同步目录、双启动）不成立：
 * 异平台形态的记录若按字符串比对永远不等、判成「不同一进程」——方向恰是最坏侧（抹活 worker
 * 凭据、回收活锁、误 taskkill）。本文件在**两个平台上都跑**：各自喂对方平台的形态，
 * 断言一律落 `unverifiable`，不猜。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNativeCanonicalStartForm, processMatchesRecord } from '../../src/trivium/util/exec.js';
import { IS_WIN } from '../../src/trivium/util/platform.js';

const ISO_FORM = '2026-10-20T07:43:46.123456Z';
const LSTART_FORM = 'Mon Oct 20 07:43:46 2026';

test('形态判别：本平台形态认、对方平台形态不认', () => {
  assert.equal(isNativeCanonicalStartForm(ISO_FORM), IS_WIN, 'ISO 形态是 win32 的规范化形态');
  assert.equal(isNativeCanonicalStartForm(LSTART_FORM), !IS_WIN, 'ps lstart 形态是 POSIX 的规范化形态');
  assert.equal(isNativeCanonicalStartForm(''), false, '空串不是任何平台的形态');
  assert.equal(isNativeCanonicalStartForm('not a time'), false);
});

test('交叉形态：记录是对方平台的形态时判 unverifiable，不按「不同一进程」处置', async () => {
  const foreign = IS_WIN ? LSTART_FORM : ISO_FORM;
  const m = await processMatchesRecord(process.pid, { canonical: foreign, legacy: null });
  assert.equal(m.alive, true, '被比对象是本进程，活着');
  assert.equal(m.sameProcess, false);
  assert.equal(m.startedAt, null, '异平台形态不做比对——取不到也不猜');
  assert.equal(m.identity, 'unverifiable', '「判不了」与「确认不符」必须分开（EV-175 同一口径）');
});

test('交叉形态：进程已不在时维持 pid_gone（死亡是文件系统事实，与形态无关）', async () => {
  const foreign = IS_WIN ? LSTART_FORM : ISO_FORM;
  const m = await processMatchesRecord(-1, { canonical: foreign, legacy: null });
  assert.equal(m.alive, false);
  assert.equal(m.identity, 'different', 'pid 不在按不在处置，不因形态异常翻成别的结论');
});
