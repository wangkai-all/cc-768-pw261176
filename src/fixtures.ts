import {
  makeSummary,
  makeTarget,
  newId,
  type SummaryInput,
  type Workspace,
} from './core/model';

function meanExact(value: string, label = '均值 E[X]'): SummaryInput {
  return {
    ...makeSummary('mean'),
    label,
    bound: { mode: 'exact', value, step: '', lo: '', hi: '' },
  };
}
function meanRounded(value: string, step: string, label = '均值 E[X]'): SummaryInput {
  return {
    ...makeSummary('mean'),
    label,
    bound: { mode: 'rounded', value, step, lo: '', hi: '' },
  };
}
function secondRounded(value: string, step: string, label = '二阶矩 E[X²]'): SummaryInput {
  return {
    ...makeSummary('second'),
    label,
    bound: { mode: 'rounded', value, step, lo: '', hi: '' },
  };
}
function countIn(
  lo: string,
  hi: string,
  countLo: string,
  countHi: string,
  label: string,
  value = countLo,
  step = '',
  loInclusive = true,
  hiInclusive = true,
): SummaryInput {
  return {
    ...makeSummary('count'),
    label,
    bound:
      countLo === countHi && step === ''
        ? { mode: 'exact', value, step: '', lo: '', hi: '' }
        : { mode: 'interval', value, step, lo: countLo, hi: countHi },
    countBin: { lo, hi, loInclusive, hiInclusive },
  };
}

function base(name: string, notes: string): Workspace {
  return {
    schemaVersion: 1,
    id: newId('ws'),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sampleSize: '100',
    support: { mode: 'finite', values: ['0', '1', '2', '3', '5'] },
    summaries: [],
    targets: [],
    jointSelection: [],
    analystNotes: notes,
  };
}

/** 1. Enumerable three-point support: every corner of the polytope is checkable by hand. */
export function fixtureEnumerable(): Workspace {
  const w = base(
    '可枚举核对 · 三取值',
    '支持集只有 3 个取值，可行域是二维单纯形上的线段；应用会用独立顶点枚举复核每一个界。',
  );
  w.support = { mode: 'finite', values: ['0', '1', '2'] };
  w.sampleSize = '100';
  w.summaries = [meanExact('0.5', '均值 E[X]（精确）')];
  w.targets = [
    { ...makeTarget(1), label: '阈值 1', threshold: '1' },
    { ...makeTarget(2), label: '阈值 2', threshold: '2' },
  ];
  return w;
}

/** 2. A mis-entered rounding interval that no distribution can satisfy. */
export function fixtureBadRounding(): Workspace {
  const w = base(
    '舍入区间互相矛盾 · 录入错误',
    '均值被录成 25（本意可能是 2.5），舍入步长 0.1 形成 [24.95, 25.05]，而支持集最大取值只有 5。应用只报告冲突，不会放宽或改写摘要，也不会偷偷把 25 当成 2.5。',
  );
  w.support = { mode: 'finite', values: ['0', '1', '2', '3', '5'] };
  w.sampleSize = '100';
  w.summaries = [
    meanRounded('25', '0.1', '均值（源舍入到 0.1）'),
    secondRounded('7.0', '0.1', '二阶矩（源舍入到 0.1）'),
  ];
  w.targets = [{ ...makeTarget(1), label: '阈值 3', threshold: '3' }];
  return w;
}

/** 3. Two per-threshold extremes that cannot be attained by one distribution. */
export function fixtureIncompatibleExtremes(): Workspace {
  const w = base(
    '多个极值不能同时达到',
    'X ∈ {0,1,2}，E[X] = 0.5。阈值 2 以上的最大比例 1/4 需要 P(X=2)=1/4；阈值 1 以上的最大比例 1/2 需要 P(X≥1)=1/2。两者同时成立会把均值推到 0.75。每个界单独可达，但来自不同分布；联合检查会给出最小冲突集合。',
  );
  w.support = { mode: 'finite', values: ['0', '1', '2'] };
  w.sampleSize = '100';
  w.summaries = [meanExact('0.5', '均值 E[X]（精确）')];
  w.targets = [
    { ...makeTarget(1), label: '阈值 2', threshold: '2' },
    { ...makeTarget(2), label: '阈值 1', threshold: '1' },
  ];
  return w;
}

/** 4. Continuous support: certified outer bound + attainable inner bound + explicit gap. */
export function fixtureContinuous(): Workspace {
  const w = base(
    '连续区间 · 外逼近与可达内界',
    'X ∈ [0,2]，E[X] = 1。阈值 1.5 的严格尾部比例上确界是 2/3，但任何连续分布都无法达到（只能逼近）。因此外逼近界 = 2/3、可达内界 < 2/3，间隙是显式离散化松弛。',
  );
  w.support = { mode: 'continuous', lo: '0', hi: '2', grid: 24 };
  w.sampleSize = '100';
  w.summaries = [meanExact('1', '均值 E[X]（精确）')];
  w.targets = [
    { ...makeTarget(1), label: '阈值 1.5（严格大于）', threshold: '1.5', strictTail: true },
  ];
  return w;
}

/** 5. Counts plus rounded moments, all feasible, with interval stacking. */
export function fixtureCounts(): Workspace {
  const w = base(
    '区间计数 + 舍入矩 · 混合',
    'N = 100。计数区间 [0,2] 报 28–32，均值报 2.5 ± 0.05。所有摘要只作为区间进入求解：计数的概率质量在 [0.28, 0.32]，均值的 E[X] 在 [2.45, 2.55]。',
  );
  w.support = { mode: 'finite', values: ['0', '1', '2', '3', '5'] };
  w.sampleSize = '100';
  w.summaries = [
    countIn('0', '2', '28', '32', '取值 ≤ 2 的计数（源直接给区间）'),
    meanRounded('2.5', '0.1', '均值（源舍入到 0.1）'),
  ];
  w.targets = [{ ...makeTarget(1), label: '阈值 3', threshold: '3' }];
  return w;
}

export interface Fixture {
  id: string;
  title: string;
  blurb: string;
  make: () => Workspace;
}

export const FIXTURES: Fixture[] = [
  {
    id: 'enumerable',
    title: '可枚举核对 · 三取值',
    blurb: '小支持集 + 顶点枚举复核',
    make: fixtureEnumerable,
  },
  {
    id: 'extremes',
    title: '极值不能同时达到',
    blurb: '联合检查与最小冲突集合',
    make: fixtureIncompatibleExtremes,
  },
  {
    id: 'bad-rounding',
    title: '错误舍入区间',
    blurb: '录入冲突，拒绝求解',
    make: fixtureBadRounding,
  },
  {
    id: 'counts',
    title: '区间计数 + 舍入矩',
    blurb: '计数按 N 折算为质量区间',
    make: fixtureCounts,
  },
  {
    id: 'continuous',
    title: '连续区间 · 保守界',
    blurb: '外逼近 + 可达内界 + 显式间隙',
    make: fixtureContinuous,
  },
];
