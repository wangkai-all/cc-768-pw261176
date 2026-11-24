// Analysis engine.
//
// Finite support: the feasible set is a polytope over probability masses; each
// bound is the optimum of an exact rational LP, and both the attaining
// distribution and the dual multipliers are returned and independently
// verified.
//
// Continuous support: we never claim a grid solution is optimal. We produce
//   * a rigorous outer bound from a dual multiplier vector whose Lagrangian is
//     exactly maximised over the whole interval (piecewise quadratic sup), and
//   * an attainable inner bound from a genuine distribution supported on the
//     breakpoints.
// The certified interval is [inner, outer] for a maximum and [outer, inner] for
// a minimum; the gap is the explicit discretisation slack.

import {
  type Rat,
  ZERO,
  ONE,
  rat,
  add,
  sub,
  mul,
  div,
  neg,
  cmp,
  eq,
  isZero,
  max2,
  toDecimalString,
  toFraction,
} from './rational';
import {
  type LpRow,
  solveMax,
  solveMin,
  verifyDual,
  verifyWitness,
  type DualCheck,
  type WitnessCheck,
} from './simplex';
import {
  type CompiledProblem,
  type CompiledSummary,
  type CompiledTarget,
  unitMassRow,
  inBinForSupport,
  objectiveLoss,
  objectiveTail,
  newId,
} from './model';

export type Metric = 'tail' | 'loss';
export type Direction = 'min' | 'max';
export type Side = 'at' | 'left' | 'right';

export interface DualRowEvidence {
  key: string;
  label: string;
  rel: '<=' | '>=' | '=';
  bound: Rat;
  multiplier: Rat;
  signOk: boolean;
  feature: FeatureKind;
}

export type FeatureKind = 'mean' | 'second' | 'count' | 'mass' | 'objective';

export interface FiniteBound {
  mode: 'finite';
  targetId: string;
  targetLabel: string;
  threshold: Rat;
  metric: Metric;
  direction: Direction;
  status: 'ok' | 'infeasible' | 'unbounded' | 'error';
  value: Rat;
  objectiveLabel: string;
  witness?: Rat[];
  witnessCheck?: WitnessCheck;
  dual?: Rat[];
  dualCheck?: DualCheck;
  dualRows?: DualRowEvidence[];
  tightSupportIndices?: number[];
  iterations: number;
  message?: string;
}

export interface ContinuousBound {
  mode: 'continuous';
  targetId: string;
  targetLabel: string;
  threshold: Rat;
  metric: Metric;
  direction: Direction;
  status: 'ok' | 'undecided' | 'error';
  outer: Rat;
  inner: Rat | null;
  innerKind: 'attainable' | 'trivial';
  gap: Rat;
  exact: boolean;
  objectiveLabel: string;
  certificate: ContinuousCertificate;
  /** Attaining distribution on the breakpoint support (inner bound witness). */
  innerWitness?: Rat[];
  innerWitnessCheck?: WitnessCheck;
  gridSolution?: Rat;
  gridDerivation?: string;
  iterations: number;
  message?: string;
}

export type Bound = FiniteBound | ContinuousBound;

export interface ContinuousCertificate {
  valid: boolean;
  weights: Rat[];
  mu0: Rat;
  bound: Rat;
  supValue: Rat;
  supPoint: Rat;
  supSide: Side;
  checkedPoints: number;
  cutIterations: number;
  samples: number;
  signOk: boolean;
  rows: DualRowEvidence[];
  hAtSup: Rat;
  dualObjective: Rat;
}

export interface ConflictGroup {
  id: string;
  label: string;
  rows: LpRow[];
  kind: 'summary' | 'bound' | 'unit';
}

export interface InfeasibilityReport {
  status: 'feasible' | 'infeasible' | 'undecided';
  message: string;
  conflict?: {
    groups: { id: string; label: string; kind: ConflictGroup['kind'] }[];
    dropWitnesses: {
      droppedId: string;
      droppedLabel: string;
      /**
       * Whether the conflict set *without* this item is feasible. This is the
       * minimality claim proper. It is always true for an IIS and says nothing
       * about the rest of the model.
       */
      minimalityFeasible: boolean;
      /**
       * Whether the WHOLE model without this item is feasible. False here with
       * `minimalityFeasible` true means a second, disjoint conflict exists that
       * this report does not list.
       */
      feasible: boolean;
      /** Witness for the whole model minus this item (a genuine distribution). */
      witness?: Rat[];
    }[];
  };
}

export interface JointCheckItem {
  targetId: string;
  metric: Metric;
  direction: Direction;
}

export interface JointCheckResult {
  id: string;
  createdAt: string;
  mode: 'finite' | 'continuous';
  items: { targetId: string; targetLabel: string; metric: Metric; direction: Direction; bound: Rat }[];
  status: 'attainable' | 'not-attainable' | 'undecided';
  message: string;
  witness?: Rat[];
  witnessChecks?: { label: string; ok: boolean; value: Rat }[];
  conflict?: InfeasibilityReport['conflict'];
  /**
   * Why a joint check failed: the minimal conflict set itself (which reproduces
   * the infeasibility) and, for each item, whether the remaining items are
   * jointly attainable. `conflict.groups` is the set to inspect; the drop
   * witnesses show that each element is necessary.
   */
  resolution?: {
    conflictReproduced: boolean;
    dropChecks: {
      key: string;
      label: string;
      /** Conflict set minus this item is feasible ⇒ the set is minimal. */
      minimalityFeasible: boolean;
      /** Whole model minus this item is feasible ⇒ this was the only conflict. */
      feasible: boolean;
    }[];
  };
  gridNote?: string;
}

export interface PairCompatibility {
  a: string;
  b: string;
  status: 'yes' | 'no' | 'undecided';
}

export interface AnalysisResult {
  engineVersion: string;
  createdAt: string;
  problem: CompiledProblem;
  finiteMode: boolean;
  baseRows: LpRow[];
  bounds: Bound[];
  feasibility: InfeasibilityReport;
  assumptions: string[];
  supportValues: Rat[];
  supportTexts: string[];
  pairCompatibility: PairCompatibility[];
  bruteForce?: BruteForceReport;
  notes: string[];
}

export interface BruteForceReport {
  available: boolean;
  reason: string;
  verticesChecked: number;
  objectives: { label: string; min?: Rat; max?: Rat; matches: boolean }[];
  combinations: number;
}

export const ENGINE_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Row metadata: how each row's feature is evaluated at an arbitrary point.

export interface RowInfo {
  row: LpRow;
  feature: FeatureKind;
  bin?: CompiledSummary['bin'];
  /** Dual weight attached during continuous bound computation. */
  weight?: Rat;
}

