import * as acorn from "acorn";
import tsPlugin from "acorn-typescript";

/**
 * Strip TypeScript's type layer from source, leaving runtime-valid JavaScript.
 *
 * The engine parses TS so its spans are correct, but the sandbox runs code with
 * `new Function`, which only understands JavaScript. Rather than a full
 * transpiler, we remove exactly the TS-only constructs by their AST spans:
 * type annotations, generics, `as`/`satisfies` casts, interfaces, type aliases,
 * and access modifiers. Everything else — the runtime syntax the engine
 * actually mutates — passes through byte-for-byte.
 *
 * Conservative: any construct we do not explicitly recognise as TS-only is left
 * alone, and the result is re-parsed as plain JavaScript to prove it is valid
 * before it reaches the sandbox.
 */

const TsParser = acorn.Parser.extend(
  tsPlugin() as unknown as (BaseParser: typeof acorn.Parser) => typeof acorn.Parser,
);

interface AnyNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isNode(v: unknown): v is AnyNode {
  return typeof v === "object" && v !== null && typeof (v as AnyNode).type === "string";
}

/** Collect [start, end) ranges of TS-only syntax, walking the whole AST. */
function collectRanges(node: AnyNode, src: string, ranges: Array<[number, number]>): void {
  // acorn-typescript marks type annotations on `.typeAnnotation`, generics on
  // `.typeParameters` / `.typeArguments`, casts as TSTypeCast-like nodes.
  const ann = node["typeAnnotation"];
  if (isNode(ann)) ranges.push([ann.start, ann.end]);
  const tp = node["typeParameters"];
  if (isNode(tp)) ranges.push([tp.start, tp.end]);
  const ta = node["typeArguments"];
  if (isNode(ta)) ranges.push([ta.start, ta.end]);
  const ret = node["returnType"];
  if (isNode(ret)) ranges.push([ret.start, ret.end]);
  const acc = node["accessibility"];
  if (typeof acc === "string" && (acc === "public" || acc === "private" || acc === "protected" || acc === "readonly")) {
    // the modifier keyword precedes the node; find its span in source
    const before = src.slice(Math.max(0, node.start - 24), node.start);
    const m = before.match(new RegExp(`(?:^|\\s)(${acc})\\s*$`));
    if (m) {
      const kwStart = node.start - m[0].length + (m[0].startsWith(acc) ? 0 : 1);
      ranges.push([kwStart, node.start]);
    }
  }

  switch (node.type) {
    case "TSAsExpression":
    case "TSSatisfiesExpression": {
      // `expr as T` -> keep the expression, drop ` as T`
      const expr = node["expression"];
      const typeAnn = node["typeAnnotation"];
      if (isNode(expr) && isNode(typeAnn)) {
        ranges.push([expr.end, typeAnn.end]);
      }
      break;
    }
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
    case "TSDeclareFunction": {
      // whole declaration is type-only; remove it
      ranges.push([node.start, node.end]);
      return;
    }
    case "TSNonNullExpression": {
      // `x!` -> drop the `!`
      const expr = node["expression"];
      if (isNode(expr)) ranges.push([expr.end, node.end]);
      break;
    }
    case "TSParameterProperty": {
      // constructor(private x: number) -> keep the parameter, drop the modifier
      const param = node["parameter"];
      if (isNode(param)) {
        for (const k of Object.keys(node)) {
          if (k === "parameter") continue;
          const v = node[k];
          if (isNode(v)) collectRanges(v, src, ranges);
          else if (Array.isArray(v)) for (const it of v) if (isNode(it)) collectRanges(it, src, ranges);
        }
        collectRanges(param, src, ranges);
      }
      return;
    }
    default:
      break;
  }

  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    if (key === "typeAnnotation" || key === "typeParameters" || key === "typeArguments" || key === "returnType") continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) if (isNode(item)) collectRanges(item, src, ranges);
    } else if (isNode(v)) {
      collectRanges(v, src, ranges);
    }
  }
}

/** Merge overlapping/adjacent ranges, then remove them right-to-left. */
function removeRanges(src: string, ranges: Array<[number, number]>): string {
  const sorted = ranges
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  let out = src;
  for (let i = merged.length - 1; i >= 0; i--) {
    const [s, e] = merged[i]!;
    out = out.slice(0, s) + out.slice(e);
  }
  return out;
}

/**
 * Strip types. Returns the input unchanged when it is already plain JS.
 * Throws if the TS cannot be parsed or the result is not valid JS — the caller
 * turns that into an inline error rather than feeding the sandbox bad code.
 */
export function stripTypes(src: string): string {
  // Fast path: plain JS parses without the plugin and needs no work.
  try {
    acorn.parse(src, { ecmaVersion: "latest" });
    return src;
  } catch {
    // fall through to TS handling
  }

  const ast = TsParser.parse(src, { ecmaVersion: "latest" }) as unknown as AnyNode;
  const ranges: Array<[number, number]> = [];
  collectRanges(ast, src, ranges);
  const out = removeRanges(src, ranges);

  // Guarantee: the sandbox never receives code we have not re-validated as JS.
  try {
    acorn.parse(out, { ecmaVersion: "latest" });
  } catch (e) {
    throw new Error(`could not strip types cleanly: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}
