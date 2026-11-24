import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ENGINE_VERSION,
  analyze,
  type AnalysisResult,
  type JointCheckResult,
} from './core/analysis';
import {
  compileWorkspace,
  defaultWorkspace,
  fingerprint,
  makeTarget,
  newId,
  normalizeWorkspace,
  type CompiledProblem,
  type Workspace,
} from './core/model';
import { buildExport, buildSavedAnalysis } from './core/persist';
import type { SavedAnalysis } from './core/analysis';
import { FIXTURES } from './fixtures';
import {
  downloadJson,
  loadAutosave,
  loadSaved,
  persistSaved,
  readJsonFile,
  writeAutosave,
} from './storage';
import { SummaryEditor } from './components/SummaryEditor';
import { DiagnosticsPanel } from './components/Diagnostics';
import { ResultsPanel } from './components/Results';

type Theme = 'light' | 'dark';

function initialWorkspace(): Workspace {
  const auto = loadAutosave();
  if (auto) {
    try {
      return normalizeWorkspace(auto);
    } catch {
      // fall through to the default demo workspace
    }
  }
  return defaultWorkspace();
}

function blankWorkspace(): Workspace {
  const base = defaultWorkspace();
  return {
    ...base,
    id: newId('ws'),
    name: '新摘要',
    createdAt: new Date().toISOString(),
    summaries: [],
    targets: [{ ...makeTarget(1), label: '阈值 1', threshold: '1' }],
    jointSelection: [],
    analystNotes: '',
  };
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export default function App() {
  const [ws, setWs] = useState<Workspace>(initialWorkspace);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [jointChecks, setJointChecks] = useState<JointCheckResult[]>([]);
  const [saved, setSaved] = useState<SavedAnalysis[]>(() => loadSaved());
  const [flash, setFlash] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const deferredWs = useDeferredValue(ws);
  const computing = deferredWs !== ws;

  // Autosave the editable workspace (not the results) so a reload keeps the
  // source summaries exactly as typed.
  useEffect(() => {
    const t = window.setTimeout(() => writeAutosave(ws), 350);
    return () => window.clearTimeout(t);
  }, [ws]);

  const problem = useMemo(() => compileWorkspace(deferredWs), [deferredWs]);

  const computed = useMemo(() => {
    if (problem.issues.some((i) => i.severity === 'error')) {
      return { analysis: null as AnalysisResult | null, error: null as string | null };
    }
    try {
      return { analysis: analyze(problem), error: null as string | null };
    } catch (e) {
      return {
        analysis: null as AnalysisResult | null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [problem]);

  // Results disappear when the inputs change, so stale joint checks are cleared.
  const sourceKey = useMemo(() => JSON.stringify(ws), [ws]);
  const prevKey = useRef(sourceKey);
  useEffect(() => {
    if (prevKey.current !== sourceKey) {
      prevKey.current = sourceKey;
      setJointChecks([]);
    }
  }, [sourceKey]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(t);
  }, [flash]);

  const updateWorkspace = (next: Workspace) => {
    setWs({ ...next, updatedAt: new Date().toISOString() });
  };

  const applyTheme = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('summary-bounds.theme', t);
    } catch {
      // ignore
    }
  };

  const onJoint = (r: JointCheckResult) => {
    const key = (x: JointCheckResult) =>
      x.items
        .map((i) => `${i.targetId}|${i.metric}|${i.direction}`)
        .sort()
        .join(',');
    setJointChecks((prev) => [r, ...prev.filter((x) => key(x) !== key(r))].slice(0, 12));
  };

  const saveSnapshot = () => {
    if (!computed.analysis) {
      setFlash({ kind: 'error', text: '当前存在输入错误，无法保存结果快照。' });
      return;
    }
    // Use the compiled workspace, not the live one: they can differ for a
    // moment while the deferred value catches up, and a snapshot must be
    // internally consistent.
    const snapshot = buildSavedAnalysis(
      problem.workspace,
      problem,
      computed.analysis,
      jointChecks,
    );
    const next = [snapshot, ...saved].slice(0, 30);
    setSaved(next);
    persistSaved(next);
    setFlash({
      kind: 'ok',
      text: `已保存快照「${ws.name}」：原摘要、求解假设、全部界与联合检查结果一起存档。`,
    });
  };

  const exportCurrent = () => {
    if (!computed.analysis) {
      setFlash({ kind: 'error', text: '当前存在输入错误，无法导出结果。' });
      return;
    }
    const snapshot = buildSavedAnalysis(
      problem.workspace,
      problem,
      computed.analysis,
      jointChecks,
    );
    downloadJson(
      `${slug(snapshot.name)}-${snapshot.fingerprint}.json`,
      buildExport(problem.workspace, snapshot),
    );
    setFlash({ kind: 'ok', text: '已导出 JSON（含原摘要、假设与结果）。' });
  };

  const importFile = async (file: File) => {
    try {
      const raw = await readJsonFile(file);
      const next = extractWorkspace(raw);
      setWs(next);
      setJointChecks([]);
      setFlash({ kind: 'ok', text: `已载入「${next.name}」；结果已按载入的摘要重新计算。` });
    } catch (e) {
      setFlash({ kind: 'error', text: e instanceof Error ? e.message : '导入失败' });
    }
  };

  const loadSnapshot = (s: SavedAnalysis) => {
    try {
      const next = normalizeWorkspace(s.workspace);
      setWs(next);
      setJointChecks([]);
      setFlash({ kind: 'ok', text: `已载入快照「${s.name}」（${formatTime(s.savedAt)}）。` });
    } catch (e) {
      setFlash({ kind: 'error', text: e instanceof Error ? e.message : '快照无法载入' });
    }
  };

  const deleteSnapshot = (s: SavedAnalysis) => {
    const next = saved.filter((x) => x.id !== s.id || x.savedAt !== s.savedAt);
    setSaved(next);
    persistSaved(next);
  };

  const loadFixture = (id: string) => {
    const f = FIXTURES.find((x) => x.id === id);
    if (!f) return;
    setWs(f.make());
    setJointChecks([]);
    setFlash({ kind: 'ok', text: `已载入示例「${f.title}」。` });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>摘要界</h1>
          <p>
            只给定样本总量、均值/二阶矩范围与几档区间计数，枚举全部符合摘要的分布，
            求指定阈值以上比例与截断损失的上下界。不补造微观记录，不修改互相矛盾的源摘要。
          </p>
        </div>
        <div className="topbar-actions">
          <select
            aria-label="载入示例"
            value=""
            onChange={(e) => {
              loadFixture(e.target.value);
              e.target.value = '';
            }}
            style={{ width: 'auto' }}
          >
            <option value="">载入示例…</option>
            {FIXTURES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setWs(blankWorkspace())}>
            新建
          </button>
          <button className="btn" onClick={saveSnapshot}>
            保存快照
          </button>
          <button className="btn" onClick={exportCurrent}>
            导出 JSON
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            导入 JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
          <button
            className="btn ghost"
            onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="切换深浅色主题"
          >
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
        </div>
      </header>

      {flash && (
        <div className={`notice ${flash.kind}`} style={{ marginBottom: 16 }}>
          <span>{flash.text}</span>
        </div>
      )}

      <div className="layout">
        <div className="stack">
          <SummaryEditor ws={ws} problem={problem} onChange={updateWorkspace} />
          <SnapshotCard
            saved={saved}
            onLoad={loadSnapshot}
            onExport={(s) => downloadJson(`${slug(s.name)}-${s.fingerprint}.json`, s)}
            onDelete={deleteSnapshot}
          />
        </div>

        <div className="stack">
          {computing && <div className="computing">正在按最新输入重新计算…</div>}
          <DiagnosticsPanel problem={problem} analysis={computed.analysis ?? emptyAnalysis(problem)} />
          {computed.analysis ? (
            <ResultsPanel
              analysis={computed.analysis}
              problem={problem}
              onJoint={onJoint}
            />
          ) : (
            <div className="card">
              <header>
                <h2>结果</h2>
              </header>
              <div className="body">
                <div className="notice error">
                  <span>
                    {computed.error
                      ? `求解器异常：${computed.error}`
                      : '存在输入错误，暂不计算界。请先修正标红的摘要或取值。'}
                  </span>
                </div>
              </div>
            </div>
          )}
          <footer className="footer-note" style={{ textAlign: 'center' }}>
            引擎 {ENGINE_VERSION} · 指纹 {fingerprint(JSON.stringify(problem.workspace))} ·
            所有计算使用精确有理数，不施加浮点容差
          </footer>
        </div>
      </div>
    </div>
  );
}

function SnapshotCard({
  saved,
  onLoad,
  onExport,
  onDelete,
}: {
  saved: SavedAnalysis[];
  onLoad: (s: SavedAnalysis) => void;
  onExport: (s: SavedAnalysis) => void;
  onDelete: (s: SavedAnalysis) => void;
}) {
  return (
    <div className="card">
      <header>
        <h2>快照存档</h2>
        <span className="hint">原摘要 + 假设 + 界 + 联合检查</span>
      </header>
      <div className="body">
        {saved.length === 0 ? (
          <div className="empty">
            还没有快照。点击顶部“保存快照”，会把当时的源摘要、求解假设、全部界与联合检查一起写入本机存档。
          </div>
        ) : (
          <div className="snap-list">
            {saved.map((s) => (
              <div className="snap" key={`${s.id}-${s.savedAt}`}>
                <div className="meta">
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.name}</div>
                  <div>
                    {formatTime(s.savedAt)} · 指纹 {s.fingerprint} · {s.bounds.length} 个界 ·{' '}
                    {s.jointChecks.length} 项联合检查
                  </div>
                </div>
                <div className="actions">
                  <button className="btn small" onClick={() => onLoad(s)}>
                    载入
                  </button>
                  <button className="btn small" onClick={() => onExport(s)}>
                    导出
                  </button>
                  <button className="btn small danger" onClick={() => onDelete(s)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="footer-note">
          快照保存在浏览器本机；需要长期保存或交给他人核对时，请使用“导出 JSON”。
        </p>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function slug(name: string): string {
  const s = name.trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
  return s || 'summary-bounds';
}

function extractWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') throw new Error('文件内容不是对象');
  const o = raw as Record<string, unknown>;
  if (o.kind === 'summary-bounds.snapshot') {
    if (!o.sourceWorkspace) throw new Error('快照缺少 sourceWorkspace');
    return normalizeWorkspace(o.sourceWorkspace);
  }
  if (o.schemaVersion === 1) return normalizeWorkspace(o);
  if (o.workspace) return normalizeWorkspace(o.workspace);
  throw new Error('无法识别的文件格式：需要工作区或快照 JSON');
}

/**
 * A minimal placeholder so the diagnostics panel can render while inputs are
 * invalid. It carries no bounds and no claims; `ResultsPanel` is not shown.
 */
function emptyAnalysis(problem: CompiledProblem): AnalysisResult {
  return {
    engineVersion: ENGINE_VERSION,
    createdAt: new Date().toISOString(),
    problem,
    finiteMode: problem.mode === 'finite',
    baseRows: [],
    bounds: [],
    feasibility: {
      status: 'undecided',
      message: '存在输入错误，暂不计算界。请先修正摘要或取值。',
    },
    assumptions: problem.assumptions,
    supportValues: [],
    supportTexts: [],
    pairCompatibility: [],
    notes: [],
  };
}
