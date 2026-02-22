/**
 * Quick test for MiniLang Lexer.
 */

import { Lexer } from "./lexer";
import { TokenType } from "./tokens";

const source = `
let x = 42;
mut name = "hello";
fn add(a, b) {
  let sum = a + b;
  print(sum);
}
if (x >= 10 and x != 0) {
  add(x, 3.14);
} else {
  print("nope");
}
while (x > 0) {
  mut x = x - 1;
}
`;

const lexer = new Lexer(source);
const tokens = lexer.tokenize();

console.log(`Total tokens: ${tokens.length}`);
console.log("---");

for (const t of tokens) {
  const typeName = TokenType[t.type];
  console.log(`${typeName.padEnd(12)} | ${t.value.padEnd(10)} | ${t.line}:${t.column}`);
}
