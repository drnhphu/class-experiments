// Test-only engine (collect mode): one multiple-choice question per step.
// Exists to exercise the core (opening batch, reveal, CSV, archive) before engines A to D are built.
import { el, pick } from "../../js/i18n.js";

const T = {
  id: "T",
  mode: "collect",

  validate(config) {
    const errs = [];
    if (!Array.isArray(config.steps) || config.steps.length < 1 || config.steps.length > 10) errs.push("T: steps phải có 1 đến 10 câu");
    else config.steps.forEach((s, i) => {
      if (!s.prompt) errs.push(`T: steps[${i}] thiếu prompt`);
      if (!Array.isArray(s.options) || s.options.length < 2 || s.options.length > 6) errs.push(`T: steps[${i}] cần 2 đến 6 options`);
    });
    return errs;
  },

  assign() { return null; },

  renderStudent(step, config, ctx) {
    if (step === "__result") return null;
    const s = config.steps.find((x) => x.id === step);
    const shownAt = performance.now();
    return el("div", { class: "space-y-3" },
      el("p", { class: "text-lg font-medium" }, pick(s.prompt, ctx.lang)),
      el("div", { class: "grid gap-2" }, s.options.map((o, i) =>
        el("button", {
          class: "rounded-lg border border-slate-300 bg-white px-4 py-3 text-left active:bg-slate-200",
          onclick: () => ctx.submit({ [step]: i }, { [step]: Math.round(performance.now() - shownAt) })
        }, pick(o, ctx.lang))))
    );
  },

  scoreLocal() { return null; },

  aggregate(responses, config) {
    const counts = {};
    for (const s of config.steps) counts[s.id] = new Array(s.options.length).fill(0);
    for (const r of responses) {
      for (const s of config.steps) {
        const v = r.answers?.[s.id];
        if (Number.isInteger(v) && counts[s.id][v] != null) counts[s.id][v]++;
      }
    }
    return { n: responses.length, counts };
  },

  // Three columns per step: this class, earlier classes pooled, original study (if the config has one).
  renderPresenter(result, config, history, ctx) {
    const lang = ctx?.lang || "vi";
    const t = ctx?.t || ((k) => k);
    const wrap = el("div", { class: "space-y-8" });
    for (const s of config.steps) {
      const pooled = new Array(s.options.length).fill(0);
      let pooledN = 0;
      for (const h of history || []) {
        const c = h?.counts?.[s.id];
        if (!c) continue;
        c.forEach((v, i) => { pooled[i] += v; });
        pooledN += c.reduce((a, b) => a + b, 0);
      }
      const mine = result.counts[s.id];
      const mineN = mine.reduce((a, b) => a + b, 0);
      const pct = (arr, n) => arr.map((v) => (n ? Math.round((100 * v) / n) : 0));
      const bench = config.benchmark?.percents?.[s.id];
      const canvas = el("canvas", { height: "260" });
      wrap.append(el("div", {},
        el("h3", { class: "mb-2 text-2xl font-semibold" }, pick(s.prompt, lang)),
        el("div", { class: "h-72" }, canvas)));
      const datasets = [
        { label: `${t("present.thisClass")} (n=${mineN})`, data: pct(mine, mineN) },
        { label: `${t("present.earlier")} (n=${pooledN})`, data: pct(pooled, pooledN) }
      ];
      if (bench) datasets.push({ label: pick(config.benchmark.label, lang), data: bench });
      requestAnimationFrame(() => new window.Chart(canvas, {
        type: "bar",
        data: { labels: s.options.map((o) => pick(o, lang)), datasets },
        options: { responsive: true, maintainAspectRatio: false, animation: false,
          scales: { y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } } } }
      }));
    }
    return wrap;
  }
};

export default T;
