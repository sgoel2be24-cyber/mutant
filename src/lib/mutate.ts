import * as acorn from "acorn";
import tsPlugin from "acorn-typescript";
import { seededShuffle } from "./prng";

// TS-aware parser: acorn + the acorn-typescript plugin, so a pasted function
// with type annotations parses as-is instead of failing. The engine operates on
// the runtime syntax (comparisons, arithmetic, guards), which is identical in
// TS, so every operator works unchanged. The validity guarantee is preserved by
// re-parsing each mutant with the SAME parser that produced it.
// acorn-typescript's types pin to its own internal Parser class; the runtime
// contract is acorn's Parser.extend. The cast is the documented escape hatch.
const TsParser = acorn.Parser.extend(
  tsPlugin() as unknown as (BaseParser: typeof acorn.Parser) => typeof acorn.Parser,
);
/** Public entry point for tests and the UI: parse TS or JS with one call. */
export function parseSource(input: string): unknown {
  return parseAny(input);
}

function parseAny(input: string): unknown {
  try {
    return TsParser.parse(input, { ecmaVersion: "latest" });
  } catch {
    // Plain JS that the TS parser rejects for an edge reason falls back to the
    // stock parser so a weird TS construct never blocks an ordinary function.
    return acorn.parse(input, { ecmaVersion: "latest" });
  }
}

/**
 * The mutation engine — the mechanism this project owns.
 *
 * Parses user JavaScript/TypeScript with acorn, walks the AST, and rewrites the
 * source at
 * each mutation site: flipped comparison/arithmetic/logical operators, wiped or
 * nudged literals, dropped guards and conditions, dropped return values.
 *
 * VALIDITY GUARANTEE (the whole product rests on this): every returned mutant
 * is re-parsed before it is handed out. A splice that would produce invalid
 * JavaScript is first repaired by re-emitting the operands parenthesised with
 * one operator flipped, and dropped if even that fails. This exists because a
 * minimal operator splice is unsafe in a real case: `a + -5` becomes `a--5`
 * when the flip replaces " + " with "-", since a unary minus on the right
 * operand fuses with the operator. An unparseable mutant is worse than a
 * missing one — the sandbox would score it as a KILL (its parse throws, so
 * every test "fails"), silently inflating the score in a tool whose entire
 * promise is honest scoring. So the engine refuses to emit one, and reports
 * how many it repaired or rejected.
 *
 * Determinism: discovery order is AST traversal order (stable), and when a run
 * exceeds `cap`, the kept subset is a seeded Fisher-Yates. Same seed in, same
 * mutants out — a judge re-running the demo sees the same score.
 */

export interface Mutant {
  readonly id: string;
  readonly operator: string;
  readonly description: string;
  readonly code: string;
  readonly span: { readonly start: number; readonly end: number };
  readonly originalText: string;
  readonly replacementText: string;
  /** True when this mutant needed the parenthesised repair to stay valid. */
  readonly repaired: boolean;
}

export interface MutateOptions {
  readonly cap?: number;
  readonly seed?: number;
}

export interface MutateReport {
  readonly mutants: readonly Mutant[];
  /** Candidates repaired by re-emitting the operands parenthesised. */
  readonly repaired: number;
  /** Candidates discarded because no valid form could be produced. */
  readonly dropped: number;
}

interface AcornNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const COMPARISON_FLIPS: Readonly<Record<string, string>> = {
  ">=": ">",
  "<=": "<",
  ">": ">=",
  "<": "<=",
  "===": "!==",
  "==": "!=",
  "!==": "===",
  "!=": "==",
};

const ARITHMETIC_FLIPS: Readonly<Record<string, string>> = {
  "+": "-",
  "-": "+",
  "*": "/",
  "/": "*",
  "%": "*",
};

const LOGICAL_FLIPS: Readonly<Record<string, string>> = {
  "&&": "||",
  "||": "&&",
};

const ASSIGNMENT_FLIPS: Readonly<Record<string, string>> = {
  "+=": "-=",
  "-=": "+=",
  "*=": "/=",
  "/=": "*=",
};

interface Fallback {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/** A candidate rewrite: the minimal splice, plus an optional repair form. */
interface Mutation {
  readonly operator: string;
  readonly description: string;
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly fallback?: Fallback;
}

function isNode(v: unknown): v is AcornNode {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { type?: unknown }).type === "string" &&
    typeof (v as { start?: unknown }).start === "number" &&
    typeof (v as { end?: unknown }).end === "number"
  );
}

