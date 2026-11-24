// Exact two-phase simplex over rationals.
//
// The solver accepts a maximisation problem
//     max c·x   subject to   a_i·x (<= | >= | =) b_i,  x >= 0.
// All arithmetic is exact (BigInt fractions), so the returned optimum, the
// primal witness and the dual multipliers are verifiable without tolerances.
//
// Dual convention: for rows given in "<=" orientation the returned multiplier
// is non-negative and the certificate is
//     y >= 0,  Aᵀy >= c,  b·y = optimum.
// Rows passed in ">=" orientation are negated internally; the returned dual is
// brought back to the orientation the caller supplied.

import {
  type Rat,
  ZERO,
  add,
  sub,
  mul,
  div,
  neg,
  cmp,
  isZero,
  rat,
} from './rational';

export type Relation = '<=' | '>=' | '=';

export interface LpRow {
  a: Rat[];
  rel: Relation;
  b: Rat;
  key: string;
  /** Optional provenance for display; not used by the solver. */
  summaryId?: string;
  endpoint?: 'lo' | 'hi' | 'norm' | 'bound' | 'other';
  label?: string;
}

export interface SolveResult {
  status: 'optimal' | 'infeasible' | 'unbounded' | 'limit';
  /** Primal witness for structural variables (empty when infeasible). */
  x: Rat[];
  /** Maximum objective value when optimal. */
  value: Rat;
  /** Dual multipliers aligned with the input rows. */
  dual: Rat[];
  iterations: number;
  message?: string;
}

export class SolverLimitError extends Error {}

const MAX_ITERATIONS = 30_000;

interface RowMeta {
  inputIndex: number;
  sign: 1n | -1n; // normalised row = sign * input row
  std: number; // index in the normalised row list
  removed: boolean;
}

interface SimplexState {
  T: Rat[][]; // m rows, columns (variables ..., rhs at end)
  basis: number[]; // column index per row
  rows: number; // number of rows
  cols: number; // number of structural columns (excluding rhs)
}

function pivot(T: Rat[][], basis: number[], prow: number, pcol: number): void {
  const pivotVal = T[prow][pcol];
  if (isZero(pivotVal)) throw new Error('simplex: zero pivot');
  const row = T[prow];
  for (let j = 0; j < row.length; j++) row[j] = div(row[j], pivotVal);
  for (let i = 0; i < T.length; i++) {
    if (i === prow) continue;
    const factor = T[i][pcol];
    if (isZero(factor)) continue;
    const target = T[i];
    for (let j = 0; j < row.length; j++) {
      if (isZero(row[j])) continue;
      target[j] = sub(target[j], mul(factor, row[j]));
    }
  }
  basis[prow] = pcol;
}

/** Run primal simplex for a given cost vector. Returns 'optimal' | 'unbounded' | 'limit'. */
function runSimplex(
  state: SimplexState,
  cost: Rat[],
  allowed: (j: number) => boolean,
): { status: 'optimal' | 'unbounded' | 'limit'; iterations: number } {
  const { T, basis, rows, cols } = state;
  let iterations = 0;
  for (;;) {
    if (iterations >= MAX_ITERATIONS) return { status: 'limit', iterations };
    // Reduced costs r_j = c_j - c_Bᵀ B⁻¹ A_j, with canonical tableau T.
    const r: Rat[] = new Array(cols);
    for (let j = 0; j < cols; j++) {
      let sum = ZERO;
      for (let i = 0; i < rows; i++) {
        const cb = cost[basis[i]];
        if (isZero(cb)) continue;
        sum = add(sum, mul(cb, T[i][j]));
      }
      r[j] = sub(cost[j], sum);
    }
    // Bland's rule: smallest column index with a positive reduced cost.
    let enter = -1;
    for (let j = 0; j < cols; j++) {
      if (!allowed(j)) continue;
      if (cmp(r[j], ZERO) > 0) {
        enter = j;
        break;
      }
    }
    if (enter < 0) return { status: 'optimal', iterations };

    // Ratio test with Bland tie-breaking on the leaving basis variable.
    let leave = -1;
    let bestRatio: Rat | null = null;
    for (let i = 0; i < rows; i++) {
      const a = T[i][enter];
      if (cmp(a, ZERO) <= 0) continue;
      const ratio = div(T[i][cols], a);
      const c = bestRatio === null ? -1 : cmp(ratio, bestRatio);
      if (
        bestRatio === null ||
        c < 0 ||
        (c === 0 && basis[i] < basis[leave])
      ) {
        bestRatio = ratio;
        leave = i;
      }
    }
    if (leave < 0) return { status: 'unbounded', iterations };
    pivot(T, basis, leave, enter);
    iterations++;
  }
}

