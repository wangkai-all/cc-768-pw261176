import { useEffect, useMemo, useState } from 'react';
import type {
  AnalysisResult,
  Bound,
  ContinuousBound,
  FiniteBound,
  JointCheckItem,
  JointCheckResult,
  Metric,
} from '../core/analysis';
import { jointCheck } from '../core/analysis';
import type { CompiledProblem } from '../core/model';
import {
  abs,
  add,
  cmp,
  eq,
  sub,
  toDecimalString,
  toFraction,
  toPercentString,
  ZERO,
  type Rat,
} from '../core/rational';
import { DistributionChart } from './DistributionChart';

const METRIC_LABEL: Record<Metric, string> = { tail: '尾部比例', loss: '截断损失' };
const DIR_LABEL = { min: '下界', max: '上界' } as const;

/** Tail probabilities are proportions; truncated loss is an expected value. */
function formatMetricValue(metric: Metric, value: Rat): string {
  return metric === 'tail' ? toPercentString(value, 4) : toDecimalString(value, 6);
}

export function ResultsPanel({
  analysis,
  problem,
  onJoint,
}: {
  analysis: AnalysisResult;
  problem: CompiledProblem;
  onJoint: (r: JointCheckResult) => void;
}) {
  const [activeTarget, setActiveTarget] = useState<string | null>(
    problem.targets[0]?.input.id ?? null,
  );
  const target = problem.targets.find((t) => t.input.id === activeTarget) ?? problem.targets[0];

  if (analysis.problem.targets.length === 0) {
    return (
      <div className="card">
        <header>
          <h2>结果</h2>
        </header>
        <div className="body">
          <div className="empty">先添加至少一个阈值。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <header>
          <h2>界计算</h2>
          <span className="hint">
            {analysis.finiteMode ? '有限取值 · 精确有理数 LP' : '连续取值 · 保守外逼近 + 可达内界'}
          </span>
        </header>
        <div className="body">
          {problem.targets.length > 1 && (
            <div className="target-tabs" role="tablist" aria-label="选择阈值">
              {problem.targets.map((t) => (
                <button
                  key={t.input.id}
                  role="tab"
                  aria-selected={t.input.id === target?.input.id}
                  aria-pressed={t.input.id === target?.input.id}
                  onClick={() => setActiveTarget(t.input.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {target && (
            <TargetResults
              analysis={analysis}
              problem={problem}
              targetId={target.input.id}
              onJoint={onJoint}
            />
          )}
          <p className="footer-note">
            每个界都附有达到它的分布（连续情形为可达内界）与对偶乘子；两项都由独立校验函数重新计算，
            而不是相信求解器的返回值。
          </p>
        </div>
      </div>

      {analysis.finiteMode && target && (
        <BoundsComparison analysis={analysis} targetId={target.input.id} />
      )}

      <JointPanel analysis={analysis} problem={problem} onJoint={onJoint} />
      <BruteForcePanel analysis={analysis} />
    </div>
  );
}

function TargetResults({
  analysis,
  problem,
  targetId,
}: {
  analysis: AnalysisResult;
  problem: CompiledProblem;
  targetId: string;
  onJoint: (r: JointCheckResult) => void;
}) {
  const target = problem.targets.find((t) => t.input.id === targetId);
  if (!target) return null;
  const feasibility = analysis.feasibility;
  if (feasibility.status === 'infeasible') {
    return (
      <div className="notice error">
        <span>
          <strong>摘要互相矛盾。</strong> 本目标不计算界。请在上方“可行性诊断”中查看最小冲突集合；
          应用不会放宽任何摘要来让求解器通过。
        </span>
      </div>
    );
  }
  if (feasibility.status === 'undecided') {
    return <div className="notice warn">{feasibility.message}</div>;
  }
  return (
    <div className="bound-grid">
      {(['tail', 'loss'] as Metric[]).map((metric) => {
        const bs = analysis.bounds.filter(
          (b) => b.targetId === targetId && b.metric === metric,
        );
        if (bs.length === 0) return null;
        const t = toDecimalString(target.threshold, 10);
        return (
          <div key={metric} className="metric-block">
            <h4>
              {METRIC_LABEL[metric]} ·{' '}
              {metric === 'tail'
                ? target.input.strictTail
                  ? `P(X > ${t})`
                  : `P(X ≥ ${t})`
                : `E[(X − ${t})⁺]`}
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {bs.map((b) =>
                b.mode === 'finite' ? (
                  <FiniteBoundView
                    key={b.direction}
                    bound={b}
                    metric={metric}
                    supportTexts={analysis.supportTexts}
                  />
                ) : (
                  <ContinuousBoundView
                    key={b.direction}
                    bound={b}
                    metric={metric}
                    supportTexts={analysis.supportTexts}
                  />
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FiniteBoundView({
  bound,
  metric,
  supportTexts,
}: {
  bound: FiniteBound;
  metric: Metric;
  supportTexts: string[];
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div className="bound-value">{formatMetricValue(metric, bound.value)}</div>
          <div className="bound-sub">
            {DIR_LABEL[bound.direction]} · 精确值 {toFraction(bound.value)}
          </div>
        </div>
        <span className={`chip ${bound.status === 'ok' ? 'good' : 'bad'}`}>
          <i className="dot" />
          {bound.status === 'ok'
            ? '已证明'
            : bound.status === 'unbounded'
              ? '无界'
              : '不可行'}
        </span>
      </div>
      {bound.status === 'ok' && (
        <>
          <div className="verify-list" style={{ marginTop: 8 }}>
            <VerifyLine
              ok={!!bound.witnessCheck?.ok}
              text={
                bound.witnessCheck?.ok
                  ? '达到该界的分布通过复核：质量非负、Σp = 1、全部摘要约束成立、目标值与所报界一致'
                  : '达到该界的分布未通过复核'
              }
            />
            <VerifyLine
              ok={!!bound.dualCheck?.ok}
              text={
                bound.dualCheck?.ok
                  ? `对偶证据成立：乘子方向正确，逐点余量 ≥ 0，对偶目标 = 原始最优 = ${toFraction(bound.dualCheck.bound)}`
                  : '对偶证据未通过复核'
              }
            />
          </div>
          {bound.witness && bound.dualRows && (
            <details style={{ marginTop: 10 }}>
              <summary>达到该界的分布与对偶乘子</summary>
              <div className="details-body">
                <div className="table-wrap" style={{ marginBottom: 10 }}>
                  <table>
                    <caption className="sr-only">达到该界的概率质量向量</caption>
                    <thead>
                      <tr>
                        <th>取值</th>
                        <th className="num">概率质量</th>
                        <th className="num">精确分数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bound.witness.map((p, i) => (
                        <tr key={i}>
                          <td className="mono">{supportTexts[i] ?? `x${i + 1}`}</td>
                          <td className="num mono">{toDecimalString(p, 8)}</td>
                          <td className="num mono">{toFraction(p)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ color: 'var(--text-muted)' }}>合计</td>
                        <td className="num mono">
                          {toDecimalString(
                            bound.witness.reduce((s, p) => add(s, p), ZERO),
                            8,
                          )}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
                <DualTable bound={bound} />
              </div>
            </details>
          )}
        </>
      )}
      {bound.message && bound.status !== 'ok' && (
        <div className="notice warn" style={{ marginTop: 8 }}>
          {bound.message}
        </div>
      )}
    </div>
  );
}

/**
 * One line of independent re-verification. `status: 'info'` marks a true
 * observation that is not itself a pass/fail check, so it must not be rendered
 * with the failure styling.
 */
function VerifyLine({
  ok,
  text,
  status,
}: {
  ok: boolean;
  text: string;
  status?: 'ok' | 'info';
}) {
  const kind = status === 'info' ? 'info' : ok ? 'ok' : 'bad';
  const label = kind === 'ok' ? '通过' : kind === 'bad' ? '失败' : '说明';
  return (
    <div className="v">
      <span className={`status ${kind}`}>{label}</span>
      <span>{text}</span>
    </div>
  );
}

function DualTable({ bound }: { bound: FiniteBound }) {
  if (!bound.dualRows) return null;
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">对偶乘子与逐行条件</caption>
        <thead>
          <tr>
            <th>约束</th>
            <th>方向</th>
            <th className="num">右端项 b</th>
            <th className="num">乘子 w</th>
            <th>乘子方向</th>
          </tr>
        </thead>
        <tbody>
          {bound.dualRows.map((r, i) => (
            <tr key={`${r.key}-${i}`}>
              <td>{r.label}</td>
              <td className="mono">{r.rel}</td>
              <td className="num mono">{toFraction(r.bound)}</td>
              <td className="num mono">{toFraction(r.multiplier)}</td>
              <td>
                <span
                  className={`chip ${r.signOk ? 'good' : 'bad'}`}
                  style={{ fontSize: 11 }}
                >
                  {r.signOk ? '正确' : '错误'}
                </span>
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ color: 'var(--text-muted)' }}>Σ w·b</td>
            <td />
            <td className="num mono">
              {bound.dualCheck ? toFraction(bound.dualCheck.bound) : '—'}
            </td>
            <td />
            <td />
          </tr>
          <tr>
            <td style={{ color: 'var(--text-muted)' }}>逐点最小余量</td>
            <td colSpan={2} className="mono" style={{ fontSize: 11 }}>
              {bound.direction === 'max' ? 'Aᵀw − f' : 'f − Aᵀw'}
            </td>
            <td className="num mono">
              {bound.dualCheck ? toFraction(bound.dualCheck.pointwiseMinResidual) : '—'}
            </td>
            <td>
              <span
                className={`chip ${bound.dualCheck?.pointwiseOk ? 'good' : 'bad'}`}
                style={{ fontSize: 11 }}
              >
                {bound.dualCheck?.pointwiseOk ? '≥ 0' : '< 0'}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ContinuousBoundView({
  bound,
  metric,
  supportTexts,
}: {
  bound: ContinuousBound;
  metric: Metric;
  supportTexts: string[];
}) {
  const [lo, hi] =
    bound.direction === 'max'
      ? [bound.inner, bound.outer]
      : [bound.outer, bound.inner];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div className="bound-value" style={{ fontSize: 21 }}>
            {lo === null ? '—' : formatMetricValue(metric, lo)} …{' '}
            {hi === null ? '—' : formatMetricValue(metric, hi)}
          </div>
          <div className="bound-sub">
            {bound.direction === 'max'
              ? '可达下界 … 保守上界'
              : '保守下界 … 可达上界'}
            {metric === 'tail' ? '（比例）' : '（期望值）'}
          </div>
        </div>
        <span className={`chip ${bound.exact ? 'good' : 'warn'}`}>
          <i className="dot" />
          {bound.exact ? '已证明最优' : '保守界（非最优）'}
        </span>
      </div>
      <div className="kv" style={{ marginTop: 8 }}>
        <dt>保守外逼近</dt>
        <dd className="mono">{toFraction(bound.outer)}</dd>
        <dt>可达内界</dt>
        <dd className="mono">
          {bound.inner === null ? '无' : toFraction(bound.inner)}
          {bound.innerKind === 'trivial' && (
            <span style={{ color: 'var(--text-muted)' }}>（平凡值）</span>
          )}
        </dd>
        <dt>离散化间隙</dt>
        <dd className="mono">{toFraction(bound.gap)}</dd>
        <dt>sup h 取到于</dt>
        <dd className="mono">
          x = {toDecimalString(bound.certificate.supPoint, 8)}
          {bound.certificate.supSide !== 'at' &&
            `（${bound.certificate.supSide === 'left' ? '左极限' : '右极限'}）`}
        </dd>
      </div>
      <RangeStrip
        inner={bound.inner}
        outer={bound.outer}
        direction={bound.direction}
        label={METRIC_LABEL[metric]}
      />
      <div className="verify-list" style={{ marginTop: 8 }}>
        <VerifyLine
          ok={bound.certificate.signOk}
          text={bound.certificate.signOk ? '对偶乘子方向正确' : '对偶乘子方向错误（证书无效）'}
        />
        {bound.innerWitnessCheck && (
          <VerifyLine
            ok={bound.innerWitnessCheck.ok}
            text={
              bound.innerWitnessCheck.ok
                ? '内界达到分布通过复核：非负、Σp = 1、全部摘要约束成立、目标值等于所报内界'
                : '内界达到分布未通过复核'
            }
          />
        )}
        <VerifyLine
          ok={bound.certificate.valid}
          text={`分段二次上确界在支撑区间上精确求值：检查了 ${bound.certificate.checkedPoints} 个候选点（含各断点单侧极限与凹二次顶点）`}
        />
      </div>
      <div className="notice" style={{ marginTop: 8 }}>
        <span>{bound.message}</span>
      </div>
      {bound.innerWitness && bound.innerWitnessCheck?.ok && (
        <details style={{ marginTop: 8 }}>
          <summary>可达内界的分布（断点支撑）</summary>
          <div className="details-body">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>断点</th>
                    <th className="num">概率质量</th>
                    <th className="num">精确分数</th>
                  </tr>
                </thead>
                <tbody>
                  {bound.innerWitness.map((p, i) => (
                    <tr key={i}>
                      <td className="mono">{supportTexts[i] ?? i + 1}</td>
                      <td className="num mono">{toDecimalString(p, 8)}</td>
                      <td className="num mono">{toFraction(p)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>合计</td>
                    <td className="num mono">
                      {toDecimalString(
                        bound.innerWitness.reduce((acc, p) => add(acc, p), ZERO),
                        8,
                      )}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="footer-note" style={{ marginTop: 8 }}>
              该质量向量只落在断点上，因此对应一个合法的连续分布；它达到内界，但不是连续最优的证明。
            </p>
          </div>
        </details>
      )}
      <details style={{ marginTop: 8 }}>
        <summary>对偶证据与求值细节</summary>
        <div className="details-body">
          <div className="kv" style={{ marginBottom: 8 }}>
            <dt>μ₀</dt>
            <dd className="mono">{toFraction(bound.certificate.mu0)}</dd>
            <dt>sup h(x)</dt>
            <dd className="mono">{toFraction(bound.certificate.supValue)}</dd>
            <dt>乘子·右端 b·w</dt>
            <dd className="mono">{toFraction(sub(bound.certificate.bound, add(bound.certificate.mu0, bound.certificate.supValue)))}</dd>
            <dt>cut 轮数</dt>
            <dd className="mono">{bound.certificate.cutIterations}</dd>
            <dt>采样点数</dt>
            <dd className="mono">{bound.certificate.samples}</dd>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>约束</th>
                  <th className="num">右端项 b</th>
                  <th className="num">乘子 w</th>
                  <th>方向</th>
                </tr>
              </thead>
              <tbody>
                {bound.certificate.rows.map((r, i) => (
                  <tr key={`${r.key}-${i}`}>
                    <td>{r.label}</td>
                    <td className="num mono">{toFraction(r.bound)}</td>
                    <td className="num mono">{toFraction(r.multiplier)}</td>
                    <td>
                      <span
                        className={`chip ${r.signOk ? 'good' : 'bad'}`}
                        style={{ fontSize: 11 }}
                      >
                        {r.signOk ? '正确' : '错误'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footer-note" style={{ marginTop: 8 }}>
            外逼近：对任意满足 Σ w·a(P) = b·w 的分布，∫g dP ≤ μ₀ + b·w + sup h(x)。
            上确界在所有断点单侧与凹二次顶点处精确取到；这不是网格采样。
          </p>
          {bound.gridSolution !== undefined && (
            <p className="footer-note">{bound.gridDerivation}</p>
          )}
        </div>
      </details>
    </div>
  );
}

function RangeStrip({
  inner,
  outer,
  direction,
  label,
}: {
  inner: Rat | null;
  outer: Rat;
  direction: 'min' | 'max';
  label: string;
}) {
  if (inner === null) return null;
  const lo = direction === 'max' ? inner : outer;
  const hi = direction === 'max' ? outer : inner;
  const axisMax = Math.max(Number(outer.n) / Number(outer.d), 1e-9) * 1.15;
  const pos = (r: Rat) => Math.min(100, Math.max(0, (Number(r.n) / Number(r.d) / axisMax) * 100));
  const a = Math.min(pos(lo), pos(hi));
  const b = Math.max(pos(lo), pos(hi));
  return (
    <div style={{ marginTop: 10 }} role="img" aria-label={`${label} 的可达内界与外逼近区间`}>
      <div
        style={{
          position: 'relative',
          height: 8,
          background: 'var(--gridline)',
          borderRadius: 4,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${a}%`,
            width: `${Math.max(b - a, 0.6)}%`,
            top: 0,
            bottom: 0,
            background: 'var(--series-1)',
            opacity: 0.28,
            borderRadius: 4,
          }}
        />
        <div
          title={`可达内界 ${toFraction(inner)}`}
          style={{
            position: 'absolute',
            left: `calc(${pos(inner)}% - 1.5px)`,
            width: 3,
            top: -3,
            bottom: -3,
            background: 'var(--series-1)',
            borderRadius: 2,
          }}
        />
        <div
          title={`保守外逼近 ${toFraction(outer)}`}
          style={{
            position: 'absolute',
            left: `calc(${pos(outer)}% - 1.5px)`,
            width: 3,
            top: -3,
            bottom: -3,
            background: 'var(--series-2)',
            borderRadius: 2,
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--text-muted)',
          marginTop: 3,
          gap: 8,
        }}
      >
        <span>
          可达内界 <span className="mono">{toFraction(inner)}</span>
        </span>
        <span className="mono" style={{ color: 'var(--text-secondary)' }}>
          间隙 {toFraction(abs(sub(outer, inner)))}
        </span>
        <span>
          保守外逼近 <span className="mono">{toFraction(outer)}</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribution comparison for different bounds

function BoundsComparison({
  analysis,
  targetId,
}: {
  analysis: AnalysisResult;
  targetId: string;
}) {
  const [metric, setMetric] = useState<Metric>('tail');
  const finiteBounds = useMemo(
    () =>
      analysis.bounds.filter(
        (b): b is FiniteBound =>
          b.mode === 'finite' &&
          b.status === 'ok' &&
          b.targetId === targetId &&
          b.metric === metric,
      ),
    [analysis, targetId, metric],
  );
  if (finiteBounds.length === 0) return null;
  const supports = analysis.supportTexts;
  const sameWitness =
    finiteBounds.length === 2 &&
    finiteBounds[0].witness!.length === finiteBounds[1].witness!.length &&
    finiteBounds[0].witness!.every((v, i) => eq(v, finiteBounds[1].witness![i]));
  // One shared scale so the two distributions are visually comparable.
  let sharedMax: Rat | undefined;
  for (const b of finiteBounds) {
    for (const p of b.witness ?? []) {
      if (sharedMax === undefined || cmp(p, sharedMax) > 0) sharedMax = p;
    }
  }
  return (
    <div className="card">
      <header>
        <h2>各界的达到分布对照</h2>
        <span className="hint">不同界的达到分布不一定相同</span>
      </header>
      <div className="body">
        <div className="seg" style={{ marginBottom: 10 }}>
          {(['tail', 'loss'] as Metric[]).map((m) => (
            <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {finiteBounds.map((b) => {
            const color = b.direction === 'min' ? 'var(--series-1)' : 'var(--series-2)';
            return (
              <DistributionChart
                key={b.direction}
                title={`${DIR_LABEL[b.direction]} · ${formatMetricValue(metric, b.value)}`}
                subtitle={b.witnessCheck?.ok ? '达到分布已复核' : '达到分布未复核'}
                bars={supports.map((label, i) => ({ label, value: b.witness![i] }))}
                xLabel="取值"
                yFormat="percent"
                height={170}
                color={color}
                yMax={sharedMax}
              />
            );
          })}
        </div>
        <p className="footer-note">
          {sameWitness
            ? '这两个界由同一个分布达到。'
            : '每个界展示各自达到它的概率质量向量；它们不必是同一个分布。要检查能否由同一分布同时达到，请使用联合检查。'}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Joint attainability

function JointPanel({
  analysis,
  problem,
  onJoint,
}: {
  analysis: AnalysisResult;
  problem: CompiledProblem;
  onJoint: (r: JointCheckResult) => void;
}) {
  const candidates = analysis.bounds.filter(
    (b) =>
      (b.mode === 'finite' && b.status === 'ok') ||
      (b.mode === 'continuous' && b.status === 'ok'),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<JointCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A joint result describes one exact set of inputs. When the summaries,
  // support or targets change it is no longer evidence for what is on screen.
  useEffect(() => {
    setResult(null);
    setError(null);
    setSelected(new Set());
  }, [problem]);

  const keyOf = (b: Bound) => `${b.targetId}|${b.metric}|${b.direction}`;
  const pairKeyOf = (b: Bound) => `${b.targetId}|${b.metric}`;
  const toggle = (b: Bound) => {
    const k = keyOf(b);
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else {
      // A lower and an upper bound of the same quantity are two different
      // numbers by construction; selecting both would make the check fail for
      // a definitional reason. Replace instead of accumulating.
      for (const other of candidates) {
        if (pairKeyOf(other) === pairKeyOf(b) && other.direction !== b.direction) {
          next.delete(keyOf(other));
        }
      }
      next.add(k);
    }
    setSelected(next);
    setResult(null);
    setError(null);
  };
  const run = () => {
    const items: JointCheckItem[] = candidates
      .filter((b) => selected.has(keyOf(b)))
      .map((b) => ({ targetId: b.targetId, metric: b.metric, direction: b.direction }));
    if (items.length < 2) {
      setError('请至少选择两个界再运行联合检查。');
      setResult(null);
      return;
    }
    const r = jointCheck(problem, analysis, items);
    setResult(r);
    setError(null);
    onJoint(r);
  };

  if (candidates.length === 0) {
    return (
      <div className="card">
        <header>
          <h2>联合检查</h2>
        </header>
        <div className="body">
          <div className="empty">当前没有可用的界可供联合检查。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <header>
        <h2>联合检查</h2>
        <span className="hint">同一分布能否同时达到多个界</span>
      </header>
      <div className="body">
        <div className="joint-list">
          {candidates.map((b) => {
            const k = keyOf(b);
            const value =
              b.mode === 'finite'
                ? formatMetricValue(b.metric, b.value)
                : `${formatMetricValue(b.metric, b.outer)}（外逼近）`;
            return (
              <label className="joint-row" key={k}>
                <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(b)} />
                <span>
                  {targetLabel(analysis, b.targetId)} · {METRIC_LABEL[b.metric]}
                  {DIR_LABEL[b.direction]}
                </span>
                <span className="val mono">{value}</span>
              </label>
            );
          })}
        </div>
        <div className="row">
          <button className="btn primary" onClick={run}>
            运行联合检查
          </button>
          <button
            className="btn ghost"
            title="每个量只选一个方向（优先上界）：下界与上界是同一量的两个极端，不可能由同一分布同时达到"
            onClick={() => {
              // One direction per quantity: min and max of the same quantity
              // are different numbers, so selecting both is a request error
              // rather than something a distribution could ever satisfy.
              // Prefer the upper bound — "how large can it be" is the question
              // this tool is built around.
              const prefer = new Map<string, Bound>();
              for (const b of candidates) {
                const pk = pairKeyOf(b);
                const cur = prefer.get(pk);
                if (!cur || (cur.direction !== 'max' && b.direction === 'max')) {
                  prefer.set(pk, b);
                }
              }
              setSelected(new Set([...prefer.values()].map(keyOf)));
              setResult(null);
              setError(null);
            }}
          >
            全选（每量上界）
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setSelected(new Set());
              setResult(null);
              setError(null);
            }}
          >
            清空
          </button>
        </div>
        {error && (
          <div className="notice warn" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
        {result && <JointResultView result={result} analysis={analysis} />}
        <p className="footer-note">
          {analysis.finiteMode
            ? '有限模式：把所选界的数值作为等式约束加入原摘要 LP，求解可行性；若不可行，给出最小冲突集合，并保留原摘要不动。'
            : '连续模式：在断点支撑上求解。可行即给出真实连续分布的见证；不可行只说明该离散化无法联合达到，不构成连续不可行的证明。'}
        </p>
      </div>
    </div>
  );
}

function JointResultView({
  result,
  analysis,
}: {
  result: JointCheckResult;
  analysis: AnalysisResult;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div
        className={`notice ${
          result.status === 'attainable'
            ? 'ok'
            : result.status === 'not-attainable'
              ? 'error'
              : 'warn'
        }`}
      >
        <span>
          <strong>
            {result.status === 'attainable'
              ? '联合可达'
              : result.status === 'not-attainable'
                ? '联合不可达'
                : '未能判定'}
          </strong>{' '}
          — {result.message}
        </span>
      </div>
      {result.witness && (
        <details open style={{ marginTop: 10 }}>
          <summary>联合见证：同一分布达到全部所选界</summary>
          <div className="details-body">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>取值</th>
                    <th className="num">概率质量</th>
                    <th className="num">精确分数</th>
                  </tr>
                </thead>
                <tbody>
                  {result.witness.map((p, i) => (
                    <tr key={i}>
                      <td className="mono">{analysis.supportTexts[i] ?? i + 1}</td>
                      <td className="num mono">{toDecimalString(p, 8)}</td>
                      <td className="num mono">{toFraction(p)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ color: 'var(--text-muted)' }}>合计</td>
                    <td className="num mono">
                      {toDecimalString(
                        result.witness.reduce((s, p) => add(s, p), ZERO),
                        8,
                      )}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {result.witnessChecks && (
              <div className="verify-list" style={{ marginTop: 8 }}>
                {result.witnessChecks.map((c, i) => (
                  <VerifyLine key={i} ok={c.ok} text={`${c.label}：见证值 ${toFraction(c.value)}`} />
                ))}
              </div>
            )}
          </div>
        </details>
      )}
      {result.conflict && (
        <div style={{ marginTop: 10 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>最小冲突组</th>
                  <th>类型</th>
                  <th>集合内去掉此项</th>
                  <th>完整模型中去掉此项</th>
                  <th>完整模型解出的质量向量</th>
                </tr>
              </thead>
              <tbody>
                {result.conflict.groups.map((g) => {
                  const dw = result.conflict!.dropWitnesses.find((x) => x.droppedId === g.id);
                  return (
                    <tr key={g.id}>
                      <td>{g.label}</td>
                      <td>
                        {g.kind === 'bound' ? '所选界' : g.kind === 'unit' ? '总质量' : '摘要'}
                      </td>
                      <td>
                        <span
                          className={`chip ${dw?.minimalityFeasible ? 'good' : 'bad'}`}
                          style={{ fontSize: 11 }}
                        >
                          {dw?.minimalityFeasible ? '恢复可行' : '仍不可行'}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`chip ${dw?.feasible ? 'good' : 'warn'}`}
                          style={{ fontSize: 11 }}
                        >
                          {dw?.feasible ? '可行' : '仍不可行'}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {dw?.feasible && dw.witness
                          ? dw.witness
                              .map(
                                (p, i) =>
                                  `${analysis.supportTexts[i] ?? i + 1}:${toDecimalString(p, 4)}`,
                              )
                              .filter((s) => !s.endsWith(':0'))
                              .join('  ') || '零质量'
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="footer-note" style={{ marginTop: 8 }}>
            最后一列的质量向量来自「删掉该项后的完整模型」：它满足除被删掉那一项之外的全部约束
            （若删掉的正是 Σp = 1，它就不再是分布，只用于证明其余约束相容）。所选界的数值只作为
            等式加入检查，原摘要未被改动。
          </p>
        </div>
      )}
      {result.resolution && (
        <div className="verify-list" style={{ marginTop: 8 }}>
          <VerifyLine
            ok={result.resolution.conflictReproduced}
            text={
              result.resolution.conflictReproduced
                ? '冲突集合本身已复核：仅保留这些项仍然不可行'
                : '冲突集合本身未能复现不可行（求解器结果不一致，请勿采信本结论）'
            }
          />
          <VerifyLine
            ok={result.resolution.dropChecks.every((d) => d.minimalityFeasible)}
            text={
              result.resolution.dropChecks.every((d) => d.minimalityFeasible)
                ? '最小性已复核：在冲突集合内部去掉任何一项，剩余项都重新可行'
                : `最小性未通过：去掉${result.resolution.dropChecks
                    .filter((d) => !d.minimalityFeasible)
                    .map((d) => `「${d.label}」`)
                    .join('、')}后，冲突集合内部仍不可行`
            }
          />
          <VerifyLine
            ok={result.resolution.dropChecks.every((d) => d.feasible)}
            status={
              result.resolution.dropChecks.every((d) => d.feasible) ? 'ok' : 'info'
            }
            text={
              result.resolution.dropChecks.every((d) => d.feasible)
                ? '这就是全部冲突：从完整模型中删掉任何一项，其余摘要与所选界都会重新同时可行'
                : `从完整模型中删掉某些项后整体仍不可行，说明此外还有独立冲突；本表只列出其中一处。这不是本次检查的错误，联合不可达的结论仍然成立`
            }
          />
        </div>
      )}
      {result.gridNote && <p className="footer-note">{result.gridNote}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BruteForcePanel({ analysis }: { analysis: AnalysisResult }) {
  const bf = analysis.bruteForce;
  if (!bf) return null;
  return (
    <div className="card">
      <header>
        <h2>独立核对</h2>
        <span className="hint">顶点枚举 vs 单纯形</span>
      </header>
      <div className="body">
        {bf.available ? (
          <>
            <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>{bf.reason}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>目标</th>
                    <th className="num">枚举最小值</th>
                    <th className="num">枚举最大值</th>
                    <th>与 LP 一致</th>
                  </tr>
                </thead>
                <tbody>
                  {bf.objectives.map((o) => (
                    <tr key={o.label}>
                      <td>{o.label}</td>
                      <td className="num mono">{o.min !== undefined ? toFraction(o.min) : '—'}</td>
                      <td className="num mono">{o.max !== undefined ? toFraction(o.max) : '—'}</td>
                      <td>
                        <span className="chip good" style={{ fontSize: 11 }}>
                          {o.matches ? '一致' : '不一致'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="footer-note">
              枚举在全部可行顶点上取目标值的最大/最小；单纯形结果与之一致才显示“一致”。
            </p>
          </>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{bf.reason}</p>
        )}
      </div>
    </div>
  );
}

function targetLabel(analysis: AnalysisResult, id: string): string {
  return analysis.problem.targets.find((t) => t.input.id === id)?.label ?? id;
}
