import { Token, TokenType } from "./tokens";

export type Program = { type: "Program"; body: Stmt[] };

export type LetDecl = {
  type: "LetDecl";
  name: string;
  mutable: boolean;
  init: Expr;
};

export type FnDecl = { type: "FnDecl"; name: string; params: string[]; body: Stmt[] };

export type IfStmt = {
  type: "IfStmt";
  condition: Expr;
  consequent: Stmt[];
  alternate: Stmt[] | null;
};

export type WhileStmt = { type: "WhileStmt"; condition: Expr; body: Stmt[] };

export type ExprStmt = { type: "ExprStmt"; expr: Expr };

export type ReturnStmt = { type: "ReturnStmt"; value: Expr | null };

export type BinaryExpr = {
  type: "BinaryExpr";
  op: string;
  left: Expr;
  right: Expr;
};

export type UnaryExpr = { type: "UnaryExpr"; op: string; operand: Expr };

export type CallExpr = { type: "CallExpr"; callee: Expr; args: Expr[] };

export type Identifier = { type: "Identifier"; name: string };

export type NumLit = { type: "NumLit"; value: number };

export type StrLit = { type: "StrLit"; value: string };

export type BoolLit = { type: "BoolLit"; value: boolean };

export type NullLit = { type: "NullLit" };

export type AssignExpr = { type: "AssignExpr"; name: string; value: Expr };

export type FnExpr = { type: "FnExpr"; params: string[]; body: Stmt[] };

export type Expr =
  | BinaryExpr
  | UnaryExpr
  | CallExpr
  | Identifier
  | NumLit
  | StrLit
  | BoolLit
  | NullLit
  | AssignExpr
  | FnExpr;

export type Stmt = LetDecl | FnDecl | IfStmt | WhileStmt | ExprStmt | ReturnStmt;