function objectiveValue(state: SimplexState, cost: Rat[]): Rat {
  let z = ZERO;
  for (let i = 0; i < state.rows; i++) {
    const cb = cost[state.basis[i]];
    if (isZero(cb)) continue;
    z = add(z, mul(cb, state.T[i][state.cols]));
  }
  return z;
}

/** Exact Gaussian solve for Bᵀ y = c_B. Returns null when singular. */
function solveBasisDual(E: Rat[][], basis: number[], cB: Rat[]): Rat[] | null {
  const m = E.length;
  if (m === 0) return [];
  // Build Bᵀ (m x m): row i col k = E[k][basis[i]].
  const M: Rat[][] = [];
  for (let i = 0; i < m; i++) {
    const row: Rat[] = [];
    for (let k = 0; k < m; k++) row.push(E[k][basis[i]]);
    row.push(cB[i]);
    M.push(row);
  }
  for (let col = 0; col < m; col++) {
    let piv = -1;
    for (let r = col; r < m; r++) {
      if (!isZero(M[r][col])) {
        piv = r;
        break;
      }
    }
    if (piv < 0) return null;
    if (piv !== col) {
      const t = M[piv];
      M[piv] = M[col];
      M[col] = t;
    }
    const p = M[col][col];
    for (let j = col; j <= m; j++) M[col][j] = div(M[col][j], p);
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (isZero(f)) continue;
      for (let j = col; j <= m; j++) {
        M[r][j] = sub(M[r][j], mul(f, M[col][j]));
      }
    }
  }
  return M.map((row) => row[m]);
}

/**
 * Maximise c·x over the rows. When the problem is feasible the solution is
 * returned exactly; when infeasible, `dual` holds the phase-I multipliers (may
 * be empty) which are useful only for diagnostics.
 */
