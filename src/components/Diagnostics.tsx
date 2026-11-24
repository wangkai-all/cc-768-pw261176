import type { AnalysisResult, InfeasibilityReport, PairCompatibility } from '../core/analysis';
import { toDecimalString, ZERO } from '../core/rational';
import type { CompiledProblem } from '../core/model';

const METRIC_LABEL = { tail: '尾部比例', loss: '截断损失' } as const;
const DIR_LABEL = { min: '下界', max: '上界' } as const;

export function DiagnosticsPanel({
  problem,
  analysis,
}: {
  problem: CompiledProblem;
  analysis: AnalysisResult;
}) {
  const errors = problem.issues.filter((i) => i.severity === 'error');
  const warnings = problem.issues.filter((i) => i.severity === 'warning');
  const feas = analysis.feasibility;
  const statusChip =
    feas.status === 'feasible'
      ? { cls: 'good', text: '可行' }
      : feas.status === 'infeasible'
        ? { cls: 'bad', text: '不可行' }
        : { cls: 'warn', text: '未判定' };

  return (
    <div className="card">
      <header>
        <h2>可行性诊断</h2>
        <span className="hint">输入保持原样；只报告冲突，不自动修正</span>
      </header>
      <div className="body">
        <div className="row" style={{ marginBottom: 10, gap: 8 }}>
          <span className={`chip ${statusChip.cls}`}>
            <i className="dot" />
            {statusChip.text}
          </span>
          {analysis.finiteMode ? (
            <span className="hint">
              有限取值 · {analysis.supportValues.length} 个质量变量
            </span>
          ) : (
            <span className="hint">
              连续区间 [{toDecimalString(problem.supportLo ?? ZERO, 6)},{' '}
              {toDecimalString(problem.supportHi ?? ZERO, 6)}] · {analysis.supportValues.length} 个断点
            </span>
          )}
        </div>

        {errors.length > 0 && (
          <ul className="issues" style={{ marginBottom: 10 }}>
            {errors.map((i) => (
              <li key={i.id} className="error">
                <div>
                  <strong>{i.message}</strong>
                  {i.detail && <div className="detail">{i.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="issues" style={{ marginBottom: 10 }}>
            {warnings.map((i) => (
              <li key={i.id} className="warning">
                <div>
                  <strong>{i.message}</strong>
                  {i.detail && <div className="detail">{i.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {feas.status === 'feasible' && (
          <div className="notice ok" style={{ marginBottom: 10 }}>
            <span>
              全部摘要区间可以同时满足。求解时每条舍入摘要按整个区间约束进入，不以中心值替代。
            </span>
          </div>
        )}

        {feas.status === 'infeasible' && feas.conflict && (
          <ConflictView conflict={feas.conflict} supportTexts={analysis.supportTexts} />
        )}

        {feas.status === 'undecided' && <div className="notice warn">{feas.message}</div>}

        <details style={{ marginTop: 10 }} open={false}>
          <summary>进入求解的约束与假设</summary>
          <div className="details-body">
            <div className="table-wrap" style={{ marginBottom: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>摘要</th>
                    <th>进入求解的区间</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {problem.summaries.map((s) => (
                    <tr key={s.input.id}>
                      <td>{s.label}</td>
                      <td className="mono">
                        {s.input.kind === 'count'
                          ? `N·P(X ∈ bin) ∈ [${toDecimalString(s.interval.lo, 8)}, ${toDecimalString(s.interval.hi, 8)}]`
                          : `[${toDecimalString(s.interval.lo, 8)}, ${toDecimalString(s.interval.hi, 8)}]`}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
                        {s.interval.derivation}
                      </td>
                    </tr>
                  ))}
                  {problem.summaries.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ color: 'var(--text-muted)' }}>
                        没有启用的摘要；界退化为平凡范围。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {analysis.assumptions.map((a, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {a}
                </li>
              ))}
            </ul>
          </div>
        </details>

        <PairView pairs={analysis.pairCompatibility} analysis={analysis} />
      </div>
    </div>
  );
}

function ConflictView({
  conflict,
  supportTexts,
}: {
  conflict: NonNullable<InfeasibilityReport['conflict']>;
  supportTexts: string[];
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="notice error" style={{ marginBottom: 10 }}>
        <span>
          <strong>摘要区间互相矛盾。</strong> 下表是删除过滤得到的最小冲突集合：“集合内去掉该项”
          一列是它之所以被称为最小的依据；“完整模型中去掉该项”一列回答更强的问题——这一处冲突
          是否就是全部矛盾。应用没有放宽、截断或改写任何原摘要。
        </span>
      </div>
      {!conflict.dropWitnesses.every((d) => d.feasible) && (
        <div className="notice warn" style={{ marginBottom: 10 }}>
          <span>
            从完整模型中删掉本表某项后仍然不可行，说明本表之外还有另一处独立冲突；
            本表列出的只是其中一处，不是对全部矛盾的完整诊断。
          </span>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>最小冲突集合中的项</th>
              <th>类型</th>
              <th>集合内去掉该项</th>
              <th>完整模型中去掉该项</th>
              <th>完整模型解出的质量向量</th>
            </tr>
          </thead>
          <tbody>
            {conflict.groups.map((g) => {
              const dw = conflict.dropWitnesses.find((x) => x.droppedId === g.id);
              return (
                <tr key={g.id}>
                  <td>{g.label}</td>
                  <td>{g.kind === 'summary' ? '摘要' : g.kind === 'unit' ? '总质量' : '所选界'}</td>
                  <td>
                    <span className={`chip ${dw?.minimalityFeasible ? 'good' : 'bad'}`}>
                      {dw?.minimalityFeasible ? '可行' : '仍不可行'}
                    </span>
                  </td>
                  <td>
                    <span className={`chip ${dw?.feasible ? 'good' : 'warn'}`}>
                      {dw?.feasible ? '可行' : '仍不可行'}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {dw?.feasible && dw.witness
                      ? dw.witness
                          .map((p, i) => `${supportTexts[i] ?? i + 1}:${toDecimalString(p, 4)}`)
                          .filter((s) => !s.endsWith(':0'))
                          .join('  ')
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="footer-note" style={{ marginTop: 8 }}>
        最后一列的质量向量来自删掉该项后的完整模型：满足除被删掉那一项之外的全部约束（若删掉的正是
        Σp = 1，它就不再是分布，只用于证明其余约束相容）。冲突项之外的摘要保持原值；诊断只读取输入，
        不会为了让求解器通过而改动它们。
      </p>
    </div>
  );
}

function PairView({
  pairs,
  analysis,
}: {
  pairs: PairCompatibility[];
  analysis: AnalysisResult;
}) {
  if (pairs.length === 0) return null;
  const no = pairs.filter((p) => p.status === 'no');
  const yes = pairs.filter((p) => p.status === 'yes').length;
  const label = (key: string) => {
    const [targetId, metric, direction] = key.split('|');
    const b = analysis.bounds.find(
      (x) => x.targetId === targetId && x.metric === metric && x.direction === direction,
    );
    return b
      ? `${b.targetLabel} · ${METRIC_LABEL[b.metric]}${DIR_LABEL[b.direction]}`
      : key;
  };
  return (
    <details style={{ marginTop: 10 }}>
      <summary>
        两两联合可达性（{yes} 对可达，{no.length} 对不可同时达到）
      </summary>
      <div className="details-body">
        {no.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12.5 }}>
            任意两个界都可以由同一个分布同时达到。三个及以上请使用“联合检查”。
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>界 A</th>
                  <th>界 B</th>
                  <th>同一分布</th>
                </tr>
              </thead>
              <tbody>
                {no.map((p) => (
                  <tr key={`${p.a}~${p.b}`}>
                    <td>{label(p.a)}</td>
                    <td>{label(p.b)}</td>
                    <td>
                      <span className="chip bad">不可同时达到</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="footer-note" style={{ marginTop: 8 }}>
          两两可达不推出全体可达；每个界的达到分布可能不同，请用联合检查核对。
        </p>
      </div>
    </details>
  );
}
