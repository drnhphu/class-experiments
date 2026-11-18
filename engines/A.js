// Engine A: choices within subject, self-paced in the opening batch.
// Designs: "pricelist" (E01: certainty equivalent from a multiple price list, plus a St. Petersburg
// willingness to pay) and "pair" (E02: two binary choices placed apart in the batch, read as a 2x2 table).
// Step types: "pricelist", "number", "choice". All wording students read comes from the config file.
import { el, pick } from "../js/i18n.js";
import {
  median, pct, round, sum, addCounts, binCounts, formatNumber, fmtPct, fill,
  threeColumns, barChart, distributionChart, benchmarkLine, heading, elapsedClock
} from "../js/viz.js";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const ofType = (config, type) => (config.steps || []).filter((s) => s && s.type === type);
export const rowKey = (i) => `row${String(i + 1).padStart(2, "0")}`;

// ---------- price list (pure) ----------
export function expectedValue(g) {
  return (g.p * g.high + (100 - g.p) * g.low) / 100;
}

// Reads one person's rows. Consistent = gamble on every row up to a switch row, sure amount after it
// (rows go from the smallest to the largest sure amount). k = index of the first "sure" row (n if none).
// The certainty equivalent lies between the last sure amount turned down and the first one taken.
export function analyzeList(answers, step) {
  const n = step.sure.length;
  const seq = step.sure.map((_, i) => answers?.[rowKey(i)]);
  if (seq.some((v) => v !== "sure" && v !== "gamble")) return null; // not answered (or incomplete)
  const first = seq.indexOf("sure");
  const k = first === -1 ? n : first;
  const consistent = seq.every((v, i) => (i < k ? v === "gamble" : v === "sure"));
  const switches = seq.slice(1).filter((v, i) => v !== seq[i]).length;
  if (!consistent) return { consistent: false, switches };
  const lo = k === 0 ? step.gamble.low : step.sure[k - 1];
  const hi = k === n ? step.gamble.high : step.sure[k];
  const ev = expectedValue(step.gamble);
  const ce = (lo + hi) / 2;
  return { consistent: true, switches, k, lo, hi, ce, ev, rp: ev - ce };
}

// Certainty equivalents implied by counts of switch rows (index 0..n), one value per person.
export function cesFromCounts(switchCounts, step) {
  const out = [];
  const n = step.sure.length;
  switchCounts.forEach((c, k) => {
    const lo = k === 0 ? step.gamble.low : step.sure[k - 1];
    const hi = k === n ? step.gamble.high : step.sure[k];
    for (let i = 0; i < c; i++) out.push((lo + hi) / 2);
  });
  return out;
}

export function listStats(switchCounts, inconsistent, wtp, step) {
  const ces = cesFromCounts(switchCounts, step);
  const ev = expectedValue(step.gamble);
  const medianCe = median(ces);
  return {
    consistent: ces.length,
    inconsistent,
    answered: ces.length + inconsistent,
    medianCe,
    medianRp: medianCe == null ? null : ev - medianCe,
    averse: ces.filter((c) => c < ev).length,
    loving: ces.filter((c) => c > ev).length,
    nWtp: wtp.length,
    medianWtp: median(wtp)
  };
}

// ---------- pair of choices (pure) ----------
export function pairKey(answers, steps) {
  const a = answers?.[steps[0].id], b = answers?.[steps[1].id];
  return Number.isInteger(a) && Number.isInteger(b) ? `${a}${b}` : null;
}

// Cells that break the independence axiom for the Allais rule: sure option in problem 1 with the
// long shot in problem 2 (classic pattern, "01"), or the reverse ("10").
const VIOLATIONS = { allais: ["01", "10"] };
const CLASSIC = { allais: "01" };

// Outcomes as a map x -> probability (percent); merges repeated amounts.
function lottery(option) {
  const m = new Map();
  for (const o of option?.outcomes || []) m.set(o.x, (m.get(o.x) || 0) + o.p);
  return m;
}
const sameLottery = (m, pairs) => m.size === pairs.length && pairs.every(([x, p]) => Math.abs((m.get(x) ?? -1) - p) < 1e-9);