export function solveMax(c: Rat[], rows: LpRow[]): SolveResult {
  const n = c.length;
  const m = rows.length;
  const norm: {
    a: Rat[];
    rel: Relation;
    b: Rat;
    sign: 1n | -1n;
    inputIndex: number;
  }[] = [];
  rows.forEach((row, idx) => {
    let a = row.a.slice();
    let b = row.b;
    let rel = row.rel;
    let sign: 1n | -1n = 1n;
    if (cmp(b, ZERO) < 0) {
      a = a.map(neg);
      b = neg(b);
      sign = -1n;
      if (rel === '<=') rel = '>=';
      else if (rel === '>=') rel = '<=';
    }
    norm.push({ a, rel, b, sign, inputIndex: idx });
  });

  // Column layout: structural (n), slack/surplus per row (m), artificial per row (m).
  const slackCol = (i: number) => n + i;
  const artCol = (i: number) => n + m + i;
  const totalCols = n + 2 * m;
  let T: Rat[][] = [];
  const basis: number[] = [];
  const needsArt: boolean[] = [];
  const rowMeta: RowMeta[] = [];
  norm.forEach((row, i) => {
    const cells: Rat[] = new Array(totalCols + 1).fill(ZERO);
    for (let j = 0; j < n; j++) cells[j] = row.a[j];
    cells[totalCols] = row.b;
    if (row.rel === '<=') {
      cells[slackCol(i)] = rat(1);
      basis.push(slackCol(i));
      needsArt.push(false);
    } else if (row.rel === '>=') {
      cells[slackCol(i)] = rat(-1);
      cells[artCol(i)] = rat(1);
      basis.push(artCol(i));
      needsArt.push(true);
    } else {
      // '=': a zero slack column is allocated but never used.
      cells[slackCol(i)] = ZERO;
      cells[artCol(i)] = rat(1);
      basis.push(artCol(i));
      needsArt.push(true);
    }
    T.push(cells);
    rowMeta.push({ inputIndex: row.inputIndex, sign: row.sign, std: i, removed: false });
  });

  const state: SimplexState = { T, basis, rows: m, cols: totalCols };
  // Snapshot of the standard-form matrix A_std (structural + slack columns) in
  // the original row orientation — the dual extraction needs B itself, not the
  // tableau's B⁻¹A.
  const Astd: Rat[][] = T.map((row) => row.slice(0, n + m));

  // ---- Phase I ------------------------------------------------------------
  const phaseOneCost: Rat[] = new Array(totalCols).fill(ZERO);
  for (let i = 0; i < m; i++) phaseOneCost[artCol(i)] = rat(-1);
  const phaseOne = runSimplex(state, phaseOneCost, () => true);
  if (phaseOne.status === 'limit') {
    return {
      status: 'limit',
      x: new Array(n).fill(ZERO),
      value: ZERO,
      dual: new Array(m).fill(ZERO),
      iterations: phaseOne.iterations,
      message: '单纯形迭代达到上限（可能是数值退化）。请简化摘要或支持集。',
    };
  }
  const phaseOneValue = objectiveValue(state, phaseOneCost);
  if (cmp(phaseOneValue, ZERO) < 0) {
    // Infeasible. Keep phase-I duals for optional display (mapped back later).
    return {
      status: 'infeasible',
      x: new Array(n).fill(ZERO),
      value: phaseOneValue,
      dual: new Array(m).fill(ZERO),
      iterations: phaseOne.iterations,
    };
  }

  // ---- Remove artificials -------------------------------------------------
  // Pivot each artificial basic variable out using a NONBASIC structural or
  // slack column. If every candidate column is already basic the row is a
  // positive combination of others (redundant) and is dropped; its dual
  // multiplier is zero, which is a valid certificate for a redundant row.
  for (let i = 0; i < m; i++) {
    if (basis[i] < n + m) continue; // not artificial
    const basicSet = new Set(basis.filter((b) => b < n + m));
    let found = -1;
    for (let j = 0; j < n + m; j++) {
      if (basicSet.has(j)) continue;
      if (!isZero(T[i][j])) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      pivot(T, basis, i, found);
    } else {
      rowMeta[i].removed = true;
    }
  }

  const keptRows = rowMeta
    .map((meta, i) => ({ meta, i }))
    .filter(({ meta, i }) => !meta.removed && basis[i] < n + m);
  const keptRowIndices = keptRows.map(({ i }) => i);
  const finalCols = n + m;
  const finalT: Rat[][] = [];
  const finalBasis: number[] = [];
  const finalMeta: { inputIndex: number; sign: 1n | -1n; std: number }[] = [];
  keptRowIndices.forEach((i) => {
    const row: Rat[] = [];
    for (let j = 0; j < n + m; j++) row.push(T[i][j]);
    row.push(T[i][totalCols]);
    finalT.push(row);
    finalBasis.push(basis[i]);
    const meta = rowMeta[i];
    finalMeta.push({ inputIndex: meta.inputIndex, sign: meta.sign, std: i });
  });

  // ---- Phase II -----------------------------------------------------------
  const cost: Rat[] = new Array(finalCols).fill(ZERO);
  for (let j = 0; j < n; j++) cost[j] = c[j];
  const phaseTwoState: SimplexState = {
    T: finalT,
    basis: finalBasis,
    rows: finalT.length,
    cols: finalCols,
  };
  const phaseTwo = runSimplex(phaseTwoState, cost, (j) => j < n + m);
  if (phaseTwo.status === 'limit') {
    return {
      status: 'limit',
      x: new Array(n).fill(ZERO),
      value: ZERO,
      dual: new Array(m).fill(ZERO),
      iterations: phaseOne.iterations + phaseTwo.iterations,
      message: '第二阶段单纯形迭代达到上限。请简化输入。',
    };
  }
  if (phaseTwo.status === 'unbounded') {
    return {
      status: 'unbounded',
      x: new Array(n).fill(ZERO),
      value: ZERO,
      dual: new Array(m).fill(ZERO),
      iterations: phaseOne.iterations + phaseTwo.iterations,
      message: '目标函数在可行域上无界（通常意味着缺少总质量约束）。',
    };
  }

  const value = objectiveValue(phaseTwoState, cost);

  // Primal witness
  const x: Rat[] = new Array(n).fill(ZERO);
  for (let i = 0; i < finalT.length; i++) {
    const col = finalBasis[i];
    if (col < n) x[col] = finalT[i][finalCols];
  }

  // Dual witnesses: Bᵀ y = c_B over the original standard-form columns.
  const E: Rat[][] = finalMeta.map((meta) => Astd[meta.std].slice(0, finalCols));
  const cB: Rat[] = finalBasis.map((col) => cost[col]);
  const yNorm = solveBasisDual(E, finalBasis, cB);
  const dual: Rat[] = new Array(m).fill(ZERO);
  if (yNorm) {
    for (let k = 0; k < finalMeta.length; k++) {
      const meta = finalMeta[k];
      // normalised row = sign * input row  =>  y_input = sign * y_norm
      dual[meta.inputIndex] = mul(rat(meta.sign), yNorm[k]);
    }
  }

  return {
    status: 'optimal',
    x,
    value,
    dual,
    iterations: phaseOne.iterations + phaseTwo.iterations,
  };
}

export function solveMin(c: Rat[], rows: LpRow[]): SolveResult {
  const res = solveMax(c.map(neg), rows);
  return {
    ...res,
    value: neg(res.value),
    dual: res.dual.map(neg),
  };
}

/** Check whether the given rows (with x >= 0) are feasible, ignoring an objective. */
export function checkFeasible(n: number, rows: LpRow[]): { feasible: boolean; x: Rat[]; iterations: number; status: string } {
  const res = solveMax(new Array(n).fill(ZERO), rows);
  return {
    feasible: res.status === 'optimal',
    x: res.x,
    iterations: res.iterations,
    status: res.status,
  };
}

