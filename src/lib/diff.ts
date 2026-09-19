/**
 * Minimal token-level diff (LCS). Used to show a mutant's change against the
 * original in survivor cards. Hand-written rather than imported: the diff IS
 * part of the product's evidence surface, and it stays tiny.
 */

export type DiffPart = { kind: "same" | "add" | "del"; text: string };

export function tokenize(src: string): string[] {
  // Multi-char operators first (===, !==, >=, <=, ==, !=, &&, ||) so a flip
  // like `>=` -> `>` renders as one clean del/add pair, not char soup.
  return (
    src.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|\s+|===|!==|==|!=|>=|<=|&&|\|\||=>|[^\s\w]/g) ?? []
  );
}

export function diffTokens(a: readonly string[], b: readonly string[]): DiffPart[] {
  // LCS table (bounded by token counts; inputs here are small functions)
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i] as string);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push("del", a[i] as string);
      i++;
    } else {
      push("add", b[j] as string);
      j++;
    }
  }
  while (i < n) push("del", a[i++] as string);
  while (j < m) push("add", b[j++] as string);
  return parts;
}

/** Compact line-level diff between original and mutant source. */
export function diffSource(original: string, mutant: string): DiffPart[] {
  return diffTokens(tokenize(original), tokenize(mutant));
}
