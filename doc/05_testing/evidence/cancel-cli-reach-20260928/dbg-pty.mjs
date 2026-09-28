const { run } = await import('/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/util/exec.js');
const r = await run('/bin/sh', ['-c', 'echo hi; sleep 1; echo bye'], { killTree: true, timeoutMs: 5000, pty: true });
console.log(JSON.stringify({ code: r.code, signal: r.signal, stdout: r.stdout, stderr: r.stderr, cmd: r.commandLine }));
