#!/usr/bin/env bash
cd /home/revil/projects/zipbul/pyreez
M="anthropic/claude-opus-4.6,openai/gpt-5.4"
for t in t2 t3; do
  echo "[gen] $t start $(date +%T)"
  bun run src/cli.ts deliberate --task "$(cat .advq/$t.txt)" --models "$M" --protocol adversarial_debate --max-rounds 2 >.advq/${t}.json 2>.advq/${t}.err
  echo "[gen] $t done exit=$? bytes=$(wc -c <.advq/${t}.json) $(date +%T)"
done
echo "[gen] ALL DONE $(date +%T)"
