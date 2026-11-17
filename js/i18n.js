// UI strings live in lang/vi.json and lang/en.json; experiment strings live in each config as { vi, en }.
const cache = {};

export const LANGS = ["vi", "en"];

export async function loadLang(lang) {
  if (!LANGS.includes(lang)) lang = "vi";
  if (!cache[lang]) {
    const res = await fetch(new URL(`../lang/${lang}.json`, import.meta.url));
    cache[lang] = await res.json();
  }
  return cache[lang];
}

// t("key", { n: 3 }) replaces {n} in the string. Missing keys show the key itself so gaps are visible.
export function makeT(dict) {
  return (key, vars = {}) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}

// Pick the string for the session language from a { vi, en } object.
export function pick(obj, lang) {
  if (obj == null) return "";
  if (typeof obj === "string") return obj;
  return obj[lang] ?? obj.vi ?? obj.en ?? "";
}

// Small DOM helper shared by pages and engines: el("p", { class: "x" }, "text", child)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
