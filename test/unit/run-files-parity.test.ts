import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
/*
 * 用既有的 `REPO_ROOT`，不自己从 `import.meta.url` 算——打包后测试跑在 dist/test/ 下，
 * 相对层数与源码树不同，自算必错。`known-forms-parity` 里就写着这条注释，
 * 而我起草本文件时照样自己算了一遍，三条用例当场 ENOENT。
 */
import { REPO_ROOT } from '../helpers/fixture.js';
import {
  ATOMIC_TMP_SUFFIX,
  RUN_DIR_FILES,
  RUN_DIR_FILE_NAMES,
  isRunDirFile,
} from '../../src/trivium/run-files.js';

/**
 * 运行目录文件清单的**反向对账**（r2 代码双审 AGY-05 ≡ GLM-07 ≡ CODEX-09）。
 *
 * ## 常量化解决不了的那一半
 *
 * 把四个文件名收进 `run-files.ts` 之后，「改名」这一族没问题了：
 * 写入点与判定点引的是同一个值。但**新增**仍然会漏——下一个人在
 * `run-protocol.ts` 里直接写 `path.join(runDir, 'trace.json')`，
 * 常量文件一个字都不用改，编译器也不会有意见，
 * 而禁读分类会把读到它的那一侧判成「读到对端运行输出」→ 当场作废。
 *
 * 症状是随机的：只有审查员恰好列了那个目录才触发。
 *
 * 所以这里扫真正的写入点源码，把 `path.join(runDir, '<字面量>')` 全抓出来，
 * 与清单比对——**方向是从代码到清单**，与「按清单去代码里找」相反：
 * 后者只能证明清单里的都还在，证明不了代码里没有清单外的。
 */

const SRC = path.join(REPO_ROOT, 'src/trivium');

/** 写运行目录那一层的模块。新增这类模块时要同步加进来（本文件末尾有守它的用例） */
const WRITER_MODULES = ['run-protocol.ts', 'status.ts'];

/** `path.join(runDir, '…')` / `path.join(dir, '…')` 里的字面量文件名 */
const JOIN_LITERAL = /path\.join\(\s*(?:runDir|dir)\s*,\s*'([^']+)'\s*\)/g;

test('运行目录那一层不得出现清单外的字面量文件名（反向对账）', async () => {
  const offenders: string[] = [];
  for (const m of WRITER_MODULES) {
    const src = await fs.readFile(path.join(SRC, m), 'utf8');
    for (const hit of src.matchAll(JOIN_LITERAL)) {
      const name = hit[1]!;
      if (!RUN_DIR_FILE_NAMES.includes(name)) offenders.push(`${m}: '${name}'`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '这些文件写在运行目录那一层却不在 RUN_DIR_FILES 里——' +
      '审查员读到它们会被判成「读到对端运行输出」而作废。' +
      '请加进 src/trivium/run-files.ts，而不是改这条断言：\n' +
      offenders.join('\n'),
  );
});

test('清单里的每个名字都真的有写入点（正向对账）', async () => {
  const sources = await Promise.all(
    WRITER_MODULES.map((m) => fs.readFile(path.join(SRC, m), 'utf8')),
  );
  const all = sources.join('\n');
  for (const [key, name] of Object.entries(RUN_DIR_FILES)) {
    assert.ok(
      all.includes(`RUN_DIR_FILES.${key}`),
      `清单里有 ${key}='${name}' 却没有任何写入点引用它——` +
        '要么写入点绕开了常量（那是上一条用例的事），要么这个条目已经作废该删',
    );
  }
});

test('原子写的临时文件名形态与 writeAtomic 对得上', async () => {
  /*
   * `writeAtomic` 落的是 `<目标>.tmp-<pid>-<毫秒>`。判定要认得它：
   * `status.json` 每次心跳都经原子写，那一瞬间目录里就有一个临时文件，
   * 审查员的一次目录列举撞上它就会被误判——与内容无关、与时机有关，极难复现。
   *
   * 这里从 `fsx.ts` 源码里把那行拼法抓出来，用它造一个真实形态的名字再验，
   * 而不是手抄一个样例：手抄的话，改了拼法这条用例照样绿。
   */
  const fsx = await fs.readFile(path.resolve(SRC, 'util/fsx.ts'), 'utf8');
  const m = /const tmp = `\$\{target\}([^`]*)`/.exec(fsx);
  assert.ok(m, 'writeAtomic 的临时名拼法变了，本用例的抓取正则要跟着改');

  const shape = m[1]!
    .replace('${process.pid}', String(process.pid))
    .replace('${Date.now()}', String(Date.now()));
  const tmpName = `${RUN_DIR_FILES.status}${shape}`;

  assert.match(tmpName, ATOMIC_TMP_SUFFIX, `实际临时名 ${tmpName} 不匹配 ATOMIC_TMP_SUFFIX`);
  assert.equal(isRunDirFile(tmpName), true, '原子写的中间态必须仍被认作己方运行时材料');
});

test('认得清单内的名字，不认清单外的', () => {
  for (const n of RUN_DIR_FILE_NAMES) assert.equal(isRunDirFile(n), true, n);
  assert.equal(isRunDirFile('result.json'), false, '侧目录下的产出不属于这一层');
  assert.equal(isRunDirFile('gemini'), false, '侧名不是运行目录文件');
  /*
   * 后缀剥离只剥**真的**原子写形态，不能顺手把别的名字剥成清单内的。
   * `request.json.tmp-x` 里的 `x` 不是数字，剥不掉，因而不认——
   * 否则「随便加个 .tmp- 后缀就能让任意文件被当成己方材料」。
   */
  assert.equal(isRunDirFile('request.json.tmp-x'), false, '非数字段不构成原子写临时名');
  assert.equal(isRunDirFile('request.json.bak'), false);
});

test('写运行目录的模块清单本身有人守着', async () => {
  /*
   * 上面三条用例扫的是 `WRITER_MODULES` 里的文件。**新增一个写那一层的模块**
   * 而不登记进来，三条用例会一起变成空转——绿得毫无意义。
   *
   * 这条用例反过来扫全仓：谁调了 `runDirFor` 或拿到 `runDir` 去 `path.join`，
   * 谁就得在清单里。
   */
  const files = (await fs.readdir(SRC)).filter((f) => f.endsWith('.ts'));
  const missing: string[] = [];
  for (const f of files) {
    /*
     * 清单模块自己不在扫描面内：它只定义常量、不写任何文件。
     * （它会被抓到纯粹因为文档注释里举了 `path.join(runDir, '…')` 这个例子——
     * 这个扫描是字面的，不解析注释。为一行注释去写注释剥离器不值得。）
     */
    if (f === 'run-files.ts') continue;
    const src = await fs.readFile(path.join(SRC, f), 'utf8');
    if (!/path\.join\(\s*runDir\s*,/.test(src)) continue;
    if (!WRITER_MODULES.includes(f)) missing.push(f);
  }
  assert.deepEqual(
    missing,
    [],
    `这些模块往运行目录那一层写文件，但不在 WRITER_MODULES 里，反向对账扫不到它们：\n${
      missing.join('\n')
    }`,
  );
});
