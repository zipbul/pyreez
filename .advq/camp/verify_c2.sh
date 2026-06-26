#!/usr/bin/env bash
cd /home/revil/projects/zipbul/pyreez
M="anthropic/claude-opus-4.6,openai/gpt-5.4"
for r in 1 2; do
  echo "[vc2] run$r start $(date +%T)"
  bun run src/cli.ts deliberate --task "$(cat .advq/camp/c2.txt)" --models "$M" --protocol adversarial_debate --max-rounds 2 >.advq/camp/c2_fix${r}.json 2>.advq/camp/c2_fix${r}.err
  echo "[vc2] run$r done exit=$? $(date +%T)"
done
echo DONE
