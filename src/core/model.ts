// Workspace model: raw source summaries, rounding intervals, compiled LP rows.
// Raw inputs are kept verbatim; derived intervals are computed without ever
// rewriting the user's numbers.

import {
  type Rat,
  ZERO,
  ONE,
  rat,
  add,
  mul,
  sub,
  cmp,
  eq,
  div,
  parseDecimal,
  toDecimalString,
  toFraction,
  neg,
} from './rational';
import type { LpRow } from './simplex';

export type BoundMode = 'exact' | 'rounded' | 'interval';
export type SummaryKind = 'mean' | 'second' | 'count';
export type SupportMode = 'finite' | 'continuous';

export interface NumberBoundInput {
  mode: BoundMode;
  /** Reported value for exact / rounded modes. */
  value: string;
  /** Rounding step for rounded mode, e.g. "0.1" or "10". */
  step: string;
  /** Direct interval for interval mode. */
  lo: string;
  hi: string;
}

export interface CountBin {
  lo: string;
  hi: string;
  loInclusive: boolean;
  hiInclusive: boolean;
}

export interface SummaryInput {
  id: string;
  kind: SummaryKind;
  enabled: boolean;
  label: string;
  bound: NumberBoundInput;
  countBin?: CountBin;
  note: string;
}

export interface TargetInput {
  id: string;
  label: string;
  threshold: string;
  /** true => tail is X > t, false => X >= t. */
  strictTail: boolean;
  wantTailMin: boolean;
  wantTailMax: boolean;
  wantLossMin: boolean;
  wantLossMax: boolean;
}

export interface FiniteSupportInput {
  mode: 'finite';
  values: string[];
}

export interface ContinuousSupportInput {
  mode: 'continuous';
  lo: string;
  hi: string;
  /** Number of uniform grid cells before extra breakpoints are inserted. */
  grid: number;
}

export type SupportInput = FiniteSupportInput | ContinuousSupportInput;

export interface JointSelection {
  targetId: string;
  metric: 'tail' | 'loss';
  direction: 'min' | 'max';
}

export interface Workspace {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sampleSize: string;
  support: SupportInput;
  summaries: SummaryInput[];
  targets: TargetInput[];
  jointSelection: JointSelection[];
  analystNotes: string;
}

export type IssueSeverity = 'error' | 'warning';

export interface ProblemIssue {
  id: string;
  severity: IssueSeverity;
  scope: 'support' | 'sample' | 'summary' | 'target' | 'general';
  relatedId?: string;
  message: string;
  detail?: string;
}

export interface CompiledInterval {
  lo: Rat;
  hi: Rat;
  exact: boolean;
  /** How the interval was obtained, e.g. "3.2 ± 0.05". */
  derivation: string;
  /** Decimal display of the raw inputs, unmodified. */
  raw: string;
}

export interface CompiledSummary {
  input: SummaryInput;
  interval: CompiledInterval;
  label: string;
  bin?: { lo: Rat; hi: Rat; loInclusive: boolean; hiInclusive: boolean };
}

export interface CompiledTarget {
  input: TargetInput;
  threshold: Rat;
  label: string;
}

