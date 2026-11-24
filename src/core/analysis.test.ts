import { describe, expect, it } from 'vitest';
import { add, cmp, div, eq, mul, rat, sub, toNumber, ZERO, type Rat } from './rational';
import {
  analyze,
  type AnalysisResult,
  type ContinuousBound,
  type FiniteBound,
  jointCheck,
} from './analysis';
import {
  compileWorkspace,
  defaultWorkspace,
  makeSummary,
  makeTarget,
  type Workspace,
} from './model';

function ws(mut: (w: Workspace) => void): Workspace {
  const w = defaultWorkspace();
  w.support = { mode: 'finite', values: ['0', '1', '2', '3', '5'] };
  w.sampleSize = '100';
  w.summaries = [];
  w.targets = [];
  mut(w);
  return w;
}

function exact(kind: 'mean' | 'second', value: string) {
  return {
    ...makeSummary(kind),
    label: kind === 'mean' ? '均值' : '二阶矩',
    bound: { mode: 'exact' as const, value, step: '', lo: '', hi: '' },
  };
}

function target(threshold: string) {
  return { ...makeTarget(1), label: `阈值 ${threshold}`, threshold };
}

function fb(a: AnalysisResult, targetId: string, metric: 'tail' | 'loss', dir: 'min' | 'max'): FiniteBound {
  const b = a.bounds.find(
    (x) => x.targetId === targetId && x.metric === metric && x.direction === dir && x.mode === 'finite',
  );
  if (!b) throw new Error('bound not found');
  return b as FiniteBound;
}

function cb(a: AnalysisResult, targetId: string, metric: 'tail' | 'loss', dir: 'min' | 'max'): ContinuousBound {
  const b = a.bounds.find(
    (x) => x.targetId === targetId && x.metric === metric && x.direction === dir && x.mode === 'continuous',
  );
  if (!b) throw new Error('bound not found');
  return b as ContinuousBound;
}