// ---------------------------------------------------------------------------
// Verification helpers. These are intentionally independent of the solver so
// the UI can show that witness and dual really prove the reported bound.

export interface WitnessCheck {
  ok: boolean;
  nonneg: boolean;
  unitMass?: boolean;
  rowsOk: boolean;
  valueMatches: boolean;
  failures: { key: string; residual: Rat; relation: Relation }[];
}

export function verifyWitness(
  c: Rat[],
  rows: LpRow[],
  x: Rat[],
  value: Rat,
  requireUnitMass: boolean,
): WitnessCheck {
  const failures: WitnessCheck['failures'] = [];
  let nonneg = true;
  x.forEach((v) => {
    if (cmp(v, ZERO) < 0) nonneg = false;
  });
  let rowsOk = true;
  rows.forEach((row) => {
    let lhs = ZERO;
    for (let j = 0; j < x.length; j++) lhs = add(lhs, mul(row.a[j], x[j]));
    const diff = sub(lhs, row.b);
    let ok = true;
    if (row.rel === '<=') ok = cmp(diff, ZERO) <= 0;
    else if (row.rel === '>=') ok = cmp(diff, ZERO) >= 0;
    else ok = isZero(diff);
    if (!ok) {
      rowsOk = false;
      failures.push({ key: row.key, residual: diff, relation: row.rel });
    }
  });
  let mass = ZERO;
  for (const v of x) mass = add(mass, v);
  const unitMass = requireUnitMass ? isZero(sub(mass, rat(1))) : true;
  let lhsValue = ZERO;
  for (let j = 0; j < c.length; j++) lhsValue = add(lhsValue, mul(c[j], x[j]));
  const valueMatches = isZero(sub(lhsValue, value));
  return {
    ok: nonneg && rowsOk && unitMass && valueMatches,
    nonneg,
    unitMass,
    rowsOk,
    valueMatches,
    failures,
  };
}

export interface DualCheck {
  ok: boolean;
  signsOk: boolean;
  pointwiseOk: boolean;
  /** b·w, the certified bound. */
  bound: Rat;
  /** Minimum of (Aᵀw − f) for max, or (f − Aᵀw) for min; must be >= 0. */
  pointwiseMinResidual: Rat;
  badPoints: number[];
  /** Residual per structural variable, for display. */
  residuals: Rat[];
}

/**
 * Verify a dual certificate.
 *
 * For a MAXIMISATION problem the certificate is w with
 *   row "<=" => w_i >= 0,  row ">=" => w_i <= 0,  row "=" => free,
 *   Aᵀw >= c,  and the certified upper bound is b·w.
 * For a MINIMISATION problem the certificate is w with
 *   row ">=" => w_i >= 0,  row "<=" => w_i <= 0,  row "=" => free,
 *   Aᵀw <= c,  and the certified lower bound is b·w.
 */
export function verifyDual(
  f: Rat[],
  rows: LpRow[],
  w: Rat[],
  direction: 'max' | 'min',
): DualCheck {
  let signsOk = true;
  for (let i = 0; i < rows.length; i++) {
    const rel = rows[i].rel;
    const v = w[i];
    if (rel === '=') continue;
    const wantedPositive =
      direction === 'max' ? rel === '<=' : rel === '>=';
    if (wantedPositive) {
      if (cmp(v, ZERO) < 0) signsOk = false;
    } else if (cmp(v, ZERO) > 0) {
      signsOk = false;
    }
  }
  const residuals: Rat[] = [];
  const badPoints: number[] = [];
  let minResidual: Rat | null = null;
  for (let j = 0; j < f.length; j++) {
    let lhs = ZERO;
    for (let i = 0; i < rows.length; i++) {
      if (isZero(w[i]) || isZero(rows[i].a[j])) continue;
      lhs = add(lhs, mul(w[i], rows[i].a[j]));
    }
    const residual = direction === 'max' ? sub(lhs, f[j]) : sub(f[j], lhs);
    residuals.push(residual);
    if (cmp(residual, ZERO) < 0) badPoints.push(j);
    if (minResidual === null || cmp(residual, minResidual) < 0) minResidual = residual;
  }
  let bound = ZERO;
  for (let i = 0; i < rows.length; i++) {
    if (isZero(w[i])) continue;
    bound = add(bound, mul(w[i], rows[i].b));
  }
  const pointwiseOk = badPoints.length === 0;
  return {
    ok: signsOk && pointwiseOk,
    signsOk,
    pointwiseOk,
    bound,
    pointwiseMinResidual: minResidual ?? ZERO,
    badPoints,
    residuals,
  };
}
