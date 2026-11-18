// Engine B: between-subject conditions. Each person sees one version; the instructor's page splits
// the class into equal groups (js/assign.js). The condition each person got is read from the
// assignment document (CSV column "assignment"), never from the phone.
// Designs: "anchor" (E05: comparison question with a low or high anchor, then an estimate),
// "framing" (E06: the same two options described as gains or as losses), "decoy" (E07: two options,
// or the same two plus an option the target beats on every attribute) and "default" (E08: the same
// yes/no decision with the box ticked or unticked at the start).
// All wording students read comes from the config file.
import { el, pick } from "../js/i18n.js";
import { balancedAssign } from "../js/assign.js";
import {
  median, pct, round, sum, formatNumber, fmtPct, fill, threeColumns, barChart, benchmarkLine, heading, elapsedClock, MIN_CELL
} from "../js/viz.js";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const bilingual = (o) => o && typeof o === "object" && typeof o.vi === "string" && typeof o.en === "string";
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const has = (o, ...keys) => bilingual(o) && keys.every((k) => o.vi.includes(`{${k}}`) && o.en.includes(`{${k}}`));

// ---------- pure helpers ----------
export function fraction(r) { return `${r.num}/${r.den}`; }
export function complement(r) { return `${r.den - r.num}/${r.den}`; }

// Option texts of one framing version, built from the shared numbers so both versions describe
// exactly the same outcomes.
export function framingTexts(config, cond, lang) {
  const f = config.frames[cond];
  const n = cond === "gain" ? config.sure : config.total - config.sure;
  const params = { n, all: config.total, p: fraction(config.risky), q: complement(config.risky) };
  return [fill(pick(f.sure, lang), params, lang), fill(pick(f.risky, lang), params, lang)];
}

// Responses arrive with r.assignment attached by the instructor's page.
function byCondition(responses, config) {
  const out = Object.fromEntries(config.conditions.map((c) => [c, []]));
  for (const r of responses) if (r.assignment in out) out[r.assignment].push(r);
  return out;
}

// ---------- validation ----------
function validateCommon(config) {
  const errs = [];
  const conds = config.conditions;
  if (!Array.isArray(conds) || conds.length !== 2 || new Set(conds).size !== 2 || conds.some((c) => !/^[a-z]{1,12}$/.test(c || ""))) {
    errs.push("B: conditions phải là đúng hai nhãn khác nhau (chữ thường)");
  } else if (!conds.every((c) => bilingual(config.conditionNames?.[c]))) errs.push("B: thiếu conditionNames cho từng điều kiện");
  return errs;
}

