import type {
  BoundMode,
  CountBin,
  SummaryInput,
  SupportInput,
  TargetInput,
  Workspace,
} from '../core/model';
import { binMembershipLabel, makeSummary, makeTarget } from '../core/model';
import { toDecimalString } from '../core/rational';
import type { CompiledProblem } from '../core/model';

const KIND_LABEL: Record<SummaryInput['kind'], string> = {
  mean: '均值',
  second: '二阶矩',
  count: '区间计数',
};

const MODE_LABEL: Record<BoundMode, string> = {
  exact: '精确值',
  rounded: '舍入值',
  interval: '直接区间',
};

interface Props {
  ws: Workspace;
  problem: CompiledProblem;
  onChange: (ws: Workspace) => void;
}

export function SummaryEditor({ ws, problem, onChange }: Props) {
  const patch = (p: Partial<Workspace>) => onChange({ ...ws, ...p });

  const updateSummary = (id: string, p: Partial<SummaryInput>) => {
    patch({ summaries: ws.summaries.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  };
  const updateBound = (s: SummaryInput, p: Partial<SummaryInput['bound']>) =>
    updateSummary(s.id, { bound: { ...s.bound, ...p } });
  const updateBin = (s: SummaryInput, p: Partial<CountBin>) =>
    updateSummary(s.id, { countBin: { ...(s.countBin as CountBin), ...p } });

  const addSummary = (kind: SummaryInput['kind']) =>
    patch({ summaries: [...ws.summaries, makeSummary(kind)] });

  return (
    <div className="card">
      <header>
        <h2>源摘要</h2>
        <span className="hint">原样保留，不做任何自动修正</span>
      </header>
      <div className="body">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="field grow" style={{ marginBottom: 0 }}>
            <label htmlFor="ws-name">分析名称</label>
            <input
              id="ws-name"
              type="text"
              value={ws.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 130 }}>
            <label htmlFor="sample">样本总量 N</label>
            <input
              id="sample"
              type="text"
              inputMode="decimal"
              value={ws.sampleSize}
              onChange={(e) => patch({ sampleSize: e.target.value })}
            />
          </div>
        </div>

        <SupportEditor support={ws.support} onChange={(support) => patch({ support })} />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            margin: '16px 0 8px',
          }}
        >
          <strong style={{ fontSize: 13 }}>摘要条目</strong>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn small" onClick={() => addSummary('mean')}>
              + 均值
            </button>
            <button className="btn small" onClick={() => addSummary('second')}>
              + 二阶矩
            </button>
            <button className="btn small" onClick={() => addSummary('count')}>
              + 区间计数
            </button>
          </div>
        </div>

        {ws.summaries.length === 0 && (
          <div className="empty">尚未添加摘要。没有摘要时，界退化为平凡范围。</div>
        )}

        {ws.summaries.map((s, idx) => {
          const compiled = problem.summaries.find((c) => c.input.id === s.id);
          return (
            <div className="summary-item" key={s.id}>
              <div className="summary-item-head">
                <span className="kind">{KIND_LABEL[s.kind]}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>#{idx + 1}</span>
                <label
                  className="chip neutral"
                  style={{ marginLeft: 'auto', cursor: 'pointer', gap: 4 }}
                  title="停用后该摘要不进入求解，但保留在文件中"
                >
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => updateSummary(s.id, { enabled: e.target.checked })}
                    style={{ width: 'auto' }}
                  />
                  启用
                </label>
                <button
                  className="btn small danger"
                  onClick={() => patch({ summaries: ws.summaries.filter((x) => x.id !== s.id) })}
                  aria-label={`删除摘要 ${idx + 1}`}
                >
                  删除
                </button>
              </div>

              <div className="field">
                <label htmlFor={`label-${s.id}`}>标签（可选）</label>
                <input
                  id={`label-${s.id}`}
                  type="text"
                  placeholder={KIND_LABEL[s.kind]}
                  value={s.label}
                  onChange={(e) => updateSummary(s.id, { label: e.target.value })}
                />
              </div>

              {s.kind === 'count' && (
                <div className="row" style={{ marginBottom: 8 }}>
                  <div className="field" style={{ marginBottom: 0, width: 92 }}>
                    <label>取值下界</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={s.countBin?.lo ?? ''}
                      onChange={(e) => updateBin(s, { lo: e.target.value })}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0, width: 92 }}>
                    <label>取值上界</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={s.countBin?.hi ?? ''}
                      onChange={(e) => updateBin(s, { hi: e.target.value })}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>区间开闭</label>
                    <div className="seg">
                      <button
                        aria-pressed={s.countBin?.loInclusive ?? true}
                        onClick={() => updateBin(s, { loInclusive: true })}
                      >
                        下界闭
                      </button>
                      <button
                        aria-pressed={!(s.countBin?.loInclusive ?? true)}
                        onClick={() => updateBin(s, { loInclusive: false })}
                      >
                        下界开
                      </button>
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>&nbsp;</label>
                    <div className="seg">
                      <button
                        aria-pressed={s.countBin?.hiInclusive ?? false}
                        onClick={() => updateBin(s, { hiInclusive: true })}
                      >
                        上界闭
                      </button>
                      <button
                        aria-pressed={!(s.countBin?.hiInclusive ?? false)}
                        onClick={() => updateBin(s, { hiInclusive: false })}
                      >
                        上界开
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="row" style={{ marginBottom: 6 }}>
                <div className="field" style={{ marginBottom: 0, minWidth: 150 }}>
                  <label>源数字形式</label>
                  <div className="seg">
                    {(Object.keys(MODE_LABEL) as BoundMode[]).map((m) => (
                      <button
                        key={m}
                        aria-pressed={s.bound.mode === m}
                        onClick={() => updateBound(s, { mode: m })}
                      >
                        {MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>
                {s.bound.mode === 'exact' && (
                  <div className="field grow" style={{ marginBottom: 0 }}>
                    <label>数值</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={s.bound.value}
                      onChange={(e) => updateBound(s, { value: e.target.value })}
                    />
                  </div>
                )}
                {s.bound.mode === 'rounded' && (
                  <>
                    <div className="field grow" style={{ marginBottom: 0 }}>
                      <label>源报告值</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={s.bound.value}
                        onChange={(e) => updateBound(s, { value: e.target.value })}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0, width: 110 }}>
                      <label>舍入步长</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={s.bound.step}
                        onChange={(e) => updateBound(s, { step: e.target.value })}
                      />
                    </div>
                  </>
                )}
                {s.bound.mode === 'interval' && (
                  <>
                    <div className="field grow" style={{ marginBottom: 0 }}>
                      <label>
                        {s.kind === 'count' ? '计数下界' : '区间下界'}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={s.bound.lo}
                        onChange={(e) => updateBound(s, { lo: e.target.value })}
                      />
                    </div>
                    <div className="field grow" style={{ marginBottom: 0 }}>
                      <label>
                        {s.kind === 'count' ? '计数上界' : '区间上界'}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={s.bound.hi}
                        onChange={(e) => updateBound(s, { hi: e.target.value })}
                      />
                    </div>
                  </>
                )}
              </div>

              {compiled ? (
                <div className="derived">
                  <span style={{ color: 'var(--text-muted)' }}>进入求解的约束：</span>
                  <span className="mono">
                    {s.kind === 'count' && s.countBin
                      ? `N·P(X ∈ ${binMembershipLabel(s.countBin)})`
                      : s.kind === 'mean'
                        ? 'E[X]'
                        : 'E[X²]'}{' '}
                    ∈ [
                    {toDecimalString(
                      s.kind === 'count'
                        ? compiled.interval.lo
                        : compiled.interval.lo,
                      8,
                    )}
                    ,{' '}
                    {toDecimalString(compiled.interval.hi, 8)}]
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    （{compiled.interval.derivation}）
                  </span>
                </div>
              ) : (
                <div className="derived" style={{ color: 'var(--critical)' }}>
                  该条目目前无法编译，请检查上方数值。
                </div>
              )}

              <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                <label>备注（可选）</label>
                <input
                  type="text"
                  value={s.note}
                  onChange={(e) => updateSummary(s.id, { note: e.target.value })}
                  placeholder="例如：来源表 3，疑似录入错误"
                />
              </div>
            </div>
          );
        })}

        <TargetEditor
          targets={ws.targets}
          onChange={(targets) => patch({ targets })}
        />

        <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
          <label htmlFor="notes">分析师备注</label>
          <textarea
            id="notes"
            value={ws.analystNotes}
            onChange={(e) => patch({ analystNotes: e.target.value })}
            placeholder="记录数据来源、口径与已知问题；会随存档一起保存。"
          />
        </div>
      </div>
    </div>
  );
}

