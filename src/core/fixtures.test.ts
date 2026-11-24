import { describe, expect, it } from 'vitest';
import { analyze, jointCheck } from './analysis';
import { compileWorkspace, defaultWorkspace } from './model';
import { FIXTURES, fixtureIncompatibleExtremes } from '../fixtures';
import { eq, rat, ZERO, cmp } from './rational';

describe('fixtures', () => {
  it('enumerable fixture has all bounds independently vertex-checked', () => {
    const f = FIXTURES.find((x) => x.id === 'enumerable')!;
    const ws = f.make();
    const a = analyze(compileWorkspace(ws));
    expect(a.feasibility.status).toBe('feasible');
    expect(a.bruteForce?.available).toBe(true);
    const bf = a.bruteForce!;
    for (const obj of bf.objectives) {
      const tail = obj.label.includes('尾部比例');
      const label = obj.label.split(' · ')[0];
      const t = ws.targets.find((x) => x.label === label)!;
      const dirs = a.bounds.filter(
        (b) => b.targetId === t.id && b.metric === (tail ? 'tail' : 'loss') && b.mode === 'finite',
      );
      for (const b of dirs) {
        if (b.mode !== 'finite' || b.status !== 'ok') continue;
        expect(eq(b.value, b.direction === 'min' ? obj.min! : obj.max!)).toBe(true);
        expect(b.witnessCheck?.ok).toBe(true);
        expect(b.dualCheck?.ok).toBe(true);
      }
    }
    // threshold 2, P(X>=2) max = 1/4 (support {0,1,2}, mean 1/2)
    const t2 = ws.targets.find((x) => x.label === '阈值 2')!;
    const b = a.bounds.find((x) => x.targetId === t2.id && x.metric === 'tail' && x.direction === 'max');
    expect(b && b.mode === 'finite' && eq(b.value, rat(1, 4))).toBe(true);
  });

  it('extremes fixture reports joint non-attainability with two different witnesses', () => {
    const f = FIXTURES.find((x) => x.id === 'extremes')!;
    const ws = f.make();
    const problem = compileWorkspace(ws);
    const a = analyze(problem);
    const t2 = ws.targets.find((x) => x.label === '阈值 2')!;
    const t1 = ws.targets.find((x) => x.label === '阈值 1')!;
    const b2 = a.bounds.find((x) => x.targetId === t2.id && x.metric === 'tail' && x.direction === 'max');
    const b1 = a.bounds.find((x) => x.targetId === t1.id && x.metric === 'tail' && x.direction === 'max');
    expect(b2 && b2.mode === 'finite' && eq(b2.value, rat(1, 4))).toBe(true);
    expect(b1 && b1.mode === 'finite' && eq(b1.value, rat(1, 2))).toBe(true);
    const joint = jointCheck(problem, a, [
      { targetId: t2.id, metric: 'tail', direction: 'max' },
      { targetId: t1.id, metric: 'tail', direction: 'max' },
    ]);
    expect(joint.status).toBe('not-attainable');
    expect(joint.conflict!.groups.length).toBeGreaterThan(1);
    // Summits: max P(X>=2) uses mass at 2, max P(X>=1) uses mass at 1.
    const w2 = (b2 as any).witness;
    const w1 = (b1 as any).witness;
    expect(eq(w2[2], rat(1, 4))).toBe(true);
    expect(eq(w1[1], rat(1, 2))).toBe(true);
    expect(w2).not.toEqual(w1);
  });

  it('bad rounding fixture is infeasible and leaves input untouched', () => {
    const f = FIXTURES.find((x) => x.id === 'bad-rounding')!;
    const ws = f.make();
    const a = analyze(compileWorkspace(ws));
    expect(a.feasibility.status).toBe('infeasible');
    expect(a.bounds.length).toBe(0);
    expect(ws.summaries[0].bound.value).toBe('25');
    expect(ws.summaries[0].bound.step).toBe('0.1');
    expect(a.problem.summaries[0].interval.lo).toEqual(rat(24.95));
    expect(a.problem.summaries[0].interval.hi).toEqual(rat(25.05));
  });

  it('counts fixture is feasible and uses mass intervals', () => {
    const f = FIXTURES.find((x) => x.id === 'counts')!;
    const ws = f.make();
    const a = analyze(compileWorkspace(ws));
    expect(a.feasibility.status).toBe('feasible');
    const cnt = a.problem.summaries.find((s) => s.input.kind === 'count')!;
    // Count interval is in raw counts; the LP divides by N=100.
    expect(cnt.interval.lo).toEqual(rat(28));
    expect(cnt.interval.hi).toEqual(rat(32));
    const massRows = a.baseRows.filter((r) => r.summaryId === cnt.input.id);
    expect(massRows.map((r) => r.b)).toEqual([rat(28, 100), rat(32, 100)]);
    const hi = a.bounds.find((b) => b.metric === 'tail' && b.direction === 'max' && b.status === 'ok');
    expect(hi).toBeTruthy();
  });

  it('continuous fixture certifies an outer bound strictly above every attainable value', () => {
    const f = FIXTURES.find((x) => x.id === 'continuous')!;
    const ws = f.make();
    const a = analyze(compileWorkspace(ws));
    const b = a.bounds.find((x) => x.metric === 'tail' && x.direction === 'max');
    expect(b && b.mode === 'continuous').toBe(true);
    if (b && b.mode === 'continuous') {
      expect(eq(b.outer, rat(2, 3))).toBe(true);
      expect(cmp(b.inner!, b.outer)).toBeLessThan(0);
      expect(cmp(b.gap, ZERO)).toBeGreaterThan(0);
      expect(b.exact).toBe(false);
      expect(b.certificate.signOk).toBe(true);
    }
  });
});