// ---------- validation ----------
function bilingual(obj) { return obj && typeof obj === "object" && typeof obj.vi === "string" && typeof obj.en === "string"; }

function validatePricelist(config) {
  const errs = [];
  const lists = ofType(config, "pricelist");
  if (lists.length !== 1) return ["A/pricelist: cần đúng một bước type \"pricelist\""];
  const s = lists[0], g = s.gamble || {};
  if (!bilingual(s.prompt)) errs.push("A/pricelist: thiếu prompt");
  if (!bilingual(s.sureLabel) || !bilingual(s.gambleLabel)) errs.push("A/pricelist: thiếu sureLabel hoặc gambleLabel");
  if (g.p !== 50) errs.push("A/pricelist: canh bạc phải là 50/50 (gamble.p = 50)");
  if (!isNum(g.high) || !isNum(g.low) || g.low < 0 || g.high <= g.low) errs.push("A/pricelist: gamble.high phải lớn hơn gamble.low, và gamble.low không âm");
  const sure = s.sure;
  if (!Array.isArray(sure) || sure.length < 10 || !sure.every(isNum)) return [...errs, "A/pricelist: cần từ 10 mức chắc chắn trở lên (sure)"];
  if (sure.length > 30) errs.push("A/pricelist: tối đa 30 mức chắc chắn");
  const step = sure[1] - sure[0];
  if (!(step > 0) || sure.some((v, i) => i > 0 && Math.abs(v - sure[i - 1] - step) > 1e-9)) errs.push("A/pricelist: các mức chắc chắn phải tăng dần và cách đều");
  if (isNum(g.high)) {
    if (!(sure[0] < 0.1 * g.high)) errs.push("A/pricelist: mức thấp nhất phải dưới 10% giải thưởng");
    if (Math.abs(sure[sure.length - 1] - g.high) > 1e-9) errs.push("A/pricelist: mức cao nhất phải bằng 100% giải thưởng");
    const ev = expectedValue(g);
    const below = sure.filter((v) => v < ev).length, above = sure.filter((v) => v > ev).length;
    if (Math.abs(below - above) > 2) errs.push(`A/pricelist: giá trị kỳ vọng ${ev} phải nằm khoảng giữa danh sách (${below} mức dưới, ${above} mức trên)`);
  }
  for (const n of ofType(config, "number")) {
    if (!bilingual(n.prompt)) errs.push(`A/number ${n.id}: thiếu prompt`);
    if (!isNum(n.min) || !isNum(n.max) || n.max <= n.min) errs.push(`A/number ${n.id}: cần min < max (giới hạn nhập)`);
  }
  if ((config.steps || []).some((x) => !["pricelist", "number"].includes(x?.type))) errs.push("A/pricelist: chỉ nhận bước pricelist và number");
  return errs;
}