export function featureKindOfRow(row: LpRow, problem: CompiledProblem): FeatureKind {
  if (row.key === 'unit-mass' || row.key.startsWith('bound:')) return 'mass';
  const id = row.summaryId;
  if (!id) return 'mass';
  const s = problem.summaries.find((x) => x.input.id === id);
  if (!s) return 'mass';
  return s.input.kind === 'mean' ? 'mean' : s.input.kind === 'second' ? 'second' : 'count';
}

export function rowInfos(problem: CompiledProblem, rows: LpRow[]): RowInfo[] {
  return rows.map((row) => {
    const feature = featureKindOfRow(row, problem);
    let bin: CompiledSummary['bin'];
    if (feature === 'count' && row.summaryId) {
      bin = problem.summaries.find((x) => x.input.id === row.summaryId)?.bin;
    }
    return { row, feature, bin };
  });
}

function featureAt(info: RowInfo, x: Rat, side: Side): Rat {
  switch (info.feature) {
    case 'mean':
      return x;
    case 'second':
      return mul(x, x);
    case 'count': {
      if (!info.bin) return ZERO;
      const b = info.bin;
      const loOk =
        side === 'left'
          ? cmp(x, b.lo) > 0
          : side === 'right'
            ? cmp(x, b.lo) >= 0
            : b.loInclusive
              ? cmp(x, b.lo) >= 0
              : cmp(x, b.lo) > 0;
      const hiOk =
        side === 'left'
          ? cmp(x, b.hi) <= 0
          : side === 'right'
            ? cmp(x, b.hi) < 0
            : b.hiInclusive
              ? cmp(x, b.hi) <= 0
              : cmp(x, b.hi) < 0;
      return loOk && hiOk ? ONE : ZERO;
    }
    default:
      return ONE;
  }
}

export function rowLabel(row: LpRow): string {
  return row.label ?? row.key;
}

function rowsForCompiled(points: Rat[], problem: CompiledProblem): LpRow[] {
  const rows: LpRow[] = [];
  for (const s of problem.summaries) {
    const iv = s.interval;
    const mk = (
      rel: '<=' | '>=' | '=',
      b: Rat,
      endpoint: 'lo' | 'hi' | 'norm',
      suffix: string,
    ): LpRow => ({
      a: points.map((v) => {
        if (s.input.kind === 'mean') return v;
        if (s.input.kind === 'second') return mul(v, v);
        return inBinForSupport(v, s.bin!) ? ONE : ZERO;
      }),
      rel,
      b,
      key: `summary:${s.input.id}:${s.input.kind}:${suffix}`,
      summaryId: s.input.id,
      endpoint,
      label:
        s.input.kind === 'count'
          ? `${s.label}${suffix === 'lo' ? '（计数下界）' : suffix === 'hi' ? '（计数上界）' : ''}`
          : `${s.label}${suffix === 'lo' ? '（下界）' : suffix === 'hi' ? '（上界）' : ''}`,
    });
    if (s.input.kind === 'count') {
      const lo = div(iv.lo, problem.sampleSize);
      const hi = div(iv.hi, problem.sampleSize);
      if (eq(lo, hi)) rows.push(mk('=', lo, 'norm', 'mass'));
      else {
        rows.push(mk('>=', lo, 'lo', 'lo'));
        rows.push(mk('<=', hi, 'hi', 'hi'));
      }
    } else if (iv.exact) {
      rows.push(mk('=', iv.lo, 'norm', 'value'));
    } else {
      rows.push(mk('>=', iv.lo, 'lo', 'lo'));
      rows.push(mk('<=', iv.hi, 'hi', 'hi'));
    }
  }
  rows.push(unitMassRow(points.length));
  return rows;
}

export function buildBaseRows(problem: CompiledProblem, points?: Rat[]): LpRow[] {
  const pts = points ?? (problem.mode === 'finite' ? problem.values : problem.breakpoints ?? []);
  return rowsForCompiled(pts, problem);
}

export function objectiveFor(
  _problem: CompiledProblem,
  target: CompiledTarget,
  metric: Metric,
  points: Rat[],
): Rat[] {
  return metric === 'tail'
    ? objectiveTail(points, target.threshold, target.input.strictTail)
    : objectiveLoss(points, target.threshold);
}

export function metricLabel(metric: Metric, target: CompiledTarget): string {
  if (metric === 'tail') {
    return `P(X ${target.input.strictTail ? '>' : '≥'} ${toDecimalString(target.threshold, 8)})`;
  }
  return `E[(X − ${toDecimalString(target.threshold, 8)})⁺]`;
}

// ---------------------------------------------------------------------------
// Finite support bounds

function finiteSolve(
  problem: CompiledProblem,
  target: CompiledTarget,
  metric: Metric,
  direction: Direction,
  baseRows: LpRow[],
): FiniteBound {
  const points = problem.values;
  const c = objectiveFor(problem, target, metric, points);
  const objectiveLabel = metricLabel(metric, target);
  const res = direction === 'max' ? solveMax(c, baseRows) : solveMin(c, baseRows);
  const base = {
    mode: 'finite' as const,
    targetId: target.input.id,
    targetLabel: target.label,
    threshold: target.threshold,
    metric,
    direction,
    value: res.value,
    objectiveLabel,
    iterations: res.iterations,
  };
  if (res.status === 'unbounded') {
    return { ...base, status: 'unbounded', message: '目标在可行域上无界：请检查是否缺少总质量约束。' };
  }
  if (res.status === 'limit') {
    return { ...base, status: 'error', message: res.message ?? '单纯形迭代上限' };
  }
  if (res.status === 'infeasible') {
    return { ...base, status: 'infeasible', message: '摘要约束不可行；未计算该界。' };
  }
  const witnessCheck = verifyWitness(c, baseRows, res.x, res.value, true);
  const dualCheck = verifyDual(c, baseRows, res.dual, direction);
  const dualRows: DualRowEvidence[] = baseRows.map((row, i) => {
    const signOk =
      row.rel === '='
        ? true
        : direction === 'max'
          ? row.rel === '>='
            ? cmp(res.dual[i], ZERO) <= 0
            : cmp(res.dual[i], ZERO) >= 0
          : row.rel === '>='
            ? cmp(res.dual[i], ZERO) >= 0
            : cmp(res.dual[i], ZERO) <= 0;
    return {
      key: row.key,
      label: rowLabel(row),
      rel: row.rel,
      bound: row.b,
      multiplier: res.dual[i],
      signOk,
      feature: featureKindOfRow(row, problem),
    };
  });
  const tightSupportIndices = res.x
    .map((v, i) => (cmp(v, ZERO) > 0 ? i : -1))
    .filter((i) => i >= 0);
  return {
    ...base,
    status: 'ok',
    witness: res.x,
    witnessCheck,
    dual: res.dual,
    dualCheck,
    dualRows,
    tightSupportIndices,
  };
}

