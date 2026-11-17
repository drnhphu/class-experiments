// Engine C: measures each person and scores them on the phone (no extra writes for the score).
// Designs: "calibration" (E09, 90% intervals), "lossaversion" (E10, lambda = gain / loss),
// "bayes" (E11, percent format then frequency format), "crt" (E12, three timed puzzles).
// All wording students read comes from the config file; generic UI words come from lang/*.json.
import { el, pick } from "../js/i18n.js";
import {
  median, mean, pct, round, sum, addCounts, binCounts, formatNumber, fmtPct, fill,
  threeColumns, barChart, distributionChart, benchmarkLine, heading
} from "../js/viz.js";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
// Years are written without thousands separators ("1776", not "1.776").
const fmtQ = (v, q, lang) => (q.year && isNum(v) ? String(v) : formatNumber(v, lang, 4));
const bilingual = (o) => o && typeof o === "object" && typeof o.vi === "string" && typeof o.en === "string";
const steps = (config) => config.steps || [];

// ---------- pure scoring helpers (shared by phone and laptop, unit-tested) ----------
export const calQuestions = (config) => steps(config).flatMap((s) => s.questions || []);

export function scoreCalibration(answers, config) {
  const items = calQuestions(config).map((q) => {
    const lo = answers?.[`${q.id}_lo`], hi = answers?.[`${q.id}_hi`];
    const ok = isNum(lo) && isNum(hi);
    return { id: q.id, lo: ok ? lo : null, hi: ok ? hi : null, answer: q.answer, hit: ok ? lo <= q.answer && q.answer <= hi : null };
  });
  const answered = items.filter((x) => x.hit != null);
  return { answered: answered.length, hits: answered.filter((x) => x.hit).length, total: items.length, items };
}

export function posterior(p) {
  const tp = p.base * p.sens, fp = (100 - p.base) * p.fpr;
  return (100 * tp) / (tp + fp);
}

// Counts out of a population of N (icon array, frequency wording).
export function frequencies(p, N = 1000) {
  const pos = Math.round((N * p.base) / 100);
  const tp = Math.round((N * p.base * p.sens) / 1e4);
  const fp = Math.round((N * (100 - p.base) * p.fpr) / 1e4);
  return { N, pos, tp, fn: pos - tp, fp, tn: N - pos - fp };
}

// CRT: correct and intuitive answers computed from the puzzle's numbers.
export function crtKey(s) {
  if (s.kind === "sumdiff") return { correct: (s.total - s.diff) / 2, intuitive: s.total - s.diff };
  if (s.kind === "rate") return { correct: s.k, intuitive: s.n };
  if (s.kind === "doubling") return { correct: s.days - 1, intuitive: s.days / 2 };
  return null;
}

export function crtClass(v, s) {
  if (v === null) return "timeout";
  if (!isNum(v)) return null; // not answered
  const key = crtKey(s);
  if (Math.abs(v - key.correct) < 1e-9) return "correct";
  if (Math.abs(v - key.intuitive) < 1e-9) return "intuitive";
  return "other";
}

export function scoreCrt(answers, config) {
  const items = steps(config).map((s) => {
    const has = answers && s.id in answers;
    const v = has ? answers[s.id] : undefined;
    return { id: s.id, value: has ? v : undefined, cls: has ? crtClass(v, s) : null, ...crtKey(s) };
  });
  const answered = items.filter((x) => x.cls);
  return { answered: answered.length, score: answered.filter((x) => x.cls === "correct").length, total: items.length, items };
}

