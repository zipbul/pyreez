#!/usr/bin/env bash
# usage: run.sh <tag> <k> <task...>
cd /home/revil/projects/zipbul/pyreez
TAG="$1"; K="$2"; shift 2
M="anthropic/claude-opus-4.6,anthropic/claude-sonnet-4.6"
mkdir -p .advq/val
for t in "$@"; do
  echo "[$TAG] $t k$K start $(date +%T)"
  bun run src/cli.ts deliberate --task "$(cat .advq/camp/$t.txt)" --models "$M" --protocol adversarial_debate --max-rounds 2 \
    >.advq/val/${TAG}_${t}_k${K}.json 2>.advq/val/${TAG}_${t}_k${K}.err
  echo "[$TAG] $t k$K done exit=$? bytes=$(wc -c <.advq/val/${TAG}_${t}_k${K}.json) $(date +%T)"
done
echo "[$TAG] ALL DONE $(date +%T)"
