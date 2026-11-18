// Engine D: live games, played in the four phases the instructor drives (intro, open, locked, reveal).
// Designs: "beauty" (E13, guess p times the class average; everyone plays, no pairs),
// "pd" (E14, prisoner's dilemma in pairs, one round or several rounds with the same partner) and
// "ultimatum" (E15, proposer and responder choose at the same time; the proposer then plays the
// dictator version with the same total).
//
// Pairs are made by the instructor's page when a round opens (assign) and kept for later rounds.
// People who join after that get a seat in the next round: first the empty seat next to a person who
// was paired with the machine, then pairs among themselves; an odd one out plays the machine.
// Every choice is simultaneous, so nobody ever waits for a partner: at the end of a round the machine
// plays the fixed rule from the config for any seat with no choice (odd person, or a partner who did
// not choose in time). The machine's choices never count in class results (decision 8).
//
// Assignment document: { kind: "pairs", seats: [s0, s1], byUid: { uid: "c03.s0" }, bots: [pair ids] }
// plus round and gameId added by the control page. The CSV column "assignment" holds the seat string.
// Answer keys: "r<k>" for round k; the ultimatum proposer also writes "r<k>d" (dictator part).
import { el, pick } from "../js/i18n.js";
import { shuffle } from "../js/assign.js";
import {
  median, mean, pct, round, sum, binCounts, formatNumber, fmtPct, fill,
  threeColumns, barChart, distributionChart, benchmarkLine, heading, elapsedClock, MIN_CELL
} from "../js/viz.js";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isInt = (x) => Number.isInteger(x);
const bilingual = (o) => o && typeof o === "object" && typeof o.vi === "string" && typeof o.en === "string";
const has = (o, ...keys) => bilingual(o) && keys.every((k) => o.vi.includes(`{${k}}`) && o.en.includes(`{${k}}`));
const DESIGNS = ["beauty", "pd", "ultimatum"];
const MAX_ROUNDS = 5; // plan, E14: one round, or 3 to 5 rounds with the same partner
export const BOT_RULES = ["tit-for-tat"];

// ---------- pure helpers (unit-tested in Node) ----------
export const paired = (config) => config.design === "pd" || config.design === "ultimatum";
export const seatNames = (config) => (config.design === "ultimatum" ? config.roles : ["A", "B"]);
export const roundKey = (k) => `r${k}`;
export const factorOf = (config) => config.factor.num / config.factor.den;

export function parseSeat(s) {
  if (typeof s !== "string") return null;
  const i = s.lastIndexOf(".");
  return i > 0 ? { pid: s.slice(0, i), seat: s.slice(i + 1) } : null;
}
const pidOf = (n) => `c${String(n).padStart(2, "0")}`;

// pair id -> { seat: uid }
export function pairTable(byUid) {
  const table = {};
  for (const [u, s] of Object.entries(byUid || {})) {
    const p = parseSeat(s);
    if (p) (table[p.pid] ||= {})[p.seat] = u;
  }
  return table;
}

// Seats for everyone in `participants` who has none yet; earlier seats never move.
export function assignPairs(participants, config, previous = null, rnd = Math.random) {
  const seats = seatNames(config);
  const byUid = { ...(previous?.byUid || {}) };
  const table = pairTable(byUid);
  const fresh = shuffle(participants.filter((u) => !(u in byUid)), rnd);
  for (const pid of Object.keys(table).sort()) {
    for (const s of seats) {
      if (!table[pid][s] && fresh.length) { const u = fresh.pop(); table[pid][s] = u; byUid[u] = `${pid}.${s}`; }
    }
  }
  let next = Math.max(0, ...Object.keys(table).map((p) => Number(p.slice(1)) || 0)) + 1;
  while (fresh.length >= 2) {
    const pid = pidOf(next++);
    for (const s of seats) byUid[fresh.pop()] = `${pid}.${s}`;
  }
  if (fresh.length === 1) byUid[fresh.pop()] = `${pidOf(next++)}.${seats[Math.floor(rnd() * seats.length)]}`;
  const bots = Object.entries(pairTable(byUid)).filter(([, p]) => seats.some((s) => !p[s])).map(([pid]) => pid).sort();
  return { kind: "pairs", seats, byUid, bots };
}

// Rounds that have at least one answer, in order.
function answeredRounds(responses, config) {
  const out = [];
  for (let k = 1; k <= (config.rounds?.max || 1); k++) {
    if (responses.some((r) => r.answers?.[roundKey(k)] != null)) out.push(k);
  }
  return out;
}

// pair id -> { seat: answers } from responses that carry their seat (r.assignment).
function seatedAnswers(responses, config) {
  const seats = seatNames(config);
  const table = {};
  for (const r of responses) {
    const p = parseSeat(r.assignment);
    if (p && seats.includes(p.seat)) (table[p.pid] ||= {})[p.seat] = r.answers || {};
  }
  return table;
}