describe('joint check evidence', () => {
  it('explains selecting both directions of one quantity as a request error', () => {
    // min and max of the same quantity are different numbers by construction,
    // so asking for both is self-contradictory. It must not be reported as a
    // minimal conflict set of the summaries.
    const problem = compileWorkspace(defaultWorkspace());
    const a = analyze(problem);
    const items = a.bounds.map((b) => ({
      targetId: b.targetId,
      metric: b.metric,
      direction: b.direction,
    }));
    const joint = jointCheck(problem, a, items);
    expect(joint.status).toBe('not-attainable');
    expect(joint.conflict).toBeUndefined();
    expect(joint.message).toContain('所选界本身互相排斥');
  });

  it('reports and independently re-verifies the minimal conflict set', () => {
    const ws = fixtureIncompatibleExtremes();
    const problem = compileWorkspace(ws);
    const a = analyze(problem);
    const [t2, t1] = ws.targets;
    const joint = jointCheck(problem, a, [
      { targetId: t2.id, metric: 'tail', direction: 'max' },
      { targetId: t1.id, metric: 'tail', direction: 'max' },
    ]);
    expect(joint.status).toBe('not-attainable');
    expect(joint.resolution?.conflictReproduced).toBe(true);
    expect(joint.resolution?.dropChecks.length).toBeGreaterThan(1);
    expect(joint.resolution?.dropChecks.every((d) => d.feasible)).toBe(true);
    // The conflict must name both selected bounds and the mean, and nothing else.
    const kinds = (joint.conflict?.groups ?? []).map((g) => g.kind).sort();
    expect(kinds).toEqual(['bound', 'bound', 'summary']);
    const labels = (joint.conflict?.groups ?? []).map((g) => g.label).join(' ');
    expect(labels).toContain('阈值 2');
    expect(labels).toContain('阈值 1');
    expect(labels).toContain('均值');
  });

  it('shows drop witnesses for the whole model, not just the conflict set', () => {
    // Regression: the witness used to be solved over only the conflict groups,
    // so the displayed vector could sum to less than 1 and still be labelled
    // "恢复可行". It must satisfy unit mass and every non-conflicting summary.
    const ws = fixtureIncompatibleExtremes();
    const problem = compileWorkspace(ws);
    const a = analyze(problem);
    const [t2, t1] = ws.targets;
    const joint = jointCheck(problem, a, [
      { targetId: t2.id, metric: 'tail', direction: 'max' },
      { targetId: t1.id, metric: 'tail', direction: 'max' },
    ]);
    expect(joint.resolution?.dropChecks.every((d) => d.minimalityFeasible)).toBe(true);
    for (const dw of joint.conflict!.dropWitnesses) {
      expect(dw.minimalityFeasible).toBe(true);
      expect(dw.feasible).toBe(true);
      const mass = dw.witness!.reduce((s, p) => s + Number(p.n) / Number(p.d), 0);
      expect(mass).toBeCloseTo(1, 10);
    }
    // Same check on the standalone feasibility diagnosis.
    const bad = FIXTURES.find((x) => x.id === 'bad-rounding')!.make();
    const badAnalysis = analyze(compileWorkspace(bad));
    for (const dw of badAnalysis.feasibility.conflict!.dropWitnesses) {
      // Minimality always holds for the reported set...
      expect(dw.minimalityFeasible).toBe(true);
      // ...but this fixture has a second, independent conflict, so removing
      // unit mass from the whole model must still be infeasible and must not
      // claim a witness distribution.
      if (dw.droppedId === 'unit-mass') {
        expect(dw.feasible).toBe(false);
        expect(dw.witness).toBeUndefined();
      }
      if (dw.witness) {
        const mass = dw.witness.reduce((s, p) => s + Number(p.n) / Number(p.d), 0);
        expect(mass).toBeCloseTo(1, 10);
      }
    }
  });
});