function SupportEditor({
  support,
  onChange,
}: {
  support: SupportInput;
  onChange: (s: SupportInput) => void;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 13 }}>取值集合</strong>
        <div className="seg">
          <button
            aria-pressed={support.mode === 'finite'}
            onClick={() =>
              onChange({ mode: 'finite', values: support.mode === 'finite' ? support.values : ['0', '1', '2', '3', '5'] })
            }
          >
            有限集合
          </button>
          <button
            aria-pressed={support.mode === 'continuous'}
            onClick={() =>
              onChange({
                mode: 'continuous',
                lo: support.mode === 'continuous' ? support.lo : '0',
                hi: support.mode === 'continuous' ? support.hi : '10',
                grid: support.mode === 'continuous' ? support.grid : 32,
              })
            }
          >
            连续区间
          </button>
        </div>
      </div>

      {support.mode === 'finite' ? (
        <>
          <div className="field">
            <label htmlFor="values">可能取值（逗号或换行分隔，按数值排序）</label>
            <textarea
              id="values"
              value={support.values.join(', ')}
              onChange={(e) =>
                onChange({
                  mode: 'finite',
                  values: e.target.value
                    .split(/[,，\n]/)
                    .map((x) => x.trim())
                    .filter((x) => x !== ''),
                })
              }
              spellCheck={false}
            />
            <span className="help">
              集合之外的取值被视为零质量。应用不会补造任何个体记录。
            </span>
          </div>
        </>
      ) : (
        <div className="row">
          <div className="field grow" style={{ marginBottom: 0 }}>
            <label>区间下界</label>
            <input
              type="text"
              inputMode="decimal"
              value={support.lo}
              onChange={(e) => onChange({ ...support, lo: e.target.value })}
            />
          </div>
          <div className="field grow" style={{ marginBottom: 0 }}>
            <label>区间上界</label>
            <input
              type="text"
              inputMode="decimal"
              value={support.hi}
              onChange={(e) => onChange({ ...support, hi: e.target.value })}
            />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 110 }}>
            <label>网格单元数</label>
            <input
              type="number"
              min={2}
              max={120}
              value={support.grid}
              onChange={(e) => onChange({ ...support, grid: Number(e.target.value) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TargetEditor({
  targets,
  onChange,
}: {
  targets: TargetInput[];
  onChange: (t: TargetInput[]) => void;
}) {
  const update = (id: string, p: Partial<TargetInput>) =>
    onChange(targets.map((t) => (t.id === id ? { ...t, ...p } : t)));
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          margin: '16px 0 8px',
          borderTop: '1px solid var(--border)',
          paddingTop: 12,
        }}
      >
        <strong style={{ fontSize: 13 }}>阈值与目标</strong>
        <button
          className="btn small"
          onClick={() => onChange([...targets, makeTarget(targets.length + 1)])}
        >
          + 阈值
        </button>
      </div>
      {targets.length === 0 && <div className="empty">尚未设置阈值。</div>}
      {targets.map((t, idx) => (
        <div className="target-item" key={t.id}>
          <div className="target-item-head">
            <span className="kind" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              阈值 #{idx + 1}
            </span>
            <button
              className="btn small danger"
              style={{ marginLeft: 'auto' }}
              onClick={() => onChange(targets.filter((x) => x.id !== t.id))}
            >
              删除
            </button>
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="field grow" style={{ marginBottom: 0 }}>
              <label>阈值 t</label>
              <input
                type="text"
                inputMode="decimal"
                value={t.threshold}
                onChange={(e) => update(t.id, { threshold: e.target.value })}
              />
            </div>
            <div className="field grow" style={{ marginBottom: 0 }}>
              <label>标签（可选）</label>
              <input
                type="text"
                value={t.label}
                onChange={(e) => update(t.id, { label: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>尾部口径</label>
              <div className="seg">
                <button
                  aria-pressed={!t.strictTail}
                  onClick={() => update(t.id, { strictTail: false })}
                >
                  X ≥ t
                </button>
                <button
                  aria-pressed={t.strictTail}
                  onClick={() => update(t.id, { strictTail: true })}
                >
                  X &gt; t
                </button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
            <Check label="尾部比例下界" checked={t.wantTailMin} onChange={(v) => update(t.id, { wantTailMin: v })} />
            <Check label="尾部比例上界" checked={t.wantTailMax} onChange={(v) => update(t.id, { wantTailMax: v })} />
            <Check label="截断损失下界" checked={t.wantLossMin} onChange={(v) => update(t.id, { wantLossMin: v })} />
            <Check label="截断损失上界" checked={t.wantLossMax} onChange={(v) => update(t.id, { wantLossMax: v })} />
          </div>
        </div>
      ))}
    </>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 'auto', accentColor: 'var(--series-1)' }}
      />
      {label}
    </label>
  );
}