export class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Program {
    const body: Stmt[] = [];
    while (!this.isAtEnd()) {
      body.push(this.parseDeclaration());
    }
    return { type: "Program", body };
  }

  private parseDeclaration(): Stmt {
    if (this.match(TokenType.LET)) return this.parseLetDecl();
    if (this.match(TokenType.FN)) return this.parseFnDecl();
    return this.parseStatement();
  }

  private parseLetDecl(): LetDecl {
    let mutable = false;
    if (this.match(TokenType.MUT)) mutable = true;

    const nameTok = this.consume(TokenType.IDENT, "Expected identifier after let/mut");
    const name = nameTok.value;

    this.consume(TokenType.ASSIGN, "Expected '=' after variable name in declaration");

    const init = this.parseExpression();

    this.consume(TokenType.SEMICOLON, "Expected ';' after variable declaration");

    return { type: "LetDecl", name, mutable, init };
  }

  private parseFnDecl(): FnDecl {
    const nameTok = this.consume(TokenType.IDENT, "Expected function name after 'fn'");
    const name = nameTok.value;

    this.consume(TokenType.LPAREN, "Expected '(' after function name");
    const params = this.parseParams();
    this.consume(TokenType.RPAREN, "Expected ')' after function parameters");

    const body = this.parseBlock();

    return { type: "FnDecl", name, params, body };
  }

  private parseStatement(): Stmt {
    if (this.match(TokenType.IF)) return this.parseIfStmt();
    if (this.match(TokenType.WHILE)) return this.parseWhileStmt();
    if (this.match(TokenType.RETURN)) return this.parseReturnStmt();
    if (this.match(TokenType.LBRACE)) {
      const stmts = this.parseBlock();
      if (stmts.length === 1) {
        const s = stmts[0];
        if (s.type === "ExprStmt") return s;
      }
      throw this.error(this.peek(), "Unexpected block statement here");
    }
    return this.parseExprStmt();
  }

  private parseIfStmt(): IfStmt {
    this.consume(TokenType.LPAREN, "Expected '(' after 'if'");
    const condition = this.parseExpression();
    this.consume(TokenType.RPAREN, "Expected ')' after if condition");

    const consequent = this.parseBlock();

    let alternate: Stmt[] | null = null;
    if (this.match(TokenType.ELSE)) {
      if (this.match(TokenType.IF)) {
        alternate = [this.parseIfStmt()];
      } else {
        alternate = this.parseBlock();
      }
    }
    return { type: "IfStmt", condition, consequent, alternate };
  }

  private parseWhileStmt(): WhileStmt {
    this.consume(TokenType.LPAREN, "Expected '(' after 'while'");
    const condition = this.parseExpression();
    this.consume(TokenType.RPAREN, "Expected ')' after while condition");
    const body = this.parseBlock();
    return { type: "WhileStmt", condition, body };
  }

  private parseReturnStmt(): ReturnStmt {
    let value: Expr | null = null;
    if (!this.check(TokenType.SEMICOLON)) {
      value = this.parseExpression();
    }
    this.consume(TokenType.SEMICOLON, "Expected ';' after return value");
    return { type: "ReturnStmt", value };
  }

  private parseExprStmt(): ExprStmt {
    const expr = this.parseExpression();
    this.consume(TokenType.SEMICOLON, "Expected ';' after expression");
    return { type: "ExprStmt", expr };
  }

  private parseBlock(): Stmt[] {
    this.consume(TokenType.LBRACE, "Expected '{' to start block");
    const body: Stmt[] = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      body.push(this.parseDeclaration());
    }
    this.consume(TokenType.RBRACE, "Expected '}' to end block");
    return body;
  }

  private parseParams(): string[] {
    const params: string[] = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        const paramTok = this.consume(TokenType.IDENT, "Expected parameter name");
        params.push(paramTok.value);
      } while (this.match(TokenType.COMMA));
    }
    return params;
  }

  private parseExpression(): Expr {
    return this.parseAssignment();
  }

  private parseAssignment(): Expr {
    const expr = this.parseOr();

    if (this.match(TokenType.ASSIGN)) {
      const equals = this.previous();
      if (expr.type === "Identifier") {
        const value = this.parseAssignment();
        return { type: "AssignExpr", name: expr.name, value };
      }
      this.error(equals, "Invalid assignment target");
    }

    return expr;
  }

  private parseOr(): Expr {
    let expr = this.parseAnd();

    while (this.match(TokenType.OR)) {
      const operator = this.previous().value;
      const right = this.parseAnd();
      expr = { type: "BinaryExpr", op: operator, left: expr, right };
    }

    return expr;
  }

  private parseAnd(): Expr {
    let expr = this.parseEquality();

    while (this.match(TokenType.AND)) {
      const operator = this.previous().value;
      const right = this.parseEquality();
      expr = { type: "BinaryExpr", op: operator, left: expr, right };
    }

    return expr;
  }

  private parseEquality(): Expr {
    let expr = this.parseComparison();

    while (this.match(TokenType.NEQ, TokenType.EQ)) {
      const operator = this.previous().value;
      const right = this.parseComparison();
      expr = { type: "BinaryExpr", op: operator, left: expr, right };
    }

    return expr;
  }

  private parseComparison(): Expr {
    let expr = this.parseAdditive();

    while (
      this.match(TokenType.GT, TokenType.GTE, TokenType.LT, TokenType.LTE)
    ) {
      const operator = this.previous().value;
      const right = this.parseAdditive();
      expr = { type: "BinaryExpr", op: operator, left: expr, right };
    }

    return expr;
  }

  private parseAdditive(): Expr {
    let expr = this.parseMultiplicative();

    while (this.match(TokenType.PLUS, TokenType.MINUS)) {
      const operator = this.previous().value;
      const right = this.parseMultiplicative();
      expr = { type: "BinaryExpr", op: operator, left: expr, right };
    }

    return expr;
  }

  private parseMultiplicative(): Expr {
    let expr = this.parseUnary();

    while (this.match(TokenType.STAR, TokenType.SLASH, TokenType.PERCENT)) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      expr = { type: "BinaryExpr", op: operator, left: expr, right };
    }

    return expr;
  }

  private parseUnary(): Expr {
    if (this.match(TokenType.NOT, TokenType.MINUS)) {
      const operator = this.previous().value;
      const operand = this.parseUnary();
      return { type: "UnaryExpr", op: operator, operand };
    }
    return this.parseCall();
  }

  private parseCall(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match(TokenType.LPAREN)) {
        expr = this.finishCall(expr);
      } else {
        break;
      }
    }

    return expr;
  }

  private finishCall(callee: Expr): Expr {
    const args: Expr[] = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        args.push(this.parseExpression());
      } while (this.match(TokenType.COMMA));
    }
    this.consume(TokenType.RPAREN, "Expected ')' after function arguments");
    return { type: "CallExpr", callee, args };
  }

  private parsePrimary(): Expr {
    if (this.match(TokenType.FALSE)) return { type: "BoolLit", value: false };
    if (this.match(TokenType.TRUE)) return { type: "BoolLit", value: true };
    if (this.match(TokenType.NULL_KW)) return { type: "NullLit" };

    if (this.match(TokenType.INT, TokenType.FLOAT)) {
      const n = Number(this.previous().value);
      return { type: "NumLit", value: n };
    }

    if (this.match(TokenType.STRING)) {
      return { type: "StrLit", value: this.previous().value };
    }

    if (this.match(TokenType.IDENT)) {
      return { type: "Identifier", name: this.previous().value };
    }

    // Built-in function keywords treated as identifiers in expression context
    if (this.match(TokenType.PRINT, TokenType.LEN, TokenType.TYPE)) {
      return { type: "Identifier", name: this.previous().value };
    }

    if (this.match(TokenType.FN)) {
      return this.parseFnExpr();
    }

    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      this.consume(TokenType.RPAREN, "Expected ')' after expression");
      return expr;
    }

    throw this.error(this.peek(), "Expected expression");
  }

  private parseFnExpr(): FnExpr {
    this.consume(TokenType.LPAREN, "Expected '(' after 'fn' in function expression");
    const params = this.parseParams();
    this.consume(TokenType.RPAREN, "Expected ')' after function expression parameters");
    const body = this.parseBlock();
    return { type: "FnExpr", params, body };
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw this.error(this.peek(), message);
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private previous(): Token {
    return this.tokens[this.pos - 1];
  }

  private error(token: Token, message: string): Error {
    const msg = `[line ${token.line}:${token.column}] Error at '${token.value}': ${message}`;
    return new Error(msg);
  }
}