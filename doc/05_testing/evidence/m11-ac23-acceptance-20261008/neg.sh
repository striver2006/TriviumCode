#!/bin/sh
# CASE 剧本 11 ① 负对照（零配额）：前三条期望 64，第四条期望 69；前后对比归档根与运行根，期望零工件。
SP=/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/d8a869f3-11f6-4327-a7a1-61c9337e76d1/scratchpad/ac23
cd "$SP/fx" || exit 2
TV=./.trivium/bin/trivium
OUT="$SP/negative-controls.txt"
snap() {
  echo "--- archive root ($1)"
  find .reviews -type f | sort
  echo "--- run root entries ($1)"
  ls -1 "$HOME/.trivium/runs" 2>/dev/null | wc -l | tr -d ' '
  echo "--- git status ($1)"
  git status --short
}
{
  echo "# AC-23 negative controls, $(date -u +%Y-%m-%dT%H:%M:%SZ), fixture HEAD $(git rev-parse --short HEAD)"
  snap before
  i=0
  for args in \
    "--tier-codex medium" \
    "--effort-codex medium" \
    "--effort-glm high" \
    "--profile-codex nosuchprofile"; do
    i=$((i+1))
    if [ "$i" = 3 ]; then critics=codex,glm; else critics=codex,gemini; fi
    echo
    echo "=== N$i: preflight --stage plan --critics $critics $args"
    # shellcheck disable=SC2086
    $TV preflight --stage plan --critics "$critics" $args 2>&1
    echo "exit=$?"
  done
  echo
  snap after
} >"$OUT" 2>&1
cat "$OUT"
