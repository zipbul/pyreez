#!/usr/bin/env bash
# usage: runr1.sh <tag> <task...>   — R1-only (max-rounds 1), 2 anthropic models
cd /home/revil/projects/zipbul/pyreez
TAG="$1"; shift
M="anthropic/claude-opus-4.6,anthropic/claude-sonnet-4.6"
mkdir -p .advq/val
for t in "$@"; do
  echo "[$TAG] $t start $(date +%T)"
  bun run src/cli.ts deliberate --task "$(cat .advq/camp/$t.txt)" --models "$M" --protocol adversarial_debate --max-rounds 1 \
    >.advq/val/v3_${TAG}_${t}.json 2>.advq/val/b4_${TAG}_${t}.err
  echo "[$TAG] $t done exit=$? bytes=$(wc -c <.advq/val/v3_${TAG}_${t}.json) $(date +%T)"
done
echo "[$TAG] ALL DONE $(date +%T)"
