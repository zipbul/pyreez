#!/usr/bin/env bash
cd /home/revil/projects/zipbul/pyreez
M="anthropic/claude-opus-4.6,anthropic/claude-sonnet-4.6"
for t in c3 c5 c6; do
  echo "[web] $t start $(date +%T)"
  bun run src/cli.ts deliberate --task "$(cat .advq/camp/$t.txt)" --models "$M" --protocol adversarial_debate --max-rounds 2 --web-access true >.advq/camp/web_$t.json 2>.advq/camp/web_$t.err
  echo "[web] $t done exit=$? bytes=$(wc -c <.advq/camp/web_$t.json) $(date +%T)"
done
echo DONE
