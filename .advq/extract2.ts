import { readFileSync, writeFileSync } from "node:fs";
function pick(file: string, round: number, modelsub: string, out: string) {
  const o = JSON.parse(readFileSync(`/home/revil/projects/zipbul/pyreez/.advq/${file}`, "utf8"));
  const r = o.rounds.find((x: any) => x.number === round);
  const resp = r.responses.find((y: any) => y.model.includes(modelsub));
  writeFileSync(`/home/revil/projects/zipbul/pyreez/.advq/${out}.txt`, resp.content);
  return `${out} <- ${file} R${round} ${modelsub} ${resp.content.length}B`;
}
const lines = [
  pick("t2.json", 2, "claude", "RESULT_t2"),
  pick("t3.json", 2, "claude", "RESULT_t3"),
  pick("t2.json", 1, "claude", "PROCESS_t2"),
  pick("t3.json", 1, "claude", "PROCESS_t3"),
];
writeFileSync("/home/revil/projects/zipbul/pyreez/.advq/extract2.log", lines.join("\n") + "\n");