// ---------------------------------------------------------------------------
// Continuous support: exact piecewise supremum of the Lagrangian

function objectiveAt(metric: Metric, target: CompiledTarget, x: Rat, side: Side): Rat {
  if (metric === 'tail') {
    if (eq(x, target.threshold)) {
      if (side === 'left') return ZERO;
      if (side === 'right') return ONE;
      return target.input.strictTail ? ZERO : ONE;
    }
    const inside =
      cmp(x, target.threshold) > 0 ||
      (!target.input.strictTail && cmp(x, target.threshold) === 0);
    return inside ? ONE : ZERO;
  }
  return cmp(x, target.threshold) > 0 ? sub(x, target.threshold) : ZERO;
}

interface SupResult {
  value: Rat;
  x: Rat;
  side: Side;
  checked: number;
}

/**
 * Exact supremum over the whole support interval of
 *     g(x) + Σ w_i a_i(x) − μ0.
 * The term is piecewise: a quadratic on each open interval between
 * breakpoints, with one-sided values at the breakpoints. Vertices of concave
 * pieces are checked exactly in addition to every breakpoint limit.
 */
export function lagrangianSup(
  problem: CompiledProblem,
  target: CompiledTarget,
  metric: Metric,
  infos: RowInfo[],
  mu0: Rat,
  sign: 1 | -1 = 1,
): SupResult {
  const lo = problem.supportLo!;
  const hi = problem.supportHi!;
  const bps = lagrangianBreakpoints(problem, target);
  let best: SupResult | null = null;
  let checked = 0;
  const consider = (x: Rat, side: Side, value: Rat) => {
    checked++;
    if (!best || cmp(value, best.value) > 0) best = { value, x, side, checked: 0 };
  };
  const evalAt = (x: Rat, side: Side) => {
    const value = hAt(metric, target, infos, mu0, x, side, sign);
    consider(x, side, value);
  };
  for (const bp of bps) {
    evalAt(bp, 'at');
    if (cmp(bp, lo) > 0) evalAt(bp, 'left');
    if (cmp(bp, hi) < 0) evalAt(bp, 'right');
  }
  // The points we test are a finite set X of candidate maximisers. Since h is
  // continuous on each open piece and its pieces are quadratics, testing every
  // breakpoint limit and the exact vertex of each concave piece is exhaustive.
  //
  // [Completeness check] On an open interval between consecutive breakpoints,
  // every count feature and the tail indicator are constant, so
  //     h(x) = c2 x² + c1 x + c0
  // exactly. A quadratic attains its supremum on a closed interval at an
  // endpoint or at its vertex; endpoints are covered by the one-sided limits
  // above, and the vertex (if inside) is tested here. If c2 = 0 the function is
  // linear and its supremum is at an endpoint. Therefore no maximiser is
  // missed, which is what makes this an outward bound rather than a sampled
  // one.
  for (let k = 0; k + 1 < bps.length; k++) {
    const u = bps[k];
    const v = bps[k + 1];
    if (cmp(u, v) >= 0) continue;
    const mid = div(add(u, v), rat(2));
    let c2 = ZERO;
    let c1 = ZERO;
    let c0 = neg(mu0);
    for (const info of infos) {
      const w = info.weight ?? ZERO;
      if (isZero(w)) continue;
      const negW = neg(w);
      if (info.feature === 'second') c2 = add(c2, negW);
      else if (info.feature === 'mean') c1 = add(c1, negW);
      else if (info.feature === 'count' && info.bin) {
        if (featureAt(info, mid, 'at').n === 1n) c0 = add(c0, negW);
      } else if (info.feature === 'mass') {
        c0 = add(c0, mul(negW, featureAt(info, mid, 'at')));
      }
    }
    // Objective on this open interval (scaled by `sign`).
    if (metric === 'tail') {
      if (cmp(mid, target.threshold) > 0 || (!target.input.strictTail && eq(mid, target.threshold))) {
        c0 = add(c0, rat(sign));
      }
    } else if (cmp(mid, target.threshold) > 0) {
      c1 = add(c1, rat(sign));
      c0 = sub(c0, mul(rat(sign), target.threshold));
    }
    if (cmp(c2, ZERO) < 0) {
      const xv = div(neg(c1), mul(rat(2), c2));
      if (cmp(xv, u) > 0 && cmp(xv, v) < 0) {
        const val = add(add(mul(c2, mul(xv, xv)), mul(c1, xv)), c0);
        consider(xv, 'at', val);
      }
    }
  }
  const result = best ?? { value: ZERO, x: lo, side: 'at' as Side, checked };
  return { ...result, checked };
}

function hAt(
  metric: Metric,
  target: CompiledTarget,
  infos: RowInfo[],
  mu0: Rat,
  x: Rat,
  side: Side,
  sign: 1 | -1,
): Rat {
  // h(x) = g(x) − Σ w_i a_i(x) − μ, the pointwise Lagrangian slack.
  let h = sub(scale(sign, objectiveAt(metric, target, x, side)), mu0);
  for (const info of infos) {
    const w = info.weight ?? ZERO;
    if (isZero(w)) continue;
    h = sub(h, mul(w, featureAt(info, x, side)));
  }
  return h;
}

function scale(sign: 1 | -1, x: Rat): Rat {
  return sign === 1 ? x : neg(x);
}

function lagrangianBreakpoints(problem: CompiledProblem, target: CompiledTarget): Rat[] {
  const lo = problem.supportLo!;
  const hi = problem.supportHi!;
  const set = new Map<string, Rat>();
  const push = (x: Rat) => {
    if (cmp(x, lo) < 0 || cmp(x, hi) > 0) return;
    set.set(`${x.n}/${x.d}`, x);
  };
  push(lo);
  push(hi);
  push(target.threshold);
  for (const s of problem.summaries) {
    if (s.bin) {
      push(s.bin.lo);
      push(s.bin.hi);
    }
  }
  return [...set.values()].sort(cmp);
}

