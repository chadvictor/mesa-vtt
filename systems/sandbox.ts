/**
 * Mesa VTT — Pure-TypeScript Zero-Eval AST Expression & Macro Sandbox.
 *
 * Security invariants:
 * - Zero `eval`, zero `new Function`, zero access to `window`/`globalThis`/DOM.
 * - Strict caps on source size, AST node count, nesting depth, execution steps, and commands.
 * - Blocks prototype chain traversal (`__proto__`, `prototype`, `constructor`, etc.).
 * - 100% compliant with strict CSP (`script-src 'self'`).
 */

import type { MacroCommand, MacroContext, MacroResult, Visibility } from "./types";

const MAX_SOURCE_LENGTH = 4096;
const MAX_AST_NODES = 500;
const MAX_DEPTH = 32;
const MAX_STEPS = 200;
const MAX_COMMANDS = 25;

const FORBIDDEN_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenKind =
  | "number"
  | "string"
  | "template"
  | "ident"
  | "at_ident"
  | "op"
  | "punct"
  | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

const TWO_CHAR_OPS = new Set(["==", "!=", "<=", ">=", "&&", "||"]);
const THREE_CHAR_OPS = new Set(["===", "!=="]);
const SINGLE_CHAR_OPS = new Set(["+", "-", "*", "/", "%", "<", ">", "!", "="]);
const PUNCT = new Set(["(", ")", "{", "}", "[", "]", ",", ";", ":", ".", "?"]);

function isIdentStart(ch: string): boolean {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    ch === "_" ||
    ch === "$"
  );
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function tokenize(source: string): Token[] {
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new SandboxError(`Script excede o limite de ${MAX_SOURCE_LENGTH} caracteres.`);
  }
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];

    // Whitespace (treat newlines as optional statement separators only when parsed; skip here)
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // Line comments // ...
    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i++;
      continue;
    }

    // Block comments /* ... */
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      let closed = false;
      while (i + 1 < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) throw new SandboxError("Comentário de bloco não fechado.");
      continue;
    }

    // Numbers
    if (ch >= "0" && ch <= "9") {
      const start = i;
      let hasDot = false;
      while (i < n) {
        const c = source[i];
        if (c >= "0" && c <= "9") {
          i++;
        } else if (c === "." && !hasDot && source[i + 1] >= "0" && source[i + 1] <= "9") {
          hasDot = true;
          i++;
        } else {
          break;
        }
      }
      tokens.push({ kind: "number", value: source.slice(start, i), pos: start });
      continue;
    }

    // Strings ("..." or '...') and Template Strings (`...`)
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const start = i;
      i++;
      let out = "";
      let closed = false;
      while (i < n) {
        const c = source[i];
        if (c === "\\") {
          i++;
          if (i >= n) break;
          const esc = source[i];
          if (esc === "n") out += "\n";
          else if (esc === "t") out += "\t";
          else if (esc === "r") out += "\r";
          else out += esc;
          i++;
          continue;
        }
        if (c === quote) {
          i++;
          closed = true;
          break;
        }
        out += c;
        i++;
      }
      if (!closed) throw new SandboxError("String não fechada.");
      tokens.push({
        kind: quote === "`" ? "template" : "string",
        value: out,
        pos: start,
      });
      continue;
    }

    // @variable shorthand (e.g. @forca, @target.bloqueio)
    if (ch === "@") {
      const start = i;
      i++;
      const nameStart = i;
      if (i < n && isIdentStart(source[i])) {
        while (i < n && isIdentPart(source[i])) i++;
        tokens.push({ kind: "at_ident", value: source.slice(nameStart, i), pos: start });
        continue;
      }
      throw new SandboxError(`Identificador esperado após '@' na posição ${start}.`);
    }

    // Identifiers & keywords
    if (isIdentStart(ch)) {
      const start = i;
      while (i < n && isIdentPart(source[i])) i++;
      tokens.push({ kind: "ident", value: source.slice(start, i), pos: start });
      continue;
    }

    // 3-char operators
    const three = source.slice(i, i + 3);
    if (THREE_CHAR_OPS.has(three)) {
      tokens.push({ kind: "op", value: three, pos: i });
      i += 3;
      continue;
    }

    // 2-char operators
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: "op", value: two, pos: i });
      i += 2;
      continue;
    }

    // 1-char operators
    if (SINGLE_CHAR_OPS.has(ch)) {
      tokens.push({ kind: "op", value: ch, pos: i });
      i++;
      continue;
    }

    // Punctuation
    if (PUNCT.has(ch)) {
      tokens.push({ kind: "punct", value: ch, pos: i });
      i++;
      continue;
    }

    throw new SandboxError(`Caractere inválido '${ch}' na posição ${i}.`);
  }

  tokens.push({ kind: "eof", value: "", pos: n });
  return tokens;
}