// ---------- validation ----------
function validateCalibration(config) {
  const errs = [];
  if (config.confidence !== 90) errs.push("C/calibration: confidence phải là 90 (khoảng tin cậy 90%)");
  if (!steps(config).length) return [...errs, "C/calibration: cần steps chứa questions"];
  for (const s of steps(config)) {
    if (!bilingual(s.prompt)) errs.push(`C/calibration ${s.id}: thiếu prompt`);
    if (!Array.isArray(s.questions) || !s.questions.length) errs.push(`C/calibration ${s.id}: cần questions`);
  }
  const qs = calQuestions(config);
  if (qs.length !== 10) errs.push(`C/calibration: cần đúng 10 câu (hiện ${qs.length})`);
  const ids = qs.map((q) => q.id);
  if (ids.some((id) => !/^q[0-9]{2}$/.test(id || "")) || new Set(ids).size !== ids.length) errs.push("C/calibration: id câu phải có dạng q01 đến q99 và không trùng");
  qs.forEach((q) => {
    if (!bilingual(q.prompt) || !bilingual(q.unit)) errs.push(`C/calibration ${q.id}: thiếu prompt hoặc unit`);
    if (!isNum(q.answer)) errs.push(`C/calibration ${q.id}: answer phải là số`);
    if (q.year != null && typeof q.year !== "boolean") errs.push(`C/calibration ${q.id}: year phải là true hoặc false`);
    if (!q.source || typeof q.source.label !== "string" || !q.source.label || !/^https:\/\//.test(q.source.url || "")) errs.push(`C/calibration ${q.id}: cần nguồn kiểm chứng (source.label và source.url https)`);
  });
  return errs;
}

function validateLoss(config) {
  const errs = [];
  const g = config.gamble || {};
  if (g.p !== 50) errs.push("C/lossaversion: canh bạc phải là 50/50 (gamble.p = 50)");
  if (!isNum(g.loss) || g.loss <= 0) errs.push("C/lossaversion: gamble.loss phải là số dương cố định");
  if (steps(config).length !== 1) return [...errs, "C/lossaversion: cần đúng một bước"];
  const s = steps(config)[0];
  if (!bilingual(s.prompt)) errs.push("C/lossaversion: thiếu prompt");
  if (!bilingual(config.unit)) errs.push("C/lossaversion: thiếu unit");
  if (!isNum(s.min) || s.min <= 0) errs.push("C/lossaversion: min phải là số dương");
  if (!isNum(s.max) || !(s.max > g.loss)) errs.push("C/lossaversion: cần giới hạn trên max lớn hơn khoản thua");
  return errs;
}

function validateBayes(config) {
  const errs = [];
  const st = steps(config);
  if (st.length !== 2) return ["C/bayes: cần đúng hai bài (hai bước)"];
  if (st[0].format !== "percent" || st[1].format !== "frequency") errs.push("C/bayes: bài thứ nhất dạng percent, bài thứ hai dạng frequency");
  st.forEach((s, i) => {
    const tag = `C/bayes ${s.id}`;
    if (![s.base, s.sens, s.fpr].every(isNum)) { errs.push(`${tag}: cần base, sens, fpr là số (phần trăm)`); return; }
    if (s.base < 1 || s.base > 5) errs.push(`${tag}: tỷ lệ nền phải từ 1% đến 5%`);
    if (!(s.sens > 0 && s.sens <= 100) || !(s.fpr > 0 && s.fpr < 100)) errs.push(`${tag}: sens trong (0, 100], fpr trong (0, 100)`);
    if (!((100 - s.base) * s.fpr > s.base * s.sens)) errs.push(`${tag}: số báo nhầm phải lớn hơn số báo đúng`);
    const post = posterior(s);
    if (!(post < 20)) errs.push(`${tag}: đáp án Bayes phải dưới 20% (hiện ${round(post, 1)}%)`);
    if (!bilingual(s.prompt) || !bilingual(s.explain)) errs.push(`${tag}: thiếu prompt hoặc explain`);
    if (!Array.isArray(s.options) || s.options.length < 2 || s.options.length > 6) errs.push(`${tag}: cần 2 đến 6 phương án`);
    else {
      if (s.options.some((o) => !bilingual(o.text) || !isNum(o.value))) errs.push(`${tag}: mỗi phương án cần text và value (phần trăm)`);
      if (!Number.isInteger(s.answer) || !s.options[s.answer]) errs.push(`${tag}: answer phải là chỉ số phương án đúng`);
      else if (Math.abs(s.options[s.answer].value - post) > 1) errs.push(`${tag}: phương án đúng phải bằng đáp án Bayes ${round(post, 1)}% (sai lệch tối đa 1 điểm)`);
    }
    if (s.format === "frequency") {
      const N = s.population;
      if (!Number.isInteger(N) || N < 100) errs.push(`${tag}: population phải là số nguyên từ 100`);
      else {
        const parts = [N * s.base / 100, N * s.base * s.sens / 1e4, N * (100 - s.base) * s.fpr / 1e4];
        if (parts.some((x) => Math.abs(x - Math.round(x)) > 1e-9)) errs.push(`${tag}: với dạng tần suất, số người ở mỗi nhóm phải là số nguyên`);
      }
    }
    if (i === 0 && !config.icons) errs.push("C/bayes: thiếu icons (nhãn của hình 1.000 chấm)");
  });
  if (st.length === 2 && ["base", "sens", "fpr"].every((k) => st[0][k] === st[1][k])) errs.push("C/bayes: bài thứ hai phải khác số so với bài thứ nhất");
  const ic = config.icons || {};
  if (config.icons && !["tp", "fn", "fp", "tn"].every((k) => bilingual(ic[k]))) errs.push("C/bayes: icons cần tp, fn, fp, tn");
  return errs;
}

function validateCrt(config) {
  const errs = [];
  const st = steps(config);
  if (st.length !== 3) return ["C/crt: cần đúng 3 câu đố"];
  for (const s of st) {
    const tag = `C/crt ${s.id}`;
    const key = crtKey(s);
    if (!key) { errs.push(`${tag}: kind phải là sumdiff, rate hoặc doubling`); continue; }
    if (s.kind === "sumdiff" && !(isNum(s.total) && isNum(s.diff) && Math.abs(s.total - 1.1 * s.diff) < 1e-9)) errs.push(`${tag}: tổng phải bằng 1,1 lần phần chênh lệch`);
    if (s.kind === "rate" && !(Number.isInteger(s.k) && Number.isInteger(s.n) && s.k >= 2 && s.n >= 2 && s.n !== s.k)) errs.push(`${tag}: k và n là số nguyên từ 2, khác nhau`);
    if (s.kind === "doubling" && !(Number.isInteger(s.days) && s.days >= 4 && s.days % 2 === 0)) errs.push(`${tag}: days là số nguyên chẵn từ 4`);
    if (![key.correct, key.intuitive].every(isNum)) continue;
    if (s.answer !== key.correct) errs.push(`${tag}: answer phải là ${key.correct} theo phép tính`);
    if (s.intuitive !== key.intuitive) errs.push(`${tag}: intuitive phải là ${key.intuitive}`);
    if (key.correct === key.intuitive) errs.push(`${tag}: đáp án trực giác phải khác đáp án đúng`);
    const lim = s.timeLimit ?? config.timeLimit;
    if (!isNum(lim) || lim < 10 || lim > 300) errs.push(`${tag}: cần giới hạn thời gian từ 10 đến 300 giây`);
    if (!bilingual(s.prompt) || !bilingual(s.unit)) errs.push(`${tag}: thiếu prompt hoặc unit`);
  }
  return errs;
}

const VALIDATORS = { calibration: validateCalibration, lossaversion: validateLoss, bayes: validateBayes, crt: validateCrt };

// ---------- phone screens ----------
const primaryBtn = (label, onclick, disabled = false) =>
  el("button", { class: "w-full rounded-lg bg-slate-900 py-3 font-medium text-white disabled:opacity-40", disabled, onclick }, label);
const numInput = (cls = "w-full") => el("input", { type: "number", inputmode: "decimal", step: "any", class: `${cls} rounded-lg border border-slate-300 px-3 py-2 text-base` });
const readNum = (input) => (input.value === "" ? null : Number(input.value));

function renderCalibrationStep(s, config, ctx) {
  const { lang, t } = ctx;
  const shownAt = performance.now();
  const msg = el("p", { class: "text-sm text-rose-700" }, "");
  const fields = s.questions.map((q) => {
    const lo = numInput(), hi = numInput();
    const echo = el("p", { class: "text-xs text-slate-500" }, "");
    const upd = () => {
      const a = readNum(lo), b = readNum(hi);
      echo.textContent = isNum(a) || isNum(b) ? `${isNum(a) ? fmtQ(a, q, lang) : "…"} → ${isNum(b) ? fmtQ(b, q, lang) : "…"} ${pick(q.unit, lang)}` : "";
    };
    lo.addEventListener("input", upd); hi.addEventListener("input", upd);
    return { q, lo, hi, node: el("div", { class: "space-y-1 border-t border-slate-100 pt-3" },
      el("p", { class: "font-medium" }, pick(q.prompt, lang)),
      el("div", { class: "grid grid-cols-2 gap-2" },
        el("label", { class: "space-y-1" }, el("span", { class: "text-xs text-slate-500" }, t("c.low")), lo),
        el("label", { class: "space-y-1" }, el("span", { class: "text-xs text-slate-500" }, t("c.high")), hi)),
      echo) };
  });
  const go = primaryBtn(t("eng.confirm"), () => {
    const answers = {};
    for (const f of fields) {
      const a = readNum(f.lo), b = readNum(f.hi);
      if (!isNum(a) || !isNum(b) || a > b) { msg.textContent = t("c.lowHigh"); return; }
      answers[`${f.q.id}_lo`] = a; answers[`${f.q.id}_hi`] = b;
    }
    ctx.submit(answers, { [s.id]: Math.round(performance.now() - shownAt) });
  });
  return el("div", { class: "space-y-3" }, el("p", { class: "whitespace-pre-line" }, fill(pick(s.prompt, lang), { c: config.confidence }, lang)),
    ...fields.map((f) => f.node), msg, go);
}

function renderNumberStep(s, config, ctx, key = s.id) {
  const { lang, t } = ctx;
  const shownAt = performance.now();
  const input = numInput();
  const echo = el("p", { class: "text-sm text-slate-500" }, "");
  const msg = el("p", { class: "text-sm text-rose-700" }, "");
  input.addEventListener("input", () => { const v = readNum(input); echo.textContent = isNum(v) ? `= ${formatNumber(v, lang)} ${pick(config.unit, lang)}` : ""; });
  const go = primaryBtn(t("eng.confirm"), () => {
    const v = readNum(input);
    if (!isNum(v) || v < s.min || v > s.max) { msg.textContent = t("eng.range", { min: formatNumber(s.min, lang), max: formatNumber(s.max, lang) }); return; }
    ctx.submit({ [key]: v }, { [key]: Math.round(performance.now() - shownAt) });
  });
  return el("div", { class: "space-y-3" },
    el("p", { class: "whitespace-pre-line" }, fill(pick(s.prompt, lang), { loss: config.gamble?.loss ?? "", unit: pick(config.unit, lang) }, lang)),
    el("label", { class: "block space-y-1" }, el("span", { class: "text-sm text-slate-600" }, pick(config.unit, lang)), input), echo, msg, go);
}

function renderOptionsStep(s, ctx) {
  const { lang, t } = ctx;
  const shownAt = performance.now();
  let chosen = null;
  const go = primaryBtn(t("eng.confirm"), () => { if (chosen != null) ctx.submit({ [s.id]: chosen }, { [s.id]: Math.round(performance.now() - shownAt) }); }, true);
  const base = "w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-left";
  const opts = s.options.map((o, i) => el("button", { class: base, onclick: (ev) => {
    chosen = i;
    for (const b of ev.currentTarget.parentNode.children) b.className = base;
    ev.currentTarget.className = "w-full rounded-lg border-2 border-slate-900 bg-slate-100 px-4 py-3 text-left";
    go.disabled = false;
  } }, pick(o.text, lang)));
  return el("div", { class: "space-y-3" }, el("p", { class: "whitespace-pre-line" }, pick(s.prompt, lang)), el("div", { class: "grid gap-2" }, opts), go);
}

// One timed puzzle. When time runs out the answer is recorded as null ("timeout").
function renderTimedStep(s, config, ctx) {
  const { lang, t } = ctx;
  const limit = 1000 * (s.timeLimit ?? config.timeLimit);
  const start = performance.now();
  let done = false;
  const input = numInput();
  const clock = el("p", { class: "text-sm font-medium text-amber-700" }, t("eng.timeLeft", { s: Math.ceil(limit / 1000) }));
  const msg = el("p", { class: "text-sm text-rose-700" }, "");
  const finish = (v) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    ctx.submit({ [s.id]: v }, { [s.id]: Math.min(Math.round(performance.now() - start), limit) });
  };
  const node = el("div", { class: "space-y-3" }, clock, el("p", { class: "whitespace-pre-line" }, pick(s.prompt, lang)),
    el("label", { class: "block space-y-1" }, el("span", { class: "text-sm text-slate-600" }, pick(s.unit, lang)), input), msg,
    primaryBtn(t("eng.confirm"), () => {
      const v = readNum(input);
      if (!isNum(v)) { msg.textContent = t("c.needNumber"); return; }
      finish(v);
    }));
  const timer = setInterval(() => {
    const elapsed = performance.now() - start;
    if (!node.isConnected && elapsed > 3000) { clearInterval(timer); return; } // screen left without answering
    const left = limit - elapsed;
    if (left <= 0) finish(null);
    else clock.textContent = t("eng.timeLeft", { s: Math.ceil(left / 1000) });
  }, 250);
  return node;
}

