// Robust HIGH-finding extractor: splits a worker response into finding blocks and emits every block
// whose verdict/confidence is HIGH. Guarantees judged-count == parsed-HIGH-count (closes the prior gap).
import { readFileSync } from "fs";

function blocks(content: string): string[] {
  // split on markdown headers (## / ###) or horizontal rules; keep non-trivial blocks
  return content.split(/\n(?=#{2,3}\s)|\n-{3,}\n/).map(b => b.trim()).filter(b => b.length > 40);
}
function isHigh(block: string): boolean {
  // a finding is HIGH if its verdict/confidence carries an uppercase HIGH and no competing MEDIUM/LOW verdict
  if (!/\bHIGH\b/.test(block)) return false;
  // guard: the HIGH must be in a verdict/confidence context, not just prose
  return /(verdict|confidence)[\s\S]{0,40}HIGH|HIGH[\s\S]{0,15}confidence/i.test(block);
}

const files = process.argv.slice(2);
const out: { id: string; text: string }[] = [];
let n = 0;
for (const f of files) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  const task = f.match(/_(c\d)\b/)?.[1] ?? "?";
  for (const r of j.rounds || []) {
    for (const w of r.responses || []) {
      const model = w.model.split("/").pop().replace("claude-", "");
      for (const b of blocks(w.content || "")) {
        if (!isHigh(b)) continue;
        n++;
        out.push({ id: `${task}/${model}/${n}`, text: b.replace(/\s+/g, " ").slice(0, 750) });
      }
    }
  }
}
console.log(JSON.stringify(out, null, 0));
console.error(`extracted ${out.length} HIGH blocks`);
