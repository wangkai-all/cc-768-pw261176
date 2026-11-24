import { describe, expect, it } from 'vitest';
import { solveMax, solveMin, verifyDual, verifyWitness, type LpRow } from './simplex';
import { rat, add, mul, cmp, ZERO, toNumber, sub, div, eq, type Rat } from './rational';

const r = (n: number, d = 1) => rat(n, d);
const row = (a: number[], rel: '<=' | '>=' | '=', b: number, key = 'k'): LpRow => ({
  a: a.map((x) => rat(x)),
  rel,
  b: rat(b),
  key,
});

function matVec(A: Rat[][], x: Rat[]): Rat[] {
  return A.map((rowA) => rowA.reduce((s, a, j) => add(s, mul(a, x[j])), ZERO));
}

describe('exact simplex', () => {
  it('solves a classic max problem with a unit-sum constraint', () => {
    // max x1 + 2 x2  s.t. x1 + x2 <= 1, x1 >= 0, x2 >= 0
    const res = solveMax([r(1), r(2)], [row([1, 1], '<=', 1)]);
    expect(res.status).toBe('optimal');
    expect(toNumber(res.value)).toBe(2);
    expect(res.x.map(toNumber)).toEqual([0, 1]);
    const chk = verifyWitness([r(1), r(2)], [row([1, 1], '<=', 1)], res.x, res.value, false);
    expect(chk.ok).toBe(true);
    const dchk = verifyDual([r(1), r(2)], [row([1, 1], '<=', 1)], res.dual, 'max');
    expect(dchk.ok).toBe(true);
    expect(toNumber(dchk.bound)).toBe(2);
  });

  it('handles >= rows and equality rows', () => {
    // min 2x1 + x2 s.t. x1+x2 = 1, x1 >= 0.4, x1,x2 >= 0
    const rows = [row([1, 1], '=', 1), row([1, 0], '>=', 0.4)];
    const c = [r(2), r(1)];
    const res = solveMin(
      c,
      rows.map((row_) => ({ ...row_, a: [rat(2), rat(1)] })) && rows,
    );
    // min cost 2x1 + x2 = 1 + x1 -> x1 = 0.4, value 1.4
    expect(res.status).toBe('optimal');
    expect(toNumber(res.value)).toBeCloseTo(1.4, 12);
    const d = verifyDual(c, rows, res.dual, 'min');
    expect(d.ok).toBe(true);
    expect(toNumber(d.bound)).toBeCloseTo(1.4, 12);
    const w = verifyWitness(c, rows, res.x, res.value, false);
    expect(w.ok).toBe(true);
  });

  it('reports infeasibility', () => {
    // x1 <= 0.2 and x1 >= 0.8
    const rows = [row([1, 0], '<=', 0.2), row([1, 0], '>=', 0.8)];
    const res = solveMax([r(1), r(0)], rows);
    expect(res.status).toBe('infeasible');
  });

  it('reports unboundedness', () => {
    const res = solveMax([r(1)], [row([-1], '<=', 0)]);
    // max x with -x <= 0 => x >= 0, unbounded
    expect(res.status).toBe('unbounded');
  });

  it('handles redundant equality given twice', () => {
    const rows = [row([1, 1], '=', 1), row([2, 2], '=', 2), row([0, 1], '<=', 0.7)];
    const res = solveMax([r(1), r(2)], rows);
    expect(res.status).toBe('optimal');
    expect(toNumber(res.value)).toBeCloseTo(1.7, 12);
    const d = verifyDual([r(1), r(2)], rows, res.dual, 'max');
    expect(d.ok).toBe(true);
  });

  it('produces duals valid for random 3-variable problems (brute force vertices)', () => {
    // Deterministic pseudo-random search over small LPs; compare against
    // vertex enumeration on the constraint set x>=0 plus rows.
    let seed = 123456789;
    const rnd = () => {
      seed = (1103515245 * seed + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 40; trial++) {
      const n = 3;
      const rows: LpRow[] = [];
      // Ensure boundedness with box constraints.
      for (let j = 0; j < n; j++) rows.push(row(Array.from({ length: n }, (_, k) => (k === j ? 1 : 0)), '<=', 2 + rnd(), `box${j}`));
      for (let i = 0; i < 3; i++) {
        const a = Array.from({ length: n }, () => Math.round((rnd() * 6 - 3) * 10) / 10);
        a[0] = Math.abs(a[0]) + 0.1;
        rows.push(row(a, rnd() > 0.5 ? '<=' : '>=', Math.round((rnd() * 6 - 1) * 10) / 10, `r${i}`));
      }
      const c = Array.from({ length: n }, () => Math.round((rnd() * 6 - 3) * 10) / 10);
      const res = solveMax(c.map((x) => rat(x)), rows);
      if (res.status !== 'optimal') continue;
      const w = verifyWitness(c.map((x) => rat(x)), rows, res.x, res.value, false);
      expect(w.ok).toBe(true);
      const d = verifyDual(c.map((x) => rat(x)), rows, res.dual, 'max');
      expect(d.ok).toBe(true);
      expect(eq(d.bound, res.value)).toBe(true);
      // Upper bound check: every feasible vertex objective <= res.value.
      const vertices = enumerateVertices(rows, n);
      for (const vx of vertices) {
        const obj = vx.reduce((s, x, j) => add(s, mul(x, rat(c[j]))), ZERO);
        expect(cmp(obj, res.value)).toBeLessThanOrEqual(0);
      }
    }
  });
});

/** Enumerate all basic feasible vertices of {A x <= b, x >= 0} for small n. */
function enumerateVertices(rows: LpRow[], n: number): Rat[][] {
  const allRows: { a: Rat[]; b: Rat }[] = [];
  for (const rr of rows) {
    if (rr.rel === '<=') allRows.push({ a: rr.a, b: rr.b });
    else if (rr.rel === '>=') allRows.push({ a: rr.a.map((x) => mul(x, rat(-1))), b: mul(rr.b, rat(-1)) });
    else {
      allRows.push({ a: rr.a, b: rr.b });
      allRows.push({ a: rr.a.map((x) => mul(x, rat(-1))), b: mul(rr.b, rat(-1)) });
    }
  }
  for (let j = 0; j < n; j++) {
    allRows.push({ a: Array.from({ length: n }, (_, k) => rat(k === j ? -1 : 0)), b: ZERO });
  }
  const out: Rat[][] = [];
  const combos = choose(allRows.length, n);
  for (const combo of combos) {
    const M = combo.map((idx) => allRows[idx].a.slice());
    const sol = gauss(M, combo.map((idx) => allRows[idx].b));
    if (!sol) continue;
    let feasible = true;
    for (const rr of allRows) {
      let lhs = ZERO;
      for (let j = 0; j < n; j++) lhs = add(lhs, mul(rr.a[j], sol[j]));
      if (cmp(lhs, rr.b) > 0) {
        feasible = false;
        break;
      }
    }
    if (feasible) out.push(sol);
  }
  return out;
}

function choose(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (start: number) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

function gauss(A: Rat[][], b: Rat[]): Rat[] | null {
  const n = A.length;
  const M = A.map((rowA, i) => [...rowA, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = -1;
    for (let i = col; i < n; i++) if (cmp(M[i][col], ZERO) !== 0) { piv = i; break; }
    if (piv < 0) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] = div(M[col][j], p);
    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const f = M[i][col];
      if (cmp(f, ZERO) === 0) continue;
      for (let j = col; j <= n; j++) M[i][j] = sub(M[i][j], mul(f, M[col][j]));
    }
  }
  return M.map((rowA) => rowA[n]);
}

export { matVec };