export interface CompiledProblem {
  workspace: Workspace;
  mode: SupportMode;
  values: Rat[];
  valueTexts: string[];
  supportLo?: Rat;
  supportHi?: Rat;
  grid?: number;
  sampleSize: Rat;
  summaries: CompiledSummary[];
  targets: CompiledTarget[];
  issues: ProblemIssue[];
  assumptions: string[];
  /** Cell boundaries in continuous mode (including extra breakpoints). */
  breakpoints?: Rat[];
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function emptyBound(mode: BoundMode = 'rounded'): NumberBoundInput {
  return { mode, value: '', step: mode === 'rounded' ? '0.1' : '', lo: '', hi: '' };
}

export function makeSummary(kind: SummaryKind): SummaryInput {
  return {
    id: newId('sum'),
    kind,
    enabled: true,
    label: '',
    bound: emptyBound(kind === 'count' ? 'rounded' : 'exact'),
    countBin:
      kind === 'count'
        ? { lo: '', hi: '', loInclusive: true, hiInclusive: false }
        : undefined,
    note: '',
  };
}

export function makeTarget(index: number): TargetInput {
  return {
    id: newId('tgt'),
    label: `阈值 ${index}`,
    threshold: '',
    strictTail: false,
    wantTailMin: true,
    wantTailMax: true,
    wantLossMin: true,
    wantLossMax: true,
  };
}

export function defaultWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    id: newId('ws'),
    name: '未命名摘要',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sampleSize: '100',
    support: { mode: 'finite', values: ['0', '1', '2', '3', '5'] },
    summaries: [
      {
        ...makeSummary('mean'),
        label: '均值（源舍入到 0.1）',
        bound: { mode: 'rounded', value: '1.8', step: '0.1', lo: '', hi: '' },
      },
      {
        ...makeSummary('second'),
        label: '二阶矩（源舍入到 0.1）',
        bound: { mode: 'rounded', value: '6.0', step: '0.1', lo: '', hi: '' },
      },
    ],
    targets: [
      {
        ...makeTarget(1),
        label: '阈值 2.5',
        threshold: '2.5',
      },
    ],
    jointSelection: [],
    analystNotes: '',
  };
}

export function parseBound(
  input: NumberBoundInput,
  scopeLabel: string,
  issues: ProblemIssue[],
  relatedId: string,
): CompiledInterval | null {
  const push = (message: string, detail?: string) =>
    issues.push({
      id: newId('issue'),
      severity: 'error',
      scope: 'summary',
      relatedId,
      message: `${scopeLabel}：${message}`,
      detail,
    });

  if (input.mode === 'exact') {
    const v = parseDecimal(input.value);
    if (!v) {
      push('无法解析数值', `原始输入「${input.value}」`);
      return null;
    }
    return {
      lo: v,
      hi: v,
      exact: true,
      derivation: `精确值 ${toDecimalString(v, 10)}`,
      raw: input.value,
    };
  }
  if (input.mode === 'rounded') {
    const v = parseDecimal(input.value);
    const step = parseDecimal(input.step);
    if (!v) {
      push('无法解析舍入中心值', `原始输入「${input.value}」`);
      return null;
    }
    if (!step || cmp(step, ZERO) <= 0) {
      push('舍入步长必须为正数', `原始输入「${input.step}」`);
      return null;
    }
    const half = div(step, rat(2));
    const lo = sub(v, half);
    const hi = add(v, half);
    return {
      lo,
      hi,
      exact: false,
      derivation: `${input.value} ± ${toDecimalString(half, 10)} → [${toDecimalString(lo, 10)}, ${toDecimalString(hi, 10)}]`,
      raw: `${input.value} ± ${input.step}`,
    };
  }
  const lo = parseDecimal(input.lo);
  const hi = parseDecimal(input.hi);
  if (!lo || !hi) {
    push('区间端点无法解析', `原始输入 [${input.lo}, ${input.hi}]`);
    return null;
  }
  if (cmp(lo, hi) > 0) {
    push('区间下界大于上界；未做任何自动修正', `原始输入 [${input.lo}, ${input.hi}]`);
    return null;
  }
  return {
    lo,
    hi,
    exact: cmp(lo, hi) === 0,
    derivation: `直接区间 [${toDecimalString(lo, 10)}, ${toDecimalString(hi, 10)}]`,
    raw: `[${input.lo}, ${input.hi}]`,
  };
}