function validateAllais(config) {
  const errs = [];
  const ch = ofType(config, "choice");
  if (ch.length !== 2 || (config.steps || []).length !== 2) return ["A/allais: cần đúng hai bước type \"choice\""];
  for (const s of ch) {
    if (!bilingual(s.prompt)) errs.push(`A/allais ${s.id}: thiếu prompt`);
    if (!Array.isArray(s.options) || s.options.length !== 2) { errs.push(`A/allais ${s.id}: cần đúng hai phương án`); continue; }
    s.options.forEach((o, i) => {
      if (!bilingual(o.name)) errs.push(`A/allais ${s.id}: phương án ${i + 1} thiếu name`);
      const ps = (o.outcomes || []).map((x) => x.p);
      if (!ps.length || !ps.every(isNum) || Math.abs(sum(ps) - 100) > 1e-9) errs.push(`A/allais ${s.id}: xác suất của phương án ${i + 1} phải cộng lại 100`);
      if ((o.outcomes || []).some((x) => !isNum(x.x) || x.x < 0)) errs.push(`A/allais ${s.id}: kết cục phải là số không âm`);
    });
  }
  if (errs.length) return errs;
  // Problem 1, option A: one sure amount X.
  const a = lottery(ch[0].options[0]);
  if (a.size !== 1 || [...a.values()][0] !== 100 || !([...a.keys()][0] > 0)) return ["A/allais: phương án A của bài 1 phải chắc chắn 100% nhận một khoản X > 0"];
  const X = [...a.keys()][0];
  const b = lottery(ch[0].options[1]);
  const H = Math.max(...b.keys());
  const q = b.get(H), r = b.get(X), z = b.get(0);
  const sets = [{ q: 10, r: 89, z: 1, ratio: 5 }, { q: 33, r: 66, z: 1, ratio: null }];
  const set = sets.find((x) => x.q === q && x.r === r && x.z === z && b.size === 3);
  if (!set) return ["A/allais: phương án B của bài 1 phải là bộ 10, 89, 1 (giải lớn gấp 5 lần X) hoặc bộ 33, 66, 1 của Kahneman và Tversky (1979)"];
  if (!(H > X)) errs.push("A/allais: giải lớn phải lớn hơn X");
  if (set.ratio && Math.abs(H - set.ratio * X) > 1e-9) errs.push("A/allais: với bộ 10, 89, 1 thì giải lớn phải gấp 5 lần X");
  // Problem 2: the common consequence (X with probability r) is removed from both options.
  if (!sameLottery(lottery(ch[1].options[0]), [[X, 100 - r], [0, r]])) errs.push(`A/allais: phương án thứ nhất của bài 2 phải là ${100 - r}% nhận X, ${r}% không nhận gì`);
  if (!sameLottery(lottery(ch[1].options[1]), [[H, q], [0, 100 - q]])) errs.push(`A/allais: phương án thứ hai của bài 2 phải là ${q}% nhận giải lớn, ${100 - q}% không nhận gì`);
  const sep = config.separate;
  if (!sep || sep.steps?.[0] !== ch[0].id || sep.steps?.[1] !== ch[1].id || !(sep.minGap >= 3)) {
    errs.push("A/allais: cần separate = { steps: [bài 1, bài 2], minGap ≥ 3 } để hai bài cách nhau ít nhất ba thí nghiệm");
  }
  if (!bilingual(config.text?.sure) || !bilingual(config.text?.outcome) || !bilingual(config.text?.zero)) errs.push("A/allais: thiếu text.sure, text.outcome hoặc text.zero");
  return errs;
}

// ---------- phone screens ----------
const box = (...c) => el("div", { class: "space-y-3" }, ...c);
const primaryBtn = (label, onclick, disabled = false) =>
  el("button", { class: "w-full rounded-lg bg-slate-900 py-3 font-medium text-white disabled:opacity-40", disabled, onclick }, label);

function outcomeText(option, config, lang) {
  const unit = pick(config.unit, lang);
  const outs = option.outcomes || [];
  if (outs.length === 1 && outs[0].p === 100) return fill(pick(config.text.sure, lang), { x: outs[0].x, unit }, lang);
  return outs.map((o) => fill(pick(o.x === 0 ? config.text.zero : config.text.outcome, lang), { p: o.p, x: o.x, unit }, lang)).join("; ");
}