function sampleSet(problem: CompiledProblem, target: CompiledTarget): { x: Rat; side: Side }[] {
  const bps = lagrangianBreakpoints(problem, target);
  const lo = problem.supportLo!;
  const hi = problem.supportHi!;
  const out: { x: Rat; side: Side }[] = [];
  const pushSample = (x: Rat, side: Side) => {
    if (cmp(x, lo) < 0 || cmp(x, hi) > 0) return;
    out.push({ x, side });
  };
  bps.forEach((bp, i) => {
    pushSample(bp, 'at');
    pushSample(bp, 'left');
    pushSample(bp, 'right');
    if (i + 1 < bps.length) {
      const next = bps[i + 1];
      const width = sub(next, bp);
      pushSample(add(bp, div(width, rat(4))), 'at');
      pushSample(div(add(bp, next), rat(2)), 'at');
      pushSample(sub(next, div(width, rat(4))), 'at');
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Continuous dual LP (cutting planes) over the dual weights

function continuousDualLP(
  _problem: CompiledProblem,
  target: CompiledTarget,
  metric: Metric,
  infos: RowInfo[],
  samples: { x: Rat; side: Side }[],
  sign: 1 | -1,
): { weights: Rat[]; mu0: Rat; z: Rat; iterations: number } | null {
  // Variable layout: for each row either one signed weight or a free
  // difference (w⁺ − w⁻); then mu = mu⁺ − mu⁻ and z = z⁺ − z⁻ (free).
  // The dual has the OPPOSITE orientation of the primal: "<=" row => w <= 0.
  const defs: { kind: 'w' | 'mu' | 'z'; infoIndex?: number; mult: 1 | -1 }[] = [];
  infos.forEach((info, i) => {
    const rel = info.row.rel;
    if (rel === '=') {
      defs.push({ kind: 'w', infoIndex: i, mult: 1 });
      defs.push({ kind: 'w', infoIndex: i, mult: -1 });
    } else if (rel === '<=') {
      defs.push({ kind: 'w', infoIndex: i, mult: 1 }); // w >= 0
    } else {
      defs.push({ kind: 'w', infoIndex: i, mult: -1 }); // w <= 0
    }
  });
  defs.push({ kind: 'mu', mult: 1 });
  defs.push({ kind: 'mu', mult: -1 });
  defs.push({ kind: 'z', mult: 1 });
  defs.push({ kind: 'z', mult: -1 });
  const nv = defs.length;
  // Pointwise constraint (max form):
  //     mu + Σ w_i a_i(x) + z >= g(x)   for every sampled x.
  const lpRows: LpRow[] = samples.map((s, idx) => {
    const a: Rat[] = new Array(nv).fill(ZERO);
    for (let v = 0; v < nv; v++) {
      const d = defs[v];
      if (d.kind === 'w') a[v] = mul(rat(d.mult), featureAt(infos[d.infoIndex!], s.x, s.side));
      else a[v] = rat(d.mult);
    }
    return { a, rel: '>=' as const, b: scale(sign, objectiveAt(metric, target, s.x, s.side)), key: `sample:${idx}` };
  });
  // min mu − Σ b_i w_i + z
  const c: Rat[] = defs.map((d) => {
    if (d.kind === 'w') {
      const info = infos[d.infoIndex!];
      return mul(rat(d.mult), info.row.b);
    }
    return rat(d.mult);
  });
  const res = solveMin(c, lpRows);
  if (res.status !== 'optimal') return null;
  const weights = new Array(infos.length).fill(ZERO);
  let mu0 = ZERO;
  let z = ZERO;
  defs.forEach((d, v) => {
    const val = res.x[v];
    if (isZero(val)) return;
    if (d.kind === 'w') weights[d.infoIndex!] = add(weights[d.infoIndex!], mul(rat(d.mult), val));
    else if (d.kind === 'mu') mu0 = add(mu0, mul(rat(d.mult), val));
    else z = add(z, mul(rat(d.mult), val));
  });
  return { weights, mu0, z, iterations: res.iterations };
}

/**
 * Outer bound for a MAXIMISATION of `metric`.
 *
 * Claim: for any distribution P supported in [lo, hi] satisfying Σ w_i a_i(P) = b·w,
 *     E_P[g] <= mu0 + b·w + sup_x h(x),   h(x) = g(x) + Σ w_i a_i(x) − μ0,
 * provided the multiplier orientation is dual-feasible. Proof: g(x) <= h(x) + μ0 − Σ w_i a_i(x)
 * pointwise, so integrating gives E_P[g] <= sup h + μ0 − Σ w_i E_P[a_i] = sup h + μ0 − b·w;
 * the identity is what we evaluate. `sup h` is computed exactly (piecewise
 * quadratic), so the resulting number is valid for every continuous
 * distribution, not just the sampled grid. The cutting-plane LP minimises
 * mu0 − b·w + z with z >= h(x) at samples; the returned certificate is then
 * re-validated by the exact sup before being used.
 */
export function continuousUpperBound(
  problem: CompiledProblem,
  target: CompiledTarget,
  metric: Metric,
  infos: RowInfo[],
  sign: 1 | -1 = 1,
): { cert: ContinuousCertificate; iterations: number } {
  const lo = problem.supportLo!;
  const hi = problem.supportHi!;
  const eps = div(sub(hi, lo), rat(1_000_000));
  // Probability distributions satisfy ΣP = 1 automatically, so the unit-mass
  // row is not part of the continuous Lagrangian relaxation.
  const relInfos = infos.filter((info) => info.row.key !== 'unit-mass');
  let samples = sampleSet(problem, target);
  let best: ContinuousCertificate | null = null;
  let iterations = 0;
  for (let it = 0; it < 15; it++) {
    const sol = continuousDualLP(problem, target, metric, relInfos, samples, sign);
    iterations++;
    if (!sol) break;
    const weightedInfos: RowInfo[] = relInfos.map((info, i) => ({ ...info, weight: sol.weights[i] }));
    const sup = lagrangianSup(problem, target, metric, weightedInfos, sol.mu0, sign);
    let bDotW = ZERO;
    for (let i = 0; i < weightedInfos.length; i++) {
      const w = weightedInfos[i].weight ?? ZERO;
      if (!isZero(w)) bDotW = add(bDotW, mul(w, weightedInfos[i].row.b));
    }
    // ∫g dP = μ + b·w + ∫h dP ≤ μ + b·w + sup h.
    const bound = add(add(sol.mu0, bDotW), sup.value);
    const signOk = weightedInfos.every((info) => {
      if (info.row.rel === '=') return true;
      const w = info.weight ?? ZERO;
      return info.row.rel === '<=' ? cmp(w, ZERO) >= 0 : cmp(w, ZERO) <= 0;
    });
    if (!signOk) break;
    const cert: ContinuousCertificate = {
      valid: true,
      weights: weightedInfos.map((info) => info.weight ?? ZERO),
      mu0: sol.mu0,
      bound,
      supValue: sup.value,
      supPoint: sup.x,
      supSide: sup.side,
      checkedPoints: sup.checked,
      cutIterations: it + 1,
      samples: samples.length,
      signOk,
      rows: weightedInfos.map((info) => ({
        key: info.row.key,
        label: rowLabel(info.row),
        rel: info.row.rel,
        bound: info.row.b,
        multiplier: info.weight ?? ZERO,
        signOk:
          info.row.rel === '='
            ? true
            : info.row.rel === '<='
              ? cmp(info.weight ?? ZERO, ZERO) >= 0
              : cmp(info.weight ?? ZERO, ZERO) <= 0,
        feature: info.feature,
      })),
      hAtSup: sub(sup.value, sol.mu0),
      dualObjective: add(add(sol.mu0, bDotW), sol.z),
    };
    if (!best || cmp(cert.bound, best.bound) < 0) best = cert;
    if (cmp(sup.value, sol.z) <= 0) break;
    let nx = sup.x;
    if (sup.side === 'left') nx = sub(sup.x, eps);
    else if (sup.side === 'right') nx = add(sup.x, eps);
    if (cmp(nx, lo) < 0) nx = lo;
    if (cmp(nx, hi) > 0) nx = hi;
    samples = [...samples, { x: nx, side: 'at' }];
  }
  return {
    cert:
      best ?? {
        valid: true,
        weights: relInfos.map(() => ZERO),
        mu0: ZERO,
        bound: metric === 'tail' ? ONE : max2(ZERO, sub(hi, target.threshold)),
        supValue: metric === 'tail' ? ONE : max2(ZERO, sub(hi, target.threshold)),
        supPoint: hi,
        supSide: 'at',
        checkedPoints: 0,
        cutIterations: 0,
        samples: 0,
        signOk: true,
        rows: [],
        hAtSup: ZERO,
        dualObjective: ZERO,
      },
    iterations,
  };
}

function gridSolve(
  problem: CompiledProblem,
  target: CompiledTarget,
  metric: Metric,
  direction: Direction,
  points: Rat[],
): { status: string; value: Rat; witness?: Rat[] } {
  const rows = buildBaseRows(problem, points);
  const c = objectiveFor(problem, target, metric, points);
  const res = direction === 'max' ? solveMax(c, rows) : solveMin(c, rows);
  return { status: res.status, value: res.value, witness: res.status === 'optimal' ? res.x : undefined };
}

function continuousBound(
  problem: CompiledProblem,
  target: CompiledTarget,
  metric: Metric,
  direction: Direction,
  infos: RowInfo[],
): ContinuousBound {
  const objectiveLabel = metricLabel(metric, target);
  // max g <= UB(g);  min g >= −UB(−g).
  const sign: 1 | -1 = direction === 'max' ? 1 : -1;
  const upper = continuousUpperBound(problem, target, metric, infos, sign);
  const outer = direction === 'max' ? upper.cert.bound : neg(upper.cert.bound);
  const points = problem.breakpoints ?? [];
  const grid = gridSolve(problem, target, metric, direction, points);
  let inner: Rat | null = grid.status === 'optimal' ? grid.value : null;
  let innerKind: 'attainable' | 'trivial' = 'attainable';
  if (inner === null) {
    innerKind = 'trivial';
    inner =
      direction === 'max'
        ? ZERO
        : metric === 'tail'
          ? ONE
          : max2(ZERO, sub(problem.supportHi!, target.threshold));
  }
  const gap = direction === 'max' ? sub(outer, inner) : sub(inner, outer);
  const exact = isZero(gap);
  // Independent re-check of the attaining distribution, exactly as for finite
  // mode: this vector is a genuine distribution on the breakpoints, hence a
  // legitimate continuous distribution.
  const innerWitness = grid.status === 'optimal' ? grid.witness : undefined;
  const innerWitnessCheck =
    innerWitness && inner !== null
      ? verifyWitness(
          objectiveFor(problem, target, metric, points),
          buildBaseRows(problem, points),
          innerWitness,
          inner,
          true,
        )
      : undefined;
  return {
    mode: 'continuous',
    targetId: target.input.id,
    targetLabel: target.label,
    threshold: target.threshold,
    metric,
    direction,
    status: grid.status === 'optimal' ? 'ok' : 'undecided',
    outer,
    inner,
    innerKind,
    gap: cmp(gap, ZERO) < 0 ? ZERO : gap,
    exact,
    objectiveLabel,
    certificate: upper.cert,
    innerWitness,
    innerWitnessCheck,
    gridSolution: inner,
    gridDerivation:
      grid.status === 'optimal'
        ? '断点支撑上的精确 LP 解；该概率向量本身对应一个合法的连续分布，因此是可达见证。'
        : '断点支撑上不存在可行离散分布，故没有可达内界；内界退化为平凡值并明确标注。',
    iterations: upper.iterations,
    message: exact
      ? '外逼近界与可达内界完全一致：该连续最优已被此对证明。'
      : '外逼近界覆盖所有连续分布；间隙是显式离散化松弛，不宣称任何网格解为连续最优。',
  };
}

// ---------------------------------------------------------------------------
// Diagnostics / IIS

export function groupRows(problem: CompiledProblem, rows: LpRow[], extraGroups: ConflictGroup[] = []): ConflictGroup[] {
  const groups: ConflictGroup[] = [];
  for (const s of problem.summaries) {
    const rs = rows.filter((r) => r.summaryId === s.input.id);
    if (rs.length === 0) continue;
    groups.push({ id: s.input.id, label: `摘要：${s.label} ${s.interval.derivation}`, rows: rs, kind: 'summary' });
  }
  const unit = rows.filter((r) => r.key === 'unit-mass');
  groups.push({ id: 'unit-mass', label: '总质量 Σp = 1', rows: unit, kind: 'unit' });
  for (const extra of extraGroups) groups.push(extra);
  return groups;
}

export function flatten(groups: ConflictGroup[]): LpRow[] {
  return groups.flatMap((g) => g.rows);
}

export function isFeasible(n: number, rows: LpRow[]): { feasible: boolean; witness?: Rat[]; iterations: number; status: string } {
  const res = solveMax(new Array(n).fill(ZERO), rows);
  return {
    feasible: res.status === 'optimal',
    witness: res.status === 'optimal' ? res.x : undefined,
    iterations: res.iterations,
    status: res.status,
  };
}

/**
 * Deletion-filter IIS over whole summary groups. A group is either one source
 * summary (all of its rows together) or the unit-mass constraint. We never
 * remove a single endpoint row: a rounded summary is one atomic claim.
 */
export function findIIS(n: number, groups: ConflictGroup[]): InfeasibilityReport {
  const full = isFeasible(n, flatten(groups));
  if (full.feasible) return { status: 'feasible', message: '全部约束可行。' };
  if (full.status === 'limit') {
    return { status: 'undecided', message: '单纯形迭代上限，未能判定可行性。' };
  }
  let active = groups.slice();
  for (const g of groups) {
    const trial = active.filter((x) => x.id !== g.id);
    if (trial.length === 0) continue;
    if (!isFeasible(n, flatten(trial)).feasible) active = trial;
  }
  const dropWitnesses = active.map((g) => {
    // Two different questions, both worth answering:
    //  - the conflict set without this item: must be feasible, else `active`
    //    was not minimal (this is the definition of an IIS);
    //  - the whole model without this item: says whether the conflict we found
    //    is the only one. It can legitimately be infeasible, and that is not a
    //    failure of minimality — it means another conflict exists elsewhere.
    const inConflict = isFeasible(n, flatten(active.filter((x) => x.id !== g.id)));
    const whole = isFeasible(n, flatten(groups.filter((x) => x.id !== g.id)));
    return {
      droppedId: g.id,
      droppedLabel: g.label,
      minimalityFeasible: inConflict.feasible,
      feasible: whole.feasible,
      witness: whole.witness,
    };
  });
  const minimal = dropWitnesses.every((d) => d.minimalityFeasible);
  const singleConflict = dropWitnesses.every((d) => d.feasible);
  return {
    status: 'infeasible',
    message: minimal
      ? singleConflict
        ? '摘要约束互相矛盾。下表给出的最小冲突集合：删除其中任何一项，其余全部约束都会重新可行。原始摘要未被修改，也没有被放松。'
        : '摘要约束互相矛盾。下表给出的最小冲突集合本身已复核为最小；但删除其中某些项后整体仍不可行，说明还存在另一处独立冲突。原始摘要未被修改，也没有被放松。'
      : '摘要约束互相矛盾。删除过滤得到的集合未通过最小性复核（这不应发生）；请勿采信下表。',
    conflict: {
      groups: active.map((g) => ({ id: g.id, label: g.label, kind: g.kind })),
      dropWitnesses,
    },
  };
}

// ---------------------------------------------------------------------------
// Joint attainability

function objectiveRow(
  target: CompiledTarget,
  metric: Metric,
  points: Rat[],
  value: Rat,
  id: string,
): LpRow {
  return {
    a: metric === 'tail' ? objectiveTail(points, target.threshold, target.input.strictTail) : objectiveLoss(points, target.threshold),
    rel: '=',
    b: value,
    key: `bound:${id}`,
    summaryId: undefined,
    label: `${target.label} · ${metric === 'tail' ? '尾部比例' : '截断损失'} = ${toDecimalString(value, 8)}`,
    endpoint: 'norm',
  };
}

export function jointCheck(
  problem: CompiledProblem,
  analysis: AnalysisResult,
  items: JointCheckItem[],
): JointCheckResult {
  const bounded = items
    .map((it) => {
      const b = analysis.bounds.find(
        (x) => x.targetId === it.targetId && x.metric === it.metric && x.direction === it.direction,
      );
      return b ? { it, b } : null;
    })
    .filter((x): x is { it: JointCheckItem; b: Bound } => !!x);
  const displayItems = bounded.map(({ b }) => ({
    targetId: b.targetId,
    targetLabel: b.targetLabel,
    metric: b.metric,
    direction: b.direction,
    bound: b.mode === 'finite' ? b.value : b.outer,
  }));
  const pts = analysis.supportValues;
  const extraGroups: ConflictGroup[] = bounded.map(({ b }) => {
    const value = b.mode === 'finite' ? b.value : b.outer;
    const t = findTarget(problem, b.targetId)!;
    return {
      id: `sel:${b.targetId}:${b.metric}:${b.direction}`,
      label: `所选界：${b.targetLabel} · ${b.metric === 'tail' ? '尾部比例' : '截断损失'} ${b.direction === 'min' ? '下界' : '上界'} = ${toDecimalString(value, 8)}`,
      rows: [objectiveRow(t, b.metric, pts, value, `${b.targetId}:${b.metric}:${b.direction}`)],
      kind: 'bound' as const,
    };
  });
  const groups = [...groupRows(problem, buildBaseRows(problem, pts)), ...extraGroups];
  // Selecting both bounds of the SAME quantity asks for two different values
  // at once. That is a definitional contradiction in the request, not a
  // conflict among the summaries, so it gets its own explanation instead of a
  // bogus "minimal conflict set" naming only the two selected rows.
  const boundValues = new Map<string, { label: string; min: Rat; max: Rat }>();
  for (const { b } of bounded) {
    const k = `${b.targetId}|${b.metric}`;
    const value = b.mode === 'finite' ? b.value : b.outer;
    const g = boundValues.get(k);
    if (!g) {
      boundValues.set(k, {
        label: `${b.targetLabel} · ${b.metric === 'tail' ? '尾部比例' : '截断损失'}`,
        min: value,
        max: value,
      });
    } else if (cmp(value, g.min) < 0) g.min = value;
    else if (cmp(value, g.max) > 0) g.max = value;
  }
  const contradictory = [...boundValues.values()].filter((g) => cmp(g.min, g.max) !== 0);
  if (contradictory.length > 0) {
    return {
      id: newId('joint'),
      createdAt: new Date().toISOString(),
      mode: analysis.finiteMode ? 'finite' : 'continuous',
      items: displayItems,
      status: 'not-attainable',
      message: `所选界本身互相排斥：${contradictory
        .map((g) => `${g.label} 要求同时等于 ${toDecimalString(g.min, 8)} 和 ${toDecimalString(g.max, 8)}`)
        .join('；')}。这不是摘要之间的矛盾，也没有分布能做到——请只选单个方向，或分别检查下界与上界。`,
      gridNote:
        '下界与上界衡量同一个量在同一份摘要上的两个极端，它们一般由不同分布达到，本来就不应同时选取。',
    };
  }
  const rows = flatten(groups);
  const feas = isFeasible(pts.length, rows);
  if (feas.feasible) {
    const witnessChecks = bounded.map(({ b }) => {
      const t = findTarget(problem, b.targetId)!;
      const c = objectiveFor(problem, t, b.metric, pts);
      const val = dot(c, feas.witness!);
      const targetVal = b.mode === 'finite' ? b.value : b.outer;
      return {
        label: `${b.targetLabel} · ${b.metric === 'tail' ? '尾部比例' : '截断损失'}`,
        ok: eq(val, targetVal),
        value: val,
      };
    });
    return {
      id: newId('joint'),
      createdAt: new Date().toISOString(),
      mode: analysis.finiteMode ? 'finite' : 'continuous',
      items: displayItems,
      status: 'attainable',
      message: analysis.finiteMode
        ? '存在同一个分布同时达到所选的全部界。下方给出可核验的概率质量向量。'
        : '断点支撑上存在同一个真实分布同时达到所选全部界；该分布也是合法的连续分布，因此联合可达性已证。',
      witness: feas.witness,
      witnessChecks,
      gridNote: analysis.finiteMode ? undefined : '该结论来自断点支撑上的真实分布，不是网格近似最优声明。',
    };
  }
  if (!analysis.finiteMode) {
    return {
      id: newId('joint'),
      createdAt: new Date().toISOString(),
      mode: 'continuous',
      items: displayItems,
      status: 'undecided',
      message:
        '在断点支撑上无法同时达到所选全部界。这不构成连续情形不可行的证明；请增大网格或参考各界的对偶证据。',
      gridNote: '连续模式下联合不可行性的严格证明需要额外的对偶论证，当前未给出。',
    };
  }
  const report = findIIS(pts.length, groups);
  // Independent check of the reported conflict, answering both questions:
  //  - is the conflict set minimal (each one-dropped subset feasible)?
  //  - is dropping an item enough to fix the whole model, or is there a second
  //    conflict elsewhere?
  let resolution: JointCheckResult['resolution'];
  if (report.conflict) {
    const byId = new Map(groups.map((g) => [g.id, g]));
    const conflictGroups = report.conflict.groups
      .map((g) => byId.get(g.id))
      .filter((g): g is ConflictGroup => !!g);
    resolution = {
      conflictReproduced: !isFeasible(pts.length, flatten(conflictGroups)).feasible,
      dropChecks: conflictGroups.map((g) => {
        const key = `${g.kind === 'bound' ? '界' : g.kind === 'unit' ? '总质量' : '摘要'}｜${g.label}`;
        return {
          key,
          label: g.label,
          minimalityFeasible: isFeasible(
            pts.length,
            flatten(conflictGroups.filter((x) => x.id !== g.id)),
          ).feasible,
          feasible: isFeasible(
            pts.length,
            flatten(groups.filter((x) => x.id !== g.id)),
          ).feasible,
        };
      }),
    };
  }
  return {
    id: newId('joint'),
    createdAt: new Date().toISOString(),
    mode: 'finite',
    items: displayItems,
    status: 'not-attainable',
    message: '不存在同一个分布同时达到所选全部界。最小冲突集合如下（也包含摘要约束）。',
    conflict: report.conflict,
    resolution,
  };
}

function findTarget(problem: CompiledProblem, id: string): CompiledTarget | undefined {
  return problem.targets.find((t) => t.input.id === id);
}

function dot(a: Rat[], b: Rat[]): Rat {
  let s = ZERO;
  for (let i = 0; i < a.length; i++) s = add(s, mul(a[i], b[i]));
  return s;
}

// ---------------------------------------------------------------------------
// Independent brute-force vertex enumeration (small finite supports)

export function bruteForceCheck(
  problem: CompiledProblem,
  baseRows: LpRow[],
  objectives: { label: string; c: Rat[] }[],
): BruteForceReport {
  const n = problem.values.length;
  if (n > 5) {
    return { available: false, reason: '支持集超过 5 个取值，枚举核对组合过多。', verticesChecked: 0, objectives: [], combinations: 0 };
  }
  const ineq: { a: Rat[]; b: Rat }[] = [];
  for (const r of baseRows) {
    if (r.rel === '<=') ineq.push({ a: r.a, b: r.b });
    else if (r.rel === '>=') ineq.push({ a: r.a.map(neg), b: neg(r.b) });
    else {
      ineq.push({ a: r.a, b: r.b });
      ineq.push({ a: r.a.map(neg), b: neg(r.b) });
    }
  }
  for (let j = 0; j < n; j++) {
    ineq.push({ a: Array.from({ length: n }, (_, k) => (k === j ? neg(ONE) : ZERO)), b: ZERO });
  }
  const combos = chooseCount(ineq.length, n);
  if (combos > 60000) {
    return { available: false, reason: `枚举需要检查 ${combos} 个组合，超出交互式上限。`, verticesChecked: 0, objectives: [], combinations: combos };
  }
  const vertices: Rat[][] = [];
  for (const combo of combinations(ineq.length, n)) {
    const M = combo.map((idx) => ineq[idx].a.slice());
    const sol = gaussSolve(M, combo.map((idx) => ineq[idx].b));
    if (!sol) continue;
    let feasible = true;
    for (const r of ineq) {
      if (cmp(dot(r.a, sol), r.b) > 0) {
        feasible = false;
        break;
      }
    }
    if (feasible) vertices.push(sol);
  }
  const out = objectives.map(({ label, c }) => {
    if (vertices.length === 0) return { label, matches: false };
    let mn = dot(c, vertices[0]);
    let mx = mn;
    for (const v of vertices) {
      const val = dot(c, v);
      if (cmp(val, mn) < 0) mn = val;
      if (cmp(val, mx) > 0) mx = val;
    }
    return { label, min: mn, max: mx, matches: true };
  });
  return {
    available: true,
    reason: `独立枚举了 ${vertices.length} 个可行顶点（组合空间 ${combos}）。`,
    verticesChecked: vertices.length,
    objectives: out,
    combinations: combos,
  };
}

function chooseCount(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

function* combinations(n: number, k: number): Generator<number[]> {
  const cur: number[] = [];
  function* rec(start: number): Generator<number[]> {
    if (cur.length === k) {
      yield cur.slice();
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      yield* rec(i + 1);
      cur.pop();
    }
  }
  yield* rec(0);
}

function gaussSolve(A: Rat[][], b: Rat[]): Rat[] | null {
  const n = A.length;
  const M = A.map((rowA, i) => [...rowA, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = -1;
    for (let i = col; i < n; i++) if (!isZero(M[i][col])) { piv = i; break; }
    if (piv < 0) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] = div(M[col][j], p);
    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const f = M[i][col];
      if (isZero(f)) continue;
      for (let j = col; j <= n; j++) M[i][j] = sub(M[i][j], mul(f, M[col][j]));
    }
  }
  return M.map((rowA) => rowA[n]);
}

// ---------------------------------------------------------------------------
// Top-level analysis

export function analyze(problem: CompiledProblem): AnalysisResult {
  const finiteMode = problem.mode === 'finite';
  const rows = buildBaseRows(problem);
  const points = finiteMode ? problem.values : problem.breakpoints ?? [];
  const infos = rowInfos(problem, rows);
  const inputOk = problem.issues.every((i) => i.severity !== 'error');
  let feasibility: InfeasibilityReport = {
    status: 'undecided',
    message: '存在输入错误，先修正摘要后再做可行性诊断。',
  };
  if (inputOk && points.length > 0) {
    feasibility = findIIS(points.length, groupRows(problem, rows));
  }
  const bounds: Bound[] = [];
  const canCompute = inputOk && feasibility.status !== 'infeasible' && points.length > 0;
  if (canCompute) {
    for (const target of problem.targets) {
      for (const metric of ['tail', 'loss'] as Metric[]) {
        const wantMin = metric === 'tail' ? target.input.wantTailMin : target.input.wantLossMin;
        const wantMax = metric === 'tail' ? target.input.wantTailMax : target.input.wantLossMax;
        if (!wantMin && !wantMax) continue;
        if (finiteMode) {
          if (wantMin) bounds.push(finiteSolve(problem, target, metric, 'min', rows));
          if (wantMax) bounds.push(finiteSolve(problem, target, metric, 'max', rows));
        } else {
          if (wantMin) bounds.push(continuousBound(problem, target, metric, 'min', infos));
          if (wantMax) bounds.push(continuousBound(problem, target, metric, 'max', infos));
        }
      }
    }
  }

  const pairCompatibility: PairCompatibility[] = [];
  if (finiteMode && feasibility.status === 'feasible') {
    const okBounds = bounds.filter((b): b is FiniteBound => b.mode === 'finite' && b.status === 'ok');
    for (let i = 0; i < okBounds.length; i++) {
      for (let j = i + 1; j < okBounds.length; j++) {
        const a = okBounds[i];
        const b = okBounds[j];
        // The lower and upper bounds of the same quantity can only coincide if
        // they are equal, so that pair carries no information. Pair checks are
        // meant to surface less obvious incompatibilities between different
        // thresholds or different metrics.
        if (a.targetId === b.targetId && a.metric === b.metric) continue;
        const ta = findTarget(problem, a.targetId)!;
        const tb = findTarget(problem, b.targetId)!;
        const rows2 = [
          ...rows,
          objectiveRow(ta, a.metric, points, a.value, `pair:${i}`),
          objectiveRow(tb, b.metric, points, b.value, `pair:${j}`),
        ];
        pairCompatibility.push({
          a: `${a.targetId}|${a.metric}|${a.direction}`,
          b: `${b.targetId}|${b.metric}|${b.direction}`,
          status: isFeasible(points.length, rows2).feasible ? 'yes' : 'no',
        });
      }
    }
  }

  let bruteForce: BruteForceReport | undefined;
  if (finiteMode && feasibility.status === 'feasible' && points.length <= 5) {
    const objectives = problem.targets.flatMap((t) =>
      (['tail', 'loss'] as Metric[]).map((m) => ({
        label: `${t.label} · ${m === 'tail' ? '尾部比例' : '截断损失'}`,
        c: objectiveFor(problem, t, m, points),
      })),
    );
    bruteForce = bruteForceCheck(problem, rows, objectives);
  }

  const notes: string[] = [];
  if (!inputOk) notes.push('存在输入错误；本页不计算界，也不静默修正任何输入。');
  if (feasibility.status === 'infeasible') notes.push('摘要互相矛盾；未修改任何摘要，只报告最小冲突集合。');
  if (!finiteMode) {
    notes.push('连续模式：外逼近界对所有连续分布成立；内界来自断点支撑上的真实分布；两者之差是显式离散化间隙。');
  }

  return {
    engineVersion: ENGINE_VERSION,
    createdAt: new Date().toISOString(),
    problem,
    finiteMode,
    baseRows: rows,
    bounds,
    feasibility,
    assumptions: problem.assumptions,
    supportValues: points,
    supportTexts: finiteMode ? problem.valueTexts : points.map((p) => toDecimalString(p, 8)),
    pairCompatibility,
    bruteForce,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Persistence

export interface SerializedBound {
  targetId: string;
  targetLabel: string;
  threshold: string;
  metric: Metric;
  direction: Direction;
  status: string;
  objectiveLabel: string;
  value?: string;
  valueFraction?: string;
  witness?: string[];
  witnessOk?: boolean;
  dual?: string[];
  dualOk?: boolean;
  dualBound?: string;
  dualResidualMin?: string;
  dualRows?: { label: string; rel: string; bound: string; multiplier: string; signOk: boolean; feature: string }[];
  outer?: string;
  inner?: string | null;
  innerKind?: string;
  gap?: string;
  exact?: boolean;
  certificate?: {
    valid: boolean;
    signOk: boolean;
    bound: string;
    supValue: string;
    supPoint: string;
    supSide: string;
    checkedPoints: number;
    innerWitness?: string[];
    innerWitnessOk?: boolean;
    cutIterations: number;
    weights: { label: string; multiplier: string }[];
    mu0: string;
  };
  iterations: number;
  message?: string;
  tightSupportIndices?: number[];
}

export interface SavedAnalysis {
  id: string;
  name: string;
  savedAt: string;
  engineVersion: string;
  fingerprint: string;
  workspace: unknown;
  assumptions: string[];
  supportMode: string;
  support: string[];
  sampleSize: string;
  bounds: SerializedBound[];
  feasibility: unknown;
  /** Joint checks converted to plain JSON records (exact fractions as strings). */
  jointChecks: unknown[];
  issues: { severity: string; message: string; detail?: string }[];
  notes: string[];
}

export function serializeBound(b: Bound): SerializedBound {
  const out: SerializedBound = {
    targetId: b.targetId,
    targetLabel: b.targetLabel,
    threshold: toDecimalString(b.threshold, 10),
    metric: b.metric,
    direction: b.direction,
    status: b.status,
    objectiveLabel: b.objectiveLabel,
    iterations: b.iterations,
    message: b.message,
  };
  if (b.mode === 'finite') {
    out.value = toDecimalString(b.value, 10);
    out.valueFraction = toFraction(b.value);
    out.witness = b.witness?.map((v) => toFraction(v));
    out.witnessOk = b.witnessCheck?.ok;
    out.dual = b.dual?.map((v) => toFraction(v));
    out.dualOk = b.dualCheck?.ok;
    out.dualBound = b.dualCheck ? toFraction(b.dualCheck.bound) : undefined;
    out.dualResidualMin = b.dualCheck ? toFraction(b.dualCheck.pointwiseMinResidual) : undefined;
    out.dualRows = b.dualRows?.map((r) => ({
      label: r.label,
      rel: r.rel,
      bound: toFraction(r.bound),
      multiplier: toFraction(r.multiplier),
      signOk: r.signOk,
      feature: r.feature,
    }));
    out.tightSupportIndices = b.tightSupportIndices;
  } else {
    out.outer = toFraction(b.outer);
    out.inner = b.inner === null ? null : toFraction(b.inner);
    out.innerKind = b.innerKind;
    out.gap = toFraction(b.gap);
    out.exact = b.exact;
    if (b.gridSolution !== undefined) out.value = toFraction(b.gridSolution);
    out.certificate = {
      valid: b.certificate.valid,
      innerWitness: b.innerWitness?.map((v) => toFraction(v)),
      innerWitnessOk: b.innerWitnessCheck?.ok,
      signOk: b.certificate.signOk,
      bound: toFraction(b.certificate.bound),
      supValue: toFraction(b.certificate.supValue),
      supPoint: toFraction(b.certificate.supPoint),
      supSide: b.certificate.supSide,
      checkedPoints: b.certificate.checkedPoints,
      cutIterations: b.certificate.cutIterations,
      weights: b.certificate.weights.map((w, i) => ({
        label: b.certificate.rows[i]?.label ?? `row ${i}`,
        multiplier: toFraction(w),
      })),
      mu0: toFraction(b.certificate.mu0),
    };
  }
  return out;
}