// ---------- personal results (phone, after reveal) ----------
function renderPersonal(config, ctx) {
  const { lang, t } = ctx;
  const sc = ctx.score;
  const parts = [el("h2", { class: "text-lg font-semibold" }, t("eng.yourResult"))];
  if (config.design === "calibration") {
    parts.push(el("p", { class: "text-lg" }, t("c.youHits", { k: sc.hits, n: sc.answered, exp: round((config.confidence / 100) * sc.answered, 1) })));
    const qs = new Map(calQuestions(config).map((q) => [q.id, q]));
    parts.push(el("ol", { class: "space-y-2 text-sm" }, sc.items.map((it) => {
      const q = qs.get(it.id), unit = pick(q.unit, lang);
      return el("li", { class: "border-t border-slate-100 pt-2" },
        el("p", {}, pick(q.prompt, lang)),
        el("p", { class: it.hit ? "text-emerald-700" : "text-rose-700" },
          it.hit == null ? t("c.skipped") : `${it.hit ? "✓" : "✗"} ${t("c.yourRange", { lo: fmtQ(it.lo, q, lang), hi: fmtQ(it.hi, q, lang), unit })}`),
        el("p", {}, t("c.truth", { v: fmtQ(q.answer, q, lang), unit }), " · ",
          el("a", { href: q.source.url, target: "_blank", rel: "noopener", class: "underline" }, q.source.label)));
    })));
  } else if (config.design === "lossaversion") {
    const unit = pick(config.unit, lang);
    parts.push(el("p", { class: "text-lg" }, t("c.youLambda", { g: formatNumber(sc.gain, lang), l: formatNumber(config.gamble.loss, lang), unit, lam: formatNumber(round(sc.lambda, 2), lang) })));
    parts.push(el("p", {}, t(sc.lambda > 1 ? "c.lambdaAbove" : sc.lambda < 1 ? "c.lambdaBelow" : "c.lambdaOne")));
    if (sc.capped) parts.push(el("p", { class: "text-sm text-slate-500" }, t("c.lambdaCapped")));
  } else if (config.design === "bayes") {
    steps(config).forEach((s, i) => {
      const mine = sc.items[i];
      parts.push(el("div", { class: "space-y-1 border-t border-slate-100 pt-2" },
        el("p", { class: "font-medium" }, t("c.round", { r: i + 1 })),
        el("p", { class: mine.correct ? "text-emerald-700" : "text-rose-700" },
          mine.choice == null ? t("c.skipped") : `${mine.correct ? "✓" : "✗"} ${t("c.youPicked", { a: pick(s.options[mine.choice].text, lang) })}`),
        el("p", {}, t("c.correctIs", { a: pick(s.options[s.answer].text, lang) })),
        el("p", { class: "whitespace-pre-line text-sm text-slate-600" }, pick(s.explain, lang))));
    });
  } else if (config.design === "crt") {
    parts.push(el("p", { class: "text-lg" }, t("c.youScore", { k: sc.score, n: sc.total })));
    steps(config).forEach((s, i) => {
      const it = sc.items[i];
      const time = ctx.myTimes?.[s.id];
      parts.push(el("div", { class: "space-y-1 border-t border-slate-100 pt-2 text-sm" },
        el("p", { class: "font-medium" }, `${i + 1}. ${pick(s.prompt, lang)}`),
        el("p", { class: it.cls === "correct" ? "text-emerald-700" : "text-rose-700" },
          it.cls == null ? t("c.skipped") : it.cls === "timeout" ? t("c.timedOut") : `${it.cls === "correct" ? "✓" : "✗"} ${t("c.youAnswered", { v: formatNumber(it.value, lang), unit: pick(s.unit, lang) })}`),
        el("p", {}, t("c.crtKey", { c: formatNumber(it.correct, lang), i: formatNumber(it.intuitive, lang), unit: pick(s.unit, lang) })),
        isNum(time) ? el("p", { class: "text-slate-500" }, t("c.yourTime", { s: formatNumber(round(time / 1000, 1), lang) })) : null));
    });
  }
  return el("div", { class: "space-y-3" }, ...parts);
}

