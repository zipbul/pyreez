/**
 * Quick test for MiniLang Evaluator.
 */

import { Lexer } from "./lexer";
import { Parser } from "./parser";
import { evaluate, Evaluator, Environment } from "./evaluator";

function run(source: string): { result: unknown; output: string[] } {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  return evaluate(program);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

let passed = 0;

// ── 1. Variable declaration ──
{
  const { output } = run(`let x = 42; print(x);`);
  assert(output[0] === "42", `let/print: got "${output[0]}"`);
  passed++;
}

// ── 2. Mutable variable + assignment ──
{
  const { output } = run(`let mut x = 10; x = 20; print(x);`);
  assert(output[0] === "20", `mut: got "${output[0]}"`);
  passed++;
}

// ── 3. Immutable assignment should throw ──
{
  try {
    run(`let x = 10; x = 20;`);
    assert(false, "Should have thrown for immutable assignment");
  } catch (e: any) {
    assert(e.message.includes("immutable"), `Expected immutability error, got: ${e.message}`);
    passed++;
  }
}

// ── 4. Arithmetic ──
{
  const { output } = run(`print(2 + 3 * 4); print(10 - 3); print(10 / 3); print(10 % 3);`);
  assert(output[0] === "14", `precedence: 2+3*4 = ${output[0]}`);
  assert(output[1] === "7", `sub: ${output[1]}`);
  assert(Math.abs(Number(output[2]) - 3.3333333333333335) < 0.0001, `div: ${output[2]}`);
  assert(output[3] === "1", `mod: ${output[3]}`);
  passed++;
}

// ── 5. Comparison operators ──
{
  const { output } = run(`
    print(1 < 2);
    print(2 > 1);
    print(1 <= 1);
    print(2 >= 3);
    print(1 == 1);
    print(1 != 2);
  `);
  assert(output[0] === "true", `<`);
  assert(output[1] === "true", `>`);
  assert(output[2] === "true", `<=`);
  assert(output[3] === "false", `>=`);
  assert(output[4] === "true", `==`);
  assert(output[5] === "true", `!=`);
  passed++;
}

// ── 6. Logical operators (short-circuit) ──
{
  const { output } = run(`
    print(true and false);
    print(true or false);
    print(false and print("skip"));
    print(true or print("skip"));
  `);
  // "and" short-circuits: false and print("skip") → false, print not called
  // "or" short-circuits: true or print("skip") → true, print not called
  assert(output[0] === "false", `and: ${output[0]}`);
  assert(output[1] === "true", `or: ${output[1]}`);
  // "skip" should NOT appear
  assert(!output.includes("skip"), `short-circuit: skip appeared`);
  passed++;
}

// ── 7. Unary operators ──
{
  const { output } = run(`print(-5); print(!true); print(!false);`);
  assert(output[0] === "-5", `neg: ${output[0]}`);
  assert(output[1] === "false", `!true: ${output[1]}`);
  assert(output[2] === "true", `!false: ${output[2]}`);
  passed++;
}

// ── 8. If/else ──
{
  const { output } = run(`
    if (1 > 0) { print("yes"); } else { print("no"); }
    if (0 > 1) { print("yes"); } else { print("no"); }
  `);
  assert(output[0] === "yes", `if true`);
  assert(output[1] === "no", `if false`);
  passed++;
}

// ── 9. While loop ──
{
  const { output } = run(`
    let mut i = 0;
    while (i < 5) {
      i = i + 1;
    }
    print(i);
  `);
  assert(output[0] === "5", `while: ${output[0]}`);
  passed++;
}

// ── 10. Function declaration + call ──
{
  const { output } = run(`
    fn add(a, b) {
      return a + b;
    }
    print(add(3, 4));
  `);
  assert(output[0] === "7", `fn call: ${output[0]}`);
  passed++;
}

// ── 11. Function with no return ──
{
  const { output } = run(`
    fn greet(name) {
      print("Hello " + name);
    }
    greet("world");
  `);
  assert(output[0] === "Hello world", `fn no return: ${output[0]}`);
  passed++;
}

// ── 12. Closure ──
{
  const { output } = run(`
    fn makeCounter() {
      let mut count = 0;
      fn inc() {
        count = count + 1;
        return count;
      }
      return inc;
    }
    let counter = makeCounter();
    print(counter());
    print(counter());
    print(counter());
  `);
  assert(output[0] === "1", `closure 1: ${output[0]}`);
  assert(output[1] === "2", `closure 2: ${output[1]}`);
  assert(output[2] === "3", `closure 3: ${output[2]}`);
  passed++;
}

// ── 13. Lambda (FnExpr) ──
{
  const { output } = run(`
    let double = fn(x) { return x * 2; };
    print(double(5));
  `);
  assert(output[0] === "10", `lambda: ${output[0]}`);
  passed++;
}

// ── 14. String concatenation ──
{
  const { output } = run(`print("hello" + " " + "world");`);
  assert(output[0] === "hello world", `str concat: ${output[0]}`);
  passed++;
}

// ── 15. Built-in len() ──
{
  const { output } = run(`print(len("hello")); print(len(""));`);
  assert(output[0] === "5", `len: ${output[0]}`);
  assert(output[1] === "0", `len empty: ${output[1]}`);
  passed++;
}

// ── 16. Built-in type() ──
{
  const { output } = run(`
    print(type(42));
    print(type("hello"));
    print(type(true));
    print(type(null));
  `);
  assert(output[0] === "number", `type num`);
  assert(output[1] === "string", `type str`);
  assert(output[2] === "boolean", `type bool`);
  assert(output[3] === "null", `type null`);
  passed++;
}

// ── 17. Division by zero ──
{
  try {
    run(`let x = 10 / 0;`);
    assert(false, "Should throw for div by zero");
  } catch (e: any) {
    assert(e.message.includes("Division by zero"), `div zero: ${e.message}`);
    passed++;
  }
}

// ── 18. Undefined variable ──
{
  try {
    run(`print(x);`);
    assert(false, "Should throw for undefined var");
  } catch (e: any) {
    assert(e.message.includes("Undefined variable"), `undef: ${e.message}`);
    passed++;
  }
}

// ── 19. Recursion (fibonacci) ──
{
  const { output } = run(`
    fn fib(n) {
      if (n <= 1) { return n; }
      return fib(n - 1) + fib(n - 2);
    }
    print(fib(10));
  `);
  assert(output[0] === "55", `fib(10): ${output[0]}`);
  passed++;
}

// ── 20. Higher-order function ──
{
  const { output } = run(`
    fn apply(f, x) {
      return f(x);
    }
    fn square(n) { return n * n; }
    print(apply(square, 7));
  `);
  assert(output[0] === "49", `higher-order: ${output[0]}`);
  passed++;
}

// ── 21. Nested if-else ──
{
  const { output } = run(`
    let x = 15;
    if (x > 20) {
      print("big");
    } else {
      if (x > 10) {
        print("medium");
      } else {
        print("small");
      }
    }
  `);
  assert(output[0] === "medium", `nested if: ${output[0]}`);
  passed++;
}

// ── 22. Complex expression: operator precedence ──
{
  const { output } = run(`print(2 + 3 * 4 - 1);`);
  assert(output[0] === "13", `2+3*4-1 = ${output[0]}`);
  passed++;
}

// ── 23. Scope isolation ──
{
  const { output } = run(`
    let x = 1;
    fn inner() {
      let x = 99;
      print(x);
    }
    inner();
    print(x);
  `);
  assert(output[0] === "99", `inner scope: ${output[0]}`);
  assert(output[1] === "1", `outer scope: ${output[1]}`);
  passed++;
}

// ── 24. Arg count mismatch ──
{
  try {
    run(`fn f(a, b) { return a; } f(1);`);
    assert(false, "Should throw for arg count");
  } catch (e: any) {
    assert(e.message.includes("arguments"), `arg count: ${e.message}`);
    passed++;
  }
}

// ── 25. Not callable ──
{
  try {
    run(`let x = 42; x(1);`);
    assert(false, "Should throw for not callable");
  } catch (e: any) {
    assert(e.message.includes("not a function"), `not callable: ${e.message}`);
    passed++;
  }
}

console.log(`\n✅ All ${passed}/25 evaluator tests passed!`);