export function parseFiniteValues(values: string[]): {
  values: Rat[];
  texts: string[];
  issues: ProblemIssue[];
} {
  const issues: ProblemIssue[] = [];
  const parsed: { r: Rat; text: string }[] = [];
  values.forEach((text, idx) => {
    const r = parseDecimal(text);
    if (!r) {
      issues.push({
        id: newId('issue'),
        severity: 'error',
        scope: 'support',
        message: `第 ${idx + 1} 个取值「${text}」无法解析`,
      });
    } else {
      parsed.push({ r, text: text.trim() });
    }
  });
  if (parsed.length === 0) {
    issues.push({
      id: newId('issue'),
      severity: 'error',
      scope: 'support',
      message: '有限取值集合为空',
    });
  }
  const sorted = parsed.slice().sort((a, b) => cmp(a.r, b.r));
  for (let i = 1; i < sorted.length; i++) {
    if (eq(sorted[i - 1].r, sorted[i].r)) {
      issues.push({
        id: newId('issue'),
        severity: 'error',
        scope: 'support',
        message: `取值 ${sorted[i].text} 重复`,
        detail: '请删除重复取值；应用不会自动合并你给出的取值集合。',
      });
    }
  }
  if (sorted.length > 0 && parsed.length === values.length && issues.length === 0) {
    // fine
  }
  return {
    values: sorted.map((x) => x.r),
    texts: sorted.map((x) => (x.text === '' ? toDecimalString(x.r, 10) : x.text)),
    issues,
  };
}

function inBin(
  v: Rat,
  bin: { lo: Rat; hi: Rat; loInclusive: boolean; hiInclusive: boolean },
): boolean {
  const loOk = bin.loInclusive ? cmp(v, bin.lo) >= 0 : cmp(v, bin.lo) > 0;
  const hiOk = bin.hiInclusive ? cmp(v, bin.hi) <= 0 : cmp(v, bin.hi) < 0;
  return loOk && hiOk;
}

export function binMembershipLabel(bin: CountBin): string {
  const l = bin.loInclusive ? '[' : '(';
  const r = bin.hiInclusive ? ']' : ')';
  return `${l}${bin.lo}, ${bin.hi}${r}`;
}