// ---------- aggregation (laptop) ----------
function aggregateCalibration(responses, config) {
  const qs = calQuestions(config);
  const hitsCounts = new Array(qs.length + 1).fill(0);
  const perQ = Object.fromEntries(qs.map((q) => [q.id, { n: 0, hits: 0 }]));
  let intervals = 0, intervalHits = 0;
  for (const r of responses) {
    const sc = scoreCalibration(r.answers, config);
    if (!sc.answered) continue;
    for (const it of sc.items) if (it.hit != null) { perQ[it.id].n++; if (it.hit) perQ[it.id].hits++; }
    intervals += sc.answered; intervalHits += sc.hits;
    if (sc.answered === qs.length) hitsCounts[sc.hits]++;
  }
  return { design: "calibration", nComplete: sum(hitsCounts), hitsCounts, intervals, intervalHits,
    perQuestion: qs.map((q) => ({ id: q.id, ...perQ[q.id] })) };
}

function aggregateLoss(responses, config) {
  const s = steps(config)[0];
  const lambdas = [];
  let capped = 0;
  for (const r of responses) {
    const g = r.answers?.[s.id];
    if (!isNum(g)) continue;
    lambdas.push(round(g / config.gamble.loss, 4));
    if (g >= s.max) capped++;
  }
  lambdas.sort((a, b) => a - b);
  return { design: "lossaversion", n: lambdas.length, lambdas, median: median(lambdas), above1: lambdas.filter((x) => x > 1).length, capped };
}