// ---------------------------------------------------------------------------
// AST Nodes
// ---------------------------------------------------------------------------

type ExprNode =
  | { type: "literal"; value: number | string | boolean | null }
  | { type: "template"; raw: string }
  | { type: "ident"; name: string }
  | { type: "at_ident"; name: string }
  | { type: "unary"; op: string; arg: ExprNode }
  | { type: "binary"; op: string; left: ExprNode; right: ExprNode }
  | { type: "conditional"; test: ExprNode; consequent: ExprNode; alternate: ExprNode }
  | { type: "member"; object: ExprNode; property: string }
  | { type: "index"; object: ExprNode; index: ExprNode }
  | { type: "call"; callee: string; args: ExprNode[] }
  | { type: "array"; elements: ExprNode[] }
  | { type: "object"; entries: Array<{ key: string; value: ExprNode }> };

type StmtNode =
  | { type: "let"; name: string; init: ExprNode }
  | { type: "if"; test: ExprNode; consequent: StmtNode[]; alternate?: StmtNode[] }
  | { type: "expr"; expr: ExprNode };

// ---------------------------------------------------------------------------
// Recursive Descent Parser
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[];
  private pos = 0;
  private nodeCount = 0;
  private depth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const tok = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private expect(kind: TokenKind, value?: string): Token {
    const tok = this.peek();
    if (tok.kind !== kind || (value !== undefined && tok.value !== value)) {
      throw new SandboxError(
        `Esperado '${value ?? kind}', encontrado '${tok.value || tok.kind}' na posição ${tok.pos}.`
      );
    }
    return this.next();
  }

  private bumpNode<T>(node: T): T {
    this.nodeCount++;
    if (this.nodeCount > MAX_AST_NODES) {
      throw new SandboxError(`Script muito complexo (limite de ${MAX_AST_NODES} nós AST).`);
    }
    return node;
  }

  private enter(): void {
    this.depth++;
    if (this.depth > MAX_DEPTH) {
      throw new SandboxError(`Aninhamento excessivo (limite de ${MAX_DEPTH} níveis).`);
    }
  }

  private leave(): void {
    this.depth--;
  }

  parseProgram(): StmtNode[] {
    const body: StmtNode[] = [];
    while (this.peek().kind !== "eof") {
      while (this.peek().kind === "punct" && this.peek().value === ";") {
        this.next();
      }
      if (this.peek().kind === "eof") break;
      body.push(this.parseStatement());
      while (this.peek().kind === "punct" && this.peek().value === ";") {
        this.next();
      }
    }
    return body;
  }

  parseSingleExpression(): ExprNode {
    const expr = this.parseExpression();
    if (this.peek().kind !== "eof") {
      throw new SandboxError(`Token inesperado '${this.peek().value}' na posição ${this.peek().pos}.`);
    }
    return expr;
  }

  private parseStatement(): StmtNode {
    this.enter();
    try {
      const tok = this.peek();

      if (tok.kind === "ident" && (tok.value === "let" || tok.value === "const")) {
        this.next();
        const nameTok = this.expect("ident");
        if (FORBIDDEN_KEYS.has(nameTok.value)) {
          throw new SandboxError(`Nome de variável proibido: '${nameTok.value}'.`);
        }
        this.expect("op", "=");
        const init = this.parseExpression();
        return this.bumpNode({ type: "let", name: nameTok.value, init });
      }

      // Statement `if (cond) { ... } else { ... }` (note: functional `if(c, a, b)` falls through to expr)
      if (tok.kind === "ident" && tok.value === "if" && this.isIfStatement()) {
        this.next();
        this.expect("punct", "(");
        const test = this.parseExpression();
        this.expect("punct", ")");
        const consequent = this.parseBlockOrSingle();
        let alternate: StmtNode[] | undefined;
        if (this.peek().kind === "ident" && this.peek().value === "else") {
          this.next();
          alternate = this.parseBlockOrSingle();
        }
        return this.bumpNode({ type: "if", test, consequent, alternate });
      }

      const expr = this.parseExpression();
      return this.bumpNode({ type: "expr", expr });
    } finally {
      this.leave();
    }
  }

  private isIfStatement(): boolean {
    // Distinguish `if (cond) { ... }` from functional expression `if(cond, a, b)`.
    if (this.peek(1).kind !== "punct" || this.peek(1).value !== "(") return false;
    let depth = 0;
    for (let i = this.pos + 1; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.kind === "punct" && t.value === "(") depth++;
      else if (t.kind === "punct" && t.value === ")") {
        depth--;
        if (depth === 0) {
          const after = this.tokens[i + 1];
          // If followed by `{` or an identifier/statement start (not operator/semicolon/eof/punct-closing), it's an if-stmt
          if (after && after.kind === "punct" && after.value === "{") return true;
          return false;
        }
      } else if (depth === 1 && t.kind === "punct" && t.value === ",") {
        // Comma at top level of `if(...)` means functional `if(cond, a, b)`
        return false;
      }
    }
    return false;
  }

  private parseBlockOrSingle(): StmtNode[] {
    if (this.peek().kind === "punct" && this.peek().value === "{") {
      this.next();
      const stmts: StmtNode[] = [];
      while (this.peek().kind !== "eof" && !(this.peek().kind === "punct" && this.peek().value === "}")) {
        while (this.peek().kind === "punct" && this.peek().value === ";") this.next();
        if (this.peek().kind === "punct" && this.peek().value === "}") break;
        stmts.push(this.parseStatement());
        while (this.peek().kind === "punct" && this.peek().value === ";") this.next();
      }
      this.expect("punct", "}");
      return stmts;
    }
    return [this.parseStatement()];
  }

  private parseExpression(): ExprNode {
    return this.parseConditional();
  }

  private parseConditional(): ExprNode {
    const test = this.parseLogicalOr();
    if (this.peek().kind === "punct" && this.peek().value === "?") {
      this.next();
      const consequent = this.parseExpression();
      this.expect("punct", ":");
      const alternate = this.parseExpression();
      return this.bumpNode({ type: "conditional", test, consequent, alternate });
    }
    return test;
  }

  private parseLogicalOr(): ExprNode {
    let left = this.parseLogicalAnd();
    while (this.peek().kind === "op" && this.peek().value === "||") {
      const op = this.next().value;
      const right = this.parseLogicalAnd();
      left = this.bumpNode({ type: "binary", op, left, right });
    }
    return left;
  }

  private parseLogicalAnd(): ExprNode {
    let left = this.parseEquality();
    while (this.peek().kind === "op" && this.peek().value === "&&") {
      const op = this.next().value;
      const right = this.parseEquality();
      left = this.bumpNode({ type: "binary", op, left, right });
    }
    return left;
  }

  private parseEquality(): ExprNode {
    let left = this.parseRelational();
    while (
      this.peek().kind === "op" &&
      (this.peek().value === "==" ||
        this.peek().value === "!=" ||
        this.peek().value === "===" ||
        this.peek().value === "!==")
    ) {
      const op = this.next().value;
      const right = this.parseRelational();
      left = this.bumpNode({ type: "binary", op, left, right });
    }
    return left;
  }

  private parseRelational(): ExprNode {
    let left = this.parseAdditive();
    while (
      this.peek().kind === "op" &&
      (this.peek().value === "<" ||
        this.peek().value === "<=" ||
        this.peek().value === ">" ||
        this.peek().value === ">=")
    ) {
      const op = this.next().value;
      const right = this.parseAdditive();
      left = this.bumpNode({ type: "binary", op, left, right });
    }
    return left;
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (this.peek().kind === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = this.bumpNode({ type: "binary", op, left, right });
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    while (
      this.peek().kind === "op" &&
      (this.peek().value === "*" || this.peek().value === "/" || this.peek().value === "%")
    ) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = this.bumpNode({ type: "binary", op, left, right });
    }
    return left;
  }

  private parseUnary(): ExprNode {
    if (
      this.peek().kind === "op" &&
      (this.peek().value === "-" || this.peek().value === "+" || this.peek().value === "!")
    ) {
      this.enter();
      try {
        const op = this.next().value;
        const arg = this.parseUnary();
        return this.bumpNode({ type: "unary", op, arg });
      } finally {
        this.leave();
      }
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExprNode {
    let node = this.parsePrimary();
    while (true) {
      if (this.peek().kind === "punct" && this.peek().value === ".") {
        this.next();
        const prop = this.expect("ident").value;
        node = this.bumpNode({ type: "member", object: node, property: prop });
      } else if (this.peek().kind === "punct" && this.peek().value === "[") {
        this.next();
        const index = this.parseExpression();
        this.expect("punct", "]");
        node = this.bumpNode({ type: "index", object: node, index });
      } else {
        break;
      }
    }
    return node;
  }

  private parsePrimary(): ExprNode {
    this.enter();
    try {
      const tok = this.peek();

      if (tok.kind === "number") {
        this.next();
        return this.bumpNode({ type: "literal", value: Number(tok.value) });
      }

      if (tok.kind === "string") {
        this.next();
        return this.bumpNode({ type: "literal", value: tok.value });
      }

      if (tok.kind === "template") {
        this.next();
        return this.bumpNode({ type: "template", raw: tok.value });
      }

      if (tok.kind === "at_ident") {
        this.next();
        return this.bumpNode({ type: "at_ident", name: tok.value });
      }

      if (tok.kind === "ident") {
        if (tok.value === "true") {
          this.next();
          return this.bumpNode({ type: "literal", value: true });
        }
        if (tok.value === "false") {
          this.next();
          return this.bumpNode({ type: "literal", value: false });
        }
        if (tok.value === "null") {
          this.next();
          return this.bumpNode({ type: "literal", value: null });
        }

        // Function call
        if (this.peek(1).kind === "punct" && this.peek(1).value === "(") {
          const callee = this.next().value;
          this.next(); // consume '('
          const args: ExprNode[] = [];
          if (!(this.peek().kind === "punct" && this.peek().value === ")")) {
            do {
              args.push(this.parseExpression());
              if (this.peek().kind === "punct" && this.peek().value === ",") {
                this.next();
              } else {
                break;
              }
            } while (true);
          }
          this.expect("punct", ")");
          return this.bumpNode({ type: "call", callee, args });
        }

        this.next();
        return this.bumpNode({ type: "ident", name: tok.value });
      }

      if (tok.kind === "punct" && tok.value === "(") {
        this.next();
        const expr = this.parseExpression();
        this.expect("punct", ")");
        return expr;
      }

      if (tok.kind === "punct" && tok.value === "[") {
        this.next();
        const elements: ExprNode[] = [];
        if (!(this.peek().kind === "punct" && this.peek().value === "]")) {
          do {
            elements.push(this.parseExpression());
            if (this.peek().kind === "punct" && this.peek().value === ",") {
              this.next();
            } else {
              break;
            }
          } while (!(this.peek().kind === "punct" && this.peek().value === "]"));
        }
        this.expect("punct", "]");
        return this.bumpNode({ type: "array", elements });
      }

      if (tok.kind === "punct" && tok.value === "{") {
        this.next();
        const entries: Array<{ key: string; value: ExprNode }> = [];
        if (!(this.peek().kind === "punct" && this.peek().value === "}")) {
          do {
            const keyTok = this.peek();
            let key: string;
            if (keyTok.kind === "ident" || keyTok.kind === "string") {
              key = this.next().value;
            } else {
              throw new SandboxError(`Chave de objeto inválida na posição ${keyTok.pos}.`);
            }
            if (FORBIDDEN_KEYS.has(key)) {
              throw new SandboxError(`Chave de objeto proibida: '${key}'.`);
            }
            this.expect("punct", ":");
            const value = this.parseExpression();
            entries.push({ key, value });
            if (this.peek().kind === "punct" && this.peek().value === ",") {
              this.next();
            } else {
              break;
            }
          } while (!(this.peek().kind === "punct" && this.peek().value === "}"));
        }
        this.expect("punct", "}");
        return this.bumpNode({ type: "object", entries });
      }

      throw new SandboxError(`Expressão inesperada '${tok.value || tok.kind}' na posição ${tok.pos}.`);
    } finally {
      this.leave();
    }
  }
}

// ---------------------------------------------------------------------------
// Safe Context Lookup & Evaluator
// ---------------------------------------------------------------------------

function safeGet(obj: unknown, key: string): unknown {
  if (FORBIDDEN_KEYS.has(key)) {
    throw new SandboxError(`Acesso proibido à propriedade '${key}'.`);
  }
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    if (key === "length") return obj.length;
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && idx < obj.length) {
      return obj[idx];
    }
    return undefined;
  }
  if (typeof obj === "string") {
    if (key === "length") return obj.length;
    return undefined;
  }
  if (typeof obj === "object") {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      return (obj as Record<string, unknown>)[key];
    }
  }
  return undefined;
}