export function pdPayoff(mine, theirs, pay) {
  if (mine === "C") return theirs === "C" ? pay.R : pay.S;
  return theirs === "C" ? pay.T : pay.P;
}

// Prisoner's dilemma. For a seat with no choice the machine plays tit-for-tat: cooperate first, then
// repeat what the other seat played in the pair's previous round.
export function aggregatePd(responses, config) {
  const [s0, s1] = seatNames(config);
  const pay = config.payoffs;
  const table = seatedAnswers(responses, config);
  const last = {};
  const rounds = {};
  for (const k of answeredRounds(responses, config)) {
    const rk = roundKey(k);
    const out = { n: 0, coop: 0, hhN: 0, hhSum: 0, botPairs: 0, pairs: {} };
    for (const pid of Object.keys(table).sort()) {
      const human = {};
      for (const s of [s0, s1]) { const v = table[pid][s]?.[rk]; if (v === "C" || v === "D") human[s] = v; }
      if (!Object.keys(human).length) continue;
      const played = { ...human };
      let auto = null;
      for (const [s, o] of [[s0, s1], [s1, s0]]) {
        if (!(s in human)) { auto = s; played[s] = last[pid] ? last[pid][o] : "C"; }
      }
      last[pid] = played;
      out.pairs[pid] = { [s0]: played[s0], [s1]: played[s1], auto };
      for (const v of Object.values(human)) { out.n++; if (v === "C") out.coop++; }
      if (auto) out.botPairs++;
      else { out.hhN += 2; out.hhSum += pdPayoff(played[s0], played[s1], pay) + pdPayoff(played[s1], played[s0], pay); }
    }
    rounds[rk] = out;
  }
  return { design: "pd", rounds };
}

// Ultimatum (strategy method: the responder states a minimum before seeing the offer) and dictator.
export function aggregateUltimatum(responses, config) {
  const [P, Rs] = seatNames(config);
  const total = config.total;
  const ok = (v) => isInt(v) && v >= 0 && v <= total;
  const table = seatedAnswers(responses, config);
  const rounds = {};
  for (const k of answeredRounds(responses, config)) {
    const rk = roundKey(k);
    const out = { offers: [], gifts: [], mins: [], hhPairs: 0, hhRejected: 0, botPairs: 0, pairs: {} };
    for (const pid of Object.keys(table).sort()) {
      const a = table[pid][P] || {}, b = table[pid][Rs] || {};
      const hOffer = ok(a[rk]) ? a[rk] : null, hGift = ok(a[`${rk}d`]) ? a[`${rk}d`] : null, hMin = ok(b[rk]) ? b[rk] : null;
      if (hOffer == null && hMin == null) continue;
      const auto = hOffer == null ? P : hMin == null ? Rs : null;
      const offer = hOffer ?? config.bot.offer, min = hMin ?? config.bot.minAccept;
      const accepted = offer >= min;
      out.pairs[pid] = { offer, min, gift: hOffer == null ? null : hGift, accepted, auto };
      if (hOffer != null) { out.offers.push(hOffer); if (hGift != null) out.gifts.push(hGift); }
      if (hMin != null) out.mins.push(hMin);
      if (auto) out.botPairs++;
      else { out.hhPairs++; if (!accepted) out.hhRejected++; }
    }
    for (const key of ["offers", "gifts", "mins"]) out[key].sort((x, y) => x - y);
    rounds[rk] = out;
  }
  return { design: "ultimatum", total, rounds };
}

// Beauty contest: closest to p times the class average wins (ties share the win).
export function aggregateBeauty(responses, config) {
  const { min, max } = config.range;
  const p = factorOf(config);
  const rounds = {};
  for (const k of answeredRounds(responses, config)) {
    const rk = roundKey(k);
    const values = responses.map((r) => r.answers?.[rk]).filter((v) => isInt(v) && v >= min && v <= max).sort((x, y) => x - y);
    if (!values.length) continue;
    const m = mean(values), target = p * m;
    const best = Math.min(...values.map((v) => Math.abs(v - target)));
    const winning = [...new Set(values.filter((v) => Math.abs(v - target) === best))];
    rounds[rk] = { values, n: values.length, mean: m, target, median: median(values), winning, winners: values.filter((v) => winning.includes(v)).length };
  }
  return { design: "beauty", rounds };
}

// Share of responders who would reject an offer of x (their minimum is above x), for x on a grid.
export function rejectionCurve(mins, total, steps = 10) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = Math.round((i * total) / steps);
    return { x, share: mins.length ? pct(mins.filter((m) => m > x).length, mins.length) : null };
  });
}

// Reasoning levels for the beauty contest: 50 p^k for k = 0..3, then the Nash equilibrium 0.
export function levels(config) {
  const p = factorOf(config), mid = (config.range.min + config.range.max) / 2;
  return [0, 1, 2, 3].map((k) => mid * p ** k);
}

