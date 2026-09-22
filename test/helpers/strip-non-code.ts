/**
 * 源码扫描类判据共用的**词法剥离器**。
 *
 * ## 为什么要有它，以及为什么它住在这里
 *
 * 本仓有一族判据靠**扫真实调用点的源码**来防「函数签名支持了、调用点没传」
 * ——这类缺口在被调函数自己的单测里**必然是绿的**（那些用例自己构造入参）。
 * 而裸子串扫描会被注释与字符串骗倒，`driver-wiring.test.ts` 的头注释记着
 * 这条判据被打穿的四个版本，第 5 版才立住。
 *
 * 那套实现原先只住在 `driver-wiring.test.ts` 里。第二个需要它的判据出现时
 * （M10a 第 1 步的声明接线盯防点），照抄一份就会长出第二份真相——
 * 而它恰恰是**被实测打穿过四次**的那类代码，两份各修各的必然分叉。
 * 故抽到这里共用；**它的自测仍留在 `driver-wiring.test.ts`**，
 * 那里有七种被实测打穿的形态逐条钉着，判据自己也要有人看着。
 *
 * > **改这个文件之后，局部验证请跑那一节**（代码双审 r1 AGY-02）：
 * >
 * > ```
 * > node scripts/build.mjs --tests-only
 * > node --test dist/test/test/unit/driver-wiring.test.js
 * > ```
 * >
 * > 自测**不搬过来**是有意的：那七条跑在 `review.ts` 等真实语料上
 * > （实参块里的注释、正则字面量里的反引号），搬走会让它们失去语料、
 * > 退化成合成用例——而它们之所以立得住，正是因为跑在真实语料上。
 *
 * ## 三条设计约束（改这里之前先读）
 *
 * - **置空而非替换**：每个非代码字符换成空格（换行保留）。这样偏移量不变，
 *   锚点在剥离后文本里的位置与原文一致，也不会凭空造出括号。
 * - 模板只置空 `TemplateHead/Middle/Tail` 与无插值模板，`${…}` 里的**表达式保留**
 *   （那里面本来就可以是真实取值）。头尾各含一半花括号，一起置空即保持配平。
 * - 注释走 `getLeadingCommentRanges`，并且**按 token 粒度遍历**（`getChildren`
 *   会给出 `(`、`)` 这类 token）——只走节点会漏掉夹在 token 之间的注释。
 */
import ts from 'typescript';

export function stripNonCode(src: string): string {
  const sf = ts.createSourceFile('scan.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = src.split('');
  const blank = (from: number, to: number): void => {
    for (let i = Math.max(0, from); i < Math.min(to, out.length); i++) {
      if (!/\s/.test(out[i]!)) out[i] = ' ';
    }
  };

  const LITERALS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ]);

  const visit = (node: ts.Node): void => {
    for (const r of ts.getLeadingCommentRanges(src, node.getFullStart()) ?? []) {
      blank(r.pos, r.end);
    }
    if (LITERALS.has(node.kind)) {
      blank(node.getStart(sf), node.getEnd());
      return; // 字面量里没有代码，不必再下钻
    }
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);

  return out.join('');
}