function buildAtScope(ctx: MacroContext): Record<string, unknown> {
  const flat: Record<string, unknown> = Object.create(null);
  const char = ctx.character;
  const sysData = (char?.systemData ?? {}) as Record<string, unknown>;
  const attrsFromChar = extractAttrs(ctx);
  const computed = { ...(char?.computed ?? {}), ...(ctx.computed ?? {}) };
  const resources = { ...(char?.resources ?? {}), ...(ctx.resources ?? {}) };

  for (const [k, v] of Object.entries(attrsFromChar)) {
    flat[k] = v;
  }
  for (const [k, v] of Object.entries(computed)) {
    flat[k] = v;
  }
  for (const [k, bar] of Object.entries(resources)) {
    if (bar && typeof bar === "object") {
      flat[k] = bar.current;
      flat[`${k}Max`] = bar.max;
      flat[`${k}_max`] = bar.max;
    }
  }
  if (typeof sysData.level === "number") {
    flat.level = sysData.level;
    flat.nivel = sysData.level;
  }
  if (char) {
    flat.name = char.name;
    flat.nome = char.name;
    flat.char = char;
  }
  flat.attrs = attrsFromChar;
  flat.computed = computed;
  flat.resources = resources;
  if (ctx.target) {
    const tComp = ctx.target.computed ?? {};
    const tRes = ctx.target.resources ?? {};
    const tView: Record<string, unknown> = Object.create(null);
    tView.id = ctx.target.id;
    tView.name = ctx.target.name;
    for (const [k, v] of Object.entries(tComp)) tView[k] = v;
    for (const [k, bar] of Object.entries(tRes)) {
      if (bar && typeof bar === "object") {
        tView[k] = bar.current;
        tView[`${k}Max`] = bar.max;
      }
    }
    flat.target = tView;
    flat.alvo = tView;
  }
  if (ctx.args) {
    flat.args = ctx.args;
  }
  return flat;
}

