### S4.5 认领 code 阶段
`TV topic claim --topic <主题> --stage code --driver {{DRIVER}} --json`

让 code 阶段在 S6 的 `--start` 之前就有权威值：手工补跑的 CLI 调用漏传 `--driver` 时，
也不会静默回落到缺省 Driver。退 0 / 退 64 的处置与 S0.8 相同。
