#!/usr/bin/env bash
cd /home/revil/projects/zipbul/pyreez
M="anthropic/claude-opus-4.6,openai/gpt-5.4"
for t in "$@"; do
  echo "[v3] $t start $(date +%T)"
  bun run src/cli.ts deliberate --task "$(cat .advq/camp/$t.txt)" --models "$M" --protocol adversarial_debate --max-rounds 2 >.advq/camp/v3_$t.json 2>.advq/camp/v3_$t.err
  echo "[v3] $t done exit=$? bytes=$(wc -c <.advq/camp/v3_$t.json) $(date +%T)"
done