function renderPricelist(s, config, ctx) {
  const lang = ctx.lang, unit = pick(config.unit, lang);
  const picks = {};
  const elapsed = elapsedClock(ctx);
  const submit = primaryBtn(ctx.t("eng.confirm"), () => {
    if (Object.keys(picks).length < s.sure.length) return;
    ctx.submit({ ...picks }, { [s.id]: elapsed() });
  }, true);
  const rows = s.sure.map((x, i) => {
    const key = rowKey(i);
    const mk = (val, label) => el("button", {
      class: "rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm",
      onclick: (ev) => {
        picks[key] = val;
        for (const b of ev.currentTarget.parentNode.children) b.className = "rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm";
        ev.currentTarget.className = "rounded-lg border-2 border-slate-900 bg-slate-900 px-2 py-2 text-sm text-white";
        submit.disabled = Object.keys(picks).length < s.sure.length;
      }
    }, label);
    return el("div", { class: "grid grid-cols-[2rem_1fr_1fr] items-center gap-2" },
      el("span", { class: "text-xs text-slate-500" }, String(i + 1)),
      mk("sure", fill(pick(s.sureLabel, lang), { x: x, unit }, lang)),
      mk("gamble", pick(s.gambleLabel, lang)));
  });
  return box(el("p", { class: "whitespace-pre-line" }, pick(s.prompt, lang)), el("div", { class: "space-y-2" }, rows),
    el("p", { class: "text-xs text-slate-500" }, ctx.t("a.listHelp")), submit);
}

function renderNumber(s, config, ctx) {
  const lang = ctx.lang;
  const elapsed = elapsedClock(ctx);
  const input = el("input", { type: "number", inputmode: "decimal", step: "any", min: String(s.min), max: String(s.max),
    class: "w-full rounded-lg border border-slate-300 px-3 py-3 text-lg" });
  const echo = el("p", { class: "text-sm text-slate-500" }, "");
  const msg = el("p", { class: "text-sm text-rose-700" }, "");
  input.addEventListener("input", () => { const v = Number(input.value); echo.textContent = input.value === "" || !isNum(v) ? "" : `= ${formatNumber(v, lang)} ${pick(config.unit, lang)}`; });
  const go = primaryBtn(ctx.t("eng.confirm"), () => {
    const v = Number(input.value);
    if (input.value === "" || !isNum(v) || v < s.min || v > s.max) { msg.textContent = ctx.t("eng.range", { min: formatNumber(s.min, lang), max: formatNumber(s.max, lang) }); return; }
    ctx.submit({ [s.id]: v }, { [s.id]: elapsed() });
  });
  return box(el("p", { class: "whitespace-pre-line" }, pick(s.prompt, lang)),
    el("label", { class: "block space-y-1" }, el("span", { class: "text-sm text-slate-600" }, pick(config.unit, lang)), input), echo, msg, go);
}

function renderChoice(s, config, ctx) {
  const lang = ctx.lang;
  const elapsed = elapsedClock(ctx);
  let chosen = null;
  const go = primaryBtn(ctx.t("eng.confirm"), () => {
    if (chosen == null) return;
    ctx.submit({ [s.id]: chosen }, { [s.id]: elapsed() });
  }, true);
  const opts = s.options.map((o, i) => el("button", {
    class: "w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-left",
    onclick: (ev) => {
      chosen = i;
      for (const b of ev.currentTarget.parentNode.children) b.className = "w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-left";
      ev.currentTarget.className = "w-full rounded-lg border-2 border-slate-900 bg-slate-100 px-4 py-3 text-left";
      go.disabled = false;
    }
  }, el("span", { class: "block font-medium" }, pick(o.name, lang)), el("span", { class: "block text-sm" }, outcomeText(o, config, lang))));
  return box(el("p", { class: "whitespace-pre-line" }, pick(s.prompt, lang)), el("div", { class: "grid gap-2" }, opts), go);
}

