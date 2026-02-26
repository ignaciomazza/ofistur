// src/components/template-config/sections/_helpers.ts
export type AnyObj = Record<string, unknown>;

export function isObject(v: unknown): v is AnyObj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function getAt<T>(obj: AnyObj, path: string[], fallback: T): T {
  let cur: unknown = obj;
  for (const k of path) {
    if (!isObject(cur)) return fallback;
    cur = (cur as AnyObj)[k];
  }
  return (cur as T) ?? fallback;
}

export function setAt(obj: AnyObj, path: string[], value: unknown): AnyObj {
  if (path.length === 0) return { ...obj };
  const next: AnyObj = { ...obj };
  let curNext: AnyObj = next;
  let curPrev: AnyObj = obj;

  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i];
    const prevChild = isObject(curPrev[k]) ? (curPrev[k] as AnyObj) : undefined;
    const nextChild: AnyObj = prevChild ? { ...prevChild } : {};
    curNext[k] = nextChild;
    curNext = nextChild;
    curPrev = prevChild ?? {};
  }
  curNext[path[path.length - 1]] = value;
  return next;
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

export function normalizeKey(label: string, fallback: string) {
  const s =
    (label || "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "";
  return s || fallback;
}

export const input =
  "w-full appearance-none rounded-2xl border border-white/10 bg-white/10 p-2 px-3 text-sm outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide focus-visible:border-sky-300 focus-visible:ring-2 focus-visible:ring-sky-200/60 dark:text-white";

export const section =
  "mb-5 h-fit rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur dark:bg-white/5";

export const badge =
  "rounded-full bg-slate-900/5 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-700 dark:bg-white/10 dark:text-slate-200";