function aggregateBayes(responses, config) {
  const st = steps(config);
  const counts = st.map((s) => new Array(s.options.length).fill(0));
  for (const r of responses) st.forEach((s, i) => { const v = r.answers?.[s.id]; if (Number.isInteger(v) && v >= 0 && v < s.options.length) counts[i][v]++; });
  return { design: "bayes", c1: counts[0], c2: counts[1], n1: sum(counts[0]), n2: sum(counts[1]),
    correct1: counts[0][st[0].answer], correct2: counts[1][st[1].answer] };
}

function aggregateCrt(responses, config) {
  const st = steps(config);
  const perQ = st.map((s) => ({ id: s.id, n: 0, correct: 0, intuitive: 0, other: 0, timeout: 0 }));
  const scoreCounts = new Array(st.length + 1).fill(0);
  const tCorrect = [], tWrong = [];
  for (const r of responses) {
    const sc = scoreCrt(r.answers, config);
    sc.items.forEach((it, i) => {
      if (!it.cls) return;
      perQ[i].n++; perQ[i][it.cls]++;
      const ms = r.times?.[it.id];
      if (isNum(ms) && it.cls !== "timeout") (it.cls === "correct" ? tCorrect : tWrong).push(round(ms / 1000, 1));
    });
    if (sc.answered === st.length) scoreCounts[sc.score]++;
  }
  tCorrect.sort((a, b) => a - b); tWrong.sort((a, b) => a - b);
  return { design: "crt", nComplete: sum(scoreCounts), scoreCounts, perQ, tCorrect, tWrong };
}