function renderPersonal(config, ctx) {
  const lang = ctx.lang, t = ctx.t, sc = ctx.score, unit = pick(config.unit, lang);
  const lines = [];
  if (config.design === "pricelist") {
    const a = sc.list;
    if (!a) lines.push(t("a.noAnswer"));
    else if (!a.consistent) lines.push(t("a.youInconsistent"));
    else {
      lines.push(t("a.youCe", { lo: formatNumber(a.lo, lang), hi: formatNumber(a.hi, lang), ce: formatNumber(a.ce, lang), unit }));
      lines.push(t("a.youRp", { ev: formatNumber(a.ev, lang), rp: formatNumber(a.rp, lang), unit }));
      lines.push(t(a.rp > 0 ? "a.youAverse" : a.rp < 0 ? "a.youLoving" : "a.youNeutral"));
    }
  } else {
    for (const c of sc.choices) {
      const s = ofType(config, "choice").find((x) => x.id === c.step), o = c.index == null ? null : s.options[c.index];
      lines.push(o ? t("a.youChose", { step: c.label, name: pick(o.name, lang), text: outcomeText(o, config, lang) }) : t("a.youSkipped", { step: c.label }));
    }
    if (sc.key) lines.push(t(sc.violation ? "a.youViolate" : "a.youConsistent"));
  }
  return el("div", { class: "space-y-3" }, el("h2", { class: "text-lg font-semibold" }, t("eng.yourResult")),
    ...lines.map((x) => el("p", {}, x)));
}

// ---------- projector ----------
function presentPricelist(result, config, history, ctx) {
  const { lang, t } = ctx;
  const list = ofType(config, "pricelist")[0];
  const unit = pick(config.unit, lang);
  const ev = expectedValue(list.gamble);
  const n = list.sure.length;
  const earlier = (history || []).filter((h) => Array.isArray(h?.switchCounts) && h.switchCounts.length === n + 1);
  const eCounts = addCounts(earlier.map((h) => h.switchCounts), n + 1);
  const eWtp = earlier.flatMap((h) => h.wtp || []);
  const mine = listStats(result.switchCounts, result.inconsistent, result.wtp || [], list);
  const prev = listStats(eCounts, sum(earlier.map((h) => h.inconsistent || 0)), eWtp, list);
  const has = prev.answered > 0;
  // Category k: certainty equivalent between bounds of switch row k.
  const bound = (k) => [k === 0 ? list.gamble.low : list.sure[k - 1], k === n ? list.gamble.high : list.sure[k]];
  const label = (from, to) => `${formatNumber(bound(from)[0], lang)}–${formatNumber(bound(to)[1], lang)}`;
  const bench = config.benchmark || {};
  const rows = [
    { label: t("a.medianCe", { unit }), mine: formatNumber(mine.medianCe, lang), earlier: has ? formatNumber(prev.medianCe, lang) : null, original: t("a.evIs", { ev: formatNumber(ev, lang) }) },
    { label: t("a.medianRp", { unit }), mine: formatNumber(mine.medianRp, lang), earlier: has ? formatNumber(prev.medianRp, lang) : null, original: bench.rp ? pick(bench.rp, lang) : null },
    { label: t("a.shareAverse"), mine: fmtPct(pct(mine.averse, mine.consistent), lang), earlier: has ? fmtPct(pct(prev.averse, prev.consistent), lang) : null, original: bench.averse ? pick(bench.averse, lang) : null },
    { label: t("a.shareInconsistent"), mine: fmtPct(pct(mine.inconsistent, mine.answered), lang), earlier: has ? fmtPct(pct(prev.inconsistent, prev.answered), lang) : null, original: null }
  ];
  const parts = [
    el("div", { class: "grid grid-cols-1 gap-8 lg:grid-cols-2" },
      el("div", { class: "space-y-2" }, heading(t("a.ceDist", { ev: formatNumber(ev, lang), unit })),
        distributionChart(result.switchCounts, label, ctx, { earlier: has ? eCounts : null, height: 280 }),
        el("p", { class: "text-base text-slate-500" }, t("a.ceNote", { m: mine.inconsistent }))),
      result.wtp ? el("div", { class: "space-y-2" }, heading(t("a.wtpDist", { unit })),
        wtpChart(result.wtp, eWtp, ctx),
        el("p", { class: "text-base text-slate-500" }, t("a.wtpNote", { med: formatNumber(mine.medianWtp, lang), prev: has ? formatNumber(prev.medianWtp, lang) : "—", unit }))) : null),
    threeColumns(rows, ctx, { mine: mine.answered, earlier: prev.answered }),
    benchmarkLine(bench, lang)
  ];
  return el("div", { class: "space-y-6" }, ...parts);
}