function extractAttrs(ctx: MacroContext): Record<string, number> {
  const out: Record<string, number> = Object.create(null);
  const sysData = (ctx.character?.systemData ?? {}) as Record<string, unknown>;
  const rawAttrs = sysData.attributes;
  if (Array.isArray(rawAttrs)) {
    for (const entry of rawAttrs) {
      if (entry && typeof entry === "object" && typeof (entry as { key?: unknown }).key === "string") {
        const key = (entry as { key: string }).key;
        const val = Number((entry as { value?: unknown }).value ?? 0);
        if (!FORBIDDEN_KEYS.has(key) && Number.isFinite(val)) {
          out[key] = val;
        }
      }
    }
  } else if (rawAttrs && typeof rawAttrs === "object") {
    for (const [k, v] of Object.entries(rawAttrs as Record<string, unknown>)) {
      if (!FORBIDDEN_KEYS.has(k) && typeof v === "number" && Number.isFinite(v)) {
        out[k] = v;
      }
    }
  }
  if (ctx.attrs) {
    for (const [k, v] of Object.entries(ctx.attrs)) {
      if (!FORBIDDEN_KEYS.has(k) && typeof v === "number" && Number.isFinite(v)) {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Replaces `@var` and `@target.bloqueio` references inside a dice formula string.
 * Example: `interpolateFormula("2d6 + @forca + 2", ctx)` -> `"2d6 + 4 + 2"`
 */
export function interpolateFormula(formula: string, ctx: MacroContext): string {
  const atScope = buildAtScope(ctx);
  return formula.replace(/@([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)/g, (_m, path: string) => {
    const parts = path.split(".");
    let cur: unknown = atScope;
    for (const part of parts) {
      cur = safeGet(cur, part);
    }
    if (typeof cur === "number" && Number.isFinite(cur)) return String(cur);
    if (typeof cur === "string") return cur;
    return "0";
  });
}

class Evaluator {
  private ctx: MacroContext;
  private atScope: Record<string, unknown>;
  private locals: Record<string, unknown>;
  public commands: MacroCommand[] = [];
  public steps = 0;

  constructor(ctx: MacroContext) {
    this.ctx = ctx;
    this.atScope = buildAtScope(ctx);
    this.locals = Object.create(null);

    // Expose root context variables
    this.locals.char = ctx.character ?? null;
    this.locals.character = ctx.character ?? null;
    this.locals.attrs = this.atScope.attrs;
    this.locals.computed = this.atScope.computed;
    this.locals.resources = this.atScope.resources;
    this.locals.target = this.atScope.target ?? null;
    this.locals.alvo = this.atScope.target ?? null;
    this.locals.args = ctx.args ?? Object.create(null);
    this.locals.user = ctx.user ?? null;
  }

  private tick(): void {
    this.steps++;
    if (this.steps > MAX_STEPS) {
      throw new SandboxError(`Limite de execução excedido (${MAX_STEPS} passos).`);
    }
  }

  private pushCommand(cmd: MacroCommand): void {
    if (this.commands.length >= MAX_COMMANDS) {
      throw new SandboxError(`Limite de comandos excedido (máx. ${MAX_COMMANDS} por macro).`);
    }
    this.commands.push(cmd);
  }

  evalStatements(stmts: StmtNode[]): unknown {
    let last: unknown = undefined;
    for (const stmt of stmts) {
      this.tick();
      if (stmt.type === "let") {
        last = this.evalExpr(stmt.init);
        this.locals[stmt.name] = last;
      } else if (stmt.type === "if") {
        const cond = this.evalExpr(stmt.test);
        if (cond) {
          last = this.evalStatements(stmt.consequent);
        } else if (stmt.alternate) {
          last = this.evalStatements(stmt.alternate);
        }
      } else {
        last = this.evalExpr(stmt.expr);
      }
    }
    return last;
  }

  evalExpr(node: ExprNode): unknown {
    this.tick();

    switch (node.type) {
      case "literal":
        return node.value;

      case "template":
        return this.evalTemplate(node.raw);

      case "ident":
        if (FORBIDDEN_KEYS.has(node.name)) {
          throw new SandboxError(`Acesso proibido a '${node.name}'.`);
        }
        if (Object.prototype.hasOwnProperty.call(this.locals, node.name)) {
          return this.locals[node.name];
        }
        if (Object.prototype.hasOwnProperty.call(this.atScope, node.name)) {
          return this.atScope[node.name];
        }
        return undefined;

      case "at_ident":
        return safeGet(this.atScope, node.name);

      case "unary": {
        const val = this.evalExpr(node.arg);
        if (node.op === "-") return -Number(val);
        if (node.op === "+") return +Number(val);
        if (node.op === "!") return !val;
        throw new SandboxError(`Operador unário desconhecido: ${node.op}`);
      }

      case "binary": {
        // Short-circuit logical ops
        if (node.op === "&&") {
          const l = this.evalExpr(node.left);
          return l ? this.evalExpr(node.right) : l;
        }
        if (node.op === "||") {
          const l = this.evalExpr(node.left);
          return l ? l : this.evalExpr(node.right);
        }

        const l = this.evalExpr(node.left);
        const r = this.evalExpr(node.right);

        switch (node.op) {
          case "+":
            if (typeof l === "string" || typeof r === "string") {
              return `${l ?? ""}${r ?? ""}`;
            }
            return Number(l) + Number(r);
          case "-":
            return Number(l) - Number(r);
          case "*":
            return Number(l) * Number(r);
          case "/": {
            const denom = Number(r);
            if (denom === 0) throw new SandboxError("Divisão por zero.");
            return Number(l) / denom;
          }
          case "%": {
            const denom = Number(r);
            if (denom === 0) throw new SandboxError("Módulo por zero.");
            return Number(l) % denom;
          }
          case "<":
            return Number(l) < Number(r);
          case "<=":
            return Number(l) <= Number(r);
          case ">":
            return Number(l) > Number(r);
          case ">=":
            return Number(l) >= Number(r);
          case "==":
            // eslint-disable-next-line eqeqeq
            return l == r;
          case "!=":
            // eslint-disable-next-line eqeqeq
            return l != r;
          case "===":
            return l === r;
          case "!==":
            return l !== r;
          default:
            throw new SandboxError(`Operador desconhecido: ${node.op}`);
        }
      }

      case "conditional":
        return this.evalExpr(node.test)
          ? this.evalExpr(node.consequent)
          : this.evalExpr(node.alternate);

      case "member":
        return safeGet(this.evalExpr(node.object), node.property);

      case "index": {
        const target = this.evalExpr(node.object);
        const key = String(this.evalExpr(node.index));
        return safeGet(target, key);
      }

      case "array":
        return node.elements.map((el) => this.evalExpr(el));

      case "object": {
        const obj: Record<string, unknown> = Object.create(null);
        for (const entry of node.entries) {
          obj[entry.key] = this.evalExpr(entry.value);
        }
        return obj;
      }

      case "call":
        return this.evalCall(node.callee, node.args);
    }
  }

  private evalTemplate(raw: string): string {
    return raw.replace(/\$\{([^}]+)\}/g, (_match, inner: string) => {
      const subTokens = tokenize(inner);
      const subExpr = new Parser(subTokens).parseSingleExpression();
      const val = this.evalExpr(subExpr);
      return val === undefined || val === null ? "" : String(val);
    });
  }

  private evalCall(callee: string, argNodes: ExprNode[]): unknown {
    // Functional `if(cond, a, b)` evaluates lazily!
    if (callee === "if") {
      if (argNodes.length < 2 || argNodes.length > 3) {
        throw new SandboxError("if(cond, entao, senao?) requer 2 ou 3 argumentos.");
      }
      if (this.evalExpr(argNodes[0])) {
        return this.evalExpr(argNodes[1]);
      }
      return argNodes[2] ? this.evalExpr(argNodes[2]) : null;
    }

    const args = argNodes.map((a) => this.evalExpr(a));

    switch (callee) {
      // Math helpers
      case "floor":
        return Math.floor(Number(args[0] ?? 0));
      case "ceil":
        return Math.ceil(Number(args[0] ?? 0));
      case "round":
        return Math.round(Number(args[0] ?? 0));
      case "abs":
        return Math.abs(Number(args[0] ?? 0));
      case "min":
        return args.length ? Math.min(...args.map(Number)) : 0;
      case "max":
        return args.length ? Math.max(...args.map(Number)) : 0;
      case "clamp": {
        const val = Number(args[0] ?? 0);
        const lo = Number(args[1] ?? 0);
        const hi = Number(args[2] ?? val);
        return Math.min(hi, Math.max(lo, val));
      }

      // Conversion helpers
      case "num":
        return Number(args[0] ?? 0);
      case "str":
        return String(args[0] ?? "");
      case "upper":
        return String(args[0] ?? "").toUpperCase();
      case "lower":
        return String(args[0] ?? "").toLowerCase();

      // VTT Macro Commands
      case "roll": {
        const rawFormula = String(args[0] ?? "2d6");
        const formula = interpolateFormula(rawFormula, this.ctx);
        const label = String(args[1] ?? "Rolagem de Macro");
        const opts = (args[2] && typeof args[2] === "object"
          ? args[2]
          : {}) as Record<string, unknown>;
        const difficulty =
          typeof opts.difficulty === "number" ? opts.difficulty : undefined;
        const visibility =
          opts.visibility === "gm_only" ||
          opts.visibility === "all_players" ||
          opts.visibility === "specific_players"
            ? (opts.visibility as Visibility)
            : undefined;
        this.pushCommand({
          type: "roll",
          formula,
          label,
          difficulty,
          visibility,
          meta: opts,
        });
        return { formula, label };
      }

      case "rollAttack": {
        const weaponId = args[0] !== undefined ? String(args[0]) : undefined;
        const bonus = typeof args[1] === "number" ? args[1] : undefined;
        this.pushCommand({ type: "roll_attack", weaponId, bonus });
        return true;
      }

      case "rollAbility": {
        const abilityId = String(args[0] ?? "");
        if (!abilityId) throw new SandboxError("rollAbility requer abilityId.");
        this.pushCommand({ type: "roll_ability", abilityId });
        return true;
      }

      case "rollSpell": {
        const spellId = String(args[0] ?? "");
        if (!spellId) throw new SandboxError("rollSpell requer spellId.");
        this.pushCommand({ type: "roll_spell", spellId });
        return true;
      }

      case "spend": {
        const resource = String(args[0] ?? "pm").toLowerCase();
        const amount = Math.max(0, Math.floor(Number(args[1] ?? 0)));
        this.pushCommand({ type: "spend", resource, amount });
        return amount;
      }

      case "spendPM":
      case "spendMP":
      case "spendMana": {
        const amount = Math.max(0, Math.floor(Number(args[0] ?? 0)));
        this.pushCommand({ type: "spend", resource: "pm", amount });
        return amount;
      }

      case "spendPV":
      case "spendHP": {
        const amount = Math.max(0, Math.floor(Number(args[0] ?? 0)));
        this.pushCommand({ type: "spend", resource: "pv", amount });
        return amount;
      }

      case "heal": {
        const amount = Math.max(0, Math.floor(Number(args[0] ?? 0)));
        const target = args[1] === "target" ? "target" : "self";
        this.pushCommand({ type: "heal", amount, target });
        return amount;
      }

      case "damage": {
        const amount = Math.max(0, Math.floor(Number(args[0] ?? 0)));
        const damageType = args[1] !== undefined ? String(args[1]) : undefined;
        const target = args[2] === "self" ? "self" : "target";
        this.pushCommand({ type: "damage", amount, damageType, target });
        return amount;
      }

      case "condition": {
        const conditionId = String(args[0] ?? "");
        if (!conditionId) throw new SandboxError("condition requer conditionId.");
        const rounds = typeof args[1] === "number" ? Math.max(1, Math.floor(args[1])) : undefined;
        const target = args[2] === "self" ? "self" : "target";
        this.pushCommand({ type: "condition", conditionId, rounds, target });
        return conditionId;
      }

      case "say": {
        const content = String(args[0] ?? "");
        this.pushCommand({ type: "chat", kind: "ic", content });
        return content;
      }

      case "ooc": {
        const content = String(args[0] ?? "");
        this.pushCommand({ type: "chat", kind: "ooc", content });
        return content;
      }

      case "emote":
      case "narrate": {
        const content = String(args[0] ?? "");
        this.pushCommand({ type: "chat", kind: "narration", content });
        return content;
      }

      default:
        throw new SandboxError(`Função não permitida no sandbox: '${callee}'.`);
    }
  }
}

/**
 * Evaluates a single pure expression inside the sandbox (throws SandboxError on invalid input).
 */
export function evaluateExpression(source: string, context: MacroContext = {}): unknown {
  const tokens = tokenize(source.trim());
  const expr = new Parser(tokens).parseSingleExpression();
  const evaluator = new Evaluator(context);
  return evaluator.evalExpr(expr);
}

/**
 * Executes a multi-statement macro script safely, returning structured commands and value.
 */
export function runMacro(script: string, context: MacroContext = {}): MacroResult {
  const trimmed = script.trim();
  if (!trimmed) {
    return { ok: true, value: undefined, commands: [], stepsUsed: 0 };
  }
  const evaluator = new Evaluator(context);
  try {
    const tokens = tokenize(trimmed);
    const stmts = new Parser(tokens).parseProgram();
    const value = evaluator.evalStatements(stmts);
    return {
      ok: true,
      value,
      commands: evaluator.commands,
      stepsUsed: evaluator.steps,
    };
  } catch (err) {
    return {
      ok: false,
      value: undefined,
      commands: [],
      error: err instanceof Error ? err.message : "Erro ao executar macro.",
      stepsUsed: evaluator.steps,
    };
  }
}