describe('finite support analysis', () => {
  it('reproduces a hand-checkable bound exactly', () => {
    // X in {0,1,2,3,5}, E[X] = 1.8 exactly, threshold 4: only 5 is in the tail.
    // max P(X >= 4) puts m at 5 and the rest at 0: 5m = 1.8 -> m = 0.36.
    // min is 0 because 0.9*2 + 0.1*0 = 1.8 keeps all mass below 4.
    const w = ws((w) => {
      w.summaries = [exact('mean', '1.8')];
      w.targets = [target('4')];
    });
    const a = analyze(compileWorkspace(w));
    expect(a.feasibility.status).toBe('feasible');
    const b = fb(a, w.targets[0].id, 'tail', 'max');
    expect(b.status).toBe('ok');
    expect(eq(b.value, rat(36, 100))).toBe(true);
    expect(b.witnessCheck?.ok).toBe(true);
    expect(b.dualCheck?.ok).toBe(true);
    expect(eq(b.dualCheck!.bound, b.value)).toBe(true);
    expect(b.witness!).toEqual([rat(64, 100), ZERO, ZERO, ZERO, rat(36, 100)]);
    const lo = fb(a, w.targets[0].id, 'tail', 'min');
    expect(eq(lo.value, ZERO)).toBe(true);
    expect(lo.witnessCheck?.ok).toBe(true);
  });

  it('handles two moment constraints and checks the dual independently', () => {
    // X in {0,1,2,3,5}, E[X]=1.8, E[X^2]=6.0.
    const w = ws((w) => {
      w.summaries = [exact('mean', '1.8'), exact('second', '6.0')];
      w.targets = [target('2.5')];
    });
    const a = analyze(compileWorkspace(w));
    expect(a.feasibility.status).toBe('feasible');
    for (const metric of ['tail', 'loss'] as const) {
      for (const dir of ['min', 'max'] as const) {
        const b = fb(a, w.targets[0].id, metric, dir);
        expect(b.status).toBe('ok');
        expect(b.witnessCheck?.ok).toBe(true);
        expect(b.dualCheck?.ok).toBe(true);
        
      }
    }
    // The two bounds must bracket.
    const lo = fb(a, w.targets[0].id, 'tail', 'min');
    const hi = fb(a, w.targets[0].id, 'tail', 'max');
    expect(cmp(lo.value, hi.value)).toBeLessThanOrEqual(0);
  });

  it('treats rounded source values as intervals and never as centres', () => {
    // Mean reported as 1.8 ± 0.05 instead of exact 1.8. The max tail bound at 4
    // must use the upper interval endpoint 1.85 -> 1.85/5 = 0.37.
    const w = ws((w) => {
      w.summaries = [
        {
          ...makeSummary('mean'),
          label: '均值',
          bound: { mode: 'rounded', value: '1.8', step: '0.1', lo: '', hi: '' },
        },
      ];
      w.targets = [target('4')];
    });
    const a = analyze(compileWorkspace(w));
    const hi = fb(a, w.targets[0].id, 'tail', 'max');
    const lo = fb(a, w.targets[0].id, 'tail', 'min');
    expect(eq(hi.value, rat(37, 100))).toBe(true);
    expect(hi.witnessCheck?.ok).toBe(true);
    // Min at threshold 2 with mean in [1.75,1.85]: mass at 3 gives 3m=1.75 -> m=7/12,
    // mass at 2 gives 2m=1.75 -> m=7/8 which is large, so min is 0 (all mass <=2
    // is possible: 1.8 at 1.8? Not in support. Use 1 and 2 mix: 0.8*1+0.2*2=1.2.
    // We simply assert the witness verifies and the bound is at most the max.
    expect(lo.witnessCheck?.ok).toBe(true);
    expect(cmp(lo.value, hi.value)).toBeLessThanOrEqual(0);
  });

  it('flags a mean/second-moment pair that no distribution can satisfy', () => {
    // E[X]=2, E[X^2]=3 would need Var = -1.
    const w = ws((w) => {
      w.support = { mode: 'finite', values: ['0', '1', '2', '3', '5'] };
      w.summaries = [exact('mean', '2'), exact('second', '3')];
      w.targets = [target('1.5')];
    });
    const a = analyze(compileWorkspace(w));
    expect(a.feasibility.status).toBe('infeasible');
    expect(a.feasibility.conflict).toBeTruthy();
    const labels = a.feasibility.conflict!.groups.map((g) => g.label).join(' | ');
    expect(labels).toContain('均值');
    expect(labels).toContain('二阶矩');
    // Dropping either element of the conflict restores feasibility.
    for (const dw of a.feasibility.conflict!.dropWitnesses) {
      expect(dw.feasible).toBe(true);
      expect(dw.witness).toBeTruthy();
    }
    // No bounds are fabricated under infeasibility.
    expect(a.bounds.length).toBe(0);
    // Raw summaries stay untouched.
    expect(w.summaries[0].bound.value).toBe('2');
    expect(w.summaries[1].bound.value).toBe('3');
  });

  it('detects overlapping count bins instead of silently adjusting them', () => {
    const w = ws((w) => {
      w.summaries = [
        {
          ...makeSummary('count'),
          label: '计数 A',
          bound: { mode: 'exact', value: '30', step: '', lo: '', hi: '' },
          countBin: { lo: '0', hi: '2', loInclusive: true, hiInclusive: true },
        },
        {
          ...makeSummary('count'),
          label: '计数 B',
          bound: { mode: 'exact', value: '20', step: '', lo: '', hi: '' },
          countBin: { lo: '2', hi: '4', loInclusive: true, hiInclusive: false },
        },
      ];
      w.targets = [target('2')];
    });
    const a = analyze(compileWorkspace(w));
    expect(a.problem.issues.some((i) => i.message.includes('重叠'))).toBe(true);
    expect(a.bounds.length).toBe(0);
  });

  it('uses interval counts as mass bounds', () => {
    // N=100; count in [0,2] reported as 30 ± 1 -> mass in [0.29, 0.31].
    const w = ws((w) => {
      w.summaries = [
        {
          ...makeSummary('count'),
          label: '低值计数',
          bound: { mode: 'rounded', value: '30', step: '2', lo: '', hi: '' },
          countBin: { lo: '0', hi: '2', loInclusive: true, hiInclusive: true },
        },
        exact('mean', '2.5'),
      ];
      w.targets = [target('4')];
    });
    const a = analyze(compileWorkspace(w));
    expect(a.feasibility.status).toBe('feasible');
    const hi = fb(a, w.targets[0].id, 'tail', 'max');
    expect(hi.status).toBe('ok');
    expect(hi.witnessCheck?.ok).toBe(true);
    expect(hi.dualCheck?.ok).toBe(true);
  });

  it('shows that per-threshold extremes need not share one distribution', () => {
    // X in {0,1,2}, E[X]=0.5.
    //   max P(X >= 2) = 0.25
    //   max P(X >= 1) = 0.5
    // Jointly: P(X=1)+P(X=2)=0.5 and P(X=2)=0.25 => mean = 0.25+0.5 = 0.75 != 0.5.
    const w = ws((w) => {
      w.support = { mode: 'finite', values: ['0', '1', '2'] };
      w.summaries = [exact('mean', '0.5')];
      w.targets = [{ ...target('2'), label: '≥2' }, { ...target('1'), label: '≥1' }];
    });
    const problem = compileWorkspace(w);
    const a = analyze(problem);
    const b2 = fb(a, w.targets[0].id, 'tail', 'max');
    const b1 = fb(a, w.targets[1].id, 'tail', 'max');
    expect(eq(b2.value, rat(1, 4))).toBe(true);
    expect(eq(b1.value, rat(1, 2))).toBe(true);
    const joint = jointCheck(problem, a, [
      { targetId: w.targets[0].id, metric: 'tail', direction: 'max' },
      { targetId: w.targets[1].id, metric: 'tail', direction: 'max' },
    ]);
    expect(joint.status).toBe('not-attainable');
    expect(joint.conflict).toBeTruthy();
    // Each bound alone is attainable.
    const jointA = jointCheck(problem, a, [
      { targetId: w.targets[0].id, metric: 'tail', direction: 'max' },
    ]);
    expect(jointA.status).toBe('attainable');
    expect(jointA.witness).toBeTruthy();
  });

  it('confirms a jointly attainable pair with one witness', () => {
    // X in {0,1,2}, E[X]=1: max P(X>=1)=1 and max E[(X-1)+]=1 are both met by X=2?
    // max tail at 1 = 1 (mass at 1 or 2), max loss at 1 = 1 (mass at 2). Joint: mass at 2
    // gives mean 2, not 1. So use max tail at 1 (1) and min loss at 1 (0): mass at 1.
    const w = ws((w) => {
      w.support = { mode: 'finite', values: ['0', '1', '2'] };
      w.summaries = [exact('mean', '1')];
      w.targets = [{ ...target('1'), label: '阈值1' }];
    });
    const problem = compileWorkspace(w);
    const a = analyze(problem);
    const joint = jointCheck(problem, a, [
      { targetId: w.targets[0].id, metric: 'tail', direction: 'max' },
      { targetId: w.targets[0].id, metric: 'loss', direction: 'min' },
    ]);
    expect(joint.status).toBe('attainable');
    expect(joint.witnessChecks?.every((c) => c.ok)).toBe(true);
    expect(joint.witness!.reduce((s, p) => add(s, p), ZERO)).toEqual(rat(1));
  });

  it('cross-checks every finite bound against independent vertex enumeration', () => {
    const w = ws((w) => {
      w.summaries = [exact('mean', '1.8'), exact('second', '6.0')];
      w.targets = [target('2.5'), target('1')];
    });
    const a = analyze(compileWorkspace(w));
    expect(a.bruteForce?.available).toBe(true);
    const bf = a.bruteForce!;
    for (const obj of bf.objectives) {
      const tail = obj.label.includes('尾部比例');
      const targetLabel = obj.label.split(' · ')[0];
      const t = w.targets.find((x) => x.label === targetLabel)!;
      const lb = fb(a, t.id, tail ? 'tail' : 'loss', 'min');
      const ub = fb(a, t.id, tail ? 'tail' : 'loss', 'max');
      expect(eq(obj.min!, lb.value)).toBe(true);
      expect(eq(obj.max!, ub.value)).toBe(true);
    }
  });

  it('reports a warning (not a silent clamp) when a count bound exceeds N', () => {
    const w = ws((w) => {
      w.summaries = [
        {
          ...makeSummary('count'),
          label: '计数',
          bound: { mode: 'exact', value: '140', step: '', lo: '', hi: '' },
          countBin: { lo: '0', hi: '2', loInclusive: true, hiInclusive: true },
        },
      ];
      w.targets = [target('2')];
    });
    const a = analyze(compileWorkspace(w));
    expect(a.problem.issues.some((i) => i.severity === 'warning' && i.message.includes('超过样本总量'))).toBe(true);
    expect(a.feasibility.status).toBe('infeasible');
  });
});