const WTP_EDGES = [0, 2, 4, 8, 16, 32, 64, 128, 256, 512];
function wtpChart(wtp, earlier, ctx) {
  const lang = ctx.lang;
  const counts = binCounts(wtp, WTP_EDGES);
  const last = WTP_EDGES.length - 2;
  const label = (from, to) => (to === last ? `≥ ${formatNumber(WTP_EDGES[from], lang)}` : `${formatNumber(WTP_EDGES[from], lang)}–${formatNumber(WTP_EDGES[to + 1], lang)}`);
  return distributionChart(counts, label, ctx, { earlier: earlier.length ? binCounts(earlier, WTP_EDGES) : null, height: 280 });
}

function presentPair(result, config, history, ctx) {
  const { lang, t } = ctx;
  const steps = ofType(config, "choice");
  const earlier = (history || []).filter((h) => h?.cross && Array.isArray(h.c1));
  const e = {
    c1: addCounts(earlier.map((h) => h.c1), 2), c2: addCounts(earlier.map((h) => h.c2), 2),
    cross: Object.fromEntries(["00", "01", "10", "11"].map((k) => [k, sum(earlier.map((h) => h.cross[k] || 0))]))
  };
  e.nBoth = sum(Object.values(e.cross));
  const has = sum(e.c1) > 0;
  const bench = config.benchmark || {};
  const viol = VIOLATIONS[config.rule] || [];
  const classic = CLASSIC[config.rule];
  const name = (si, oi) => pick(steps[si].options[oi].name, lang);
  const share = (c, i) => fmtPct(pct(c[i], sum(c)), lang);
  const cellPct = (cross, n, k) => fmtPct(pct(cross[k] || 0, n), lang);
  const violPct = (cross, n) => fmtPct(pct(sum(viol.map((k) => cross[k] || 0)), n), lang);
  const rows = [
    { label: t("a.pickIn", { step: 1, name: name(0, 0) }), mine: share(result.c1, 0), earlier: has ? share(e.c1, 0) : null, original: isNum(bench.percents?.[steps[0].id]?.[0]) ? `${bench.percents[steps[0].id][0]}%` : null },
    { label: t("a.pickIn", { step: 2, name: name(1, 1) }), mine: share(result.c2, 1), earlier: has ? share(e.c2, 1) : null, original: isNum(bench.percents?.[steps[1].id]?.[1]) ? `${bench.percents[steps[1].id][1]}%` : null },
    { label: t("a.classicPattern", { a: name(0, 0), b: name(1, 1) }), mine: cellPct(result.cross, result.nBoth, classic), earlier: e.nBoth ? cellPct(e.cross, e.nBoth, classic) : null, original: isNum(bench.cross?.[classic]) ? `${bench.cross[classic]}%` : null },
    { label: t("a.anyViolation"), mine: violPct(result.cross, result.nBoth), earlier: e.nBoth ? violPct(e.cross, e.nBoth) : null, original: null }
  ];
  // 2x2 table of this class, as percentages only (small cells are never shown as counts).
  const cell = (k) => el("td", { class: `border border-slate-300 p-4 text-center text-3xl ${k === classic ? "bg-rose-200 font-bold" : viol.includes(k) ? "bg-rose-50" : ""}` },
    cellPct(result.cross, result.nBoth, k));
  const grid = el("table", { class: "text-xl" },
    el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", { class: "p-2 font-normal" }, `${t("a.problem", { n: 2 })}: ${name(1, 0)}`), el("th", { class: "p-2 font-normal" }, `${t("a.problem", { n: 2 })}: ${name(1, 1)}`))),
    el("tbody", {},
      el("tr", {}, el("th", { class: "p-2 text-left font-normal" }, `${t("a.problem", { n: 1 })}: ${name(0, 0)}`), cell("00"), cell("01")),
      el("tr", {}, el("th", { class: "p-2 text-left font-normal" }, `${t("a.problem", { n: 1 })}: ${name(0, 1)}`), cell("10"), cell("11"))));
  return el("div", { class: "space-y-6" },
    el("div", { class: "flex flex-wrap items-start gap-10" }, grid,
      el("p", { class: "max-w-md text-xl text-slate-600" }, t("a.crossNote", { n: result.nBoth }))),
    threeColumns(rows, ctx, { mine: result.n1, earlier: sum(e.c1) }),
    benchmarkLine(bench, lang));
}