export function compileWorkspace(ws: Workspace): CompiledProblem {
  const issues: ProblemIssue[] = [];
  const assumptions: string[] = [];
  const mode = ws.support.mode;

  const sampleSize = parseDecimal(ws.sampleSize);
  if (!sampleSize || cmp(sampleSize, ZERO) <= 0) {
    issues.push({
      id: newId('issue'),
      severity: 'error',
      scope: 'sample',
      message: '样本总量必须为正数',
      detail: `原始输入「${ws.sampleSize}」`,
    });
  }
  const N = sampleSize && cmp(sampleSize, ZERO) > 0 ? sampleSize : ONE;

  let values: Rat[] = [];
  let valueTexts: string[] = [];
  let supportLo: Rat | undefined;
  let supportHi: Rat | undefined;
  let grid: number | undefined;

  if (ws.support.mode === 'finite') {
    const parsed = parseFiniteValues(ws.support.values);
    values = parsed.values;
    valueTexts = parsed.texts;
    issues.push(...parsed.issues);
    assumptions.push('取值集合为给定的有限集合；集合外的取值为零质量，不补造微观记录。');
  } else {
    const lo = parseDecimal(ws.support.lo);
    const hi = parseDecimal(ws.support.hi);
    if (!lo || !hi) {
      issues.push({
        id: newId('issue'),
        severity: 'error',
        scope: 'support',
        message: '连续取值范围的端点无法解析',
        detail: `原始输入 [${ws.support.lo}, ${ws.support.hi}]`,
      });
    } else if (cmp(lo, hi) >= 0) {
      issues.push({
        id: newId('issue'),
        severity: 'error',
        scope: 'support',
        message: '连续取值范围必须满足下界 < 上界',
        detail: `原始输入 [${ws.support.lo}, ${ws.support.hi}]`,
      });
    } else {
      supportLo = lo;
      supportHi = hi;
    }
    grid = ws.support.grid;
    if (!Number.isInteger(grid) || grid < 2 || grid > 120) {
      issues.push({
        id: newId('issue'),
        severity: 'error',
        scope: 'support',
        message: '连续网格单元数必须是 2–120 的整数',
        detail: `原始输入「${ws.support.grid}」`,
      });
      grid = undefined;
    }
    assumptions.push(
      '连续取值位于给定闭区间内；结果来自分段常数包络 + 矩条件外逼近，是保守界而非严格连续最优。',
    );
    assumptions.push('连续模式不宣称任何网格质量向量对应真实连续分布，也不宣称界可达到。');
  }

  const summaries: CompiledSummary[] = [];
  const binsSoFar: { id: string; label: string; bin: NonNullable<CompiledSummary['bin']> }[] = [];

  ws.summaries.forEach((s, idx) => {
    if (!s.enabled) return;
    const fallbackLabel =
      s.kind === 'mean'
        ? `均值 #${idx + 1}`
        : s.kind === 'second'
          ? `二阶矩 #${idx + 1}`
          : `区间计数 #${idx + 1}`;
    const label = s.label.trim() || fallbackLabel;
    const interval = parseBound(s.bound, label, issues, s.id);
    if (!interval) return;
    let bin: CompiledSummary['bin'];
    if (s.kind === 'count') {
      const binLo = parseDecimal(s.countBin?.lo ?? '');
      const binHi = parseDecimal(s.countBin?.hi ?? '');
      if (!binLo || !binHi) {
        issues.push({
          id: newId('issue'),
          severity: 'error',
          scope: 'summary',
          relatedId: s.id,
          message: `${label}：计数区间端点无法解析`,
          detail: `原始输入 [${s.countBin?.lo ?? ''}, ${s.countBin?.hi ?? ''}]`,
        });
        return;
      }
      if (cmp(binLo, binHi) > 0 || (cmp(binLo, binHi) === 0 && s.countBin?.loInclusive !== s.countBin?.hiInclusive)) {
        issues.push({
          id: newId('issue'),
          severity: 'error',
          scope: 'summary',
          relatedId: s.id,
          message: `${label}：计数取值区间为空`,
          detail: `原始输入 ${binMembershipLabel(s.countBin!)}`,
        });
        return;
      }
      bin = {
        lo: binLo,
        hi: binHi,
        loInclusive: s.countBin?.loInclusive ?? true,
        hiInclusive: s.countBin?.hiInclusive ?? false,
      };
      if (cmp(interval.lo, ZERO) < 0) {
        issues.push({
          id: newId('issue'),
          severity: 'error',
          scope: 'summary',
          relatedId: s.id,
          message: `${label}：计数区间含负值`,
          detail: interval.derivation,
        });
        return;
      }
      if (cmp(interval.hi, N) > 0) {
        issues.push({
          id: newId('issue'),
          severity: 'warning',
          scope: 'summary',
          relatedId: s.id,
          message: `${label}：计数上界超过样本总量 N；求解时会暴露不可行，不会自动截断`,
          detail: `${interval.derivation}；N=${toDecimalString(N, 10)}`,
        });
      }
      for (const other of binsSoFar) {
        let overlaps = false;
        if (mode === 'finite') {
          overlaps = values.some((v) => inBin(v, bin!) && inBin(v, other.bin));
        } else {
          const maxLo = cmp(bin.lo, other.bin.lo) >= 0 ? bin.lo : other.bin.lo;
          const minHi = cmp(bin.hi, other.bin.hi) <= 0 ? bin.hi : other.bin.hi;
          overlaps = cmp(maxLo, minHi) < 0;
        }
        if (overlaps) {
          issues.push({
            id: newId('issue'),
            severity: 'error',
            scope: 'summary',
            relatedId: s.id,
            message: `${label}：计数区间与「${other.label}」重叠`,
            detail: '重叠会导致重复计数；请手动修正区间。',
          });
        }
      }
      binsSoFar.push({ id: s.id, label, bin });
    }
    summaries.push({ input: s, interval, label, bin });
  });

  const targets: CompiledTarget[] = [];
  ws.targets.forEach((t, idx) => {
    const threshold = parseDecimal(t.threshold);
    if (!threshold) {
      issues.push({
        id: newId('issue'),
        severity: 'error',
        scope: 'target',
        relatedId: t.id,
        message: `阈值 #${idx + 1} 无法解析`,
        detail: `原始输入「${t.threshold}」`,
      });
      return;
    }
    const label = t.label.trim() || `阈值 ${toDecimalString(threshold, 10)}`;
    if (!t.wantTailMin && !t.wantTailMax && !t.wantLossMin && !t.wantLossMax) {
      issues.push({
        id: newId('issue'),
        severity: 'warning',
        scope: 'target',
        relatedId: t.id,
        message: `${label}：未选择任何要计算的界`,
      });
    }
    targets.push({ input: t, threshold, label });
  });

  assumptions.push('概率质量 p_i ≥ 0 且 Σ p_i = 1；不施加计数整数约束。');
  assumptions.push('源摘要的舍入以源给出的步长形成闭区间约束，按区间而非中心值进入求解。');
  assumptions.push('所有计算使用精确有理数；不向约束加入容差。');
  if (mode === 'continuous') {
    assumptions.push('连续模式下矩条件的区间外逼近使用每单元的端点极值，所得包络是任何连续分布都必须满足的必要条件。');
  }
  if (summaries.some((s) => s.input.kind === 'count')) {
    assumptions.push('区间计数按 N 折算为概率质量区间；不推断未给出的区间计数，也不构造个体记录。');
  }

  const breakpoints =
    mode === 'continuous' && supportLo && supportHi && grid
      ? buildBreakpoints(supportLo, supportHi, grid, summaries, targets)
      : undefined;

  return {
    workspace: ws,
    mode,
    values,
    valueTexts,
    supportLo,
    supportHi,
    grid,
    sampleSize: N,
    summaries,
    targets,
    issues,
    assumptions,
    breakpoints,
  };
}