// ---------- projector ----------
const meanFromCounts = (counts) => { const n = sum(counts); return n ? sum(counts.map((c, i) => c * i)) / n : null; };

function presentCalibration(result, config, history, ctx) {
  const { lang, t } = ctx;
  const len = result.hitsCounts.length;
  const earlier = (history || []).filter((h) => Array.isArray(h?.hitsCounts) && h.hitsCounts.length === len);
  const eCounts = addCounts(earlier.map((h) => h.hitsCounts), len);
  const eInt = sum(earlier.map((h) => h.intervals || 0)), eHits = sum(earlier.map((h) => h.intervalHits || 0));
  const has = eInt > 0;
  const expected = round((config.confidence / 100) * (len - 1), 1);
  const bench = config.benchmark || {};
  const label = (from, to) => (from === to ? String(from) : `${from}–${to}`);
  const rows = [
    { label: t("c.meanHits", { n: len - 1 }), mine: formatNumber(round(meanFromCounts(result.hitsCounts), 1), lang), earlier: sum(eCounts) ? formatNumber(round(meanFromCounts(eCounts), 1), lang) : null, original: t("c.calibrated", { k: formatNumber(expected, lang) }) },
    { label: t("c.hitRate"), mine: fmtPct(pct(result.intervalHits, result.intervals), lang), earlier: has ? fmtPct(pct(eHits, eInt), lang) : null, original: bench.hitRate ? pick(bench.hitRate, lang) : null }
  ];
  return el("div", { class: "space-y-6" },
    heading(t("c.hitsDist", { k: formatNumber(expected, lang), n: len - 1 })),
    distributionChart(result.hitsCounts, label, ctx, { earlier: sum(eCounts) ? eCounts : null, height: 280 }),
    threeColumns(rows, ctx, { mine: result.nComplete, earlier: sum(eCounts) }),
    benchmarkLine(bench, lang));
}

const LAMBDA_EDGES = [0, 1, 1.5, 2, 2.5, 3, 4, 5, Infinity];
function presentLoss(result, config, history, ctx) {
  const { lang, t } = ctx;
  const earlier = (history || []).filter((h) => Array.isArray(h?.lambdas));
  const eL = earlier.flatMap((h) => h.lambdas);
  const has = eL.length > 0;
  const bench = config.benchmark || {};
  const last = LAMBDA_EDGES.length - 2;
  const label = (from, to) => (from === 0 && to === 0 ? "< 1" : to === last ? `≥ ${formatNumber(LAMBDA_EDGES[from], lang)}` : from === 0 ? `< ${formatNumber(LAMBDA_EDGES[to + 1], lang)}` : `${formatNumber(LAMBDA_EDGES[from], lang)}–${formatNumber(LAMBDA_EDGES[to + 1], lang)}`);
  const rows = [
    { label: t("c.medianLambda"), mine: formatNumber(round(result.median, 2), lang), earlier: has ? formatNumber(round(median(eL), 2), lang) : null, original: isNum(bench.lambda) ? formatNumber(bench.lambda, lang) : null },
    { label: t("c.shareAbove1"), mine: fmtPct(pct(result.above1, result.n), lang), earlier: has ? fmtPct(pct(eL.filter((x) => x > 1).length, eL.length), lang) : null, original: null }
  ];
  return el("div", { class: "space-y-6" },
    heading(t("c.lambdaDist", { l: formatNumber(config.gamble.loss, lang), unit: pick(config.unit, lang) })),
    distributionChart(binCounts(result.lambdas, LAMBDA_EDGES), label, ctx, { earlier: has ? binCounts(eL, LAMBDA_EDGES) : null, height: 280 }),
    el("p", { class: "text-base text-slate-500" }, t("c.lambdaNote", { cap: result.capped })),
    threeColumns(rows, ctx, { mine: result.n, earlier: eL.length }),
    benchmarkLine(bench, lang));
}

