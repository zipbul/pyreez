/**
 * Quick test for MiniLang Parser.
 */

import { Lexer } from "./lexer";
import { Parser, type Program } from "./parser";

const source = `
let x = 42;
let mut name = "hello";
fn add(a, b) {
  let sum = a + b;
  return sum;
}
if (x >= 10 and x != 0) {
  add(x, 3.14);
} else {
  print("nope");
}
while (x > 0) {
  x = x - 1;
}
let neg = -5;
let result = add(1, 2);
let lambda = fn(a, b) { return a + b; };
`;

const lexer = new Lexer(source);
const tokens = lexer.tokenize();
const parser = new Parser(tokens);
const ast: Program = parser.parse();

console.log(`Program body statements: ${ast.body.length}`);
console.log("---");

for (const stmt of ast.body) {
  console.log(`  ${stmt.type}${describeStmt(stmt)}`);
}

function describeStmt(stmt: any): string {
  switch (stmt.type) {
    case "LetDecl":
      return ` → ${stmt.mutable ? "mut " : ""}${stmt.name} = ${describeExpr(stmt.init)}`;
    case "FnDecl":
      return ` → ${stmt.name}(${stmt.params.join(", ")}) [${stmt.body.length} stmts]`;
    case "IfStmt":
      return ` → cond=${describeExpr(stmt.condition)}, then=[${stmt.consequent.length}], else=[${stmt.alternate?.length ?? "none"}]`;
    case "WhileStmt":
      return ` → cond=${describeExpr(stmt.condition)}, body=[${stmt.body.length}]`;
    case "ExprStmt":
      return ` → ${describeExpr(stmt.expr)}`;
    case "ReturnStmt":
      return ` → ${stmt.value ? describeExpr(stmt.value) : "void"}`;
    default:
      return "";
  }
}

function describeExpr(expr: any): string {
  switch (expr.type) {
    case "NumLit": return `${expr.value}`;
    case "StrLit": return `"${expr.value}"`;
    case "BoolLit": return `${expr.value}`;
    case "NullLit": return "null";
    case "Identifier": return expr.name;
    case "BinaryExpr": return `(${describeExpr(expr.left)} ${expr.op} ${describeExpr(expr.right)})`;
    case "UnaryExpr": return `(${expr.op}${describeExpr(expr.operand)})`;
    case "CallExpr": return `${describeExpr(expr.callee)}(${expr.args.map(describeExpr).join(", ")})`;
    case "AssignExpr": return `${expr.name} = ${describeExpr(expr.value)}`;
    case "FnExpr": return `fn(${expr.params.join(", ")}) [${expr.body.length} stmts]`;
    default: return `<${expr.type}>`;
  }
}

// Deep assertion checks
function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

assert(ast.type === "Program", "root is Program");
assert(ast.body.length === 8, `expected 8 top-level stmts, got ${ast.body.length}`);

// 1. let x = 42;
const s0 = ast.body[0];
assert(s0.type === "LetDecl", "stmt 0 is LetDecl");
if (s0.type === "LetDecl") {
  assert(s0.name === "x", "let name is x");
  assert(s0.mutable === false, "let x is immutable");
  assert(s0.init.type === "NumLit" && s0.init.value === 42, "init is 42");
}

// 2. let mut name = "hello";
const s1 = ast.body[1];
assert(s1.type === "LetDecl", "stmt 1 is LetDecl");
if (s1.type === "LetDecl") {
  assert(s1.name === "name", "name is 'name'");
  assert(s1.mutable === true, "let mut is mutable");
  assert(s1.init.type === "StrLit" && s1.init.value === "hello", "init is 'hello'");
}

// 3. fn add(a, b) { let sum = a + b; return sum; }
const s2 = ast.body[2];
assert(s2.type === "FnDecl", "stmt 2 is FnDecl");
if (s2.type === "FnDecl") {
  assert(s2.name === "add", "fn name is add");
  assert(s2.params.length === 2, "2 params");
  assert(s2.params[0] === "a" && s2.params[1] === "b", "params are a, b");
  assert(s2.body.length === 2, "fn body has 2 stmts");
  assert(s2.body[0].type === "LetDecl", "body[0] is LetDecl");
  assert(s2.body[1].type === "ReturnStmt", "body[1] is ReturnStmt");
}

// 4. if (x >= 10 and x != 0) { ... } else { ... }
const s3 = ast.body[3];
assert(s3.type === "IfStmt", "stmt 3 is IfStmt");
if (s3.type === "IfStmt") {
  assert(s3.condition.type === "BinaryExpr", "condition is BinaryExpr");
  if (s3.condition.type === "BinaryExpr") {
    assert(s3.condition.op === "and", "top-level op is 'and'");
  }
  assert(s3.consequent.length === 1, "then has 1 stmt");
  assert(s3.alternate !== null && s3.alternate.length === 1, "else has 1 stmt");
}

// 5. while (x > 0) { x = x - 1; }
const s4 = ast.body[4];
assert(s4.type === "WhileStmt", "stmt 4 is WhileStmt");
if (s4.type === "WhileStmt") {
  assert(s4.condition.type === "BinaryExpr", "while cond is BinaryExpr");
  assert(s4.body.length === 1, "while body has 1 stmt");
  const bodyStmt = s4.body[0];
  assert(bodyStmt.type === "ExprStmt", "body stmt is ExprStmt");
  if (bodyStmt.type === "ExprStmt") {
    assert(bodyStmt.expr.type === "AssignExpr", "expr is AssignExpr");
  }
}

// 6. let neg = -5;
const s5 = ast.body[5];
assert(s5.type === "LetDecl", "stmt 5 is LetDecl");
if (s5.type === "LetDecl") {
  assert(s5.init.type === "UnaryExpr", "init is UnaryExpr");
  if (s5.init.type === "UnaryExpr") {
    assert(s5.init.op === "-", "unary op is -");
    assert(s5.init.operand.type === "NumLit", "operand is NumLit");
  }
}

// 7. let result = add(1, 2);
const s6 = ast.body[6];
assert(s6.type === "LetDecl", "stmt 6 is LetDecl");
if (s6.type === "LetDecl") {
  assert(s6.name === "result", "name is result");
  assert(s6.init.type === "CallExpr", "init is CallExpr");
  if (s6.init.type === "CallExpr") {
    assert(s6.init.callee.type === "Identifier" && s6.init.callee.name === "add", "callee is add");
    assert(s6.init.args.length === 2, "2 args");
  }
}

// 8. let lambda = fn(a, b) { return a + b; };
const s7 = ast.body[7];
assert(s7.type === "LetDecl", "stmt 7 is LetDecl");
if (s7.type === "LetDecl") {
  assert(s7.init.type === "FnExpr", "init is FnExpr");
  if (s7.init.type === "FnExpr") {
    assert(s7.init.params.length === 2, "lambda has 2 params");
    assert(s7.init.body.length === 1, "lambda body has 1 stmt");
  }
}

console.log("\n✅ All 30 assertions passed!");
