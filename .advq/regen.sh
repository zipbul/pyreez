#!/usr/bin/env bash
cd /home/revil/projects/zipbul/pyreez
M="anthropic/claude-opus-4.6,openai/gpt-5.4"
for t in t2 t3; do
  echo "[regen] $t start $(date +%T)"
  bun run src/cli.ts deliberate --task "$(cat .advq/$t.txt)" --models "$M" --protocol adversarial_debate --max-rounds 2 >.advq/new_${t}.json 2>.advq/new_${t}.err
  echo "[regen] $t done exit=$? bytes=$(wc -c <.advq/new_${t}.json) $(date +%T)"
done
echo "[regen] DONE $(date +%T)"
