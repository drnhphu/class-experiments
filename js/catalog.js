// Experiment catalog: loads config files and engines, and runs the locked-structure checks.
// Two catalogs: "main" (experiments/, engines/) and "test" (tests/ only, used to exercise the core).
import { LANGS } from "./i18n.js";

const ROOT = new URL("../", import.meta.url);
const CATALOG_INDEX = { main: "experiments/index.json", test: "tests/experiments/index.json" };
const ENGINE_IDS = { main: ["A", "B", "C", "D"], test: ["T", "TD"] };
const CONTRACT = ["id", "mode", "validate", "assign", "renderStudent", "scoreLocal", "aggregate", "renderPresenter"];

const jsonCache = new Map();
const engineCache = new Map();

async function fetchJson(path) {
  if (!jsonCache.has(path)) {
    jsonCache.set(path, fetch(new URL(path, ROOT), { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
      return r.json();
    }));
  }
  return jsonCache.get(path);
}

export async function loadCatalog(name = "main") {
  const indexPath = CATALOG_INDEX[name];
  if (!indexPath) throw new Error(`Unknown catalog ${name}`);
  const index = await fetchJson(indexPath);
  const dir = indexPath.slice(0, indexPath.lastIndexOf("/") + 1);
  return {
    name,
    enginesBase: index.engines,
    experiments: (index.experiments || []).map((e) => ({ ...e, path: dir + e.file })),
    quizzes: (index.quizzes || []).map((q) => ({ ...q, path: index.quizzesBase + q.file }))
  };
}

export async function loadConfig(catalog, expId) {
  const entry = catalog.experiments.find((e) => e.id === expId);
  if (!entry) throw new Error(`Experiment ${expId} not in catalog ${catalog.name}`);
  return fetchJson(entry.path);
}

export async function loadEngine(catalog, engineId) {
  if (!ENGINE_IDS[catalog.name].includes(engineId)) throw new Error(`Engine ${engineId} not allowed in catalog ${catalog.name}`);
  const key = catalog.enginesBase + engineId;
  if (!engineCache.has(key)) {
    engineCache.set(key, import(new URL(`${catalog.enginesBase}${engineId}.js`, ROOT).href).then((m) => m.default));
  }
  return engineCache.get(key);
}

export async function loadQuiz(catalog, quizId) {
  const entry = catalog.quizzes.find((q) => q.id === quizId);
  if (!entry) throw new Error(`Quiz ${quizId} not in catalog ${catalog.name}`);
  return fetchJson(entry.path);
}

// Steps of one experiment inside the opening batch. A config without "steps" has one step, "main".
export function stepsOf(config) {
  return Array.isArray(config.steps) && config.steps.length ? config.steps.map((s) => s.id) : ["main"];
}

// Every { vi, en } object anywhere in the config must have both languages filled.
function bilingualErrors(node, path, out) {
  if (Array.isArray(node)) node.forEach((v, i) => bilingualErrors(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") {
    const keys = Object.keys(node);
    if (keys.some((k) => LANGS.includes(k))) {
      for (const l of LANGS) {
        if (typeof node[l] !== "string" || !node[l].trim()) out.push(`${path}: thiếu chuỗi "${l}"`);
      }
    } else {
      for (const k of keys) bilingualErrors(node[k], path ? `${path}.${k}` : k, out);
    }
  }
}

// Checks shared by every experiment file, before the engine's own validate().
export function commonErrors(config, catalogName, expectedId) {
  const errs = [];
  if (!config || typeof config !== "object") return ["Tệp không phải đối tượng JSON"];
  if (config.id !== expectedId) errs.push(`id "${config.id}" không khớp mục "${expectedId}" trong danh mục`);
  if (!/^[A-Z][0-9]{2}$/.test(config.id || "")) errs.push("id phải có dạng một chữ hoa và hai chữ số, ví dụ E05");
  if (!ENGINE_IDS[catalogName].includes(config.engine)) errs.push(`engine "${config.engine}" không hợp lệ`);
  if (!["P1", "P2"].includes(config.priority)) errs.push('priority phải là "P1" hoặc "P2"');
  if (typeof config.version !== "string" || !config.version) errs.push("thiếu version");
  if (!config.concept) errs.push("thiếu concept");
  if (config.steps != null) {
    if (!Array.isArray(config.steps) || !config.steps.length) errs.push("steps phải là mảng không rỗng");
    else {
      const ids = config.steps.map((s) => s && s.id);
      if (ids.some((id) => !/^[a-z0-9]{1,12}$/.test(id || ""))) errs.push("mỗi steps[].id phải gồm chữ thường hoặc số, tối đa 12 ký tự");
      if (new Set(ids).size !== ids.length) errs.push("steps[].id bị trùng");
    }
  }
  bilingualErrors(config, "", errs);
  return errs;
}

// Full check for one catalog entry: file loads, shared rules, engine contract, engine rules.
export async function validateEntry(catalog, entry) {
  let config, engine;
  try { config = await fetchJson(entry.path); }
  catch (e) { return { id: entry.id, errors: [`Không đọc được tệp: ${e.message}`] }; }
  const errors = commonErrors(config, catalog.name, entry.id);
  try {
    engine = await loadEngine(catalog, config.engine);
    const missing = CONTRACT.filter((k) => !(k in engine));
    if (missing.length) errors.push(`Động cơ ${config.engine} thiếu: ${missing.join(", ")}`);
    else errors.push(...(engine.validate(config) || []));
  } catch (e) {
    errors.push(`Không nạp được động cơ: ${e.message}`);
  }
  return { id: entry.id, config, engine, errors };
}

// Quiz files: up to 5 multiple-choice questions plus an optional reflection prompt.
export function quizErrors(quiz, expectedId) {
  const errs = [];
  if (!quiz || typeof quiz !== "object") return ["Tệp không phải đối tượng JSON"];
  if (quiz.id !== expectedId) errs.push(`id "${quiz.id}" không khớp danh mục`);
  if (typeof quiz.version !== "string" || !quiz.version) errs.push("thiếu version");
  if (!Array.isArray(quiz.questions) || quiz.questions.length < 1 || quiz.questions.length > 5) {
    errs.push("questions phải có từ 1 đến 5 câu");
  } else {
    quiz.questions.forEach((q, i) => {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) errs.push(`câu ${i + 1}: cần 2 đến 6 phương án`);
      else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) errs.push(`câu ${i + 1}: answer phải là chỉ số phương án đúng`);
    });
  }
  bilingualErrors(quiz, "", errs);
  return errs;
}