describe('continuous support analysis', () => {
  it('gives an outer bound above the attainable inner bound, with an explicit gap', () => {
    // X in [0,2], E[X] = 1, maximise P(X > 1.5).
    // Any mass m above 1.5 contributes at least 1.5m to the mean, so m <= 2/3.
    // The bound 2/3 is a supremum, approached by m=2/3 at 1.5+ε, not attained.
    const w = ws((w) => {
      w.support = { mode: 'continuous', lo: '0', hi: '2', grid: 20 };
      w.summaries = [exact('mean', '1').enabled ? { ...exact('mean', '1') } : exact('mean', '1')];
      w.targets = [{ ...target('1.5'), strictTail: true }];
    });
    const a = analyze(compileWorkspace(w));
    const hi = cb(a, w.targets[0].id, 'tail', 'max');
    expect(hi.status).toBe('ok');
    expect(cmp(hi.outer, rat(2, 3))).toBeLessThanOrEqual(0);
    expect(cmp(hi.outer, rat(1, 2))).toBeGreaterThanOrEqual(0);
    expect(cmp(hi.inner!, hi.outer)).toBeLessThanOrEqual(0);
    expect(hi.gap).toEqual(sub(hi.outer, hi.inner!));
    expect(hi.certificate.valid).toBe(true);
    expect(hi.certificate.signOk).toBe(true);
    expect(hi.exact).toBe(false);
    expect(hi.message).toContain('不宣称');
    // Outer must be a genuine upper bound: verify at sampled feasible continuous
    // distributions built from two-point mass (analytic feasible set).
    for (const m of [0, 0.1, 0.3, 0.5, 0.6]) {
      if (m > 2 / 3 + 1e-12) continue;
      // mass m at 1.5+ and (1-m) at x0 >= 0 with mean 1.
      const xHi = 1.5 + 1e-9;
      const xLo = (1 - m * xHi) / (1 - m);
      if (xLo < -1e-12 || xLo > 1.5) continue;
      expect(m).toBeLessThanOrEqual(toNumber(hi.outer) + 1e-9);
    }
  });

  it('never reports a grid optimum as a strict continuous optimum', () => {
    // Loss objective is piecewise linear; the continuous supremum of
    // E[(X-t)+] with E[X]=1, t=0.5 over [0,2] is an LP whose optimum puts mass
    // at 2 and 0: loss = 1.5 * 0.5 = 0.75. The breakpoint grid contains 0 and 2,
    // so the inner bound equals the outer bound and exactness is legitimate here.
    // For tail at 1.5 the grid cannot sit just above 1.5, so gap > 0.
    const w = ws((w) => {
      w.support = { mode: 'continuous', lo: '0', hi: '2', grid: 16 };
      w.summaries = [exact('mean', '1')];
      w.targets = [{ ...target('1.5'), strictTail: true }];
    });
    const a = analyze(compileWorkspace(w));
    const hi = cb(a, w.targets[0].id, 'tail', 'max');
    expect(cmp(hi.gap, ZERO)).toBeGreaterThan(0);
    expect(hi.exact).toBe(false);
    expect(hi.outer).toBeTruthy();
    expect(hi.certificate.checkedPoints).toBeGreaterThan(0);
    expect(hi.certificate.weights.some((x) => cmp(x, ZERO) !== 0)).toBe(true);
  });

  it('handles lower-tail and loss objectives on the same target', () => {
    const w = ws((w) => {
      w.support = { mode: 'continuous', lo: '0', hi: '4', grid: 24 };
      w.summaries = [exact('mean', '1'), exact('second', '4')];
      w.targets = [target('1')];
    });
    const a = analyze(compileWorkspace(w));
    for (const metric of ['tail', 'loss'] as const) {
      for (const dir of ['min', 'max'] as const) {
        const b = cb(a, w.targets[0].id, metric, dir);
        expect(b.certificate.signOk).toBe(true);
        // max: attainable inner <= certified outer; min: certified outer <= attainable inner.
        if (dir === 'max') expect(cmp(b.inner!, b.outer)).toBeLessThanOrEqual(0);
        else expect(cmp(b.outer, b.inner!)).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('exact rational plumbing', () => {
  it('keeps rounding intervals exact (no float contamination)', () => {
    const third = div(rat(1), rat(3));
    const sum = add(mul(third, rat(3)), ZERO);
    expect(eq(sum, rat(1))).toBe(true);
    expect(eq(sub(rat('' as unknown as number) || rat(0), ZERO), ZERO)).toBe(true);
    const x: Rat = rat(2, 3);
    expect(toNumber(x)).toBeCloseTo(0.6666666666, 9);
  });
});
