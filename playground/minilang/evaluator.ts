/**
 * MiniLang Tree-Walk Evaluator
 * Supports: variables (let/mut), functions (named+anonymous), closures,
 * if/else, while, return, arithmetic, comparison, logical operators,
 * built-in functions (print, len, type).
 */

import type {
  Program, Stmt, Expr, LetDecl, FnDecl, IfStmt, WhileStmt,
  ExprStmt, ReturnStmt, BinaryExpr, UnaryExpr, CallExpr,
  Identifier, NumLit, StrLit, BoolLit, NullLit, AssignExpr, FnExpr,
} from "./parser";

// ── Return signal (throw/catch pattern for unwinding) ──

class ReturnSignal {
  constructor(public value: unknown) {}
}

// ── Environment (lexical scoping) ──

export class Environment {
  private vars = new Map<string, { value: unknown; mutable: boolean }>();

  constructor(private parent: Environment | null = null) {}

  define(name: string, value: unknown, mutable: boolean): void {
    if (this.vars.has(name)) {
      throw new Error(`Variable '${name}' is already defined`);
    }
    this.vars.set(name, { value, mutable });
  }

  get(name: string): unknown {
    const entry = this.vars.get(name);
    if (entry !== undefined) return entry.value;
    if (this.parent) return this.parent.get(name);
    throw new Error(`Undefined variable '${name}'`);
  }

  set(name: string, value: unknown): void {
    const entry = this.vars.get(name);
    if (entry !== undefined) {
      if (!entry.mutable) {
        throw new Error(`Cannot assign to immutable variable '${name}'`);
      }
      entry.value = value;
      return;
    }
    if (this.parent) {
      this.parent.set(name, value);
      return;
    }
    throw new Error(`Undefined variable '${name}'`);
  }
}

// ── Callable wrapper ──

type MiniLangFn = {
  kind: "function";
  params: string[];
  body: Stmt[];
  closure: Environment;
};

type BuiltinFn = {
  kind: "builtin";
  name: string;
  fn: (...args: unknown[]) => unknown;
};

type Callable = MiniLangFn | BuiltinFn;

function isCallable(v: unknown): v is Callable {
  return typeof v === "object" && v !== null && "kind" in v &&
    ((v as any).kind === "function" || (v as any).kind === "builtin");
}

// ── Evaluator ──

export class Evaluator {
  public output: string[] = [];

  private builtins: Map<string, BuiltinFn>;

  constructor() {
    this.builtins = new Map([
      ["print", {
        kind: "builtin" as const,
        name: "print",
        fn: (...args: unknown[]) => {
          const line = args.map(a => this.stringify(a)).join(" ");
          this.output.push(line);
          console.log(line);
          return null;
        },
      }],
      ["len", {
        kind: "builtin" as const,
        name: "len",
        fn: (arg: unknown) => {
          if (typeof arg === "string") return arg.length;
          if (Array.isArray(arg)) return arg.length;
          throw new Error(`len() expects string or array, got ${typeof arg}`);
        },
      }],
      ["type", {
        kind: "builtin" as const,
        name: "type",
        fn: (arg: unknown) => {
          if (arg === null) return "null";
          if (typeof arg === "number") return "number";
          if (typeof arg === "string") return "string";
          if (typeof arg === "boolean") return "boolean";
          if (isCallable(arg)) return "function";
          return typeof arg;
        },
      }],
    ]);
  }

  evaluate(program: Program): unknown {
    const globalEnv = new Environment();
    // Register builtins
    for (const [name, fn] of this.builtins) {
      globalEnv.define(name, fn, false);
    }
    return this.executeBlock(program.body, globalEnv);
  }

  private executeBlock(stmts: Stmt[], env: Environment): unknown {
    let result: unknown = null;
    for (const stmt of stmts) {
      result = this.execStmt(stmt, env);
    }
    return result;
  }

  private execStmt(stmt: Stmt, env: Environment): unknown {
    switch (stmt.type) {
      case "LetDecl": return this.execLetDecl(stmt, env);
      case "FnDecl": return this.execFnDecl(stmt, env);
      case "IfStmt": return this.execIfStmt(stmt, env);
      case "WhileStmt": return this.execWhileStmt(stmt, env);
      case "ExprStmt": return this.evalExpr(stmt.expr, env);
      case "ReturnStmt": return this.execReturnStmt(stmt, env);
    }
  }

  private execLetDecl(stmt: LetDecl, env: Environment): unknown {
    const value = this.evalExpr(stmt.init, env);
    env.define(stmt.name, value, stmt.mutable);
    return null;
  }

  private execFnDecl(stmt: FnDecl, env: Environment): unknown {
    const fn: MiniLangFn = {
      kind: "function",
      params: stmt.params,
      body: stmt.body,
      closure: env,
    };
    env.define(stmt.name, fn, false);
    return null;
  }

  private execIfStmt(stmt: IfStmt, env: Environment): unknown {
    const cond = this.evalExpr(stmt.condition, env);
    if (this.isTruthy(cond)) {
      this.executeBlock(stmt.consequent, new Environment(env));
    } else if (stmt.alternate) {
      this.executeBlock(stmt.alternate, new Environment(env));
    }
    return null;
  }

