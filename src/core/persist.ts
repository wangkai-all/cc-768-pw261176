// Persistence layer: turns the live analysis (which holds exact Rat objects and
// BigInts) into plain JSON that round-trips through localStorage or a file.
// Every number that carries a certificate is stored as an exact fraction
// string, never as a float.

import type {
  AnalysisResult,
  InfeasibilityReport,
  JointCheckResult,
  SavedAnalysis,
} from './analysis';
import { ENGINE_VERSION, serializeBound } from './analysis';
import type { CompiledProblem, Workspace } from './model';
import { compiledFingerprintSource, fingerprint } from './model';
import { toFraction, toDecimalString } from './rational';

function serializeFeasibility(f: InfeasibilityReport): unknown {
  return {
    status: f.status,
    message: f.message,
    conflict: f.conflict
      ? {
          groups: f.conflict.groups,
          dropWitnesses: f.conflict.dropWitnesses.map((d) => ({
            droppedId: d.droppedId,
            droppedLabel: d.droppedLabel,
            minimalityFeasible: d.minimalityFeasible,
            feasible: d.feasible,
            witness: d.witness?.map((p) => toFraction(p)),
          })),
        }
      : undefined,
  };
}

export function serializeJointCheck(j: JointCheckResult): unknown {
  return {
    id: j.id,
    createdAt: j.createdAt,
    mode: j.mode,
    items: j.items.map((it) => ({
      targetId: it.targetId,
      targetLabel: it.targetLabel,
      metric: it.metric,
      direction: it.direction,
      bound: toFraction(it.bound),
    })),
    status: j.status,
    message: j.message,
    witness: j.witness?.map((p) => toFraction(p)),
    witnessChecks: j.witnessChecks?.map((c) => ({
      label: c.label,
      ok: c.ok,
      value: toFraction(c.value),
    })),
    conflict: j.conflict
      ? {
          groups: j.conflict.groups,
          dropWitnesses: j.conflict.dropWitnesses.map((d) => ({
            droppedId: d.droppedId,
            droppedLabel: d.droppedLabel,
            minimalityFeasible: d.minimalityFeasible,
            feasible: d.feasible,
            witness: d.witness?.map((p) => toFraction(p)),
          })),
        }
      : undefined,
    resolution: j.resolution,
    gridNote: j.gridNote,
  };
}

export function buildSavedAnalysis(
  workspace: Workspace,
  problem: CompiledProblem,
  analysis: AnalysisResult,
  jointChecks: JointCheckResult[],
): SavedAnalysis {
  const support =
    workspace.support.mode === 'finite'
      ? workspace.support.values
      : [`[${workspace.support.lo}, ${workspace.support.hi}]`, `grid=${workspace.support.grid}`];
  return {
    id: workspace.id,
    name: workspace.name,
    savedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    fingerprint: fingerprint(compiledFingerprintSource(problem)),
    workspace,
    assumptions: analysis.assumptions,
    supportMode: workspace.support.mode,
    support,
    sampleSize: toDecimalString(problem.sampleSize, 10),
    bounds: analysis.bounds.map(serializeBound),
    feasibility: serializeFeasibility(analysis.feasibility),
    jointChecks: jointChecks.map(serializeJointCheck),
    issues: problem.issues.map((i) => ({
      severity: i.severity,
      message: i.message,
      detail: i.detail,
    })),
    notes: [
      `引擎版本 ${ENGINE_VERSION}`,
      analysis.finiteMode
        ? '有限取值：每个界都是精确有理数 LP 的最优值，并附达到分布与对偶乘子。'
        : '连续取值：外逼近界 + 断点支撑上的可达内界；间隙为显式离散化松弛。',
      ...analysis.notes,
    ],
  };
}

/** Full export wraps the snapshot with the raw source values untouched. */
export function buildExport(workspace: Workspace, snapshot: SavedAnalysis): unknown {
  return {
    kind: 'summary-bounds.snapshot',
    exportedAt: new Date().toISOString(),
    sourceWorkspace: workspace,
    analysis: snapshot,
  };
}
