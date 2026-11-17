// Session helpers shared by the three pages: step keys, local progress, CSV, archive payload.
import { stepsOf } from "./catalog.js";

export const QUIZ_ID = "Q00"; // fixed experiment id used for the end-of-session quiz responses

// Opening-batch order is a list of step keys "EXP#step". It is built from order items: "EXP" places
// every not-yet-placed step of EXP in config order, "EXP#step" places one step (used to split E02).
// Steps that no item placed are appended at the end, so nothing selected is ever dropped.
export function buildOrder(collectConfigs, items = null) {
  const byId = new Map(collectConfigs.map((c) => [c.id, c]));
  const placed = new Set();
  const out = [];
  const put = (key) => { if (!placed.has(key)) { placed.add(key); out.push(key); } };
  for (const it of items || collectConfigs.map((c) => c.id)) {
    const { exp, step } = parseStepKey(it);
    const c = byId.get(exp);
    if (!c) continue;
    if (step) { if (stepsOf(c).includes(step)) put(`${exp}#${step}`); }
    else stepsOf(c).forEach((s) => put(`${exp}#${s}`));
  }
  for (const c of collectConfigs) stepsOf(c).forEach((s) => put(`${c.id}#${s}`));
  return out;
}

// Default arrangement of order items for the selected collect experiments: the catalog's default
// order (plan: E05, E01, E06, E02 part 1, E09, ...) filtered to the selection, then anything else
// in selection order. An experiment with "separate" always gets its parts as separate items.
export function defaultItems(collectConfigs, defaultOrder = []) {
  const ids = new Set(collectConfigs.map((c) => c.id));
  const items = (defaultOrder || []).filter((it) => ids.has(parseStepKey(it).exp));
  for (const c of collectConfigs) {
    const parts = c.separate?.steps || [];
    if (parts.length) {
      for (const s of parts) if (!items.includes(`${c.id}#${s}`)) items.push(`${c.id}#${s}`);
    } else if (!items.some((it) => parseStepKey(it).exp === c.id)) items.push(c.id);
  }
  return items;
}

// Locked-structure rule that depends on the session order (plan, E02: the two problems at least
// three experiments apart). Counts distinct other experiments placed between the separated parts.
export function separationErrors(collectConfigs, order) {
  const errs = [];
  for (const c of collectConfigs) {
    const sep = c.separate;
    if (!sep?.steps?.length) continue;
    const pos = sep.steps.map((s) => order.indexOf(`${c.id}#${s}`));
    for (let i = 1; i < pos.length; i++) {
      const between = new Set(order.slice(pos[i - 1] + 1, pos[i]).map((k) => parseStepKey(k).exp).filter((e) => e !== c.id));
      if (pos[i - 1] < 0 || pos[i] < 0 || pos[i] < pos[i - 1] || between.size < sep.minGap) {
        errs.push(`${c.id}: ${sep.steps[i - 1]} và ${sep.steps[i]} phải theo thứ tự và cách nhau ít nhất ${sep.minGap} thí nghiệm khác trong phiên thu (hiện ${pos[i] > pos[i - 1] ? between.size : 0})`);
      }
    }
  }
  return errs;
}

export function parseStepKey(key) {
  const [exp, step] = key.split("#");
  return { exp, step };
}

// Phone-side memory (localStorage): progress and own answers, because a phone cannot read its own
// response documents (only the instructor can). Keyed by room and anonymous uid.
export function localStore(code, uid) {
  const k = `ce:${code}:${uid}`;
  const read = () => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
  const write = (v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: keep in memory */ } };
  let mem = read();
  return {
    get: () => mem,
    update(fn) { mem = fn(structuredClone(mem)) || mem; write(mem); return mem; }
  };
}

// Which screen the projector should show, derived from session state.
export function presentView(s) {
  if (!s) return "lobby";
  if (s.locked) return "closed";
  if (s.game) return "game";
  if (s.quiz && (s.quiz.open || s.quiz.reveal)) return "quiz";
  if (s.reveal) return "reveal";
  if (s.collectOpen) return "collect";
  return "lobby";
}

// Key used to pool results across classes: same experiment, same content version, same language,
// same opening-batch order (plan, risk table: "chỉ cộng dồn các lớp cùng thứ tự").
export function poolKey(expId, version, lang, orderSig) {
  return `${expId}|${version}|${lang}|${orderSig}`;
}

// Signature of the opening-batch order at step level, so split placements (E02) count as order.
export function orderSignature(session, expId) {
  return (session.collect || []).includes(expId) ? (session.order || []).join(">") : "live";
}

// ---------- CSV (long format: one row per answered item) ----------
const CSV_COLS = ["room", "date", "program", "label", "lang", "uid", "exp", "version", "assignment", "item", "value", "time_ms", "consent"];

function csvCell(v) {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(session, responses, assignments) {
  const info = session.info || {};
  const rows = [CSV_COLS.join(",")];
  for (const r of responses) {
    const a = assignments[r.exp]?.byUid?.[r.uid];
    const version = r.exp === QUIZ_ID ? session.quiz?.version : session.versions?.[r.exp];
    for (const [item, value] of Object.entries(r.answers || {})) {
      rows.push([
        session.code, info.date, info.program, info.label, session.lang, r.uid, r.exp, version,
        a, item, value, r.times?.[item], r.consent
      ].map(csvCell).join(","));
    }
  }
  return "﻿" + rows.join("\r\n"); // BOM so Excel reads Vietnamese correctly
}

export function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Archive (anonymized copy for cross-class comparison) ----------
// Drops the user id and free-text reflection; keeps assignment labels so conditions stay analyzable.
export function buildArchive(session, responses, assignments, results, participantsCount) {
  const records = responses.map((r) => {
    const answers = { ...(r.answers || {}) };
    if (r.exp === QUIZ_ID) delete answers.reflection;
    const rec = { exp: r.exp, answers };
    if (r.times) rec.times = r.times;
    if ("consent" in r) rec.consent = r.consent;
    const a = assignments[r.exp]?.byUid?.[r.uid];
    if (a != null) rec.assignment = a;
    return rec;
  });
  const exps = [...(session.collect || []), ...(session.games || [])];
  return {
    room: session.code,
    info: session.info || {},
    lang: session.lang,
    appVersion: session.appVersion,
    catalog: session.catalog,
    collect: session.collect || [],
    order: session.order || [],
    games: session.games || [],
    versions: session.versions || {},
    quiz: session.quiz ? { id: session.quiz.id, version: session.quiz.version } : null,
    consentEnabled: !!session.consent,
    n: participantsCount,
    keys: exps.map((e) => poolKey(e, session.versions?.[e], session.lang, orderSignature(session, e))),
    results,
    records
  };
}