  private execWhileStmt(stmt: WhileStmt, env: Environment): unknown {
    while (this.isTruthy(this.evalExpr(stmt.condition, env))) {
      this.executeBlock(stmt.body, new Environment(env));
    }
    return null;
  }

  private execReturnStmt(stmt: ReturnStmt, env: Environment): never {
    const value = stmt.value ? this.evalExpr(stmt.value, env) : null;
    throw new ReturnSignal(value);
  }

  private evalExpr(expr: Expr, env: Environment): unknown {
    switch (expr.type) {
      case "NumLit": return expr.value;
      case "StrLit": return expr.value;
      case "BoolLit": return expr.value;
      case "NullLit": return null;
      case "Identifier": return env.get(expr.name);
      case "BinaryExpr": return this.evalBinary(expr, env);
      case "UnaryExpr": return this.evalUnary(expr, env);
      case "CallExpr": return this.evalCall(expr, env);
      case "AssignExpr": return this.evalAssign(expr, env);
      case "FnExpr": return this.evalFnExpr(expr, env);
    }
  }

  private evalBinary(expr: BinaryExpr, env: Environment): unknown {
    // Short-circuit for logical operators
    if (expr.op === "and") {
      const left = this.evalExpr(expr.left, env);
      return this.isTruthy(left) ? this.evalExpr(expr.right, env) : left;
    }
    if (expr.op === "or") {
      const left = this.evalExpr(expr.left, env);
      return this.isTruthy(left) ? left : this.evalExpr(expr.right, env);
    }

    const left = this.evalExpr(expr.left, env);
    const right = this.evalExpr(expr.right, env);

    switch (expr.op) {
      case "+":
        if (typeof left === "number" && typeof right === "number") return left + right;
        if (typeof left === "string" || typeof right === "string") {
          return this.stringify(left) + this.stringify(right);
        }
        throw new Error(`Cannot add ${typeof left} and ${typeof right}`);
      case "-": return this.asNum(left) - this.asNum(right);
      case "*": return this.asNum(left) * this.asNum(right);
      case "/": {
        const divisor = this.asNum(right);
        if (divisor === 0) throw new Error("Division by zero");
        return this.asNum(left) / divisor;
      }
      case "%": return this.asNum(left) % this.asNum(right);
      case "==": return left === right;
      case "!=": return left !== right;
      case "<": return this.asNum(left) < this.asNum(right);
      case "<=": return this.asNum(left) <= this.asNum(right);
      case ">": return this.asNum(left) > this.asNum(right);
      case ">=": return this.asNum(left) >= this.asNum(right);
      default:
        throw new Error(`Unknown operator '${expr.op}'`);
    }
  }

  private evalUnary(expr: UnaryExpr, env: Environment): unknown {
    const operand = this.evalExpr(expr.operand, env);
    switch (expr.op) {
      case "-": return -this.asNum(operand);
      case "!":
      case "not":
        return !this.isTruthy(operand);
      default:
        throw new Error(`Unknown unary operator '${expr.op}'`);
    }
  }

  private evalCall(expr: CallExpr, env: Environment): unknown {
    const callee = this.evalExpr(expr.callee, env);
    if (!isCallable(callee)) {
      throw new Error(`'${this.stringify(callee)}' is not a function`);
    }

    const args = expr.args.map(a => this.evalExpr(a, env));

    if (callee.kind === "builtin") {
      return callee.fn(...args);
    }

    // User-defined function
    if (args.length !== callee.params.length) {
      throw new Error(
        `Expected ${callee.params.length} arguments but got ${args.length}`
      );
    }

    const fnEnv = new Environment(callee.closure);
    for (let i = 0; i < callee.params.length; i++) {
      fnEnv.define(callee.params[i], args[i], true);
    }

    try {
      this.executeBlock(callee.body, fnEnv);
      return null; // no explicit return
    } catch (e) {
      if (e instanceof ReturnSignal) {
        return e.value;
      }
      throw e;
    }
  }

  private evalAssign(expr: AssignExpr, env: Environment): unknown {
    const value = this.evalExpr(expr.value, env);
    env.set(expr.name, value);
    return value;
  }

  private evalFnExpr(expr: FnExpr, env: Environment): MiniLangFn {
    return {
      kind: "function",
      params: expr.params,
      body: expr.body,
      closure: env,
    };
  }

  // ── Helpers ──

  private isTruthy(v: unknown): boolean {
    if (v === null || v === false || v === 0 || v === "") return false;
    return true;
  }

  private asNum(v: unknown): number {
    if (typeof v !== "number") {
      throw new Error(`Expected number, got ${typeof v} (${this.stringify(v)})`);
    }
    return v;
  }

  private stringify(v: unknown): string {
    if (v === null) return "null";
    if (isCallable(v)) {
      return v.kind === "builtin" ? `<builtin:${v.name}>` : "<function>";
    }
    return String(v);
  }
}

// ── Convenience function ──

export function evaluate(program: Program): { result: unknown; output: string[] } {
  const evaluator = new Evaluator();
  const result = evaluator.evaluate(program);
  return { result, output: evaluator.output };
}
