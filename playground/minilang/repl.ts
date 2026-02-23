/**
 * MiniLang REPL — Read-Eval-Print Loop
 * Usage: bun run playground/minilang/repl.ts [file.ml]
 */

import { Lexer } from "./lexer";
import { Parser } from "./parser";
import { Evaluator } from "./evaluator";

const evaluator = new Evaluator();

function runSource(source: string): void {
  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();
    evaluator.evaluate(program);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
  }
}

// File mode: run a .ml file
const args = Bun.argv.slice(2);
if (args.length > 0) {
  const file = Bun.file(args[0]!);
  const source = await file.text();
  runSource(source);
  process.exit(0);
}

// Interactive REPL
console.log("MiniLang REPL v0.1 — type 'exit' to quit");
const prompt = "ml> ";
process.stdout.write(prompt);

for await (const line of console) {
  const input = line.trim();
  if (input === "exit" || input === "quit") break;
  if (input === "") {
    process.stdout.write(prompt);
    continue;
  }
  runSource(input);
  process.stdout.write(prompt);
}

console.log("Bye!");