// ---------- engine ----------
const A = {
  id: "A",
  mode: "collect",

  validate(config) {
    if (config.design === "pricelist") return validatePricelist(config);
    if (config.design === "pair") {
      if (!bilingual(config.unit)) return ["A/pair: thiếu unit"];
      if (config.rule === "allais") return validateAllais(config);
      return [`A/pair: rule "${config.rule}" chưa được hỗ trợ`];
    }
    return [`A: design "${config.design}" không hợp lệ (pricelist hoặc pair)`];
  },

  assign() { return null; },

  renderStudent(step, config, ctx) {
    if (step === "__result") return renderPersonal(config, ctx);
    const s = (config.steps || []).find((x) => x.id === step);
    if (!s) return el("p", {}, step);
    if (s.type === "pricelist") return renderPricelist(s, config, ctx);
    if (s.type === "number") return renderNumber(s, config, ctx);
    return renderChoice(s, config, ctx);
  },

  // Personal result shown on the phone after the reveal, from the phone's own answers only.
  scoreLocal(answers, config) {
    if (!answers || !Object.keys(answers).length) return null;
    if (config.design === "pricelist") return { list: analyzeList(answers, ofType(config, "pricelist")[0]) };
    const steps = ofType(config, "choice");
    const key = pairKey(answers, steps);
    return {
      key,
      violation: key != null && (VIOLATIONS[config.rule] || []).includes(key),
      choices: steps.map((s, i) => ({ step: s.id, label: i + 1, index: Number.isInteger(answers[s.id]) ? answers[s.id] : null }))
    };
  },

  aggregate(responses, config) {
    if (config.design === "pricelist") {
      const list = ofType(config, "pricelist")[0];
      const num = ofType(config, "number")[0];
      const switchCounts = new Array(list.sure.length + 1).fill(0);
      let inconsistent = 0;
      const wtp = [];
      for (const r of responses) {
        const a = analyzeList(r.answers, list);
        if (a) { if (a.consistent) switchCounts[a.k]++; else inconsistent++; }
        const v = num ? r.answers?.[num.id] : null;
        if (isNum(v)) wtp.push(v);
      }
      wtp.sort((p, q) => p - q);
      const st = listStats(switchCounts, inconsistent, wtp, list);
      return { design: "pricelist", switchCounts, inconsistent, wtp: num ? wtp : null, ...st };
    }
    const steps = ofType(config, "choice");
    const c1 = [0, 0], c2 = [0, 0], cross = { "00": 0, "01": 0, "10": 0, "11": 0 };
    for (const r of responses) {
      const a = r.answers?.[steps[0].id], b = r.answers?.[steps[1].id];
      if (a === 0 || a === 1) c1[a]++;
      if (b === 0 || b === 1) c2[b]++;
      const k = pairKey(r.answers, steps);
      if (k in cross) cross[k]++;
    }
    return { design: "pair", rule: config.rule, n1: sum(c1), n2: sum(c2), c1, c2, cross, nBoth: sum(Object.values(cross)) };
  },

  renderPresenter(result, config, history, ctx) {
    ctx = { lang: "vi", t: (k) => k, ...ctx };
    return config.design === "pricelist" ? presentPricelist(result, config, history, ctx) : presentPair(result, config, history, ctx);
  }
};

export default A;