function validateAnchor(config) {
  const errs = validateCommon(config);
  if (errs.length) return errs;
  const [cmp, est] = config.steps || [];
  if ((config.steps || []).length !== 2 || cmp?.type !== "compare" || est?.type !== "estimate") errs.push("B/anchor: cần hai bước theo thứ tự: compare (câu so sánh) rồi estimate (câu ước lượng)");
  if (config.position !== "first") errs.push("B/anchor: cần position = \"first\" (đứng đầu phiên thu)");
  if (!isNum(config.truth)) errs.push("B/anchor: truth phải là số");
  if (!config.source || !config.source.label || !/^https:\/\//.test(config.source.url || "")) errs.push("B/anchor: cần nguồn kiểm chứng giá trị thật (source.label và source.url https)");
  if (!bilingual(config.unit)) errs.push("B/anchor: thiếu unit");
  const a = config.anchors || {};
  const vals = config.conditions.map((c) => a[c]);
  if (!vals.every(isNum)) errs.push("B/anchor: anchors cần một số cho mỗi điều kiện");
  else if (isNum(config.truth) && !(Math.min(...vals) < config.truth && config.truth < Math.max(...vals))) errs.push("B/anchor: hai mỏ neo phải nằm hai phía giá trị thật");
  if (cmp?.type === "compare") {
    if (!has(cmp.prompt, "anchor")) errs.push("B/anchor: câu so sánh phải chứa {anchor} ở cả hai ngôn ngữ");
    if (!bilingual(cmp.more) || !bilingual(cmp.less)) errs.push("B/anchor: câu so sánh cần nhãn more và less");
  }
  if (est?.type === "estimate") {
    if (!bilingual(est.prompt)) errs.push("B/anchor: thiếu prompt của câu ước lượng");
    if (est.prompt && /\{anchor\}/.test(JSON.stringify(est.prompt))) errs.push("B/anchor: câu ước lượng không được nhắc lại mỏ neo");
    if (!isNum(est.min) || !isNum(est.max) || est.max <= est.min) errs.push("B/anchor: câu ước lượng cần min < max");
  }
  return errs;
}

function validateFraming(config) {
  const errs = validateCommon(config);
  if (errs.length) return errs;
  if ([...config.conditions].sort().join() !== "gain,loss") errs.push("B/framing: conditions phải là gain và loss");
  if ((config.steps || []).length !== 1) errs.push("B/framing: cần đúng một bước");
  if (!bilingual(config.story)) errs.push("B/framing: thiếu story (phần mô tả chung của hai phiên bản)");
  const r = config.risky || {};
  if (!Number.isInteger(config.total) || config.total <= 0) errs.push("B/framing: total phải là số nguyên dương");
  if (!Number.isInteger(r.num) || !Number.isInteger(r.den) || !(r.num > 0 && r.num < r.den)) errs.push("B/framing: risky cần num và den nguyên, 0 < num < den");
  else if (!Number.isInteger(config.sure) || config.sure * r.den !== config.total * r.num) errs.push("B/framing: phương án chắc chắn và phương án rủi ro phải có cùng giá trị kỳ vọng (sure = total × num / den)");
  for (const c of ["gain", "loss"]) {
    const f = config.frames?.[c];
    if (!f || !has(f.sure, "n") || !has(f.risky, "p", "q", "all")) errs.push(`B/framing: frames.${c} cần sure chứa {n} và risky chứa {p}, {q}, {all}`);
  }
  return errs;
}

const IMAGE_KEY = /^(image|images|img|picture|photo)$/i;
const IMAGE_TEXT = /<img|\.(png|jpe?g|gif|svg|webp)\b/i;
// True if any key or string anywhere in the config points to a picture.
function usesImages(node) {
  if (typeof node === "string") return IMAGE_TEXT.test(node);
  if (Array.isArray(node)) return node.some(usesImages);
  if (node && typeof node === "object") return Object.entries(node).some(([k, v]) => IMAGE_KEY.test(k) || usesImages(v));
  return false;
}
// Better on attribute a: higher or lower value, as the attribute says.
const better = (a, x, y) => (a.better === "lower" ? x < y : x > y);
const OPTION_KEYS = ["target", "competitor", "decoy"];

function validateDecoy(config) {
  const errs = validateCommon(config);
  if (errs.length) return errs;
  if ([...config.conditions].sort().join() !== "base,decoy") errs.push("B/decoy: conditions phải là base (không có mồi) và decoy (có mồi)");
  const st = config.steps || [];
  if (st.length !== 1 || st[0]?.type !== "choice" || !bilingual(st[0]?.prompt)) errs.push("B/decoy: cần đúng một bước type \"choice\" có prompt");
  if (!bilingual(config.story)) errs.push("B/decoy: thiếu story (phần mô tả chung của hai phiên bản)");
  const at = config.attributes;
  if (!Array.isArray(at) || at.length !== 2 || new Set(at.map((a) => a?.id)).size !== 2 || at.some((a) => !a?.id || !bilingual(a.name) || !bilingual(a.unit) || !["higher", "lower"].includes(a.better))) {
    return [...errs, "B/decoy: cần đúng hai thuộc tính bằng số (attributes), mỗi thuộc tính có id, name, unit và better là \"higher\" hoặc \"lower\""];
  }
  const o = config.options || {};
  if (!OPTION_KEYS.every((k) => bilingual(o[k]?.name) && at.every((a) => isNum(o[k]?.values?.[a.id])))) {
    return [...errs, "B/decoy: options cần target, competitor và decoy, mỗi phương án có name và một số cho mỗi thuộc tính"];
  }
  const v = (k, a) => o[k].values[a.id];
  const tBetter = at.filter((a) => better(a, v("target", a), v("competitor", a))).length;
  const cBetter = at.filter((a) => better(a, v("competitor", a), v("target", a))).length;
  if (tBetter !== 1 || cBetter !== 1) errs.push("B/decoy: target và competitor phải đánh đổi: mỗi phương án hơn phương án kia ở đúng một thuộc tính");
  if (!at.every((a) => better(a, v("target", a), v("decoy", a)))) errs.push("B/decoy: mồi phải bị target trội ở cả hai thuộc tính");
  if (!at.some((a) => better(a, v("decoy", a), v("competitor", a)))) errs.push("B/decoy: mồi không được bị competitor trội (mồi phải hơn competitor ở ít nhất một thuộc tính)");
  const ord = config.order;
  if (!Array.isArray(ord) || ord.length !== 3 || [...ord].sort().join() !== [...OPTION_KEYS].sort().join()) errs.push("B/decoy: order phải liệt kê đủ target, competitor, decoy, mỗi phương án một lần (thứ tự hiện)");
  if (usesImages(config)) errs.push("B/decoy: phương án phải trình bày bằng bảng số, không dùng hình ảnh");
  return errs;
}

function validateDefault(config) {
  const errs = validateCommon(config);
  if (errs.length) return errs;
  if ([...config.conditions].sort().join() !== "optin,optout") errs.push("B/default: conditions phải là optin (ô để trống) và optout (ô đánh dấu sẵn)");
  const st = config.steps || [];
  if (st.length !== 1 || st[0]?.type !== "default") errs.push("B/default: cần đúng một bước type \"default\"");
  if (!bilingual(config.story) || !bilingual(config.label)) errs.push("B/default: cần một story và một label dùng chung cho hai phiên bản (hai phiên bản chỉ khác ô chọn sẵn)");
  if (config.frames || config.versions || config.labels) errs.push("B/default: không được có chữ riêng cho từng phiên bản (frames, versions, labels); hai phiên bản chỉ khác ô chọn sẵn");
  return errs;
}

// ---------- phone screens ----------
const primaryBtn = (label, onclick, disabled = false) =>
  el("button", { class: "w-full rounded-lg bg-slate-900 py-3 font-medium text-white disabled:opacity-40", disabled, onclick }, label);
const OPT = "w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-left";
const OPT_ON = "w-full rounded-lg border-2 border-slate-900 bg-slate-100 px-4 py-3 text-left";

// Choose one of several buttons, then confirm (a stray tap is not an answer).
function choiceScreen(prompt, labels, values, key, ctx) {
  const elapsed = elapsedClock(ctx);
  let chosen = null;
  const go = primaryBtn(ctx.t("eng.confirm"), () => { if (chosen != null) ctx.submit({ [key]: chosen }, { [key]: elapsed() }); }, true);
  const opts = labels.map((label, i) => el("button", { class: OPT, onclick: (ev) => {
    chosen = values[i];
    for (const b of ev.currentTarget.parentNode.children) b.className = OPT;
    ev.currentTarget.className = OPT_ON;
    go.disabled = false;
  } }, label));
  return el("div", { class: "space-y-3" }, el("p", { class: "whitespace-pre-line" }, prompt), el("div", { class: "grid gap-2" }, opts), go);
}

function renderAnchorStep(s, config, ctx) {
  const { lang, t } = ctx;
  const unit = pick(config.unit, lang);
  if (s.type === "compare") {
    const anchor = config.anchors[ctx.assignment];
    return choiceScreen(fill(pick(s.prompt, lang), { anchor, unit }, lang),
      [fill(pick(s.more, lang), { anchor, unit }, lang), fill(pick(s.less, lang), { anchor, unit }, lang)], ["more", "less"], s.id, ctx);
  }
  const elapsed = elapsedClock(ctx);
  const input = el("input", { type: "number", inputmode: "decimal", step: "any", class: "w-full rounded-lg border border-slate-300 px-3 py-3 text-lg" });
  const echo = el("p", { class: "text-sm text-slate-500" }, "");
  const msg = el("p", { class: "text-sm text-rose-700" }, "");
  input.addEventListener("input", () => { const v = Number(input.value); echo.textContent = input.value !== "" && isNum(v) ? `= ${formatNumber(v, lang)} ${unit}` : ""; });
  const go = primaryBtn(t("eng.confirm"), () => {
    const v = input.value === "" ? NaN : Number(input.value);
    if (!isNum(v) || v < s.min || v > s.max) { msg.textContent = t("eng.range", { min: formatNumber(s.min, lang), max: formatNumber(s.max, lang) }); return; }
    ctx.submit({ [s.id]: v }, { [s.id]: elapsed() });
  });
  return el("div", { class: "space-y-3" }, el("p", { class: "whitespace-pre-line" }, fill(pick(s.prompt, lang), { unit }, lang)),
    el("label", { class: "block space-y-1" }, el("span", { class: "text-sm text-slate-600" }, unit), input), echo, msg, go);
}

function renderFramingStep(s, config, ctx) {
  const texts = framingTexts(config, ctx.assignment, ctx.lang);
  return choiceScreen(pick(config.story, ctx.lang), texts, [0, 1], s.id, ctx);
}

// Options in display order: the base version leaves the decoy out and keeps the others' order.
const shownOptions = (config, cond) => config.order.filter((k) => cond === "decoy" || k !== "decoy");
const valueText = (config, key, a, lang) => `${formatNumber(config.options[key].values[a.id], lang)} ${pick(a.unit, lang)}`;

function renderDecoyStep(s, config, ctx) {
  const { lang, t } = ctx;
  const elapsed = elapsedClock(ctx);
  const keys = shownOptions(config, ctx.assignment);
  let chosen = null;
  const go = primaryBtn(t("eng.confirm"), () => { if (chosen != null) ctx.submit({ [s.id]: chosen }, { [s.id]: elapsed() }); }, true);
  const GRID = "grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-2";
  const head = el("div", { class: `${GRID} px-4 text-xs text-slate-500` }, el("span", {}, ""),
    ...config.attributes.map((a) => el("span", { class: "text-right" }, `${pick(a.name, lang)} (${pick(a.unit, lang)})`)));
  const rows = keys.map((k) => el("button", { class: `${OPT} ${GRID}`, onclick: (ev) => {
    chosen = k;
    for (const b of ev.currentTarget.parentNode.children) b.className = `${OPT} ${GRID}`;
    ev.currentTarget.className = `${OPT_ON} ${GRID}`;
    go.disabled = false;
  } }, el("span", { class: "font-medium" }, pick(config.options[k].name, lang)),
    ...config.attributes.map((a) => el("span", { class: "text-right tabular-nums" }, formatNumber(config.options[k].values[a.id], lang)))));
  return el("div", { class: "space-y-3" }, el("p", { class: "whitespace-pre-line" }, pick(config.story, lang)),
    el("p", { class: "whitespace-pre-line" }, pick(s.prompt, lang)), head, el("div", { class: "grid gap-2" }, rows), go);
}

// One tap ticks or unticks the box in both versions; only the starting state differs.
function renderDefaultStep(s, config, ctx) {
  const { lang, t } = ctx;
  const elapsed = elapsedClock(ctx);
  let on = ctx.assignment === "optout";
  const mark = el("span", { class: "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border-2 border-slate-900 text-lg" }, on ? "✓" : "");
  const box = el("button", { class: "flex w-full items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 text-left", role: "checkbox", "aria-checked": String(on),
    onclick: () => { on = !on; mark.textContent = on ? "✓" : ""; box.setAttribute("aria-checked", String(on)); } },
    mark, el("span", {}, pick(config.label, lang)));
  const go = primaryBtn(t("eng.confirm"), () => ctx.submit({ [s.id]: on ? 1 : 0 }, { [s.id]: elapsed() }));
  return el("div", { class: "space-y-3" }, el("p", { class: "whitespace-pre-line" }, pick(config.story, lang)), box, go);
}

function renderPersonal(config, ctx) {
  const { lang, t } = ctx;
  const cond = ctx.assignment, other = config.conditions.find((c) => c !== cond);
  if (!config.conditions.includes(cond)) return el("p", { class: "text-lg" }, t("reveal.look"));
  const name = (c) => pick(config.conditionNames[c], lang);
  const lines = [];
  if (config.design === "anchor") {
    const unit = pick(config.unit, lang);
    const est = config.steps[1];
    lines.push(t("b.youAnchor", { a: formatNumber(config.anchors[cond], lang), unit, g: name(cond) }));
    lines.push(t("b.otherAnchor", { a: formatNumber(config.anchors[other], lang), unit, g: name(other) }));
    const v = ctx.myAnswers?.[est.id];
    lines.push(isNum(v) ? t("b.youEstimate", { v: formatNumber(v, lang), unit }) : t("a.noAnswer"));
    lines.push(t("b.truth", { v: formatNumber(config.truth, lang), unit, src: config.source.label }));
  } else if (config.design === "decoy") {
    const v = ctx.myAnswers?.[config.steps[0].id];
    const list = (c) => shownOptions(config, c).map((k) => `• ${pick(config.options[k].name, lang)}: ${config.attributes.map((a) => valueText(config, k, a, lang)).join(", ")}`);
    lines.push(t("b.youRead", { g: name(cond) }));
    lines.push(...list(cond));
    lines.push(config.options[v] ? t("b.youPicked", { a: pick(config.options[v].name, lang) }) : t("a.noAnswer"));
    lines.push(t(cond === "decoy" ? "b.decoy.youHadDecoy" : "b.decoy.youNoDecoy", { d: pick(config.options.decoy.name, lang), tg: pick(config.options.target.name, lang) }));
  } else if (config.design === "default") {
    const v = ctx.myAnswers?.[config.steps[0].id];
    lines.push(t("b.default.youSaw", { g: name(cond) }));
    lines.push(v === 1 || v === 0 ? t(v === 1 ? "b.default.youIn" : "b.default.youOut", { l: pick(config.label, lang) }) : t("a.noAnswer"));
    lines.push(t((v === 1) === (cond === "optout") ? "b.default.kept" : "b.default.changed"));
    lines.push(t("b.default.other", { g: name(other) }));
  } else {
    const mine = framingTexts(config, cond, lang), theirs = framingTexts(config, other, lang);
    const v = ctx.myAnswers?.[config.steps[0].id];
    lines.push(t("b.youRead", { g: name(cond) }));
    lines.push(...mine.map((x) => `• ${x}`));
    lines.push(Number.isInteger(v) ? t("b.youPicked", { a: mine[v] }) : t("a.noAnswer"));
    lines.push(t("b.otherRead", { g: name(other) }));
    lines.push(...theirs.map((x) => `• ${x}`));
  }
  return el("div", { class: "space-y-3" }, el("h2", { class: "text-lg font-semibold" }, t("eng.yourResult")), ...lines.map((x) => el("p", {}, x)));
}

// ---------- aggregation (instructor's laptop) ----------
function aggregateAnchor(responses, config) {
  const est = config.steps[1].id, cmp = config.steps[0].id;
  const groups = byCondition(responses, config);
  const out = { design: "anchor", conditions: config.conditions, n: {}, estimates: {}, median: {}, more: {} };
  for (const c of config.conditions) {
    const vals = groups[c].map((r) => r.answers?.[est]).filter(isNum).sort((a, b) => a - b);
    out.estimates[c] = vals;
    out.n[c] = vals.length;
    out.median[c] = median(vals);
    out.more[c] = groups[c].filter((r) => r.answers?.[cmp] === "more").length;
  }
  return out;
}

function aggregateFraming(responses, config) {
  const key = config.steps[0].id;
  const groups = byCondition(responses, config);
  const out = { design: "framing", conditions: config.conditions, counts: {}, n: {} };
  for (const c of config.conditions) {
    const cnt = [0, 0];
    for (const r of groups[c]) { const v = r.answers?.[key]; if (v === 0 || v === 1) cnt[v]++; }
    out.counts[c] = cnt;
    out.n[c] = sum(cnt);
  }
  return out;
}

function aggregateDecoy(responses, config) {
  const key = config.steps[0].id;
  const groups = byCondition(responses, config);
  const out = { design: "decoy", conditions: config.conditions, counts: {}, n: {} };
  for (const c of config.conditions) {
    const cnt = Object.fromEntries(OPTION_KEYS.map((k) => [k, 0]));
    for (const r of groups[c]) { const v = r.answers?.[key]; if (v in cnt && (c === "decoy" || v !== "decoy")) cnt[v]++; }
    out.counts[c] = cnt;
    out.n[c] = sum(Object.values(cnt));
  }
  return out;
}

function aggregateDefault(responses, config) {
  const key = config.steps[0].id;
  const groups = byCondition(responses, config);
  const out = { design: "default", conditions: config.conditions, joined: {}, n: {} };
  for (const c of config.conditions) {
    const vals = groups[c].map((r) => r.answers?.[key]).filter((v) => v === 0 || v === 1);
    out.joined[c] = vals.filter((v) => v === 1).length;
    out.n[c] = vals.length;
  }
  return out;
}

// Anchoring index: how far apart the two groups' medians are, relative to the distance between anchors.
export function anchoringIndex(medians, anchors, conds) {
  const [lo, hi] = [...conds].sort((a, b) => anchors[a] - anchors[b]);
  if (!isNum(medians[lo]) || !isNum(medians[hi])) return null;
  return (medians[hi] - medians[lo]) / (anchors[hi] - anchors[lo]);
}

// ---------- projector ----------
function presentAnchor(result, config, history, ctx) {
  const { lang, t } = ctx;
  const conds = [...config.conditions].sort((a, b) => config.anchors[a] - config.anchors[b]);
  const unit = pick(config.unit, lang);
  const earlier = (history || []).filter((h) => h?.estimates && conds.every((c) => Array.isArray(h.estimates[c])));
  const eEst = Object.fromEntries(conds.map((c) => [c, earlier.flatMap((h) => h.estimates[c])]));
  // A group median from fewer than MIN_CELL people would expose individual answers: hidden.
  const med = (vals) => (vals.length >= MIN_CELL ? median(vals) : null);
  const mine = Object.fromEntries(conds.map((c) => [c, med(result.estimates[c] || [])]));
  const prev = Object.fromEntries(conds.map((c) => [c, med(eEst[c])]));
  const hasPrev = conds.some((c) => eEst[c].length);
  const show = (v, n) => (v != null ? formatNumber(round(v, 0), lang) : n ? t("b.tooFew") : "—");
  const ai = anchoringIndex(mine, config.anchors, conds), aiPrev = anchoringIndex(prev, config.anchors, conds);
  const name = (c) => pick(config.conditionNames[c], lang);
  const bench = config.benchmark || {};
  const datasets = [
    { label: t("b.anchor"), data: conds.map((c) => config.anchors[c]) },
    { label: t("b.medianThis"), data: conds.map((c) => mine[c]) } // null (hidden small group) draws no bar
  ];
  if (hasPrev) datasets.push({ label: t("b.medianEarlier"), data: conds.map((c) => prev[c]) });
  const rows = [
    ...conds.map((c) => ({ label: t("b.medianOf", { g: name(c), a: formatNumber(config.anchors[c], lang), unit }), mine: show(mine[c], result.n[c]), earlier: hasPrev ? show(prev[c], eEst[c].length) : null, original: null })),
    { label: t("b.index"), mine: ai == null ? "—" : formatNumber(round(ai, 2), lang), earlier: hasPrev && aiPrev != null ? formatNumber(round(aiPrev, 2), lang) : null, original: bench.index ? pick(bench.index, lang) : null },
    { label: t("b.truthRow", { unit }), mine: formatNumber(config.truth, lang), earlier: null, original: config.source.label }
  ];
  return el("div", { class: "space-y-6" },
    heading(t("b.anchorTitle", { unit })),
    barChart(conds.map((c) => cap(name(c))), datasets, { percent: false, height: 300 }),
    el("p", { class: "text-base text-slate-500" }, t("b.anchorNote", { lo: result.n[conds[0]], hi: result.n[conds[1]] })),
    threeColumns(rows, ctx, { mine: sum(conds.map((c) => result.n[c])), earlier: sum(conds.map((c) => eEst[c].length)) }),
    benchmarkLine(bench, lang));
}

function presentFraming(result, config, history, ctx) {
  const { lang, t } = ctx;
  const conds = ["gain", "loss"];
  const earlier = (history || []).filter((h) => h?.counts && conds.every((c) => Array.isArray(h.counts[c])));
  const eCounts = Object.fromEntries(conds.map((c) => [c, [0, 1].map((i) => sum(earlier.map((h) => h.counts[c][i] || 0)))]));
  const sureShare = (cnt) => pct(cnt[0], sum(cnt));
  const hasPrev = conds.some((c) => sum(eCounts[c]));
  const name = (c) => pick(config.conditionNames[c], lang);
  const bench = config.benchmark || {};
  const diff = (cs) => { const a = sureShare(cs.gain), b = sureShare(cs.loss); return a == null || b == null ? null : a - b; };
  const datasets = [{ label: t("present.thisClass"), data: conds.map((c) => round(sureShare(result.counts[c]), 0) ?? 0) }];
  if (hasPrev) datasets.push({ label: t("present.earlier"), data: conds.map((c) => round(sureShare(eCounts[c]), 0) ?? 0) });
  if (isNum(bench.gain) && isNum(bench.loss)) datasets.push({ label: t("present.original"), data: [bench.gain, bench.loss] });
  const pts = (x) => (x == null ? "—" : t("b.points", { d: formatNumber(round(x, 0), lang) }));
  const rows = [
    ...conds.map((c) => ({ label: t("b.sureIn", { g: name(c) }), mine: fmtPct(sureShare(result.counts[c]), lang), earlier: hasPrev ? fmtPct(sureShare(eCounts[c]), lang) : null, original: isNum(bench[c]) ? `${bench[c]}%` : null })),
    { label: t("b.gap"), mine: pts(diff(result.counts)), earlier: hasPrev ? pts(diff(eCounts)) : null, original: isNum(bench.gain) && isNum(bench.loss) ? pts(bench.gain - bench.loss) : null }
  ];
  return el("div", { class: "space-y-6" },
    heading(t("b.framingTitle")),
    barChart(conds.map((c) => `${cap(name(c))} (n=${result.n[c]})`), datasets, { height: 300 }),
    el("div", { class: "grid grid-cols-1 gap-4 text-lg lg:grid-cols-2" }, conds.map((c) =>
      el("div", { class: "rounded-lg border border-slate-200 p-3" }, el("p", { class: "font-semibold" }, cap(name(c))),
        ...framingTexts(config, c, lang).map((x) => el("p", {}, x))))),
    threeColumns(rows, ctx, { mine: sum(conds.map((c) => result.n[c])), earlier: sum(conds.map((c) => sum(eCounts[c]))) }),
    benchmarkLine(bench, lang));
}

function presentDecoy(result, config, history, ctx) {
  const { lang, t } = ctx;
  const conds = ["base", "decoy"];
  const earlier = (history || []).filter((h) => h?.design === "decoy" && conds.every((c) => h.counts?.[c]));
  const eCounts = Object.fromEntries(conds.map((c) => [c, Object.fromEntries(OPTION_KEYS.map((k) => [k, sum(earlier.map((h) => h.counts[c][k] || 0))]))]));
  const share = (cnt, k) => pct(cnt[k], sum(Object.values(cnt)));
  const hasPrev = conds.some((c) => sum(Object.values(eCounts[c])));
  const name = (c) => pick(config.conditionNames[c], lang);
  const tg = pick(config.options.target.name, lang), dn = pick(config.options.decoy.name, lang);
  const bench = config.benchmark || {};
  const gap = (cs) => { const a = share(cs.decoy, "target"), b = share(cs.base, "target"); return a == null || b == null ? null : a - b; };
  const pts = (x) => (x == null ? "—" : t("b.points", { d: `${x > 0 ? "+" : ""}${formatNumber(round(x, 1), lang)}` }));
  const datasets = [{ label: t("present.thisClass"), data: conds.map((c) => round(share(result.counts[c], "target"), 0) ?? 0) }];
  if (hasPrev) datasets.push({ label: t("present.earlier"), data: conds.map((c) => round(share(eCounts[c], "target"), 0) ?? 0) });
  const rows = [
    ...conds.map((c) => ({ label: t("b.decoy.targetIn", { tg, g: name(c) }), mine: fmtPct(share(result.counts[c], "target"), lang), earlier: hasPrev ? fmtPct(share(eCounts[c], "target"), lang) : null, original: null })),
    { label: t("b.decoy.gap"), mine: pts(gap(result.counts)), earlier: hasPrev ? pts(gap(eCounts)) : null, original: isNum(bench.gap) ? pts(bench.gap) : null },
    { label: t("b.decoy.decoyPicked", { d: dn }), mine: fmtPct(share(result.counts.decoy, "decoy"), lang), earlier: hasPrev ? fmtPct(share(eCounts.decoy, "decoy"), lang) : null, original: null }
  ];
  const table = el("table", { class: "text-xl" },
    el("thead", {}, el("tr", {}, el("th", {}, ""), ...config.attributes.map((a) => el("th", { class: "p-2 text-right font-normal" }, `${pick(a.name, lang)} (${pick(a.unit, lang)})`)))),
    el("tbody", {}, ...config.order.map((k) => el("tr", { class: k === "decoy" ? "text-slate-500" : "" },
      el("th", { class: "p-2 text-left font-normal" }, `${pick(config.options[k].name, lang)}${k === "decoy" ? ` (${t("b.decoy.onlyIn")})` : ""}`),
      ...config.attributes.map((a) => el("td", { class: "p-2 text-right tabular-nums" }, formatNumber(config.options[k].values[a.id], lang)))))));
  return el("div", { class: "space-y-6" },
    heading(t("b.decoy.title", { tg })),
    el("div", { class: "flex flex-wrap items-start gap-10" }, table,
      el("div", { class: "min-w-[20rem] flex-1" }, barChart(conds.map((c) => `${cap(name(c))} (n=${result.n[c]})`), datasets, { height: 260 }))),
    threeColumns(rows, ctx, { mine: sum(conds.map((c) => result.n[c])), earlier: sum(conds.map((c) => sum(Object.values(eCounts[c])))) }),
    benchmarkLine(bench, lang));
}

function presentDefault(result, config, history, ctx) {
  const { lang, t } = ctx;
  const conds = ["optin", "optout"];
  const earlier = (history || []).filter((h) => h?.design === "default" && conds.every((c) => isNum(h.n?.[c])));
  const e = { joined: Object.fromEntries(conds.map((c) => [c, sum(earlier.map((h) => h.joined[c] || 0))])), n: Object.fromEntries(conds.map((c) => [c, sum(earlier.map((h) => h.n[c] || 0))])) };
  const rate = (r, c) => pct(r.joined[c], r.n[c]);
  const hasPrev = conds.some((c) => e.n[c]);
  const name = (c) => pick(config.conditionNames[c], lang);
  const bench = config.benchmark || {};
  const gap = (r) => { const a = rate(r, "optout"), b = rate(r, "optin"); return a == null || b == null ? null : a - b; };
  const pts = (x) => (x == null ? "—" : t("b.points", { d: formatNumber(round(x, 0), lang) }));
  const datasets = [{ label: t("present.thisClass"), data: conds.map((c) => round(rate(result, c), 0) ?? 0) }];
  if (hasPrev) datasets.push({ label: t("present.earlier"), data: conds.map((c) => round(rate(e, c), 0) ?? 0) });
  if (isNum(bench.optin) && isNum(bench.optout)) datasets.push({ label: t("present.original"), data: [bench.optin, bench.optout] });
  const rows = [
    ...conds.map((c) => ({ label: t("b.default.joinIn", { g: name(c) }), mine: fmtPct(rate(result, c), lang), earlier: hasPrev ? fmtPct(rate(e, c), lang) : null, original: isNum(bench[c]) ? `${bench[c]}%` : null })),
    { label: t("b.default.gap"), mine: pts(gap(result)), earlier: hasPrev ? pts(gap(e)) : null, original: isNum(bench.optin) && isNum(bench.optout) ? pts(bench.optout - bench.optin) : null }
  ];
  return el("div", { class: "space-y-6" },
    heading(t("b.default.title", { l: pick(config.label, lang) })),
    barChart(conds.map((c) => `${cap(name(c))} (n=${result.n[c]})`), datasets, { height: 300 }),
    el("p", { class: "text-lg text-slate-600" }, t("b.default.note")),
    threeColumns(rows, ctx, { mine: sum(conds.map((c) => result.n[c])), earlier: sum(conds.map((c) => e.n[c])) }),
    benchmarkLine(bench, lang));
}

const DESIGNS = {
  anchor: { validate: validateAnchor, render: renderAnchorStep, aggregate: aggregateAnchor, present: presentAnchor },
  framing: { validate: validateFraming, render: renderFramingStep, aggregate: aggregateFraming, present: presentFraming },
  decoy: { validate: validateDecoy, render: renderDecoyStep, aggregate: aggregateDecoy, present: presentDecoy },
  default: { validate: validateDefault, render: renderDefaultStep, aggregate: aggregateDefault, present: presentDefault }
};

// ---------- engine ----------
const B = {
  id: "B",
  mode: "collect",

  validate(config) {
    const d = Object.hasOwn(DESIGNS, config.design) ? DESIGNS[config.design] : null;
    return d ? d.validate(config) : [`B: design "${config.design}" không hợp lệ (anchor, framing, decoy hoặc default)`];
  },

  // Everyone present when the batch opens; people who join later are added by the instructor's page
  // to the condition with the fewest people (js/assign.js, leastUsed).
  assign(participants, config) {
    return { byUid: balancedAssign(participants, config.conditions), conditions: config.conditions };
  },

  renderStudent(step, config, ctx) {
    if (step === "__result") return renderPersonal(config, ctx);
    const s = (config.steps || []).find((x) => x.id === step);
    if (!s || !config.conditions.includes(ctx.assignment)) return el("p", {}, ctx.t("collect.waitGroup"));
    return DESIGNS[config.design].render(s, config, ctx);
  },

  // The phone shows which version it got (plan); the condition itself comes from ctx.assignment.
  scoreLocal(answers) {
    return answers && Object.keys(answers).length ? { answered: true } : null;
  },

  aggregate(responses, config) {
    return DESIGNS[config.design].aggregate(responses, config);
  },

  renderPresenter(result, config, history, ctx) {
    ctx = { lang: "vi", t: (k) => k, ...ctx };
    return DESIGNS[config.design].present(result, config, history, ctx);
  }
};

export default B;
