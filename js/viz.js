// Shared helpers for engines: statistics, small-cell protection, the three-column projector table,
// and charts. Pure functions (no DOM) come first so they can be unit-tested in Node.
import { el, pick } from "./i18n.js";

export const MIN_CELL = 3; // decision 5: a projector bar never stands for fewer than 3 people

// ---------- statistics (pure) ----------
export function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function mean(xs) {
  const a = xs.filter((x) => Number.isFinite(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

export function pct(part, whole) {
  return whole ? (100 * part) / whole : null;
}

export function round(x, d = 0) {
  if (x == null || !Number.isFinite(x)) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export const sum = (xs) => xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);

// Element-wise sum of equally long count arrays (pooling earlier classes).
export function addCounts(arrays, len) {
  const out = new Array(len).fill(0);
  for (const a of arrays) if (Array.isArray(a)) a.forEach((v, i) => { if (i < len && Number.isFinite(v)) out[i] += v; });
  return out;
}

// Count values into bins given by edges [e0, e1, ..., ek]: bin i is [e_i, e_{i+1}).
// Values below e0 go to the first bin, values at or above ek to the last bin.
export function binCounts(values, edges) {
  const counts = new Array(edges.length - 1).fill(0);
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    let i = 0;
    while (i < counts.length - 1 && v >= edges[i + 1]) i++;
    counts[i]++;
  }
  return counts;
}

// Merge adjacent categories so that every shown group holds at least `min` people.
// Returns [{ from, to, count }] (category indices, inclusive), covering every category once.
export function mergeSparse(counts, min = MIN_CELL) {
  const out = [];
  let cur = null;
  counts.forEach((c, i) => {
    if (!cur) cur = { from: i, to: i, count: 0 };
    cur.to = i;
    cur.count += c;
    if (cur.count >= min) { out.push(cur); cur = null; }
  });
  if (cur) {
    if (out.length) { const last = out[out.length - 1]; last.to = cur.to; last.count += cur.count; }
    else out.push(cur);
  }
  return out;
}

// Response time in ms since the step first appeared (ctx.startedAt survives reloads); ctx.now lets
// test harnesses drive the clock.
export function elapsedClock(ctx) {
  const now = ctx.now || Date.now;
  const t0 = ctx.startedAt ?? now();
  return () => Math.max(0, Math.round(now() - t0));
}

// ---------- formatting ----------
export function formatNumber(x, lang = "vi", digits = 2) {
  if (x == null) return "—";
  if (typeof x !== "number") return String(x);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(lang === "en" ? "en-US" : "vi-VN", { maximumFractionDigits: digits });
}

export const fmtPct = (x, lang) => (x == null ? "—" : `${formatNumber(round(x, 0), lang)}%`);

// Fill {placeholders} in a config template; numbers are formatted for the language.
export function fill(template, params, lang) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (k in params ? (typeof params[k] === "number" ? formatNumber(params[k], lang) : params[k]) : `{${k}}`));
}

// ---------- projector building blocks (DOM) ----------
// Three columns per row: this class, earlier classes pooled, original study.
export function threeColumns(rows, ctx, ns = {}) {
  const t = ctx.t;
  const head = el("tr", { class: "text-left text-base text-slate-500" },
    el("th", { class: "py-2 pr-4 font-normal" }, ""),
    el("th", { class: "py-2 pr-4 font-normal" }, `${t("present.thisClass")}${ns.mine != null ? ` (n=${ns.mine})` : ""}`),
    el("th", { class: "py-2 pr-4 font-normal" }, `${t("present.earlier")}${ns.earlier ? ` (n=${ns.earlier})` : ""}`),
    el("th", { class: "py-2 font-normal" }, t("present.original")));
  return el("table", { class: "w-full text-2xl" }, el("thead", {}, head),
    el("tbody", {}, rows.map((r) => el("tr", { class: "border-t border-slate-200 align-top" },
      el("td", { class: "py-2 pr-4 text-slate-600" }, r.label),
      el("td", { class: "py-2 pr-4 font-semibold" }, r.mine ?? "—"),
      el("td", { class: "py-2 pr-4" }, r.earlier ?? "—"),
      el("td", { class: "py-2 text-xl" }, r.original ?? "—")))));
}

// Bar chart through the global Chart.js (loaded by present.html). Percent charts run 0 to 100.
export function barChart(labels, datasets, { percent = true, height = 300, title = null, stacked = false } = {}) {
  const canvas = el("canvas", {});
  const box = el("div", { style: `height:${height}px` }, canvas);
  requestAnimationFrame(() => new window.Chart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: datasets.length > 1 }, title: { display: !!title, text: title || "" } },
      scales: {
        x: { stacked },
        y: percent ? { stacked, min: 0, max: 100, ticks: { callback: (v) => `${v}%` } } : { stacked, beginAtZero: true }
      }
    }
  }));
  return box;
}

// Distribution over ordered categories, as percentages, with sparse neighbours merged so that no
// bar of this class stands for fewer than MIN_CELL people. rangeLabel(from, to) names a group.
export function distributionChart(counts, rangeLabel, ctx, { earlier = null, title = null, height = 300 } = {}) {
  const groups = mergeSparse(counts);
  const n = sum(counts);
  const labels = groups.map((g) => rangeLabel(g.from, g.to));
  const datasets = [{ label: ctx.t("present.thisClass"), data: groups.map((g) => round(pct(g.count, n), 0) ?? 0) }];
  const en = earlier ? sum(earlier) : 0;
  if (en) datasets.push({ label: ctx.t("present.earlier"), data: groups.map((g) => round(pct(sum(earlier.slice(g.from, g.to + 1)), en), 0)) });
  return barChart(labels, datasets, { title, height });
}

export function benchmarkLine(benchmark, lang) {
  if (!benchmark?.label) return null;
  return el("p", { class: "text-base text-slate-500" }, `${pick(benchmark.label, lang)}${benchmark.note ? `. ${pick(benchmark.note, lang)}` : ""}`);
}

export function heading(text) {
  return el("h3", { class: "text-2xl font-semibold" }, text);
}