// ---------- validation ----------
function validateRounds(config, errs) {
  const r = config.rounds;
  if (!r || !isInt(r.default) || !isInt(r.max) || r.default < 1 || r.max < r.default || r.max > MAX_ROUNDS) {
    errs.push(`D: rounds cần default và max nguyên, 1 ≤ default ≤ max ≤ ${MAX_ROUNDS}`);
  }
}

function validateBeauty(config) {
  const errs = [];
  const f = config.factor || {};
  if (!isInt(f.num) || !isInt(f.den) || f.num <= 0 || f.den <= 0 || f.num >= f.den) errs.push("D/beauty: factor cần num và den nguyên dương, num < den (hệ số nhỏ hơn 1)");
  if (config.range?.min !== 0 || config.range?.max !== 100) errs.push("D/beauty: khoảng số phải là 0 đến 100 (range.min = 0, range.max = 100)");
  if (!has(config.rules, "p")) errs.push("D/beauty: rules phải chứa {p} ở cả hai ngôn ngữ");
  if (!bilingual(config.prompt)) errs.push("D/beauty: thiếu prompt");
  return errs;
}

function validatePd(config) {
  const errs = [];
  const p = config.payoffs || {};
  if (!["T", "R", "P", "S"].every((k) => isNum(p[k]))) errs.push("D/pd: payoffs cần đủ bốn số T, R, P, S");
  else {
    if (!(p.T > p.R && p.R > p.P && p.P > p.S)) errs.push("D/pd: điểm phải thỏa T > R > P > S");
    if (!(2 * p.R > p.T + p.S)) errs.push("D/pd: điểm phải thỏa 2R > T + S");
  }
  for (const k of ["scenario", "cooperate", "defect", "unit"]) if (!bilingual(config[k])) errs.push(`D/pd: thiếu ${k}`);
  if (!BOT_RULES.includes(config.bot)) errs.push(`D/pd: bot phải là một quy tắc cố định: ${BOT_RULES.join(", ")}`);
  if (!has(config.botNote, "c")) errs.push("D/pd: botNote (báo trước cho lớp về người lẻ chơi với máy) phải chứa {c} ở cả hai ngôn ngữ");
  return errs;
}

function validateUltimatum(config) {
  const errs = [];
  const total = config.total;
  if (!isInt(total) || total <= 0) errs.push("D/ultimatum: total phải là số nguyên dương (mặc định 100)");
  if ("dictatorTotal" in config && config.dictatorTotal !== total) errs.push("D/ultimatum: bản độc tài phải dùng cùng tổng với bản tối hậu thư");
  if (!Array.isArray(config.roles) || config.roles.join() !== "proposer,responder") errs.push("D/ultimatum: roles phải là [\"proposer\", \"responder\"]");
  else if (!config.roles.every((r) => bilingual(config.roleNames?.[r]))) errs.push("D/ultimatum: thiếu roleNames cho từng vai");
  if (!has(config.rules, "total")) errs.push("D/ultimatum: rules phải chứa {total} ở cả hai ngôn ngữ");
  for (const k of ["offerPrompt", "minPrompt", "dictatorPrompt"]) if (!has(config[k], "total")) errs.push(`D/ultimatum: ${k} phải chứa {total} ở cả hai ngôn ngữ`);
  if (!bilingual(config.unit)) errs.push("D/ultimatum: thiếu unit");
  const b = config.bot || {};
  if (!isInt(b.offer) || !isInt(b.minAccept) || b.offer < 0 || b.minAccept < 0 || (isInt(total) && (b.offer > total || b.minAccept > total))) {
    errs.push("D/ultimatum: bot cần offer và minAccept nguyên, từ 0 đến total");
  }
  if (!has(config.botNote, "offer", "min")) errs.push("D/ultimatum: botNote (báo trước cho lớp về người lẻ chơi với máy) phải chứa {offer} và {min} ở cả hai ngôn ngữ");
  return errs;
}

// ---------- phone screens ----------
const primaryBtn = (label, onclick, disabled = false) =>
  el("button", { class: "w-full rounded-lg bg-slate-900 py-3 font-medium text-white disabled:opacity-40", disabled, onclick }, label);
const OPT = "w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-left";
const OPT_ON = "w-full rounded-lg border-2 border-slate-900 bg-slate-100 px-4 py-3 text-left";
const para = (text, cls = "") => el("p", { class: `whitespace-pre-line ${cls}` }, text);

function rulesText(config, lang) {
  if (config.design === "beauty") return fill(pick(config.rules, lang), { p: `${config.factor.num}/${config.factor.den}` }, lang);
  if (config.design === "ultimatum") return fill(pick(config.rules, lang), { total: config.total }, lang);
  return pick(config.scenario, lang);
}