/** Depth-first, in-source-order traversal. Object key order is stable. */
function* walk(node: AcornNode): Generator<AcornNode> {
  yield node;
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const v: unknown = node[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (isNode(item)) yield* walk(item);
      }
    } else if (isNode(v)) {
      yield* walk(v);
    }
  }
}

const nodeAt = (node: AcornNode, key: string): AcornNode | undefined => {
  const v: unknown = node[key];
  return isNode(v) ? v : undefined;
};

const str = (node: AcornNode, key: string): string | undefined => {
  const v: unknown = node[key];
  return typeof v === "string" ? v : undefined;
};

/** Span of just the operator token between left and right operands. */
function operatorSpan(node: AcornNode): { start: number; end: number } | null {
  const left = nodeAt(node, "left");
  const right = nodeAt(node, "right");
  if (!left || !right) return null;
  if (left.end > right.start) return null;
  return { start: left.end, end: right.start };
}

/** Slices a node's exact source text; set once per `mutate` call. */
let currentSource = "";
function sourceText(node: AcornNode): string {
  return currentSource.slice(node.start, node.end);
}

function lookupFlip(
  table: Readonly<Record<string, string>>,
  node: AcornNode,
  operator: string,
): Mutation | null {
  const to = table[operator];
  const span = operatorSpan(node);
  if (to === undefined || !span) return null;
  const left = nodeAt(node, "left");
  const right = nodeAt(node, "right");
  const fallback: Fallback | undefined =
    left && right
      ? {
          start: node.start,
          end: node.end,
          replacement: `(${sourceText(left)} ${to} ${sourceText(right)})`,
        }
      : undefined;
  return {
    operator: "flip-operator",
    description: `\`${operator}\` -> \`${to}\``,
    start: span.start,
    end: span.end,
    replacement: to,
    ...(fallback ? { fallback } : {}),
  };
}

/** One candidate mutation per node, first matching rule wins. */
function mutateNode(node: AcornNode): Mutation | null {
  switch (node.type) {
    case "BinaryExpression":
    case "LogicalExpression": {
      const operator = str(node, "operator") ?? "";
      return (
        lookupFlip(COMPARISON_FLIPS, node, operator) ??
        lookupFlip(LOGICAL_FLIPS, node, operator) ??
        lookupFlip(ARITHMETIC_FLIPS, node, operator)
      );
    }
    case "AssignmentExpression": {
      const operator = str(node, "operator") ?? "";
      // Assignment expressions cannot be wrapped in a fresh pair of parens in
      // every position (e.g. `(x += 1)` is fine, but the repair must be a
      // single expression) — the minimal splice is used, and the validity gate
      // repairs or drops it if that is unsafe.
      const left = nodeAt(node, "left");
      const right = nodeAt(node, "right");
      const to = ASSIGNMENT_FLIPS[operator];
      const span = operatorSpan(node);
      if (to === undefined || !span) return null;
      const fallback: Fallback | undefined =
        left && right
          ? {
              start: node.start,
              end: node.end,
              replacement: `(${sourceText(left)} ${to} ${sourceText(right)})`,
            }
          : undefined;
      return {
        operator: "flip-operator",
        description: `\`${operator}\` -> \`${to}\``,
        start: span.start,
        end: span.end,
        replacement: to,
        ...(fallback ? { fallback } : {}),
      };
    }
    case "UnaryExpression": {
      // Drop negation: splice out just the `!` token.
      if (str(node, "operator") === "!") {
        const arg = nodeAt(node, "argument");
        if (arg && arg.start >= node.start && arg.start <= node.end) {
          return {
            operator: "drop-negation",
            description: "`!x` -> `x`",
            start: node.start,
            end: arg.start,
            replacement: "",
          };
        }
      }
      return null;
    }
    case "UpdateExpression": {
      const operator = str(node, "operator");
      const arg = nodeAt(node, "argument");
      if (!arg || (operator !== "++" && operator !== "--")) return null;
      const to = operator === "++" ? "--" : "++";
      const prefix = node["prefix"] === true;
      return {
        operator: "flip-update",
        description: `\`${operator}\` -> \`${to}\``,
        start: prefix ? node.start : arg.end,
        end: prefix ? arg.start : node.end,
        replacement: to,
      };
    }
    case "Literal": {
      const raw = str(node, "raw");
      const value: unknown = node["value"];
      if (raw === undefined) return null;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        const to = value === 0 ? 1 : value === 1 ? 2 : 0;
        return {
          operator: "wipe-number",
          description: `\`${raw}\` -> \`${to}\``,
          start: node.start,
          end: node.end,
          replacement: String(to),
        };
      }
      if (typeof value === "boolean") {
        return {
          operator: "flip-boolean",
          description: `\`${raw}\` -> \`${!value}\``,
          start: node.start,
          end: node.end,
          replacement: String(!value),
        };
      }
      if (typeof value === "string") {
        return {
          operator: "wipe-string",
          description: 'string -> ""',
          start: node.start,
          end: node.end,
          replacement: '""',
        };
      }
      return null;
    }
    case "IfStatement": {
      // Drop guard: the test is spliced to `true`.
      const test = nodeAt(node, "test");
      if (!test) return null;
      return {
        operator: "drop-guard",
        description: "guard always passes",
        start: test.start,
        end: test.end,
        replacement: "true",
      };
    }
    case "ConditionalExpression": {
      const test = nodeAt(node, "test");
      if (!test) return null;
      return {
        operator: "drop-condition",
        description: "condition always true",
        start: test.start,
        end: test.end,
        replacement: "true",
      };
    }
    case "ReturnStatement": {
      const argument = nodeAt(node, "argument");
      if (!argument) return null;
      return {
        operator: "drop-return-value",
        description: "return without the value",
        start: node.start,
        end: node.end,
        replacement: "return;",
      };
    }
    default:
      return null;
  }
}

