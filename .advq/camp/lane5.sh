#!/usr/bin/env bash
cd /home/revil/projects/zipbul/pyreez
M="anthropic/claude-opus-4.6,openai/gpt-5.4"
for t in c2 c4 c5; do
  echo "[v5] $t start $(date +%T)"
  bun run src/cli.ts deliberate --task "$(cat .advq/camp/$t.txt)" --models "$M" --protocol adversarial_debate --max-rounds 2 >.advq/camp/v5_$t.json 2>.advq/camp/v5_$t.err
  echo "[v5] $t done exit=$? bytes=$(wc -c <.advq/camp/v5_$t.json) $(date +%T)"
done
echo DONE