function botNoteText(config, lang) {
  if (config.design === "pd") return fill(pick(config.botNote, lang), { c: pick(config.cooperate, lang), d: pick(config.defect, lang) }, lang);
  if (config.design === "ultimatum") return fill(pick(config.botNote, lang), { offer: config.bot.offer, min: config.bot.minAccept }, lang);
  return null;
}

// 2 x 2 table of the prisoner's dilemma, from the reader's side. No font sizes: it inherits the
// size of the phone or of the projector.
function payoffMatrix(config, ctx) {
  const { lang, t } = ctx;
  const c = pick(config.cooperate, lang), d = pick(config.defect, lang), p = config.payoffs;
  const f = (x) => formatNumber(x, lang);
  const cell = (a, b) => el("td", { class: "border border-slate-300 px-2 py-1 text-center" }, `${f(a)} / ${f(b)}`);
  return el("div", { class: "space-y-1" },
    el("table", { class: "w-full border-collapse" },
      el("thead", {}, el("tr", {}, el("th", { class: "px-2 py-1" }, ""),
        el("th", { class: "border border-slate-300 px-2 py-1 font-medium" }, `${t("d.partner")}: ${c}`),
        el("th", { class: "border border-slate-300 px-2 py-1 font-medium" }, `${t("d.partner")}: ${d}`))),
      el("tbody", {},
        el("tr", {}, el("th", { class: "border border-slate-300 px-2 py-1 text-left font-medium" }, `${t("d.you")}: ${c}`), cell(p.R, p.R), cell(p.S, p.T)),
        el("tr", {}, el("th", { class: "border border-slate-300 px-2 py-1 text-left font-medium" }, `${t("d.you")}: ${d}`), cell(p.T, p.S), cell(p.P, p.P)))),
    el("p", { class: "opacity-70" }, t("d.matrixNote", { unit: pick(config.unit, lang) })));
}

function introNode(config, ctx) {
  const { lang, t } = ctx;
  const parts = [para(rulesText(config, lang))];
  if (config.design === "pd") parts.push(payoffMatrix(config, ctx));
  if ((config.rounds?.max || 1) > 1 && paired(config)) parts.push(para(t("d.repeatNote")));
  const note = botNoteText(config, lang);
  if (note) parts.push(para(note, "opacity-70"));
  return el("div", { class: "space-y-3" }, parts);
}

// Whole number in a range, echo line, confirm.
function numberScreen(prompt, min, max, ctx, echo, onValue) {
  const { lang, t } = ctx;
  const input = el("input", { type: "number", inputmode: "numeric", step: "1", min: String(min), max: String(max), class: "w-full rounded-lg border border-slate-300 px-3 py-3 text-lg" });
  const line = el("p", { class: "text-sm text-slate-500" }, "");
  const msg = el("p", { class: "text-sm text-rose-700" }, "");
  const valid = (v) => isInt(v) && v >= min && v <= max;
  input.addEventListener("input", () => { const v = input.value === "" ? NaN : Number(input.value); line.textContent = valid(v) && echo ? echo(v) : ""; msg.textContent = ""; });
  const go = primaryBtn(t("eng.confirm"), () => {
    const v = input.value === "" ? NaN : Number(input.value);
    if (!valid(v)) { msg.textContent = t("d.wholeNumber", { min: formatNumber(min, lang), max: formatNumber(max, lang) }); return; }
    onValue(v);
  });
  return el("div", { class: "space-y-3" }, para(prompt), input, line, msg, go);
}

function renderBeautyChoice(config, ctx) {
  const elapsed = elapsedClock(ctx);
  const { min, max } = config.range;
  return el("div", { class: "space-y-3" }, para(rulesText(config, ctx.lang), "text-sm text-slate-600"),
    numberScreen(pick(config.prompt, ctx.lang), min, max, ctx, null, (v) => ctx.submit({ [ctx.step]: v }, { [ctx.step]: elapsed() })));
}

function renderPdChoice(config, ctx) {
  const { lang, t } = ctx;
  const elapsed = elapsedClock(ctx);
  let chosen = null;
  const go = primaryBtn(t("eng.confirm"), () => { if (chosen) ctx.submit({ [ctx.step]: chosen }, { [ctx.step]: elapsed() }); }, true);
  const opts = [["C", pick(config.cooperate, lang)], ["D", pick(config.defect, lang)]].map(([v, label]) => el("button", { class: OPT, onclick: (ev) => {
    chosen = v;
    for (const b of ev.currentTarget.parentNode.children) b.className = OPT;
    ev.currentTarget.className = OPT_ON;
    go.disabled = false;
  } }, label));
  return el("div", { class: "space-y-3" }, para(pick(config.scenario, lang), "text-sm text-slate-600"), payoffMatrix(config, ctx),
    el("p", { class: "font-medium" }, t("d.pdAsk")), el("div", { class: "grid gap-2" }, opts), go);
}

