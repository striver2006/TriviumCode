若 resolve 输出的 `subject_path` 非空，把它原样传给 `{{SUBJECT_FLAG}}`。
resolve 用它定位被审对象，而 `--start` 会**重新定位一次**——不传就自动取
`{{STAGE}}/` 下最新的一份原稿，用户显式指定的那份会被静默换掉，
而 resolve 阶段的存在性校验反倒让一切看起来正常。
