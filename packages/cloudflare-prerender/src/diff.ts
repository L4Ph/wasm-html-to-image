/**
 * Line-by-line diff algorithm using Myers' diff algorithm.
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
 * Myers' O(ND) diff algorithm for lines of text.
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

  // Shortcut if one side is empty
  if (n === 0) {
    const changes: DiffChange[] = b.map((value) => ({ type: "added", value }));
    return {
      changes,
      stats: { added: b.length, removed: 0, unchanged: 0 },
    };
  }
  if (m === 0) {
    const changes: DiffChange[] = a.map((value) => ({ type: "removed", value }));
    return {
      changes,
      stats: { added: 0, removed: a.length, unchanged: 0 },
    };
  }

  const max = n + m;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  let finalD = max;
  findPath: for (let d = 0; d <= max; d++) {
    const vCopy = new Int32Array(v);
    trace.push(vCopy);
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
    const prevV = trace[d];
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && prevV[k - 1 + max] < prevV[k + 1 + max])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = prevV[prevK + max];
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

  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const c of rawChanges) {
    if (c.type === "added") added++;
    else if (c.type === "removed") removed++;
    else unchanged++;
  }

  return {
    changes: rawChanges,
    stats: { added, removed, unchanged },
  };
}
