import { describe, expect, it } from 'vitest';
import { analyze } from './analysis';
import { compileWorkspace, defaultWorkspace } from './model';
import { buildSavedAnalysis } from './persist';
import { FIXTURES } from '../fixtures';

describe('smoke: full pipeline', () => {
  it('default workspace', () => {
    const ws = defaultWorkspace();
    const problem = compileWorkspace(ws);
    expect(problem.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const a = analyze(problem);
    expect(a.bounds.length).toBeGreaterThan(0);
    buildSavedAnalysis(ws, problem, a, []);
  });
  for (const f of FIXTURES) {
    it(`fixture ${f.id}`, () => {
      const ws = f.make();
      const problem = compileWorkspace(ws);
      const a = analyze(problem);
      buildSavedAnalysis(ws, problem, a, []);
    });
  }
});