function uniqueSortedSorted(xs: Rat[]): Rat[] {
  const sorted = xs.slice().sort(cmp);
  const out: Rat[] = [];
  for (const x of sorted) {
    if (out.length === 0 || !eq(out[out.length - 1], x)) out.push(x);
  }
  return out;
}

export function buildBreakpoints(
  lo: Rat,
  hi: Rat,
  grid: number,
  summaries: CompiledSummary[],
  targets: CompiledTarget[],
): Rat[] {
  const width = sub(hi, lo);
  const points: Rat[] = [lo, hi];
  for (let j = 1; j < grid; j++) {
    points.push(add(lo, div(mul(width, rat(j)), rat(grid))));
  }
  for (const s of summaries) {
    if (s.bin) {
      if (cmp(s.bin.lo, lo) > 0 && cmp(s.bin.lo, hi) < 0) points.push(s.bin.lo);
      if (cmp(s.bin.hi, lo) > 0 && cmp(s.bin.hi, hi) < 0) points.push(s.bin.hi);
    }
  }
  for (const t of targets) {
    if (cmp(t.threshold, lo) > 0 && cmp(t.threshold, hi) < 0) points.push(t.threshold);
  }
  if (cmp(lo, ZERO) < 0 && cmp(hi, ZERO) > 0) points.push(ZERO);
  return uniqueSortedSorted(points);
}

export function compiledFingerprintSource(problem: CompiledProblem): string {
  return JSON.stringify({
    support: problem.workspace.support,
    summaries: problem.workspace.summaries,
    targets: problem.workspace.targets,
    sampleSize: problem.workspace.sampleSize,
  });
}

