# CASE 4模型族旧布尔口径的具体修正提案

状态：待Bob确认；尚未修改CASE或将4.3标绿。此项不涉及生产代码、阈值、准入例外或历史运行回写。

## 观察与根因

B1运行20261012T134125Z按真实Driver声明qwen3.8-flash及各侧回读值，记录三侧`heterogeneous: different-family`，并在`family_comparisons`记录每一对模型、来源和理由。CASE 4.3却仍要求旧布尔`true`，示例Python又按真假值分支，任何非空的`unknown`字符串也会被打印为“异构”。这是CASE没有同步当前已批准v3规范，不能据此把unknown判通过。

当前上位定义：主设计§11.6“模型族三态”及v3契约段；PRD FR-17；`skills/dual-critic/schema/run.v3.json`的`heterogeneous`枚举。三者均为same-family/different-family/unknown；历史v1/v2布尔不回写。工具身份或供应商不证明模型异构。

## 拟修改（只限CASE剧本4）

1. 在操作前明确取得本轮Driver模型声明，并在两次运行中透传；缺声明保留unknown，不推断、不用本次声明回填旧运行。
2. 4.3改为：**两侧heterogeneous均为different-family，且分别与family_comparisons中对应Driver—审核者的结果一致；逐对模型、来源和原因齐备。** 说明明确这是已声明/回读模型标识的比较，不是服务端身份验证；unknown不能算通过。
3. Python示例按三个字符串显式显示“同族/异族/未知”；历史布尔显示“旧版名义族判定”，不按字符串真值打印异构。
4. 该节末尾旧“Driver厂商名义族/布尔false”文字改为当前“按Driver声明与审核者回读比较/same-family告警”，保留同族和未知都不自动换模型、不作为审批门禁的原上位边界。可选同族对照仍为可选，不增加本轮实跑范围。

## 不变项与验证

模型回读来源、两轮换模型、防覆盖、全局配置不变四项判据不变；不修改生产Schema或guard，不把B1的Codex evidence_ok=false改成合格。修正后仅按原始B1/B2记录逐项核对新写v3与已批准规范一致，并执行相关文档契约检查。B2尚未执行，4.3即使口径修正也不会提前宣布两轮完成。
