# 20C前：路线与实际模型最小清单

旧05指纹5/1/6仅历史。当前新脚本/合同模块及local9d166全指纹能力均未测，版本也须重录；请求模型不是当前实际回读。新启动按获批20C后最终提交/安装指纹分批发布，当前0准入CLI。

|路线/组合|请求模型|当前实际模型|缺口|可复用证据|必要新增启动|
|---|---|---|---|---|---|
|claude/qwen|qwen3.8-flash|null|新全指纹能力缺；非flash生产写无新机制，保持0启动|仅历史/机制依据；不能作当前完整准入|条件成熟刷新4能力+版本另批|
|claude/qwen-pro|null|null|新全指纹能力缺；非flash生产写无新机制，保持0启动|仅历史/机制依据；不能作当前完整准入|写0；非写必要性逐项另批|
|claude/kimi|null|null|新全指纹能力缺；非flash生产写无新机制，保持0启动|仅历史/机制依据；不能作当前完整准入|写0；非写必要性逐项另批|
|claude/kimi-pro|null|null|新全指纹能力缺；非flash生产写无新机制，保持0启动|仅历史/机制依据；不能作当前完整准入|写0；非写必要性逐项另批|
|claude/deepseek|null|null|新全指纹能力缺；非flash生产写无新机制，保持0启动|仅历史/机制依据；不能作当前完整准入|写0；非写必要性逐项另批|
|claude/deepseek-pro|null|null|新全指纹能力缺；非flash生产写无新机制，保持0启动|仅历史/机制依据；不能作当前完整准入|写0；非写必要性逐项另批|
|codex/native-sol|gpt-6.1-sol|null|新包read/deny及新合同write完整指纹均缺，先Qwen/Luna写各一次|仅历史/机制依据；不能作当前完整准入|Qwen写通过后，其他4新写各2及read/deny逐项另批|
|codex/native-luna|null|null|新包read/deny及新合同write完整指纹均缺，先Qwen/Luna写各一次|仅历史/机制依据；不能作当前完整准入|首批各版本2+写2=4|
|codex/native-astra|gpt-6-astra|null|新包read/deny及新合同write完整指纹均缺，先Qwen/Luna写各一次|仅历史/机制依据；不能作当前完整准入|Qwen写通过后，其他4新写各2及read/deny逐项另批|
|codex/qwen|qwen3.8-flash|null|新包read/deny及新合同write完整指纹均缺，先Qwen/Luna写各一次|仅历史/机制依据；不能作当前完整准入|首批各版本2+写2=4|
|codex/kimi|kimi-for-coding|null|新包read/deny及新合同write完整指纹均缺，先Qwen/Luna写各一次|仅历史/机制依据；不能作当前完整准入|Qwen写通过后，其他4新写各2及read/deny逐项另批|
|codex/deepseek|deepseek-flash|null|新包read/deny及新合同write完整指纹均缺，先Qwen/Luna写各一次|仅历史/机制依据；不能作当前完整准入|Qwen写通过后，其他4新写各2及read/deny逐项另批|

Claude官方未测待订阅。Codex deny仅事后命令检测，不是CLI阻止读取。所有服务端身份null，原生产写标准不变，目标未完成。