function iconArray(p, labels, lang) {
  const f = frequencies(p, 1000);
  const groups = [["tp", f.tp, "#b91c1c"], ["fn", f.fn, "#fca5a5"], ["fp", f.fp, "#f59e0b"], ["tn", f.tn, "#cbd5e1"]];
  const cols = 50, r = 5, gap = 13;
  let i = 0, dots = "";
  for (const [, n, color] of groups) for (let k = 0; k < n; k++, i++) {
    dots += `<circle cx="${(i % cols) * gap + 8}" cy="${Math.floor(i / cols) * gap + 8}" r="${r}" fill="${color}"/>`;
  }
  const svgBox = el("div", {});
  svgBox.innerHTML = `<svg viewBox="0 0 ${cols * gap + 4} ${Math.ceil(1000 / cols) * gap + 4}" class="w-full">${dots}</svg>`; // numbers only, no user text
  const legend = el("ul", { class: "grid grid-cols-2 gap-x-6 text-lg" }, groups.map(([k, n, color]) =>
    el("li", { class: "flex items-center gap-2" }, el("span", { class: "inline-block h-4 w-4 rounded-full", style: `background:${color}` }), `${formatNumber(n, lang)} ${pick(labels[k], lang)}`)));
  return { node: el("div", { class: "space-y-3" }, svgBox, legend), f };
}

function presentBayes(result, config, history, ctx) {
  const { lang, t } = ctx;
  const st = steps(config);
  const earlier = (history || []).filter((h) => Array.isArray(h?.c1) && h.c1.length === st[0].options.length && Array.isArray(h.c2));
  const e1 = addCounts(earlier.map((h) => h.c1), st[0].options.length), e2 = addCounts(earlier.map((h) => h.c2), st[1].options.length);
  const has = sum(e1) > 0;
  const bench = config.benchmark || {};
  const datasets = [{ label: t("present.thisClass"), data: result.c1.map((c) => round(pct(c, result.n1), 0) ?? 0) }];
  if (has) datasets.push({ label: t("present.earlier"), data: e1.map((c) => round(pct(c, sum(e1)), 0)) });
  const icons = iconArray(st[0], config.icons, lang);
  const post = round(pct(icons.f.tp, icons.f.tp + icons.f.fp), 0);
  const rows = [
    { label: t("c.correctR1"), mine: fmtPct(pct(result.correct1, result.n1), lang), earlier: has ? fmtPct(pct(e1[st[0].answer], sum(e1)), lang) : null, original: isNum(bench.r1) ? `${bench.r1}%` : null },
    { label: t("c.correctR2"), mine: fmtPct(pct(result.correct2, result.n2), lang), earlier: sum(e2) ? fmtPct(pct(e2[st[1].answer], sum(e2)), lang) : null, original: isNum(bench.r2) ? `${bench.r2}%` : null }
  ];
  return el("div", { class: "space-y-6" },
    el("div", { class: "grid grid-cols-1 gap-8 lg:grid-cols-2" },
      el("div", { class: "space-y-2" }, heading(t("c.r1Dist")),
        barChart(st[0].options.map((o) => pick(o.text, lang)), datasets, { height: 300 }),
        el("p", { class: "text-base text-slate-500" }, t("c.correctMark", { a: pick(st[0].options[st[0].answer].text, lang) }))),
      el("div", { class: "space-y-2" }, heading(t("c.icons")), icons.node,
        el("p", { class: "text-xl" }, t("c.iconsCalc", { tp: formatNumber(icons.f.tp, lang), fp: formatNumber(icons.f.fp, lang), all: formatNumber(icons.f.tp + icons.f.fp, lang), p: formatNumber(post, lang) })))),
    threeColumns(rows, ctx, { mine: result.n1, earlier: sum(e1) }),
    benchmarkLine(bench, lang));
}

