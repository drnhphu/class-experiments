// Test-only engine (live mode): each round every player picks one option; no pairing.
// Exists to exercise the four-phase game state machine before engine D is built.
import { el, pick } from "../../js/i18n.js";

const TD = {
  id: "TD",
  mode: "live",

  validate(config) {
    const errs = [];
    if (!config.rules) errs.push("TD: thiếu rules");
    if (!Array.isArray(config.options) || config.options.length < 2 || config.options.length > 4) errs.push("TD: cần 2 đến 4 options");
    const r = config.rounds;
    if (!r || !Number.isInteger(r.default) || !Number.isInteger(r.max) || r.default < 1 || r.max < r.default) errs.push("TD: rounds không hợp lệ");
    return errs;
  },

  // No pairs or roles here; records who was present when the phase opened.
  assign(participants) { return { present: participants.length }; },

  renderStudent(step, config, ctx) {
    if (step === "__intro") return null; // pages fall back to config.rules
    if (step === "__result") {
      const round = ctx.round;
      const counts = ctx.result?.rounds?.[`r${round}`] || [];
      const mine = ctx.myAnswers?.[`r${round}`];
      return el("div", { class: "space-y-2" },
        el("p", {}, mine == null ? ctx.t("game.noChoice") : `${ctx.t("game.yourChoice")}: ${pick(config.options[mine], ctx.lang)}`),
        el("ul", { class: "text-sm" }, config.options.map((o, i) => el("li", {}, `${pick(o, ctx.lang)}: ${counts[i] || 0}`))));
    }
    const shownAt = performance.now();
    return el("div", { class: "grid gap-2" }, config.options.map((o, i) =>
      el("button", {
        class: "rounded-lg border border-slate-300 bg-white px-4 py-3 text-left active:bg-slate-200",
        onclick: () => ctx.submit({ [step]: i }, { [step]: Math.round(performance.now() - shownAt) })
      }, pick(o, ctx.lang))));
  },

  scoreLocal() { return null; },

  aggregate(responses, config) {
    const rounds = {};
    for (let r = 1; r <= config.rounds.max; r++) rounds[`r${r}`] = new Array(config.options.length).fill(0);
    for (const resp of responses) {
      for (const [k, v] of Object.entries(resp.answers || {})) {
        if (rounds[k] && Number.isInteger(v) && rounds[k][v] != null) rounds[k][v]++;
      }
    }
    return { rounds };
  },

  renderPresenter(result, config, history, ctx) {
    const lang = ctx?.lang || "vi";
    const counts = result.rounds?.[`r${ctx?.round || 1}`] || [];
    const canvas = el("canvas", { height: "260" });
    requestAnimationFrame(() => new window.Chart(canvas, {
      type: "bar",
      data: { labels: config.options.map((o) => pick(o, lang)), datasets: [{ label: `${ctx?.t?.("present.thisClass") || ""}`, data: counts }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false }
    }));
    return el("div", { class: "h-80" }, canvas);
  }
};

export default TD;