// The proposer's offer is kept on the phone until the dictator part is sent too, so a reload does not
// let the offer be changed after the dictator question was seen.
function draftStore(ctx) {
  const key = `ce:draft:${ctx.code || "-"}:${ctx.uid || "-"}:${ctx.exp || "-"}:${ctx.step}`;
  const mem = {};
  return {
    get() { try { const v = localStorage.getItem(key); return v == null ? mem.v ?? null : JSON.parse(v); } catch { return mem.v ?? null; } },
    set(v) { mem.v = v; try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* memory only */ } },
    clear() { delete mem.v; try { localStorage.removeItem(key); } catch { /* nothing */ } }
  };
}

function renderUltimatumChoice(config, ctx, seat) {
  const { lang, t } = ctx;
  const total = config.total, unit = pick(config.unit, lang), rk = ctx.step;
  const f = (x) => formatNumber(x, lang);
  const roleLine = el("p", { class: "text-sm font-medium" }, t("d.yourRole", { role: pick(config.roleNames[seat], lang) }));
  if (seat === "responder") {
    const elapsed = elapsedClock(ctx);
    return el("div", { class: "space-y-3" }, roleLine,
      numberScreen(fill(pick(config.minPrompt, lang), { total }, lang), 0, total, ctx, (v) => t("d.minEcho", { x: f(v), unit }),
        (v) => ctx.submit({ [rk]: v }, { [rk]: elapsed() })));
  }
  const draft = draftStore(ctx);
  const box = el("div", { class: "space-y-3" });
  const dictatorStep = ({ offer, ms }) => {
    const elapsed = elapsedClock({ now: ctx.now });
    box.replaceChildren(roleLine,
      el("p", { class: "rounded-lg bg-slate-100 p-2 text-sm" }, t("d.offerLocked", { x: f(offer), unit })),
      numberScreen(fill(pick(config.dictatorPrompt, lang), { total }, lang), 0, total, ctx, (v) => t("d.dictEcho", { keep: f(total - v), give: f(v), unit }),
        (v) => { draft.clear(); ctx.submit({ [rk]: offer, [`${rk}d`]: v }, { [rk]: ms, [`${rk}d`]: elapsed() }); }));
  };
  const saved = draft.get();
  if (isInt(saved?.offer) && saved.offer >= 0 && saved.offer <= total && isInt(saved.ms)) dictatorStep(saved);
  else {
    const elapsed = elapsedClock(ctx);
    box.replaceChildren(roleLine,
      numberScreen(fill(pick(config.offerPrompt, lang), { total }, lang), 0, total, ctx, (v) => t("d.offerEcho", { keep: f(total - v), give: f(v), unit }),
        (v) => { const d = { offer: v, ms: elapsed() }; draft.set(d); dictatorStep(d); }));
  }
  return box;
}

const lateNode = (ctx) => el("p", { class: "text-lg" }, ctx.t("d.lateJoin"));

function renderChoice(config, ctx) {
  if (!paired(config)) return renderBeautyChoice(config, ctx);
  const p = parseSeat(ctx.assignment);
  if (!p || !seatNames(config).includes(p.seat)) return lateNode(ctx);
  return config.design === "pd" ? renderPdChoice(config, ctx) : renderUltimatumChoice(config, ctx, p.seat);
}

// ---------- phone: result of one's own pair (or own number) ----------
function resultBeauty(config, ctx) {
  const { lang, t } = ctx;
  const res = ctx.result?.rounds?.[roundKey(ctx.round || 1)];
  const mine = ctx.myAnswers?.[roundKey(ctx.round || 1)];
  if (!res) return null;
  const f = (x, d = 2) => formatNumber(round(x, d), lang);
  const lines = [t("d.target", { m: f(res.mean), p: `${config.factor.num}/${config.factor.den}`, g: f(res.target) }),
    t("d.winning", { w: res.winning.map((w) => f(w)).join(", "), k: res.winners })];
  if (isInt(mine)) {
    lines.push(t("d.yourNumber", { x: f(mine), d: f(Math.abs(mine - res.target)) }));
    if (res.winning.includes(mine)) lines.push(t("d.youWin"));
  } else lines.push(t("game.noChoice"));
  return el("div", { class: "space-y-2" }, el("h2", { class: "text-lg font-semibold" }, t("eng.yourResult")), ...lines.map((x) => el("p", {}, x)));
}

