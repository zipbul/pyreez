#!/usr/bin/env bash
cd /home/revil/projects/zipbul/pyreez
echo "=== V1: --subject - reaches worker (evaluation_scoring) ==="
echo "CLAIM: The Eiffel Tower is located in Berlin." | bun run src/cli.ts deliberate \
  --task "Evaluate the subject's factual accuracy." --protocol evaluation_scoring \
  --criteria "Is the subject factually correct? 1=false, 10=true." --subject - \
  --models "anthropic/claude-opus-4.6" --max-rounds 1 >.advq/v1.json 2>.advq/v1.err
echo "V1 exit=$? bytes=$(wc -c <.advq/v1.json)"
echo "=== V2: gemini responds (no exit-55 swap) ==="
bun run src/cli.ts deliberate \
  --task "State one concrete failure mode of microservices." \
  --models "google/gemini-3-flash-preview" --protocol shared_convergence --max-rounds 1 \
  >.advq/v2.json 2>.advq/v2.err
echo "V2 exit=$? bytes=$(wc -c <.advq/v2.json)"
echo "DONE"
