#!/usr/bin/env bash
cd /home/revil/projects/zipbul/pyreez
echo "--- V1 subject stdin ---"
echo "CLAIM: The Eiffel Tower is in Berlin." | bun run src/cli.ts deliberate --task "Evaluate factual accuracy." --protocol evaluation_scoring --criteria "1=false,10=true" --subject - --models "anthropic/claude-opus-4.6" --max-rounds 1 >.advq/w1.json 2>.advq/w1.err; echo "V1 exit=$?"
echo "--- V3 multi-dash rejection (expect non-zero + clear msg) ---"
echo "x" | bun run src/cli.ts deliberate --task - --subject - --models "anthropic/claude-opus-4.6" >.advq/w3.json 2>.advq/w3.err; echo "V3 exit=$? msg=$(grep -o 'Only one flag.*' .advq/w3.err | head -1)"
echo "--- V2 gemini read-only responds ---"
bun run src/cli.ts deliberate --task "One failure mode of microservices." --models "google/gemini-3-flash-preview" --protocol shared_convergence --max-rounds 1 >.advq/w2.json 2>.advq/w2.err; echo "V2 exit=$?"
echo DONE