function resultPd(config, ctx, me) {
  const { lang, t } = ctx;
  const [s0, s1] = seatNames(config);
  const other = me.seat === s0 ? s1 : s0;
  const unit = pick(config.unit, lang), f = (x) => formatNumber(x, lang);
  const label = (v) => pick(v === "C" ? config.cooperate : config.defect, lang);
  const upTo = ctx.round || 1;
  const blocks = [];
  let total = 0, played = 0;
  for (let k = 1; k <= upTo; k++) {
    const pr = ctx.result?.rounds?.[roundKey(k)]?.pairs?.[me.pid];
    if (!pr) { if (k === upTo) blocks.push(el("p", {}, t("d.noRound", { r: k }))); continue; }
    const a = pdPayoff(pr[me.seat], pr[other], config.payoffs), b = pdPayoff(pr[other], pr[me.seat], config.payoffs);
    total += a; played++;
    if (k !== upTo) continue;
    const lines = [];
    lines.push(pr.auto === me.seat ? t("d.machineForYou", { a: label(pr[me.seat]) }) : t("d.youPicked", { a: label(pr[me.seat]) }));
    lines.push(pr.auto === other ? t("d.machinePicked", { a: label(pr[other]) }) : t("d.partnerPicked", { a: label(pr[other]) }));
    lines.push(t("d.points", { x: f(a), y: f(b), unit }));
    blocks.push(...lines.map((x) => el("p", {}, x)));
  }
  if (upTo > 1 && played) blocks.push(el("p", { class: "font-medium" }, t("d.totalSoFar", { r: upTo, x: f(total), unit })));
  return el("div", { class: "space-y-2" }, el("h2", { class: "text-lg font-semibold" }, `${t("eng.yourResult")} · ${t("game.round", { r: upTo })}`), ...blocks);
}

function resultUltimatum(config, ctx, me) {
  const { lang, t } = ctx;
  const pr = ctx.result?.rounds?.[roundKey(ctx.round || 1)]?.pairs?.[me.pid];
  const unit = pick(config.unit, lang), f = (x) => formatNumber(x, lang), total = config.total;
  const head = el("h2", { class: "text-lg font-semibold" }, t("eng.yourResult"));
  const role = el("p", { class: "text-sm" }, t("d.yourRole", { role: pick(config.roleNames[me.seat], lang) }));
  if (!pr) return el("div", { class: "space-y-2" }, head, role, el("p", {}, t("d.noRound", { r: ctx.round || 1 })));
  const lines = [];
  const proposer = me.seat === "proposer";
  if (pr.auto === me.seat) lines.push(t("d.machineForYouNum", { x: f(proposer ? pr.offer : pr.min), unit }));
  if (pr.auto && pr.auto !== me.seat) lines.push(t(proposer ? "d.machineMin" : "d.machineOffer", { x: f(proposer ? pr.min : pr.offer), unit }));
  lines.push(t("d.ultLine", { offer: f(pr.offer), min: f(pr.min), unit }));
  lines.push(pr.accepted ? t("d.accepted", { p: f(total - pr.offer), r: f(pr.offer), unit }) : t("d.rejected"));
  if (pr.auto === "proposer") lines.push(t("d.dictNone"));
  else if (pr.gift != null) lines.push(t(proposer ? "d.dictGave" : "d.dictReceived", { g: f(pr.gift), unit }));
  return el("div", { class: "space-y-2" }, head, role, ...lines.map((x) => el("p", {}, x)));
}

function renderResult(config, ctx) {
  if (!ctx.result) return null;
  if (!paired(config)) return resultBeauty(config, ctx);
  const me = parseSeat(ctx.assignment);
  if (!me) return null;
  return config.design === "pd" ? resultPd(config, ctx, me) : resultUltimatum(config, ctx, me);
}

// ---------- projector ----------
const roundsOf = (h) => (h && typeof h.rounds === "object" ? h.rounds : {});

function presentBeauty(result, config, history, ctx) {
  const { lang, t } = ctx;
  const rk = roundKey(ctx.round || 1);
  const res = result.rounds?.[rk];
  const pText = `${config.factor.num}/${config.factor.den}`;
  const f = (x, d = 1) => (x == null ? "—" : formatNumber(round(x, d), lang));
  const eVals = (history || []).flatMap((h) => roundsOf(h)[rk]?.values || []);
  const hasPrev = eVals.length > 0;
  const edges = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101];
  const label = (from, to) => `${edges[from]}–${Math.min(edges[to + 1] - 1, 100)}`;
  const bench = config.benchmark || {};
  const lv = levels(config);
  const ePrev = hasPrev ? { mean: mean(eVals), median: median(eVals) } : null;
  const rows = [
    { label: t("d.mean"), mine: f(res?.mean), earlier: ePrev ? f(ePrev.mean) : null, original: isNum(bench.mean) ? f(bench.mean, 2) : null },
    { label: t("d.targetRow", { p: pText }), mine: f(res?.target), earlier: ePrev ? f(ePrev.mean * factorOf(config)) : null, original: isNum(bench.mean) ? f(bench.mean * factorOf(config)) : null },
    { label: t("d.median"), mine: f(res?.median), earlier: ePrev ? f(ePrev.median) : null, original: isNum(bench.median) ? f(bench.median) : null },
    { label: t("d.winRow"), mine: res ? `${res.winning.map((w) => f(w, 0)).join(", ")} (${t("d.people", { n: res.winners })})` : "—", earlier: null, original: null }
  ];
  return el("div", { class: "space-y-6" },
    heading(t("d.beautyTitle")),
    distributionChart(binCounts(res?.values || [], edges), label, ctx, { earlier: hasPrev ? binCounts(eVals, edges) : null, height: 280 }),
    el("p", { class: "text-xl" }, t("d.levels", { l0: f(lv[0], 0), l1: f(lv[1], 0), l2: f(lv[2], 0), l3: f(lv[3], 0) })),
    threeColumns(rows, ctx, { mine: res?.n ?? 0, earlier: eVals.length }),
    benchmarkLine(bench, lang));
}