function splice(input: string, start: number, end: number, replacement: string): string {
  return input.slice(0, start) + replacement + input.slice(end);
}

function parses(code: string): boolean {
  try {
    parseAny(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate mutants from a self-contained JavaScript snippet. Throws on syntax
 * errors in the input — the UI layer turns those into an inline error.
 * Every returned mutant parses; see the validity guarantee above.
 */
export function mutateReport(
  input: string,
  options: MutateOptions = {},
): MutateReport {
  const cap = options.cap ?? 200;
  const seed = options.seed ?? 1;
  const ast = parseAny(input) as AcornNode;
  currentSource = input;

  const found: Mutation[] = [];
  for (const node of walk(ast)) {
    const m = mutateNode(node);
    // A mutant that does not change the source is not a mutant — e.g. dropping
    // a condition whose test is already the literal `true`. Rejecting no-ops
    // keeps the mutant count honest and the score undiluted.
    if (m && m.end > m.start && input.slice(m.start, m.end) !== m.replacement) {
      found.push(m);
    }
  }

  // Validity gate: repair an unsafe splice, or drop the candidate.
  interface Accepted {
    readonly m: Mutation;
    readonly start: number;
    readonly end: number;
    readonly replacement: string;
    readonly repaired: boolean;
  }
  const accepted: Accepted[] = [];
  let repaired = 0;
  let dropped = 0;
  for (const m of found) {
    const primary = splice(input, m.start, m.end, m.replacement);
    if (parses(primary)) {
      accepted.push({ m, start: m.start, end: m.end, replacement: m.replacement, repaired: false });
      continue;
    }
    const fb = m.fallback;
    if (fb) {
      const fixed = splice(input, fb.start, fb.end, fb.replacement);
      if (parses(fixed) && fixed !== input) {
        accepted.push({ m, start: fb.start, end: fb.end, replacement: fb.replacement, repaired: true });
        repaired++;
        continue;
      }
    }
    dropped++;
  }

  const chosen = accepted.length > cap ? seededShuffle(accepted, seed).slice(0, cap) : accepted;

  const mutants = chosen.map((a, i) => ({
    id: `M${String(i + 1).padStart(3, "0")}`,
    operator: a.m.operator,
    description: a.repaired ? `${a.m.description} (repaired)` : a.m.description,
    code: splice(input, a.start, a.end, a.replacement),
    span: { start: a.start, end: a.end },
    originalText: input.slice(a.start, a.end),
    replacementText: a.replacement,
    repaired: a.repaired,
  }));

  return { mutants, repaired, dropped };
}

/** Convenience wrapper: the mutant list only. */
export function mutate(input: string, options: MutateOptions = {}): Mutant[] {
  return mutateReport(input, options).mutants.map((m) => ({ ...m }));
}