function presentCrt(result, config, history, ctx) {
  const { lang, t } = ctx;
  const st = steps(config);
  const len = st.length + 1;
  const earlier = (history || []).filter((h) => Array.isArray(h?.scoreCounts) && h.scoreCounts.length === len);
  const eScores = addCounts(earlier.map((h) => h.scoreCounts), len);
  const eTc = earlier.flatMap((h) => h.tCorrect || []), eTw = earlier.flatMap((h) => h.tWrong || []);
  const has = sum(eScores) > 0;
  const bench = config.benchmark || {};
  const share = (q, k) => round(pct(q[k], q.n), 0) ?? 0;
  const chart = barChart(st.map((s, i) => t("c.puzzle", { i: i + 1 })), [
    { label: t("c.intuitive"), data: result.perQ.map((q) => share(q, "intuitive")) },
    { label: t("c.correct"), data: result.perQ.map((q) => share(q, "correct")) },
    { label: t("c.otherOrTimeout"), data: result.perQ.map((q) => round(pct(q.other + q.timeout, q.n), 0) ?? 0) }
  ], { height: 300, stacked: true });
  const sec = (xs) => (xs.length ? `${formatNumber(round(median(xs), 1), lang)} s` : "—");
  const rows = [
    { label: t("c.meanScore", { n: st.length }), mine: formatNumber(round(meanFromCounts(result.scoreCounts), 2), lang), earlier: has ? formatNumber(round(meanFromCounts(eScores), 2), lang) : null, original: isNum(bench.mean) ? formatNumber(bench.mean, lang) : null },
    { label: t("c.shareZero"), mine: fmtPct(pct(result.scoreCounts[0], result.nComplete), lang), earlier: has ? fmtPct(pct(eScores[0], sum(eScores)), lang) : null, original: isNum(bench.scores?.[0]) ? `${bench.scores[0]}%` : null },
    { label: t("c.shareFull", { n: st.length }), mine: fmtPct(pct(result.scoreCounts[st.length], result.nComplete), lang), earlier: has ? fmtPct(pct(eScores[st.length], sum(eScores)), lang) : null, original: isNum(bench.scores?.[st.length]) ? `${bench.scores[st.length]}%` : null },
    { label: t("c.timeCorrect"), mine: sec(result.tCorrect), earlier: eTc.length ? sec(eTc) : null, original: null },
    { label: t("c.timeWrong"), mine: sec(result.tWrong), earlier: eTw.length ? sec(eTw) : null, original: null }
  ];
  return el("div", { class: "space-y-6" }, heading(t("c.crtDist")), chart,
    el("p", { class: "text-base text-slate-500" }, st.map((s, i) => t("c.crtKeyShort", { i: i + 1, c: formatNumber(crtKey(s).correct, lang), v: formatNumber(crtKey(s).intuitive, lang) })).join(" · ")),
    threeColumns(rows, ctx, { mine: result.nComplete, earlier: sum(eScores) }),
    benchmarkLine(bench, lang));
}

// ---------- engine ----------
const C = {
  id: "C",
  mode: "collect",

  validate(config) {
    const v = VALIDATORS[config.design];
    return v ? v(config) : [`C: design "${config.design}" không hợp lệ (calibration, lossaversion, bayes, crt)`];
  },

  assign() { return null; },

  renderStudent(step, config, ctx) {
    if (step === "__result") return renderPersonal(config, ctx);
    const s = steps(config).find((x) => x.id === step);
    if (!s) return el("p", {}, step);
    if (config.design === "calibration") return renderCalibrationStep(s, config, ctx);
    if (config.design === "lossaversion") return renderNumberStep(s, config, ctx);
    if (config.design === "bayes") return renderOptionsStep(s, ctx);
    return renderTimedStep(s, config, ctx);
  },

  scoreLocal(answers, config) {
    if (!answers || !Object.keys(answers).length) return null;
    if (config.design === "calibration") return scoreCalibration(answers, config);
    if (config.design === "lossaversion") {
      const s = steps(config)[0], g = answers[s.id];
      return isNum(g) ? { gain: g, lambda: g / config.gamble.loss, capped: g >= s.max } : null;
    }
    if (config.design === "bayes") {
      return { items: steps(config).map((s) => {
        const v = answers[s.id];
        return { choice: Number.isInteger(v) ? v : null, correct: v === s.answer };
      }) };
    }
    return scoreCrt(answers, config);
  },

  aggregate(responses, config) {
    if (config.design === "calibration") return aggregateCalibration(responses, config);
    if (config.design === "lossaversion") return aggregateLoss(responses, config);
    if (config.design === "bayes") return aggregateBayes(responses, config);
    return aggregateCrt(responses, config);
  },

  renderPresenter(result, config, history, ctx) {
    ctx = { lang: "vi", t: (k) => k, ...ctx };
    if (config.design === "calibration") return presentCalibration(result, config, history, ctx);
    if (config.design === "lossaversion") return presentLoss(result, config, history, ctx);
    if (config.design === "bayes") return presentBayes(result, config, history, ctx);
    return presentCrt(result, config, history, ctx);
  }
};

export default C;
