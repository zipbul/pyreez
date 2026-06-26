#!/usr/bin/env bash
# Run the CURRENT (shipped) prompt live, 2 rounds, 2 anthropic models — verify integrated result.
cd /home/revil/projects/zipbul/pyreez
M="anthropic/claude-opus-4.6,anthropic/claude-sonnet-4.6"
mkdir -p .advq/val
for t in "$@"; do
  echo "[final] $t start $(date +%T)"
  bun run src/cli.ts deliberate --task "$(cat .advq/camp/$t.txt)" --models "$M" --protocol adversarial_debate --max-rounds 2 \
    >.advq/val/final_${t}.json 2>.advq/val/final_${t}.err
  echo "[final] $t done exit=$? bytes=$(wc -c <.advq/val/final_${t}.json) $(date +%T)"
done
echo "[final] ALL DONE $(date +%T)"