function presentPd(result, config, history, ctx) {
  const { lang, t } = ctx;
  const upTo = ctx.round || 1;
  const c = pick(config.cooperate, lang), d = pick(config.defect, lang), unit = pick(config.unit, lang);
  const ks = Array.from({ length: upTo }, (_, i) => i + 1);
  const hist = history || [];
  const pooled = (rk) => {
    const xs = hist.map((h) => roundsOf(h)[rk]).filter(Boolean);
    return { n: sum(xs.map((x) => x.n)), coop: sum(xs.map((x) => x.coop)), hhN: sum(xs.map((x) => x.hhN)), hhSum: sum(xs.map((x) => x.hhSum)) };
  };
  const rate = (x) => (x?.n ? pct(x.coop, x.n) : null);
  const hasPrev = ks.some((k) => pooled(roundKey(k)).n > 0);
  const rk = roundKey(upTo), cur = result.rounds?.[rk], prev = pooled(rk);
  const avg = (x) => (x?.hhN ? x.hhSum / x.hhN : null);
  const f = (x) => (x == null ? "—" : formatNumber(round(x, 0), lang));
  const datasets = [{ label: t("present.thisClass"), data: ks.map((k) => round(rate(result.rounds?.[roundKey(k)]), 0)) }];
  if (hasPrev) datasets.push({ label: t("present.earlier"), data: ks.map((k) => round(rate(pooled(roundKey(k))), 0)) });
  const rows = [
    { label: t("d.coopRate", { c, r: upTo }), mine: fmtPct(rate(cur), lang), earlier: prev.n ? fmtPct(rate(prev), lang) : null, original: null },
    { label: t("d.avgScore", { r: upTo, unit }), mine: f(avg(cur)), earlier: prev.hhN ? f(avg(prev)) : null, original: null },
    { label: t("d.bothRow", { a: c }), mine: f(config.payoffs.R), earlier: null, original: null },
    { label: t("d.bothRow", { a: d }), mine: f(config.payoffs.P), earlier: null, original: null }
  ];
  return el("div", { class: "space-y-6" },
    heading(t("d.pdTitle", { c })),
    barChart(ks.map((k) => t("game.round", { r: k })), datasets, { height: 260 }),
    threeColumns(rows, ctx, { mine: cur?.n ?? 0, earlier: prev.n }),
    cur?.botPairs ? el("p", { class: "text-base text-slate-500" }, t("d.botPairs", { k: cur.botPairs })) : null,
    benchmarkLine(config.benchmark, lang));
}

