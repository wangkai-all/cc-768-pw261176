import type { Workspace } from './core/model';
import type { SavedAnalysis } from './core/analysis';

const KEY = 'summary-bounds.saved.v1';
const AUTOSAVE = 'summary-bounds.autosave.v1';

export function loadSaved(): SavedAnalysis[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function persistSaved(list: SavedAnalysis[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage may be unavailable (private mode / quota); the app still works.
  }
}

export function loadAutosave(): Workspace | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE);
    if (!raw) return null;
    return JSON.parse(raw) as Workspace;
  } catch {
    return null;
  }
}

export function writeAutosave(ws: Workspace): void {
  try {
    localStorage.setItem(AUTOSAVE, JSON.stringify(ws));
  } catch {
    // ignore
  }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        reject(new Error('不是合法的 JSON 文件'));
      }
    };
    reader.readAsText(file);
  });
}