/** Simple deterministic fingerprint for display only (not cryptographic). */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function rowBoundsForSummary(
  s: CompiledSummary,
  N: Rat,
  values: Rat[],
): LpRow[] {
  const rows: LpRow[] = [];
  const mk = (rel: '<=' | '>=' | '=', b: Rat, endpoint: 'lo' | 'hi' | 'norm', suffix: string): LpRow => {
    let a: Rat[];
    if (s.input.kind === 'mean') a = values.map((v) => v);
    else if (s.input.kind === 'second') a = values.map((v) => mul(v, v));
    else {
      const bin = s.bin!;
      a = values.map((v) => (inBin(v, bin) ? ONE : ZERO));
    }
    return {
      a,
      rel,
      b,
      key: `summary:${s.input.id}:${suffix}`,
      summaryId: s.input.id,
      endpoint,
      label: s.label,
    };
  };
  if (s.input.kind === 'count') {
    const lo = div(s.interval.lo, N);
    const hi = div(s.interval.hi, N);
    if (eq(lo, hi)) rows.push(mk('=', lo, 'norm', 'mass'));
    else {
      rows.push(mk('>=', lo, 'lo', 'lo'));
      rows.push(mk('<=', hi, 'hi', 'hi'));
    }
    return rows;
  }
  if (s.interval.exact) rows.push(mk('=', s.interval.lo, 'norm', 'value'));
  else {
    rows.push(mk('>=', s.interval.lo, 'lo', 'lo'));
    rows.push(mk('<=', s.interval.hi, 'hi', 'hi'));
  }
  return rows;
}

export function unitMassRow(n: number): LpRow {
  return {
    a: new Array(n).fill(ONE),
    rel: '=',
    b: ONE,
    key: 'unit-mass',
    label: '总质量 Σp = 1',
    endpoint: 'norm',
  };
}

export function objectiveTail(values: Rat[], t: Rat, strict: boolean): Rat[] {
  return values.map((v) => {
    const hit = strict ? cmp(v, t) > 0 : cmp(v, t) >= 0;
    return hit ? ONE : ZERO;
  });
}

export function objectiveLoss(values: Rat[], t: Rat): Rat[] {
  return values.map((v) => (cmp(v, t) > 0 ? sub(v, t) : ZERO));
}

export function describeSummary(s: SummaryInput): string {
  if (s.kind === 'mean') return '均值 E[X]';
  if (s.kind === 'second') return '二阶矩 E[X²]';
  return `区间计数 ${s.countBin ? binMembershipLabel(s.countBin) : ''}`;
}

export function intervalText(iv: CompiledInterval): string {
  if (iv.exact) return `= ${toDecimalString(iv.lo, 10)}`;
  return `[${toDecimalString(iv.lo, 10)}, ${toDecimalString(iv.hi, 10)}]`;
}

export function ratToJson(r: Rat): { n: string; d: string } {
  return { n: r.n.toString(), d: r.d.toString() };
}

export function ratFromJson(x: { n: string; d: string }): Rat {
  return { n: BigInt(x.n), d: BigInt(x.d) };
}

export function ratText(r: Rat): string {
  return `${toDecimalString(r, 10)} (${toFraction(r)})`;
}

export function cloneWorkspace(ws: Workspace): Workspace {
  return JSON.parse(JSON.stringify(ws)) as Workspace;
}

export function normalizeWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') throw new Error('不是对象');
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) throw new Error('不支持的文件版本（需要 schemaVersion = 1）');
  const support = o.support as Record<string, unknown> | undefined;
  if (!support || (support.mode !== 'finite' && support.mode !== 'continuous')) {
    throw new Error('support.mode 必须为 finite 或 continuous');
  }
  if (!Array.isArray(o.summaries) || !Array.isArray(o.targets)) {
    throw new Error('summaries / targets 必须是数组');
  }
  const ws = raw as Workspace;
  // Basic shape checks; deeper validation happens in compileWorkspace.
  if (typeof ws.sampleSize !== 'string') throw new Error('sampleSize 必须是字符串');
  for (const s of ws.summaries) {
    if (!s.bound || typeof s.bound !== 'object') throw new Error('摘要缺少 bound');
    if (!s.id) throw new Error('摘要缺少 id');
  }
  for (const t of ws.targets) {
    if (!t.id) throw new Error('阈值缺少 id');
  }
  return ws;
}

export { neg };

/** Membership test shared by compilation and the analysis engine. */
export function inBinForSupport(v: Rat, bin: NonNullable<CompiledSummary['bin']>): boolean {
  return inBin(v, bin);
}