function presentUltimatum(result, config, history, ctx) {
  const { lang, t } = ctx;
  const rk = roundKey(ctx.round || 1);
  const total = config.total;
  const cur = result.rounds?.[rk] || { offers: [], gifts: [], mins: [], hhPairs: 0, hhRejected: 0, botPairs: 0 };
  const prevs = (history || []).map((h) => roundsOf(h)[rk]).filter(Boolean);
  const pool = (key) => prevs.flatMap((x) => x[key] || []);
  const prev = { offers: pool("offers"), gifts: pool("gifts"), mins: pool("mins"), hhPairs: sum(prevs.map((x) => x.hhPairs || 0)), hhRejected: sum(prevs.map((x) => x.hhRejected || 0)) };
  const share = (xs) => (xs.length ? (100 * mean(xs)) / total : null);
  const frac = (xs, test) => (xs.length ? pct(xs.filter(test).length, xs.length) : null);
  const even = (v) => 2 * v === total;
  const bench = config.benchmark || {};
  const P = (x) => (isNum(x) ? `${formatNumber(x, lang)}%` : null);
  const rows = [
    { label: t("d.offerMean"), mine: fmtPct(share(cur.offers), lang), earlier: prev.offers.length ? fmtPct(share(prev.offers), lang) : null, original: P(bench.offerMean) },
    { label: t("d.evenShare"), mine: fmtPct(frac(cur.offers, even), lang), earlier: prev.offers.length ? fmtPct(frac(prev.offers, even), lang) : null, original: P(bench.evenShare) },
    { label: t("d.giftMean"), mine: fmtPct(share(cur.gifts), lang), earlier: prev.gifts.length ? fmtPct(share(prev.gifts), lang) : null, original: P(bench.giftMean) },
    { label: t("d.giftZero"), mine: fmtPct(frac(cur.gifts, (v) => v === 0), lang), earlier: prev.gifts.length ? fmtPct(frac(prev.gifts, (v) => v === 0), lang) : null, original: P(bench.giftZero) },
    { label: t("d.minMean"), mine: fmtPct(share(cur.mins), lang), earlier: prev.mins.length ? fmtPct(share(prev.mins), lang) : null, original: null },
    { label: t("d.rejectedRow"), mine: cur.hhPairs ? `${fmtPct(pct(cur.hhRejected, cur.hhPairs), lang)} (${cur.hhRejected}/${cur.hhPairs})` : "—", earlier: prev.hhPairs ? fmtPct(pct(prev.hhRejected, prev.hhPairs), lang) : null, original: null }
  ];
  // Offers of each version in bins of 10% of the total; neighbouring bins merge until no bar of this
  // class stands for 1 or 2 people (each chart on its own, as the two versions differ in shape).
  const edges = Array.from({ length: 11 }, (_, i) => (i === 10 ? total + 1 : Math.round((i * total) / 10)));
  const lab = (from, to) => `${edges[from]}–${Math.min(edges[to + 1] - 1, total)}`;
  const dist = (key, title) => el("div", { class: "space-y-2" }, heading(title),
    distributionChart(binCounts(cur[key], edges), lab, ctx, { earlier: prev[key].length ? binCounts(prev[key], edges) : null, height: 240 }));
  const curve = rejectionCurve(cur.mins, total).filter((p) => p.x <= total / 2); // offers above half are almost never rejected
  const curveSets = [{ label: t("present.thisClass"), data: curve.map((p) => round(p.share, 0)) }];
  if (prev.mins.length) curveSets.push({ label: t("present.earlier"), data: rejectionCurve(prev.mins, total).slice(0, curve.length).map((p) => round(p.share, 0)) });
  return el("div", { class: "space-y-6" },
    el("div", { class: "grid grid-cols-1 gap-6 lg:grid-cols-3" },
      dist("offers", t("d.ultTitle")),
      dist("gifts", t("d.dictTitle")),
      el("div", { class: "space-y-2" }, heading(t("d.rejTitle")),
        cur.mins.length >= MIN_CELL ? barChart(curve.map((p) => formatNumber(p.x, lang)), curveSets, { height: 240 }) : el("p", { class: "text-xl text-slate-500" }, t("b.tooFew")))),
    threeColumns(rows, ctx, { mine: cur.offers.length + cur.mins.length, earlier: prev.offers.length + prev.mins.length }),
    cur.botPairs ? el("p", { class: "text-base text-slate-500" }, t("d.botPairs", { k: cur.botPairs })) : null,
    benchmarkLine(bench, lang));
}

// ---------- engine ----------
const D = {
  id: "D",
  mode: "live",

  validate(config) {
    if (!DESIGNS.includes(config.design)) return [`D: design "${config.design}" không hợp lệ (${DESIGNS.join(", ")})`];
    const errs = [];
    if (!bilingual(config.rules) && config.design !== "pd") errs.push("D: thiếu rules");
    validateRounds(config, errs);
    if (config.design === "beauty") errs.push(...validateBeauty(config));
    if (config.design === "pd") errs.push(...validatePd(config));
    if (config.design === "ultimatum") errs.push(...validateUltimatum(config));
    return errs;
  },

  // Called by the instructor's page when a round opens. `previous` is this game's assignment so far
  // (same game id), so pairs stay together across rounds and only newcomers get new seats.
  assign(participants, config, previous = null, rnd = Math.random) {
    return paired(config) ? assignPairs(participants, config, previous, rnd) : null;
  },

  // Steps: "__intro" (rules, shown on phones and projector), "r<k>" (choice of round k), "__result".
  renderStudent(step, config, ctx) {
    ctx = { lang: "vi", t: (k) => k, ...ctx };
    if (step === "__intro") return introNode(config, ctx);
    if (step === "__result") return renderResult(config, ctx);
    return renderChoice(config, { ...ctx, step });
  },

  // Personal results come from the pair outcome the instructor's page writes at the end of a round.
  scoreLocal() { return null; },

  aggregate(responses, config) {
    if (config.design === "pd") return aggregatePd(responses, config);
    if (config.design === "ultimatum") return aggregateUltimatum(responses, config);
    return aggregateBeauty(responses, config);
  },

  renderPresenter(result, config, history, ctx) {
    ctx = { lang: "vi", t: (k) => k, ...ctx };
    if (config.design === "pd") return presentPd(result, config, history, ctx);
    if (config.design === "ultimatum") return presentUltimatum(result, config, history, ctx);
    return presentBeauty(result, config, history, ctx);
  }
};

export default D;
