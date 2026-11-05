/**
 * Line-by-line diff algorithm using Myers' diff algorithm with common prefix/suffix optimization.
 */

export type DiffChangeType = "added" | "removed" | "unchanged";

export interface DiffChange {
  type: DiffChangeType;
  value: string;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

export interface DiffResult {
  changes: DiffChange[];
  stats: DiffStats;
}

/**
 * Split text into array of lines.
 */
function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  // If the last character was a newline, split gives an empty string at the end; keep it clean
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Core Myers' O(ND) diff on sub-arrays.
 */
function myersDiff(a: string[], b: string[]): DiffChange[] {
  const n = a.length;
  const m = b.length;

  if (n === 0) {
    return b.map((value) => ({ type: "added" as const, value }));
  }
  if (m === 0) {
    return a.map((value) => ({ type: "removed" as const, value }));
  }

  const max = n + m;
  // Guard against extreme diff sizes exceeding Worker memory / CPU limits
  if (max > 6000) {
    // Fast fallback: mark old as removed, new as added
    const fallback: DiffChange[] = [];
    for (const v of a) fallback.push({ type: "removed", value: v });
    for (const v of b) fallback.push({ type: "added", value: v });
    return fallback;
  }

  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  let finalD = max;
  findPath: for (let d = 0; d <= max; d++) {
    // Only clone the used slice [-d, d] centered at max to save memory
    const sliceLen = 2 * d + 1;
    const vSlice = new Int32Array(sliceLen);
    vSlice.set(v.subarray(max - d, max + d + 1));
    trace.push(vSlice);

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
        x = v[k + 1 + max]; // Down: insertion
      } else {
        x = v[k - 1 + max] + 1; // Right: deletion
      }
      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + max] = x;

      if (x >= n && y >= m) {
        finalD = d;
        break findPath;
      }
    }
  }

  // Backtrack to build the diff
  let x = n;
  let y = m;
  const rawChanges: DiffChange[] = [];

  for (let d = finalD; d > 0; d--) {
    const prevSlice = trace[d];
    const prevD = d;
    const k = x - y;

    // In prevSlice, offset is prevD (centered at index prevD)
    const getPrev = (offsetK: number) => {
      const idx = offsetK + prevD;
      return idx >= 0 && idx < prevSlice.length ? prevSlice[idx] : -1;
    };

    let prevK: number;
    if (k === -d || (k !== d && getPrev(k - 1) < getPrev(k + 1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = getPrev(prevK);
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      rawChanges.push({ type: "unchanged", value: a[x] });
    }

    if (d > 0) {
      if (x === prevX) {
        y--;
        rawChanges.push({ type: "added", value: b[y] });
      } else if (y === prevY) {
        x--;
        rawChanges.push({ type: "removed", value: a[x] });
      }
    }
  }

  while (x > 0 && y > 0) {
    x--;
    y--;
    rawChanges.push({ type: "unchanged", value: a[x] });
  }

  rawChanges.reverse();
  return rawChanges;
}

/**
 * Myers' O(ND) diff algorithm for lines of text with common prefix/suffix optimization.
 */
export function computeLineDiff(textA: string, textB: string): DiffResult {
  const a = splitLines(textA);
  const b = splitLines(textB);
  const n = a.length;
  const m = b.length;

  // Shortcut for identical text
  if (textA === textB) {
    const changes: DiffChange[] = a.map((value) => ({ type: "unchanged", value }));
    return {
      changes,
      stats: { added: 0, removed: 0, unchanged: a.length },
    };
  }

  // Trim common prefix
  let prefixLen = 0;
  while (prefixLen < n && prefixLen < m && a[prefixLen] === b[prefixLen]) {
    prefixLen++;
  }

  // Trim common suffix
  let suffixLen = 0;
  while (
    suffixLen < n - prefixLen &&
    suffixLen < m - prefixLen &&
    a[n - 1 - suffixLen] === b[m - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const prefixChanges: DiffChange[] = a.slice(0, prefixLen).map((value) => ({ type: "unchanged", value }));
  const suffixChanges: DiffChange[] = a.slice(n - suffixLen).map((value) => ({ type: "unchanged", value }));

  const midA = a.slice(prefixLen, n - suffixLen);
  const midB = b.slice(prefixLen, m - suffixLen);

  const midChanges = myersDiff(midA, midB);
  const allChanges = [...prefixChanges, ...midChanges, ...suffixChanges];

  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const c of allChanges) {
    if (c.type === "added") added++;
    else if (c.type === "removed") removed++;
    else unchanged++;
  }

  return {
    changes: allChanges,
    stats: { added, removed, unchanged },
  };
}
