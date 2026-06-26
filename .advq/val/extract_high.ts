// Extract HIGH-confidence findings (weakness + evidence) from CURRENT-variant outputs for judge classification.
import { readFileSync } from "fs";

const files = process.argv.slice(2);
const out: { id: string; weakness: string; evidence: string }[] = [];
let n = 0;
for (const f of files) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  const task = f.match(/b4_\w+_(c\d)/)?.[1] ?? "?";
  for (const r of j.rounds || []) {
    for (const w of r.responses || []) {
      const model = w.model.split("/").pop().replace("claude-", "");
      // split into findings by "## Finding"/"## Weakness"/"### Finding" headers
      const blocks = (w.content as string).split(/\n(?=#{2,3}\s)/);
      for (const b of blocks) {
        // is this finding HIGH?
        if (!/\bHIGH\b/.test(b)) continue;
        if (!/verdict|confidence/i.test(b)) continue;
        const weakness = (b.match(/weakness:?\*{0,2}\s*([\s\S]*?)(?=\n[-*]?\s*\*{0,2}(evidence|falsification|verdict)|\n#{2,3}\s|$)/i)?.[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 600);
        const evidence = (b.match(/evidence:?\*{0,2}\s*([\s\S]*?)(?=\n[-*]?\s*\*{0,2}(falsification|verdict)|\n#{2,3}\s|$)/i)?.[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
        if (!weakness && !evidence) continue;
        n++;
        out.push({ id: `${task}/${model}/#${n}`, weakness, evidence });
      }
    }
  }
}
console.log(JSON.stringify(out, null, 1));
console.error(`extracted ${out.length} HIGH findings`);
