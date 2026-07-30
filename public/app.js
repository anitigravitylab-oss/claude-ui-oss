"use strict";
/* Claude UI frontend — vanilla JS SPA, no build step. claude.ai-style presentation. */

/* ============================== utils ============================== */

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  // replaceChildren treats non-Node values as text, so dynamic strings are
  // never parsed as markup while existing child nodes keep their order.
  el.replaceChildren(...children.flat().filter((c) => c != null));
  return el;
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

/* T2: make a non-button element behave like a button for keyboard users. */
function makeActivatable(el, handler) {
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler(e);
    }
  });
  return el;
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function truncate(s, n) {
  if (!s) return "";
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* Phase 2: coarse relative time for session/project list rows ("3分前", "2日前"). */
function formatRelativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return "たった今";
  const min = Math.floor(diff / (60 * 1000));
  if (min < 60) return min + "分前";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "時間前";
  const day = Math.floor(hr / 24);
  if (day < 30) return day + "日前";
  const month = Math.floor(day / 30);
  if (month < 12) return month + "ヶ月前";
  return Math.floor(month / 12) + "年前";
}

function safeJsonStringify(v) {
  try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
}

/* Claude Code-style generating status line ------------------------------------ */
// source: Claude Code spinnerVerbs.ts（アップデート時はここを再同期）
const SPINNER_VERBS = [
  'Accomplishing', 'Actioning', 'Actualizing', 'Architecting', 'Baking', 'Beaming',
  'Beboppin\'', 'Befuddling', 'Billowing', 'Blanching', 'Bloviating', 'Boogieing',
  'Boondoggling', 'Booping', 'Bootstrapping', 'Brewing', 'Bunning', 'Burrowing',
  'Calculating', 'Canoodling', 'Caramelizing', 'Cascading', 'Catapulting', 'Cerebrating',
  'Channeling', 'Channelling', 'Choreographing', 'Churning', 'Clauding', 'Coalescing',
  'Cogitating', 'Combobulating', 'Composing', 'Computing', 'Concocting', 'Considering',
  'Contemplating', 'Cooking', 'Crafting', 'Creating', 'Crunching', 'Crystallizing',
  'Cultivating', 'Deciphering', 'Deliberating', 'Determining', 'Dilly-dallying', 'Discombobulating',
  'Doing', 'Doodling', 'Drizzling', 'Ebbing', 'Effecting', 'Elucidating',
  'Embellishing', 'Enchanting', 'Envisioning', 'Evaporating', 'Fermenting', 'Fiddle-faddling',
  'Finagling', 'Flambéing', 'Flibbertigibbeting', 'Flowing', 'Flummoxing', 'Fluttering',
  'Forging', 'Forming', 'Frolicking', 'Frosting', 'Gallivanting', 'Galloping',
  'Garnishing', 'Generating', 'Gesticulating', 'Germinating', 'Gitifying', 'Grooving',
  'Gusting', 'Harmonizing', 'Hashing', 'Hatching', 'Herding', 'Honking',
  'Hullaballooing', 'Hyperspacing', 'Ideating', 'Imagining', 'Improvising', 'Incubating',
  'Inferring', 'Infusing', 'Ionizing', 'Jitterbugging', 'Julienning', 'Kneading',
  'Leavening', 'Levitating', 'Lollygagging', 'Manifesting', 'Marinating', 'Meandering',
  'Metamorphosing', 'Misting', 'Moonwalking', 'Moseying', 'Mulling', 'Mustering',
  'Musing', 'Nebulizing', 'Nesting', 'Newspapering', 'Noodling', 'Nucleating',
  'Orbiting', 'Orchestrating', 'Osmosing', 'Perambulating', 'Percolating', 'Perusing',
  'Philosophising', 'Photosynthesizing', 'Pollinating', 'Pondering', 'Pontificating', 'Pouncing',
  'Precipitating', 'Prestidigitating', 'Processing', 'Proofing', 'Propagating', 'Puttering',
  'Puzzling', 'Quantumizing', 'Razzle-dazzling', 'Razzmatazzing', 'Recombobulating', 'Reticulating',
  'Roosting', 'Ruminating', 'Sautéing', 'Scampering', 'Schlepping', 'Scurrying',
  'Seasoning', 'Shenaniganing', 'Shimmying', 'Simmering', 'Skedaddling', 'Sketching',
  'Slithering', 'Smooshing', 'Sock-hopping', 'Spelunking', 'Spinning', 'Sprouting',
  'Stewing', 'Sublimating', 'Swirling', 'Swooping', 'Symbioting', 'Synthesizing',
  'Tempering', 'Thinking', 'Thundering', 'Tinkering', 'Tomfoolering', 'Topsy-turvying',
  'Transfiguring', 'Transmuting', 'Twisting', 'Undulating', 'Unfurling', 'Unravelling',
  'Vibing', 'Waddling', 'Wandering', 'Warping', 'Whatchamacalliting', 'Whirlpooling',
  'Whirring', 'Whisking', 'Wibbling', 'Working', 'Wrangling', 'Zesting',
  'Zigzagging',
];

// Linux glyph set, played back and forth (~120ms/frame). U+2026 suffix on the verb.
const SPINNER_FRAMES = ['·', '✢', '*', '✶', '✻', '✽'];
const SPINNER_BOUNCE = [...SPINNER_FRAMES, ...[...SPINNER_FRAMES].reverse()];

/* Rough local token estimate for the live status count (CJK ≈ 1/char, else ≈ chars/4). */
function estimateTokens(s) {
  if (!s) return 0;
  let cjk = 0, other = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const isCjk = (c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7ff) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0x20000 && c <= 0x2ffff);
    if (isCjk) cjk++; else other++;
  }
  return cjk + other / 4;
}

/* Compact token count like Claude Code: 900 / 1.3k / 1.0m. */
function formatCompactTokens(n) {
  const frac = n >= 1000 ? 1 : 0;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
    minimumFractionDigits: frac,
  }).format(n).toLowerCase();
}

/* Turn-completion line (round 3). */
const TURN_VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];

/* Model → context window (tokens). Claude family + unknown fall back to 200000. */
function contextWindowFor(model) {
  const m = (model || "").toLowerCase();
  if (m.includes("sonnet") || m.includes("opus") || m.includes("haiku") || m.startsWith("claude")) return 200000;
  return 200000;
}
/* min(maxOutput, 20000) is applied by the caller, so 20000 is a safe default. */
function maxOutputFor() { return 20000; }

function sumUsage(u) {
  if (!u || typeof u !== "object") return 0;
  return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
}

function formatCost(c) {
  c = Number(c);
  if (!isFinite(c)) return null;
  return c >= 0.01 ? "$" + c.toFixed(2) : "$" + c.toFixed(4);
}

/* Composer permission-mode footer text (default → hidden). */
function permissionModeLabel(mode) {
  switch (mode) {
    case "acceptEdits": return { text: "⏵⏵ accept edits on" };
    case "plan": return { text: "plan mode on" };
    case "bypassPermissions": return { text: "⏵⏵ bypass permissions on", cls: "err" };
    case "dontAsk": return { text: "⏵⏵ don't ask on" };
    case "auto": return { text: "⏵⏵ auto-accept on" };
    case "manual": return { text: "manual approval on" };
    case "":
    case "default":
    case null:
    case undefined:
      return null;
    default: return { text: "⏵⏵ " + mode + " on" };
  }
}

/* Short label for the status-cluster permission pill (round 4 / Phase 1). */
const PERM_PILL_LABEL = {
  "": "既定", "default": "既定",
  acceptEdits: "⏵accept", plan: "plan", bypassPermissions: "⏵bypass",
  dontAsk: "⏵dontAsk", auto: "⏵auto", manual: "manual",
};
function permissionPillLabel(mode) {
  return PERM_PILL_LABEL[mode || ""] || String(mode);
}

/* Inline SVG icons, represented as DOM element specs rather than HTML strings. */
const STROKE_ICON_ATTRS = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};
const SVG_ICON_SPECS = {
  chat: [["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }]],
  terminal: [
    ["polyline", { points: "4 17 10 11 4 5" }],
    ["line", { x1: "12", y1: "19", x2: "20", y2: "19" }],
  ],
  arrowUp: {
    attrs: { ...STROKE_ICON_ATTRS, "stroke-width": "2" },
    children: [["path", { d: "M12 19V5M5 12l7-7 7 7" }]],
  },
  arrowDown: [["path", { d: "M12 5v14M5 12l7 7 7-7" }]],
  stop: {
    attrs: { fill: "currentColor", stroke: "none" },
    children: [["rect", { x: "5", y: "5", width: "14", height: "14", rx: "2" }]],
  },
  chevronDown: [["path", { d: "M6 9l6 6 6-6" }]],
  x: {
    attrs: { ...STROKE_ICON_ATTRS, "stroke-linejoin": null },
    children: [["path", { d: "M18 6 6 18M6 6l12 12" }]],
  },
  folder: [["path", { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }]],
  file: [
    ["path", { d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" }],
    ["path", { d: "M14 3v6h6" }],
  ],
  arrowLeft: [["path", { d: "M19 12H5M12 19l-7-7 7-7" }]],
  sun: [
    ["circle", { cx: "12", cy: "12", r: "4" }],
    ["path", { d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }],
  ],
  moon: [["path", { d: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" }]],
  check: [["path", { d: "M20 6 9 17l-5-5" }]],
  list: {
    attrs: { ...STROKE_ICON_ATTRS, "stroke-linejoin": null },
    children: [["path", { d: "M4 6h16M4 12h16M4 18h16" }]],
  },
  bolt: {
    attrs: { fill: "currentColor", stroke: "none" },
    children: [["path", { d: "M13 2 4 14h6l-1 8 9-12h-6z" }]],
  },
};

function svgIcon(name) {
  const spec = Object.prototype.hasOwnProperty.call(SVG_ICON_SPECS, name) ? SVG_ICON_SPECS[name] : null;
  if (!spec) return document.createTextNode("");
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const attrs = Array.isArray(spec) ? STROKE_ICON_ATTRS : spec.attrs;
  const children = Array.isArray(spec) ? spec : spec.children;
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) svg.setAttribute(key, value);
  }
  for (const [tag, childAttrs] of children) {
    const child = document.createElementNS(svgNs, tag);
    for (const [key, value] of Object.entries(childAttrs)) child.setAttribute(key, value);
    svg.appendChild(child);
  }
  return svg;
}

function iconSpan(name, cls) {
  return h("span", { class: cls || "icon" }, svgIcon(name));
}

/* F2: strict allowlist sanitization for ALL rendered markdown (assistant/tool/history). */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "hr", "span", "div", "a", "b", "strong", "i", "em", "u", "s", "del",
    "code", "pre", "blockquote", "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  ALLOWED_ATTR: ["href", "title", "alt", "class", "target", "rel"],
  // Only these URI schemes/relative forms are ever allowed (blocks javascript:, data:, vbscript:, etc.)
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/(?!\/)|\.{0,2}\/)/i,
  ADD_ATTR: ["target"],
  FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "img"],
  FORBID_ATTR: ["style", "srcset"],
};

let _purifyHooked = false;
function ensurePurifyHook() {
  if (_purifyHooked || !window.DOMPurify) return;
  window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      // links always open in a new tab, never leak opener
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  _purifyHooked = true;
}

/** Render markdown text into a DOM fragment via marked + DOMPurify allowlist. */
function renderMarkdown(text) {
  // Optional instrumentation (inert unless a harness sets globalThis.__mdStats).
  if (typeof globalThis !== "undefined" && globalThis.__mdStats) {
    globalThis.__mdStats.calls++;
    globalThis.__mdStats.chars += text ? String(text).length : 0;
  }
  const asPlainText = () => {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode(String(text ?? "")));
    return fragment;
  };

  if (!window.marked || !window.DOMPurify) return asPlainText();

  let raw;
  try {
    raw = window.marked.parse(text ?? "");
  } catch {
    return asPlainText();
  }
  ensurePurifyHook();
  return window.DOMPurify.sanitize(raw, {
    ...PURIFY_CONFIG,
    RETURN_DOM_FRAGMENT: true,
  });
}

/*
 * Index up to which streamed markdown is "confirmed" (safe to freeze): the end of
 * the last blank-line paragraph break that is NOT inside an open code fence.
 * Everything before it renders once; only the tail after it is re-parsed per frame.
 */
function confirmedMarkdownBoundary(text) {
  if (!text) return 0;
  const lines = text.split("\n");
  let fenceOpen = false;
  let offset = 0;
  let boundary = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) fenceOpen = !fenceOpen;
    offset += line.length + 1; // account for the "\n" that split() removed
    if (!fenceOpen && line.trim() === "" && i < lines.length - 1) {
      boundary = Math.min(offset, text.length);
    }
  }
  return boundary;
}

function toast(message) {
  const root = document.getElementById("toast-root");
  const t = h("div", { class: "toast" }, message);
  root.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

/* ============================== auth / api ============================== */

const Auth = {
  TOKEN_KEY: "claude-ui-token",
  memoryToken: "",

  init() {
    const queryParams = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
    const urlToken = hashParams.get("token") || queryParams.get("token");
    if (urlToken) {
      this.set(urlToken);
      queryParams.delete("token"); // remove legacy ?token= links too
      hashParams.delete("token");
      const query = queryParams.toString();
      const hash = hashParams.toString();
      history.replaceState(null, "", location.pathname + (query ? "?" + query : "") + (hash ? "#" + hash : ""));
    }
  },

  get() {
    try {
      return localStorage.getItem(this.TOKEN_KEY) || this.memoryToken;
    } catch (e) {
      return this.memoryToken;
    }
  },

  set(t) {
    this.memoryToken = t;
    try { localStorage.setItem(this.TOKEN_KEY, t); } catch (e) { /* memory fallback */ }
  },

  clear() {
    this.memoryToken = "";
    try { localStorage.removeItem(this.TOKEN_KEY); } catch (e) { /* ignore */ }
  },

  async ensure() {
    if (this.get()) return this.get();
    return this.promptFor();
  },

  promptFor() {
    return new Promise((resolve) => {
      const input = h("input", {
        type: "password",
        "aria-label": "アクセストークン",
        autocomplete: "current-password",
        placeholder: "アクセストークンを貼り付け",
      });
      const submit = () => {
        const v = input.value.trim();
        if (!v) return;
        this.set(v);
        closeModal();
        resolve(v);
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      const box = h(
        "div", { class: "modal-body" },
        h("p", null, "サーバー起動時に表示されたアクセストークンを入力してください。"),
        input
      );
      openModal({
        title: "認証が必要です",
        body: box,
        footer: [h("button", { class: "btn-primary", onclick: submit }, "続ける")],
        closable: false,
      });
      setTimeout(() => input.focus(), 30);
    });
  },
};

async function apiFetch(path, opts = {}) {
  await Auth.ensure();
  const headers = Object.assign({}, opts.headers || {}, { Authorization: "Bearer " + Auth.get() });
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  if (res.status === 401) {
    Auth.clear();
    toast("トークンが無効です。再入力してください。");
    await Auth.promptFor();
    return apiFetch(path, opts);
  }
  return res;
}

async function apiJson(path, opts) {
  const res = await apiFetch(path, opts);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function wsUrl(path, params) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const qs = new URLSearchParams(params || {});
  return `${proto}//${location.host}${path}?${qs.toString()}`;
}

function wsAuthProtocol() {
  const bytes = new TextEncoder().encode(Auth.get());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return "claude-ui.auth." + encoded;
}

function openAuthenticatedWebSocket(path, params) {
  return new WebSocket(wsUrl(path, params), wsAuthProtocol());
}

let terminalAssetsPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("読み込みに失敗しました: " + src)), { once: true });
    document.head.appendChild(script);
  });
}

function ensureTerminalAssets() {
  if (window.Terminal && window.FitAddon && window.WebLinksAddon) return Promise.resolve();
  if (!terminalAssetsPromise) {
    terminalAssetsPromise = loadScript("./vendor/xterm.js")
      .then(() => loadScript("./vendor/addon-fit.js"))
      .then(() => loadScript("./vendor/addon-web-links.js"))
      .catch((error) => {
        terminalAssetsPromise = null;
        throw error;
      });
  }
  return terminalAssetsPromise;
}

/* ============================== PWA / service worker ============================== */

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (e) {
    console.warn("Service worker registration failed:", e);
  }
}

/* ============================== Web Push (Phase 3) ============================== */

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const Push = {
  checked: false, // becomes true once refresh() has resolved at least once
  supported: false,
  subscribed: false,
  reason: "",

  detectSupport() {
    const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (hasApi) {
      this.supported = true;
      this.reason = "";
      return;
    }
    this.supported = false;
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent || "");
    const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    this.reason = isIOS && !standalone
      ? "iOS はホーム画面に追加してから利用できます"
      : "この環境は通知に対応していません";
  },

  async refresh() {
    this.detectSupport();
    if (!this.supported) {
      this.subscribed = false;
      this.checked = true;
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      this.subscribed = !!sub;
    } catch (e) {
      this.subscribed = false;
    }
    this.checked = true;
  },

  async enable() {
    if (!this.supported) throw new Error(this.reason || "非対応の環境です");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("通知の許可が得られませんでした");
    const { publicKey } = await apiJson("/api/push/public-key");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await apiJson("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    this.subscribed = true;
  },

  async disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      try {
        await apiJson("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      } catch (e) {
        /* best-effort: subscription is already gone locally regardless */
      }
    }
    this.subscribed = false;
  },
};

/* ============================== modal (fs picker / token only) ============================== */

let modalQueue = [];
let modalOpen = false;
let modalClosable = true;
let modalTrigger = null; // element to restore focus to when the modal closes

function openModal({ title, body, footer, closable = true }) {
  // T3: remember the element that triggered this modal so we can restore focus to it on close.
  const restoreFocus = document.activeElement;
  modalQueue.push({ title, body, footer, closable, restoreFocus });
  if (!modalOpen) showNextModal();
}

function focusableIn(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  )).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function showNextModal() {
  const root = document.getElementById("modal-root");
  clear(root);
  const next = modalQueue.shift();
  if (!next) { modalOpen = false; return; }
  modalOpen = true;
  modalClosable = !!next.closable;
  modalTrigger = next.restoreFocus || null;

  const box = h(
    "div", { class: "modal-box", role: "dialog", "aria-modal": "true", "aria-label": String(next.title || "ダイアログ") },
    h(
      "div", { class: "modal-header" },
      h("span", null, next.title),
      next.closable ? h("button", { class: "modal-close", "aria-label": "閉じる", onclick: () => closeModal() }, svgIcon("x")) : null
    ),
    next.body,
    next.footer ? h("div", { class: "modal-footer" }, ...next.footer) : null
  );
  const overlay = h("div", { class: "modal-overlay" }, box);

  if (next.closable) {
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });
  }
  // T3: focus trap
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = focusableIn(box);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  root.appendChild(overlay);
  // Move focus into the dialog if nothing inside is focused yet.
  setTimeout(() => {
    if (!box.contains(document.activeElement)) {
      const items = focusableIn(box);
      (items[0] || box).focus();
    }
  }, 20);
}

function closeModal() {
  const root = document.getElementById("modal-root");
  clear(root);
  modalOpen = false;
  const trigger = modalTrigger;
  modalTrigger = null;
  if (modalQueue.length) { showNextModal(); return; }
  // T3: restore focus to whatever opened the modal, as the very last thing —
  // deferred a frame so any synchronous autofocus (e.g. view activation) can't win.
  const restore = () => {
    if (trigger && typeof trigger.focus === "function" && document.contains(trigger)) {
      try { trigger.focus(); } catch (e) { /* ignore */ }
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
  else setTimeout(restore, 0);
}

function isModalOpen() { return modalOpen; }
function isModalClosable() { return modalClosable; }

/* ============================== theme ============================== */

const THEME_KEY = "claude-ui-theme";

function currentTheme() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark" || explicit === "light") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  updateThemeToggle();
}

function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}

function updateThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  clear(btn);
  // icon only; show the theme you would switch to
  const next = currentTheme() === "dark" ? "light" : "dark";
  btn.appendChild(svgIcon(next === "dark" ? "moon" : "sun"));
  const label = next === "dark" ? "ダークテーマに切替" : "ライトテーマに切替";
  btn.setAttribute("title", label);
  btn.setAttribute("aria-label", label);
}

/* ============================== app state ============================== */

const App = {
  info: { claudeVersion: "", cwd: "", models: [], permissionModes: [] },
  cwd: "",
  views: new Map(),
  activeViewId: null,
  viewOrder: [],
  sessions: [],
  recentSessions: [], // Phase 5b: cross-project "recent sessions" (sidebar top section)
  lastChatViewId: null,
  lastTerminalViewId: null,
};

const DEFAULT_MODELS = ["fable", "opus", "sonnet"];
const MODEL_KEY = "claude-ui-model"; // remembers the last explicitly chosen model
const DEFAULT_MODEL_CHOICE = "fable";
const DEFAULT_PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions", "dontAsk"];

/* Phase 1: quick-action sheet — effort levels. "max" was probed against a live
   `claude --print` process (both `--effort max` at startup and `apply_flag_settings`
   mid-session) and accepted, so it's included; if a given account/plan rejects it the
   apply_flag_settings call below will surface a toast instead of silently failing. */
const EFFORT_LEVELS = ["low", "medium", "high", "max"];
const EFFORT_KEY = "claude-ui-effort"; // remembers the last explicitly chosen effort level

/* Phase 2: sidebar history is shown in pages of this size ("さらに表示" grows it). */
const SESSIONS_PAGE_SIZE = 10;
let sessionsShowLimit = SESSIONS_PAGE_SIZE;

/* Phase 2: pinned cwd paths — client-only, localStorage, insertion order (no server state). */
const PINNED_PATHS_KEY = "claude-ui-pinned-paths";
function getPinnedPaths() {
  try {
    const arr = JSON.parse(localStorage.getItem(PINNED_PATHS_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter((p) => typeof p === "string" && p) : [];
  } catch (e) {
    return [];
  }
}
function setPinnedPaths(arr) {
  try { localStorage.setItem(PINNED_PATHS_KEY, JSON.stringify(arr)); } catch (e) { /* ignore (quota/private mode) */ }
}
function isPinnedPath(p) { return getPinnedPaths().includes(p); }
function togglePinnedPath(p) {
  const arr = getPinnedPaths();
  const i = arr.indexOf(p);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(p);
  setPinnedPaths(arr);
}

/* ============================== sidebar data ============================== */

async function loadInfo() {
  try {
    const info = await apiJson("/api/info");
    App.info = info;
    document.getElementById("claude-version").textContent = "claude " + (info.claudeVersion || "?");
    // Phase 5a fix: the previously-selected cwd (localStorage) must win over
    // info.cwd (the server process's home dir — a constant, not "what the
    // user last had open"). Before this fix, info.cwd being always-truthy
    // meant every reload silently snapped the sidebar back to the server's
    // home dir, discarding the saved selection — this was the root cause of
    // "reload always goes back to root/home" (confirmed live: setCwd to a
    // non-home path, reload, App.cwd reverted to the server's HOME).
    if (!App.cwd) setCwd(localStorage.getItem("claude-ui-cwd") || info.cwd || "/");
  } catch (e) {
    toast("/api/info の取得に失敗しました: " + e.message);
  }
}

function setCwd(cwd) {
  App.cwd = cwd;
  localStorage.setItem("claude-ui-cwd", cwd);
  const el = document.getElementById("cwd-value");
  el.textContent = cwd;
  el.title = cwd;
  sessionsShowLimit = SESSIONS_PAGE_SIZE; // Phase 2: reset paging on an actual cwd switch
  loadSessions();
  persistWorkspaceState(); // Phase 5a: sidebar cwd selection is part of the restored workspace
}

let _sessionsReloadTimer = null;
function scheduleSessionsReload() {
  clearTimeout(_sessionsReloadTimer);
  _sessionsReloadTimer = setTimeout(() => { loadSessions(); loadRecentSessions(); }, 800);
}

async function loadSessions() {
  if (!App.cwd) { App.sessions = []; renderChatList(); return; }
  try {
    const sessions = await apiJson("/api/sessions?cwd=" + encodeURIComponent(App.cwd));
    App.sessions = Array.isArray(sessions) ? sessions : [];
  } catch (e) {
    App.sessions = [];
  }
  renderChatList();
}

/* Phase 5b: cross-project "recent sessions" (sidebar top section). */
async function loadRecentSessions() {
  try {
    const sessions = await apiJson("/api/sessions/recent?limit=8");
    App.recentSessions = Array.isArray(sessions) ? sessions : [];
  } catch (e) {
    App.recentSessions = [];
  }
  renderRecentSessions();
}

/* sessionIds currently open as live tabs, shared by renderChatList (hides
   already-open sessions from the per-cwd history list) and renderRecentSessions
   (same, for the cross-project list) so a tap never opens a duplicate tab. */
function getOpenSessionIds() {
  const set = new Set();
  for (const [, view] of App.views) {
    if (view.kind === "chat" && view.sessionId) set.add(view.sessionId);
  }
  return set;
}

/* Resumes `session` as a chat tab. Reused by the per-cwd history rows (no
   `session.cwd` — implicitly the current sidebar cwd) and the cross-project
   "recent sessions" list (Phase 5b: `session.cwd` may differ from the
   currently-selected sidebar cwd, so this switches it). */
function openResumedChat(session) {
  const cwd = session.cwd || App.cwd;
  if (cwd !== App.cwd) setCwd(cwd);
  const view = createChatView({ resume: session.sessionId, cwd });
  view.loadTranscript();
  // Phase 5b: this tab has no child of its own (yet) — passively tail the
  // transcript so any progress made elsewhere (a GUI terminal `--resume`, or
  // another chat tab) still shows up here without spawning a second `claude`.
  view.ensureWatching();
  closeSidebarIfMobile();
}

/* Phase 5b: tap a "最近のセッション" row → chat resume (or focus the already-open
   tab instead of opening a duplicate). */
function openRecentSession(s) {
  if (!s || !s.sessionId || !s.cwd) return;
  for (const [id, view] of App.views) {
    if (view.kind === "chat" && view.sessionId === s.sessionId) {
      if (App.cwd !== s.cwd) setCwd(s.cwd);
      activateView(id);
      closeSidebarIfMobile();
      return;
    }
  }
  openResumedChat(s);
}

/* Phase 5b: the ">_" button on a "最近のセッション" row → open the same session
   in a terminal tab (`claude --resume <id>`), the second/GUI-driving motion. */
function openRecentSessionInTerminal(s) {
  if (!s || !s.sessionId || !s.cwd) return;
  createTerminalView({ cwd: s.cwd, resume: s.sessionId });
  closeSidebarIfMobile();
}

/* Phase 5a: bottom-nav "チャット" continuity — when no chat tab is open,
   resume "the session the user was last using" instead of showing the cwd
   picker (Claude-app-like). Tries, in order: (1) a still-resumable
   attach/session pointer (readLastChatPointer — workspace snapshot or the
   older single-pointer mechanism; both are intentionally empty once a tab
   was *explicitly* closed, per Phase 4's "closed tab is not resumable"
   invariant), (2) the most recently used on-disk session for the current
   sidebar cwd (same data source/action as tapping a sidebar history row —
   this is what actually fires after an explicit close, and is why the
   picker only shows up for a truly first-ever use). */
function openLastChatOrPicker() {
  const pointer = readLastChatPointer();
  if (pointer && pointer.cwd) {
    const view = createChatView({ cwd: pointer.cwd, resume: pointer.sessionId || null });
    if (pointer.attachId) {
      view.attachId = pointer.attachId;
      persistChatAttachRecord(view);
    }
    (async () => {
      if (pointer.sessionId) await view.loadTranscript();
      view.ensureConnected();
    })();
    closeSidebarIfMobile();
    return;
  }
  const recent = App.sessions.slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0];
  if (recent && recent.sessionId) {
    openResumedChat(recent);
    return;
  }
  openNewSessionCwdPicker("chat");
}

/* ============================== unified chat list (U2) ============================== */

function renderChatList() {
  const list = document.getElementById("chat-list");
  clear(list);

  const openSessionIds = getOpenSessionIds();
  // Live views first, newest first.
  const liveIds = [...App.viewOrder].reverse();
  for (const id of liveIds) {
    const view = App.views.get(id);
    if (!view) continue;
    const dot = h("span", { class: "ci-dot" + (view.streaming ? " streaming" : ""), title: view.streaming ? "応答中" : "アクティブ" });
    const badge = view.pendingPermCount > 0
      ? h("span", { class: "ci-badge", title: "権限の確認待ち" }, String(view.pendingPermCount))
      : null;
    const closeBtn = h(
      "button",
      { class: "ci-close", "aria-label": "終了", title: "終了", onclick: (e) => { e.stopPropagation(); closeView(id); } },
      svgIcon("x")
    );
    const item = h(
      "div",
      {
        class: "chat-item live" + (id === App.activeViewId ? " active" : ""),
        onclick: () => { activateView(id); closeSidebarIfMobile(); },
        title: view.kind === "chat" && view.sessionId ? view.sessionId : "",
      },
      iconSpan(view.kind === "terminal" ? "terminal" : "chat", "ci-icon"),
      h("span", { class: "ci-title" }, view.title || (view.kind === "terminal" ? "ターミナル" : "新しいチャット")),
      badge,
      dot,
      closeBtn
    );
    makeActivatable(item, () => { activateView(id); closeSidebarIfMobile(); });
    list.appendChild(item);
  }

  // History sessions (not currently open). Phase 2: relative time + message count +
  // staged "さらに表示" paging so a project with many sessions stays fast to scan.
  const historyFull = App.sessions
    .slice()
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
    .filter((s) => s.sessionId && !openSessionIds.has(s.sessionId));
  const history = historyFull.slice(0, sessionsShowLimit);

  for (const s of history) {
    const metaParts = [];
    if (s.mtime) metaParts.push(formatRelativeTime(s.mtime));
    if (typeof s.messageCount === "number" && s.messageCount > 0) metaParts.push(s.messageCount + "件");
    const meta = metaParts.length ? h("span", { class: "hi-meta" }, metaParts.join(" · ")) : null;
    const item = h(
      "div",
      { class: "chat-item history-item", onclick: () => openResumedChat(s), title: s.sessionId },
      iconSpan("chat", "ci-icon"),
      h(
        "div", { class: "hi-main" },
        h("span", { class: "hi-title" }, s.firstPrompt || "(空のチャット)"),
        meta
      )
    );
    makeActivatable(item, () => openResumedChat(s));
    list.appendChild(item);
  }

  if (historyFull.length > sessionsShowLimit) {
    const remaining = historyFull.length - sessionsShowLimit;
    list.appendChild(h(
      "button",
      {
        class: "chat-list-more", type: "button",
        onclick: () => { sessionsShowLimit += SESSIONS_PAGE_SIZE; renderChatList(); },
      },
      `さらに表示（他 ${remaining} 件）`
    ));
  }

  if (!liveIds.length && !historyFull.length) {
    list.appendChild(h("div", { class: "chat-list-empty" }, "このディレクトリのチャットはまだありません。"));
  }

  renderRecentSessions(); // Phase 5b: keep the cross-project list's "already open" filter in sync
}

/* Phase 5b: sidebar top section — most-recently-active sessions across every
   project, so switching projects doesn't make history "disappear". */
function renderRecentSessions() {
  const list = document.getElementById("recent-sessions-list");
  if (!list) return;
  clear(list);

  const openSessionIds = getOpenSessionIds();
  const items = App.recentSessions.filter((s) => s && s.sessionId && s.cwd && !openSessionIds.has(s.sessionId));

  for (const s of items) {
    const metaParts = [];
    const base = String(s.cwd).replace(/\/+$/, "").split("/").filter(Boolean).pop() || s.cwd;
    metaParts.push(base);
    if (s.mtime) metaParts.push(formatRelativeTime(s.mtime));
    const meta = h("span", { class: "hi-meta" }, metaParts.join(" · "));
    const termBtn = h(
      "button",
      {
        class: "rs-term-btn", type: "button", title: "ターミナルで再開", "aria-label": "ターミナルで再開",
        onclick: (e) => { e.stopPropagation(); openRecentSessionInTerminal(s); },
      },
      iconSpan("terminal", "ci-icon")
    );
    const item = h(
      "div",
      { class: "chat-item history-item recent-session-item", onclick: () => openRecentSession(s), title: s.cwd + " — " + s.sessionId },
      iconSpan("chat", "ci-icon"),
      h(
        "div", { class: "hi-main" },
        h("span", { class: "hi-title" }, s.firstPrompt || "(空のチャット)"),
        meta
      ),
      termBtn
    );
    makeActivatable(item, () => openRecentSession(s));
    list.appendChild(item);
  }

  if (!items.length) {
    list.appendChild(h("div", { class: "chat-list-empty" }, "最近のセッションはまだありません。"));
  }
}

/* ---- directory picker modal ---- */

function openCwdPicker(opts) {
  // Phase 2: an optional onConfirm(path) lets callers reuse this browser as the
  // "参照…" fallback step of the new-session cwd picker (it starts a session
  // instead of just changing App.cwd). Default (no opts) keeps the original
  // footer-chip behavior of only changing the sidebar's current cwd.
  const onConfirm = opts && typeof opts.onConfirm === "function" ? opts.onConfirm : null;
  let path = App.cwd || "/";
  const pathInput = h("input", { type: "text", value: path });
  const list = h("div", { class: "fs-list" });

  const MAX_ENTRIES = 500;

  async function load(p) {
    try {
      const res = await apiJson("/api/fs?path=" + encodeURIComponent(p));
      path = p;
      pathInput.value = p;
      clear(list);
      const parent = p.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
      if (p !== "/") {
        const up = h(
          "div", { class: "fs-entry is-dir", onclick: () => load(parent) },
          iconSpan("arrowLeft", "fs-icon"), "上のディレクトリへ"
        );
        makeActivatable(up, () => load(parent));
        list.appendChild(up);
      }
      const dirs = (res.dirs || []).map(normalizeEntry);
      const files = (res.files || []).map(normalizeEntry);
      // T4: cap rendered entries so huge directories don't freeze the UI.
      let shown = 0;
      let omitted = 0;
      for (const d of dirs) {
        if (shown >= MAX_ENTRIES) { omitted += 1; continue; }
        const full = d.path || joinPath(p, d.name);
        const row = h(
          "div", { class: "fs-entry is-dir", onclick: () => load(full) },
          iconSpan("folder", "fs-icon"), d.name
        );
        makeActivatable(row, () => load(full));
        list.appendChild(row);
        shown += 1;
      }
      for (const f of files) {
        if (shown >= MAX_ENTRIES) { omitted += 1; continue; }
        list.appendChild(h(
          "div", { class: "fs-entry is-file" },
          iconSpan("file", "fs-icon"), f.name
        ));
        shown += 1;
      }
      if (omitted > 0) {
        list.appendChild(h("div", { class: "fs-entry fs-omitted" }, `他 ${omitted} 件を省略しました`));
      }
    } catch (e) {
      // T6: keep display in sync with the last confirmed path.
      pathInput.value = path;
      toast("ディレクトリの一覧に失敗しました: " + e.message);
    }
  }

  pathInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") load(pathInput.value.trim() || "/");
  });

  const goBtn = h("button", { class: "btn-ghost", onclick: () => load(pathInput.value.trim() || "/") }, "移動");
  const body = h(
    "div", { class: "modal-body" },
    h("div", { class: "fs-path-row" }, pathInput, goBtn),
    list
  );
  openModal({
    title: "作業ディレクトリの変更",
    body,
    footer: [
      h("button", { class: "btn-ghost", onclick: () => closeModal() }, "キャンセル"),
      h(
        "button", { class: "btn-primary", onclick: () => { if (onConfirm) onConfirm(path); else { setCwd(path); closeModal(); } } },
        "このディレクトリにする"
      ),
    ],
  });
  load(path);
}

function normalizeEntry(e) {
  if (typeof e === "string") {
    const name = e.replace(/\/+$/, "").split("/").pop() || e;
    return { name, path: e.includes("/") ? e : null };
  }
  return { name: e.name || (e.path ? e.path.split("/").pop() : "?"), path: e.path || null };
}

function joinPath(base, name) {
  if (name.startsWith("/")) return name;
  return base.replace(/\/+$/, "") + "/" + name;
}

/* ---- new-session cwd picker (Phase 2): pinned / recent / browse, 1 tap per row ---- */

function pathMainLabel(p) {
  const trimmed = String(p || "").replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed || "/";
}

/** One row of the picker: dir name (main) + full path + optional relative time (sub),
 *  with a ★ toggle that doesn't trigger the row's own onPick. */
function buildCwdPickerRow(p, { lastActivity, onPick, onPinChange }) {
  const pinned = isPinnedPath(p);
  const star = h(
    "button",
    {
      class: "cwd-row-star" + (pinned ? " pinned" : ""),
      type: "button",
      title: pinned ? "ピン解除" : "ピン留め",
      "aria-label": pinned ? "ピン解除" : "ピン留め",
      onclick: (e) => { e.stopPropagation(); togglePinnedPath(p); if (onPinChange) onPinChange(); },
    },
    pinned ? "★" : "☆"
  );
  const subParts = [h("span", { class: "cwd-row-path mono" }, p)];
  if (lastActivity) subParts.push(h("span", { class: "cwd-row-time" }, formatRelativeTime(lastActivity)));
  const row = h(
    "div",
    { class: "cwd-row", title: p, onclick: () => onPick(p) },
    h(
      "div", { class: "cwd-row-main" },
      h("span", { class: "cwd-row-name" }, pathMainLabel(p)),
      h("div", { class: "cwd-row-sub" }, ...subParts)
    ),
    star
  );
  makeActivatable(row, () => onPick(p));
  return row;
}

/** kind: "chat" | "terminal". Opens a 3-tier picker (pinned / recent / browse) and
 *  starts a session at whichever cwd the user taps — one tap per row. */
function openNewSessionCwdPicker(kind) {
  const title = kind === "terminal" ? "新しいターミナルを開始" : "新しいチャットを開始";

  function start(p) {
    closeModal();
    setCwd(p);
    if (kind === "terminal") createTerminalView({ cwd: p });
    else createChatView({ cwd: p });
    closeSidebarIfMobile();
  }

  const body = h("div", { class: "modal-body cwd-picker" });

  async function render() {
    clear(body);
    const pinnedPaths = getPinnedPaths();

    // Tier 0: one-tap "start right here" — keeps the old instant new-session flow
    // for the common same-directory case. Hidden when no cwd is known yet.
    if (App.cwd) {
      const cur = App.cwd;
      const curRow = h(
        "div",
        { class: "cwd-row cwd-row-current", title: cur, onclick: () => start(cur) },
        h(
          "div", { class: "cwd-row-main" },
          h("span", { class: "cwd-row-name" }, pathMainLabel(cur)),
          h("div", { class: "cwd-row-sub" }, h("span", { class: "cwd-row-path mono" }, cur))
        ),
        h("span", { class: "cwd-row-go" }, "そのまま開始")
      );
      makeActivatable(curRow, () => start(cur));
      body.appendChild(h(
        "div", { class: "cwd-picker-section" },
        h("div", { class: "cwd-picker-title" }, "現在のディレクトリで開始"),
        curRow
      ));
    }

    if (pinnedPaths.length) {
      const sec = h("div", { class: "cwd-picker-section" }, h("div", { class: "cwd-picker-title" }, "ピン留め"));
      for (const p of pinnedPaths) sec.appendChild(buildCwdPickerRow(p, { onPick: start, onPinChange: render }));
      body.appendChild(sec);
    }

    const recentSec = h("div", { class: "cwd-picker-section" }, h("div", { class: "cwd-picker-title" }, "最近使ったパス"));
    const loading = h("div", { class: "cwd-picker-loading" }, "読み込み中…");
    recentSec.appendChild(loading);
    body.appendChild(recentSec);

    const browseRow = h(
      "div", { class: "cwd-row cwd-row-browse", onclick: () => { closeModal(); openCwdPicker({ onConfirm: start }); } },
      iconSpan("folder", "cwd-row-icon"), h("span", null, "ディレクトリを参照…")
    );
    makeActivatable(browseRow, () => { closeModal(); openCwdPicker({ onConfirm: start }); });
    body.appendChild(h("div", { class: "cwd-picker-section" }, browseRow));

    try {
      const projects = await apiJson("/api/projects");
      loading.remove();
      const pinnedSet = new Set(pinnedPaths);
      const list = (Array.isArray(projects) ? projects : [])
        .filter((proj) => proj && typeof proj.cwd === "string" && proj.cwd && !pinnedSet.has(proj.cwd))
        .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
        .slice(0, 20);
      if (!list.length) {
        recentSec.appendChild(h("div", { class: "cwd-picker-empty" }, "最近使ったパスはまだありません。"));
      } else {
        for (const proj of list) {
          recentSec.appendChild(buildCwdPickerRow(proj.cwd, { lastActivity: proj.lastActivity, onPick: start, onPinChange: render }));
        }
      }
    } catch (e) {
      loading.textContent = "読み込みに失敗しました: " + e.message;
    }
  }

  render();
  openModal({
    title,
    body,
    footer: [h("button", { class: "btn-ghost", onclick: () => closeModal() }, "キャンセル")],
  });
}

/* ============================== view management ============================== */

function viewport() { return document.getElementById("viewport"); }

function registerView(view) {
  App.views.set(view.id, view);
  App.viewOrder.push(view.id);
  viewport().appendChild(view.panelEl);
  activateView(view.id);
  renderChatList();
  updateViewportEmpty();
}

function closeView(id) {
  const view = App.views.get(id);
  if (!view) return;
  try { view.dispose(); } catch (e) { /* ignore */ }
  view.panelEl.remove();
  App.views.delete(id);
  App.viewOrder = App.viewOrder.filter((v) => v !== id);
  if (App.activeViewId === id) {
    const next = App.viewOrder[App.viewOrder.length - 1] || null;
    App.activeViewId = null;
    if (next) activateView(next);
  }
  renderChatList();
  updateViewportEmpty();
  if (view.kind === "chat" && view.sessionId) scheduleSessionsReload();
  persistWorkspaceState(); // Phase 5a: closed tab (and possibly new active tab) leave the workspace
}

function activateView(id) {
  App.activeViewId = id;
  for (const [vid, view] of App.views) {
    view.panelEl.classList.toggle("active", vid === id);
  }
  const view = App.views.get(id);
  if (view) {
    if (view.kind === "chat") {
      App.lastChatViewId = id;
      persistChatAttachRecord(view); // Phase 4: refresh "last active chat" pointer
    } else if (view.kind === "terminal") {
      App.lastTerminalViewId = id;
    }
  }
  renderChatList();
  updateBottomNavActiveState();
  persistWorkspaceState(); // Phase 5a: active-tab pointer is part of the restored workspace
  if (view && view.onActivate) view.onActivate();
}

function updateViewportEmpty() {
  const vp = viewport();
  const existing = vp.querySelector(":scope > .viewport-empty");
  if (App.viewOrder.length === 0) {
    if (!existing) {
      vp.appendChild(h("div", { class: "viewport-empty" }, "サイドバーからチャットを選ぶか、新しく始めましょう。"));
    }
  } else if (existing) {
    existing.remove();
  }
}

/* ============================== chat view ============================== */

function createChatView(opts = {}) {
  const id = uid();
  const view = new ChatTab(id, opts);
  registerView(view);
  return view;
}

/* Phase 4: detach/reattach bookkeeping — persist (attachId, claude sessionId,
   cwd) per chat view so a full page reload can attempt to rejoin the most
   recently active chat's still-running session. Client-only, localStorage;
   never sent anywhere, never affects auth. */
const LAST_CHAT_ATTACH_KEY = "claude-ui-last-chat-attach";
function chatAttachStorageKey(viewId) {
  return "claude-ui-attach:" + viewId;
}

function persistChatAttachRecord(view) {
  if (!view || view.kind !== "chat" || !view.attachId) return;
  try {
    localStorage.setItem(
      chatAttachStorageKey(view.id),
      JSON.stringify({ attachId: view.attachId, sessionId: view.sessionId, cwd: view.cwd })
    );
    if (App.activeViewId === view.id) localStorage.setItem(LAST_CHAT_ATTACH_KEY, view.id);
  } catch (e) { /* ignore quota/private mode */ }
  persistWorkspaceState(); // Phase 5a: keep the tab's workspace-snapshot attachId/sessionId fresh
}

function clearChatAttachRecord(view) {
  if (!view) return;
  try {
    localStorage.removeItem(chatAttachStorageKey(view.id));
    if (localStorage.getItem(LAST_CHAT_ATTACH_KEY) === view.id) localStorage.removeItem(LAST_CHAT_ATTACH_KEY);
  } catch (e) { /* ignore */ }
}

/* Phase 5a: whole-workspace restore. Persists every open tab (chat: cwd +
   attachId + sessionId; terminal: cwd only — a PTY can't be reattached, so
   "restore" for a terminal tab is just opening a fresh one at the same cwd,
   which is the cheap option the spec calls out), which tab is active, and
   the sidebar's selected cwd. Superset of the older single-chat
   LAST_CHAT_ATTACH_KEY mechanism above (kept as-is, still used as a fallback
   below for any pre-existing/partial state). */
const WORKSPACE_KEY = "claude-ui-workspace";
// Captured once, at the very top of init(), before loadInfo()'s setCwd() call can
// persist (and thereby clobber) an empty-tabs snapshot over the real saved one —
// see the comment in init() for why this ordering hazard exists.
let _bootWorkspaceSnapshotRaw = null;

function persistWorkspaceState() {
  try {
    const tabs = App.viewOrder.map((id) => {
      const view = App.views.get(id);
      if (!view) return null;
      if (view.kind === "chat") {
        return { kind: "chat", cwd: view.cwd, attachId: view.attachId || null, sessionId: view.sessionId || null };
      }
      if (view.kind === "terminal") {
        return { kind: "terminal", cwd: view.cwd };
      }
      return null;
    }).filter(Boolean);
    const state = {
      cwd: App.cwd,
      activeIndex: App.viewOrder.indexOf(App.activeViewId),
      tabs,
    };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(state));
  } catch (e) { /* ignore quota/private mode */ }
}

/* Called once at boot. Returns true if a restore was attempted (the caller
   should not also fall back to tryRestoreLastChatOnBoot/a fresh chat). */
async function tryRestoreWorkspaceOnBoot() {
  let state;
  try {
    const raw = _bootWorkspaceSnapshotRaw;
    if (!raw) return false;
    state = JSON.parse(raw);
  } catch (e) {
    return false;
  }
  if (!state || !Array.isArray(state.tabs) || state.tabs.length === 0) return false;

  if (typeof state.cwd === "string" && state.cwd) setCwd(state.cwd);

  const createdIds = [];
  for (const tab of state.tabs) {
    if (!tab || typeof tab !== "object" || typeof tab.cwd !== "string" || !tab.cwd) continue;
    if (tab.kind === "terminal") {
      const view = await createTerminalView({ cwd: tab.cwd });
      if (view) createdIds.push(view.id);
    } else if (tab.kind === "chat") {
      const view = createChatView({ cwd: tab.cwd, resume: tab.sessionId || null });
      if (tab.attachId) {
        view.attachId = tab.attachId;
        persistChatAttachRecord(view); // re-key immediately under the new view id
      }
      createdIds.push(view.id);
      // Same ordering rationale as tryRestoreLastChatOnBoot below: load the
      // on-disk transcript first, then probe `attach` (falls back to a
      // normal `--resume` start on attach_failed). The uuid dedup in
      // loadTranscript/handleCliEvent means this order can never double-render
      // even if the attach replay also contains already-persisted history.
      (async () => {
        if (tab.sessionId) await view.loadTranscript();
        view.ensureConnected();
      })();
    }
  }
  if (createdIds.length === 0) return false;

  const activeId = (typeof state.activeIndex === "number" && createdIds[state.activeIndex]) || createdIds[createdIds.length - 1];
  activateView(activeId); // also re-persists workspace state, keyed under the new ids
  return true;
}

/* Phase 5a (bottom-nav "チャット" continuity): where to look for "the
   session the user was last using" when no chat tab is currently open. Tries
   the live workspace snapshot's most recent chat tab first, then the older
   single-pointer mechanism. Both are cleared on an *explicit* tab close (see
   ChatTab.dispose/clearChatAttachRecord) — "an explicitly closed tab is not
   resumable" is an intentional Phase 4 invariant this task must not break —
   so in that common case neither will have anything, and the caller falls
   back further to on-disk session history (see openLastChatOrPicker). */
function readLastChatPointer() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (raw) {
      const state = JSON.parse(raw);
      if (state && Array.isArray(state.tabs)) {
        for (let i = state.tabs.length - 1; i >= 0; i--) {
          const t = state.tabs[i];
          if (t && t.kind === "chat" && typeof t.cwd === "string" && t.cwd) return t;
        }
      }
    }
  } catch (e) { /* ignore */ }
  try {
    const pointerId = localStorage.getItem(LAST_CHAT_ATTACH_KEY);
    if (pointerId) {
      const raw = localStorage.getItem(chatAttachStorageKey(pointerId));
      if (raw) {
        const record = JSON.parse(raw);
        if (record && typeof record.cwd === "string" && record.cwd) return record;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* Called once at boot, before falling back to a brand-new chat. Returns true
   if a restore was attempted (the caller should not also open a fresh chat). */
function tryRestoreLastChatOnBoot() {
  let pointerId, record;
  try {
    pointerId = localStorage.getItem(LAST_CHAT_ATTACH_KEY);
    if (!pointerId) return false;
    const raw = localStorage.getItem(chatAttachStorageKey(pointerId));
    if (!raw) return false;
    record = JSON.parse(raw);
    localStorage.removeItem(chatAttachStorageKey(pointerId));
    localStorage.removeItem(LAST_CHAT_ATTACH_KEY);
  } catch (e) {
    return false;
  }
  if (!record || !record.attachId) return false;
  const view = createChatView({ cwd: record.cwd || App.cwd, resume: record.sessionId || null });
  view.attachId = record.attachId;
  persistChatAttachRecord(view); // re-key immediately under the new view id
  // Load the on-disk transcript first (the common case: nothing was
  // in-flight across the reload, so this is the *only* thing that puts
  // prior history on screen — the attach buffer only ever contains events
  // from *during* the detach window, not a full history reconstruction).
  // Events present in BOTH (a turn that completed while detached is on disk
  // AND in the replay buffer) are skipped at replay time by uuid — see the
  // _renderedUuids dedup in loadTranscript/handleCliEvent — so this ordering
  // cannot double-render.
  (async () => {
    if (record.sessionId) await view.loadTranscript();
    view.ensureConnected(); // probes `attach`; falls back to normal resume start on attach_failed
  })();
  return true;
}

class ChatTab {
  constructor(id, opts) {
    this.id = id;
    this.kind = "chat";
    this.cwd = opts.cwd || App.cwd;
    this.resumeId = opts.resume || null;
    this.sessionId = opts.resume || null;
    this.title = opts.resume ? "" : "新しいチャット";
    this.streaming = false;
    this.started = false;
    this.ws = null;
    // Phase 4: detach/reattach. attachId identifies the server-side session
    // (independent of the claude session_id) so a dropped WS can rejoin the
    // still-running child instead of losing/killing it.
    this.attachId = null;
    this._autoReconnectTimer = null;
    this._transcriptLoaded = false;
    // Phase 5b: true while this tab is passively tailing the session's JSONL
    // (no `claude` child of its own — see ensureWatching/stopWatching below).
    // Mutually exclusive with `started`/`attachId`: a tab either drives its
    // own child, or watches someone else's, never both at once.
    this.watching = false;
    this._watchRetryTimer = null;
    // uuids of rows already rendered from the REST transcript. An attach
    // replay skips any cli_event whose uuid is in this set — the CLI stamps
    // the same per-event uuid on live stream-json events and on the JSONL
    // transcript rows, so "fetched via REST then replayed from the detach
    // buffer" duplicates are detected exactly (see loadTranscript/handleCliEvent).
    this._renderedUuids = new Set();
    this.slashCommands = [];
    this.toolCards = new Map(); // tool_use_id -> card element
    this.streamState = null; // { wrapperEl, blocks: Map(index -> {type, el, ...}) }
    this.firstUserTextSet = !!opts.resume;
    this.autoScroll = true;
    this.pendingPermCount = 0;
    this._rafId = null; // batched streaming-render frame
    // Generating-status-line state.
    this.statusEl = null;
    this._statusTimers = [];

    // Phase 1: status cluster + quick-action sheet state.
    // Model/permission-mode selection lives here (single source of truth): the pills +
    // quick-action sheet are the only UI to change them (the old composer dropdowns
    // were removed). Initial model: last explicitly chosen (localStorage), else fable;
    // "" = follow CLI default is a valid remembered choice.
    let initialModel = null;
    try { initialModel = localStorage.getItem(MODEL_KEY); } catch (e) { /* ignore */ }
    this.model = initialModel === null ? DEFAULT_MODEL_CHOICE : initialModel;
    this.permissionMode = ""; // "" = CLI default; per-tab, not persisted (matches old dropdown)
    this.effort = "";
    try { this.effort = localStorage.getItem(EFFORT_KEY) || ""; } catch (e) { /* ignore */ }
    this._activeModel = null; // set after a successful mid-session set_model
    this._activePermissionMode = null; // set after a successful mid-session set_permission_mode
    this._cliContextPercent = null; // set from get_context_usage; null → fall back to local estimate
    this._pendingControl = new Map(); // requestId -> {resolve, reject, timer}
    this._qaOpen = false;

    this.buildDom();
  }

  buildDom() {
    /* header */
    this.titleEl = h("span", { class: "view-title" }, this.title || "チャット");
    this.sessionIdEl = h("span", { class: "view-session mono" }, this.sessionId || "");
    this.header = h(
      "div", { class: "view-header" },
      this.titleEl,
      h("span", { class: "view-cwd mono" }, this.cwd),
      this.sessionIdEl
    );

    /* messages */
    this.messagesEl = h("div", { class: "chat-column" });
    this.scrollEl = h("div", { class: "chat-scroll", onscroll: () => this.onScroll() }, this.messagesEl);

    /* greeting (fresh state only; resumed chats never get the node) */
    this.greetingEl = this.resumeId ? null : h("div", { class: "greeting" }, "今日は何をお手伝いしましょうか？");

    /* composer */
    this.textarea = h("textarea", {
      placeholder: "Claude にメッセージを送る…",
      rows: "1",
      onkeydown: (e) => this.onKeydown(e),
      oninput: () => this.onInput(),
    });

    this.sendBtn = h("button", { class: "send-btn", "aria-label": "送信", title: "送信 (Enter)", onclick: () => this.onSendOrInterrupt() }, svgIcon("arrowUp"));

    // Shown only while generating, next to the stop button.
    this.escHint = h("span", { class: "esc-hint" }, "esc to interrupt");
    this.escHint.style.display = "none";

    this.slashPopup = h("div", { class: "slash-popup" });

    this.scrollBtn = h(
      "button", { class: "scroll-latest", onclick: () => { this.autoScroll = true; this.scrollToBottom(true); this.updateScrollBtn(); } },
      svgIcon("arrowDown"), "最新へ"
    );
    this.scrollBtn.style.display = "none";

    this.composer = h(
      "div", { class: "composer" },
      this.textarea,
      h(
        "div", { class: "composer-toolbar" },
        h("span", { class: "toolbar-spacer" }),
        this.escHint,
        this.sendBtn
      )
    );

    // Phase 1 status cluster: circular context gauge + permission-mode pill + model pill,
    // replacing the old plain-text footer. Sits directly above the composer, shared by
    // mobile and desktop; the generating status line (spinner/verb) lives in the message
    // column instead, so the two never overlap.
    this.gaugeBtn = h(
      "button", { class: "cc-gauge-btn", type: "button", "aria-label": "コンテキスト残り 100% / クイックアクション", onclick: () => this.openActionSheet(null) },
      this.buildGauge()
    );
    this.gaugeValueEl = this.gaugeBtn.querySelector(".cc-gauge-value");
    this.gaugeNumEl = this.gaugeBtn.querySelector(".cc-gauge-num");
    this.permPillEl = h("button", { class: "cc-pill cc-pill-mode", type: "button", onclick: () => this.openActionSheet("permission") });
    this.modelPillEl = h("button", { class: "cc-pill cc-pill-model", type: "button", onclick: () => this.openActionSheet("model") });
    this.qaTrigger = h("button", { class: "qa-trigger", type: "button", title: "クイックアクション", "aria-label": "クイックアクション", onclick: () => this.openActionSheet(null) }, iconSpan("bolt"));
    this.composerFooter = h(
      "div", { class: "composer-footer cc-cluster" },
      this.gaugeBtn, this.permPillEl, this.modelPillEl,
      h("span", { class: "footer-spacer" }),
      this.qaTrigger
    );

    this.buildActionSheet();

    this.composerWrap = h(
      "div", { class: "composer-wrap" },
      this.scrollBtn, this.slashPopup, this.composer, this.composerFooter,
      this.qaBackdrop, this.qaSheet
    );
    this._lastUsageTokens = 0;
    this.updateStatusCluster();

    /* disconnect line (U6): quiet system line with reconnect action */
    this.disconnectBanner = h("div", { class: "system-line reconnect-line" });
    this.disconnectBanner.style.display = "none";

    /* Phase 5b: "閲覧モード" notice while this tab only watches (no child of
       its own). Informational only — sending a message still works (see
       sendUserMessage/stopWatching), so this never disables the composer. */
    this.watchBanner = h("div", { class: "system-line watch-line" });
    this.watchBanner.style.display = "none";

    const fresh = !this.resumeId;
    this.panelEl = h(
      "div", { class: "view chat-view" + (fresh ? " fresh" : "") },
      this.header,
      h("div", { class: "v-spacer top" }),
      this.greetingEl,
      this.scrollEl,
      this.disconnectBanner,
      this.watchBanner,
      this.composerWrap,
      h("div", { class: "v-spacer bottom" })
    );
  }

  onActivate() {
    this.textarea.focus();
  }

  setFresh(v) {
    this.panelEl.classList.toggle("fresh", v);
    if (!v && this.greetingEl) {
      // Remove the greeting entirely (a11y): let the dock transition play, then drop the node.
      const g = this.greetingEl;
      this.greetingEl = null;
      g.setAttribute("aria-hidden", "true");
      setTimeout(() => g.remove(), 400);
    }
  }

  updateTitle(text) {
    this.title = text;
    this.titleEl.textContent = text || "チャット";
    renderChatList();
  }

  /* ---- model / permission-mode selection (pills + quick-action sheet) ---- */

  /* Remember the explicit choice ("" = follow CLI default is a valid choice). */
  persistModelChoice() {
    try { localStorage.setItem(MODEL_KEY, this.model); } catch (e) { /* ignore */ }
  }

  /* Model string sent to `start` ("" = let the CLI pick its default). */
  selectedModel() {
    return (this.model || "").trim();
  }

  /* Post-start set_model overrides the start-time model for display purposes. */
  currentModel() {
    return this._activeModel || this.selectedModel();
  }

  /* Post-start set_permission_mode overrides the start-time mode for display. */
  currentPermissionMode() {
    if (this._activePermissionMode != null) return this._activePermissionMode;
    return this.permissionMode || "";
  }

  noteUsage(usage) {
    const total = sumUsage(usage);
    if (total > 0) {
      this._lastUsageTokens = total;
      this.updateStatusCluster();
    }
  }

  /* ---- status cluster: circular context gauge + permission/model pills (Phase 1) ---- */

  buildGauge() {
    const wrap = document.createElement("span");
    wrap.className = "cc-gauge";
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.setAttribute("aria-hidden", "true");
    for (const className of ["cc-gauge-track", "cc-gauge-value"]) {
      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("class", className);
      circle.setAttribute("cx", "18");
      circle.setAttribute("cy", "18");
      circle.setAttribute("r", "15.5");
      svg.appendChild(circle);
    }
    wrap.append(svg, h("span", { class: "cc-gauge-num" }));
    return wrap;
  }

  renderGauge(pct) {
    const r = 15.5;
    const c = 2 * Math.PI * r;
    const dash = Math.max(0, Math.min(c, (pct / 100) * c));
    if (this.gaugeValueEl) this.gaugeValueEl.setAttribute("stroke-dasharray", dash.toFixed(2) + " " + c.toFixed(2));
    if (this.gaugeNumEl) this.gaugeNumEl.textContent = String(pct);
    if (this.gaugeBtn) {
      this.gaugeBtn.classList.remove("warn", "err");
      if (pct < 10) this.gaugeBtn.classList.add("err");
      else if (pct < 30) this.gaugeBtn.classList.add("warn");
      this.gaugeBtn.title = "コンテキスト残り " + pct + "% ・ タップでクイックアクション";
      this.gaugeBtn.setAttribute("aria-label", "コンテキスト残り " + pct + "% / クイックアクション");
    }
  }

  updateStatusCluster() {
    // Permission-mode pill (always shown; "既定" for the default mode).
    const mode = this.currentPermissionMode();
    if (this.permPillEl) {
      this.permPillEl.textContent = permissionPillLabel(mode);
      const label = permissionModeLabel(mode);
      this.permPillEl.title = "権限モード: " + (label ? label.text : "既定") + " ・ タップで変更";
      this.permPillEl.classList.toggle("err", mode === "bypassPermissions");
    }

    // Model pill.
    const model = this.currentModel();
    if (this.modelPillEl) {
      this.modelPillEl.textContent = model || "既定";
      this.modelPillEl.title = "モデル: " + (model || "既定") + " ・ タップで変更";
    }

    // Circular context gauge: prefer the CLI's own get_context_usage percentage
    // (see refreshContextUsage); fall back to the same "until auto-compact" formula
    // the old text footer used, driven by the locally-summed usage tokens.
    let pct;
    if (this._cliContextPercent != null) {
      pct = this._cliContextPercent;
    } else if (this._lastUsageTokens > 0) {
      const ctx = contextWindowFor(this.currentModel());
      const threshold = ctx - Math.min(maxOutputFor(this.currentModel()), 20000) - 13000;
      pct = Math.max(0, Math.min(100, Math.round((threshold - this._lastUsageTokens) / threshold * 100)));
    } else {
      pct = 100;
    }
    this.renderGauge(pct);
  }

  /* ---- generic control_request relay (Phase 1: set_model / effort / permission / usage) ---- */

  /** Send {type:"control", subtype, requestId, payload} and resolve with the CLI's
   *  control_response.response once it arrives (matched by request_id). Rejects on
   *  disconnect, CLI-side error, or timeout. */
  sendControl(subtype, payload) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("セッションが接続されていません"));
        return;
      }
      const requestId = uid();
      const timer = setTimeout(() => {
        if (this._pendingControl.has(requestId)) {
          this._pendingControl.delete(requestId);
          reject(new Error(subtype + " がタイムアウトしました"));
        }
      }, 10000);
      this._pendingControl.set(requestId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: "control", subtype, requestId, payload: payload || {} }));
    });
  }

  /** Handle a control_response cli_event (subtype "success"|"error") by resolving/rejecting
   *  the matching sendControl() promise. Unknown/foreign request_ids are ignored. */
  handleControlResponse(event) {
    const r = event && event.response;
    if (!r || !r.request_id) return;
    const pending = this._pendingControl.get(r.request_id);
    if (!pending) return;
    this._pendingControl.delete(r.request_id);
    clearTimeout(pending.timer);
    if (r.subtype === "success") pending.resolve(r.response);
    else pending.reject(new Error(r.error || "control request に失敗しました"));
  }

  /** Ask the CLI for its own context-usage accounting; on success this takes over the
   *  gauge from the local estimate (see updateStatusCluster). Silently falls back on
   *  any failure (older CLI, not-yet-started session, timeout, ...). */
  refreshContextUsage() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.started) return;
    this.sendControl("get_context_usage", {})
      .then((resp) => {
        if (!resp || typeof resp.autoCompactThreshold !== "number" || typeof resp.totalTokens !== "number") return;
        const threshold = resp.autoCompactThreshold;
        if (!(threshold > 0)) return;
        const pct = Math.max(0, Math.min(100, Math.round((threshold - resp.totalTokens) / threshold * 100)));
        this._cliContextPercent = pct;
        this.updateStatusCluster();
      })
      .catch(() => { /* keep whatever the local fallback currently shows */ });
  }

  /* ---- quick-action sheet actions: model / effort / permission mode / compact ---- */

  applyModel(model) {
    model = (model || "").trim();
    if (!this.started) {
      this.model = model;
      this.persistModelChoice();
      this.updateStatusCluster();
      this.renderActionSheetContent();
      return;
    }
    if (!model) return;
    this.sendControl("set_model", { model })
      .then(() => {
        this._activeModel = model;
        this.model = model; // a post-disconnect restart should start on the new model
        this.persistModelChoice();
        this.updateStatusCluster();
        this.renderActionSheetContent();
        toast("モデルを切り替えました: " + model);
      })
      .catch((e) => toast("モデル切替に失敗しました: " + e.message));
  }

  applyEffort(level) {
    const prev = this.effort;
    this.effort = level;
    try { localStorage.setItem(EFFORT_KEY, level); } catch (e) { /* ignore */ }
    if (!this.started) {
      this.renderActionSheetContent();
      return;
    }
    this.sendControl("apply_flag_settings", { settings: { effortLevel: level } })
      .then(() => { this.renderActionSheetContent(); })
      .catch((e) => {
        this.effort = prev;
        try { localStorage.setItem(EFFORT_KEY, prev); } catch (e2) { /* ignore */ }
        this.renderActionSheetContent();
        toast("effort 変更に失敗しました: " + e.message);
      });
  }

  applyPermissionMode(mode) {
    if (!this.started) {
      this.permissionMode = mode;
      this.updateStatusCluster();
      this.renderActionSheetContent();
      return;
    }
    this.sendControl("set_permission_mode", { mode })
      .then(() => {
        this._activePermissionMode = mode;
        this.permissionMode = mode; // a post-disconnect restart should start in the new mode
        this.updateStatusCluster();
        this.renderActionSheetContent();
      })
      .catch((e) => toast("権限モードの変更に失敗しました: " + e.message));
  }

  runCompact() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.started) {
      toast("セッションが開始されていません。");
      return;
    }
    this.closeActionSheet();
    this.sendUserMessage("/compact");
  }

  /* ---- quick-action sheet: push notification toggle (Phase 3) ---- */

  buildPushSection() {
    const title = h("div", { class: "qa-section-title" }, "プッシュ通知");

    if (!Push.checked) {
      return h(
        "div", { class: "qa-section", "data-qa-section": "push" },
        title,
        h("div", { class: "qa-hint" }, "確認中…")
      );
    }

    if (!Push.supported) {
      return h(
        "div", { class: "qa-section", "data-qa-section": "push" },
        title,
        h(
          "div", { class: "qa-toggle-row qa-toggle-disabled" },
          h("span", null, "応答完了・権限確認・切断を通知"),
          h("span", { class: "qa-switch disabled" })
        ),
        h("div", { class: "qa-hint" }, Push.reason)
      );
    }

    const row = h(
      "div", { class: "qa-toggle-row", onclick: () => this.togglePush() },
      h("span", null, "応答完了・権限確認・切断を通知"),
      h("span", { class: "qa-switch" + (Push.subscribed ? " on" : "") })
    );
    return h("div", { class: "qa-section", "data-qa-section": "push" }, title, row);
  }

  togglePush() {
    if (!Push.supported) return;
    const goingOn = !Push.subscribed;
    const op = goingOn ? Push.enable() : Push.disable();
    op.then(() => {
      this.renderActionSheetContent();
      toast(goingOn ? "プッシュ通知を有効にしました" : "プッシュ通知を無効にしました");
    }).catch((e) => {
      this.renderActionSheetContent();
      toast("プッシュ通知の設定に失敗しました: " + e.message);
    });
  }

  startNewSession() {
    this.closeActionSheet();
    // Phase 2: route through the pinned/recent/browse cwd picker instead of
    // silently reusing this.cwd — this is the "start something new" action.
    openNewSessionCwdPicker("chat");
  }

  /* ---- quick-action sheet: DOM + open/close (Phase 1) ---- */

  buildActionSheet() {
    this.qaBackdrop = h("div", { class: "qa-backdrop", onclick: () => this.closeActionSheet() });
    this.qaGrabber = h("div", { class: "qa-grabber" });
    this.qaBody = h("div", { class: "qa-body" });
    this.qaSheet = h(
      "div", { class: "qa-sheet", role: "dialog", "aria-modal": "true", "aria-label": "クイックアクション" },
      this.qaGrabber,
      this.qaBody
    );

    // Swipe-down-to-close (mobile bottom sheet only; harmless no-op on desktop popover).
    let startY = null;
    let deltaY = 0;
    this.qaGrabber.addEventListener("touchstart", (e) => {
      startY = e.touches[0].clientY;
      deltaY = 0;
      this.qaSheet.style.transition = "none";
    }, { passive: true });
    this.qaGrabber.addEventListener("touchmove", (e) => {
      if (startY == null) return;
      deltaY = Math.max(0, e.touches[0].clientY - startY);
      this.qaSheet.style.transform = "translateY(" + deltaY + "px)";
    }, { passive: true });
    this.qaGrabber.addEventListener("touchend", () => {
      this.qaSheet.style.transition = "";
      if (deltaY > 80) this.closeActionSheet();
      else this.qaSheet.style.transform = "";
      startY = null;
      deltaY = 0;
    });
  }

  renderActionSheetContent(focusSection) {
    clear(this.qaBody);

    const models = (App.info.models && App.info.models.length) ? App.info.models : DEFAULT_MODELS;
    const curModel = this.currentModel();
    // "既定" (follow CLI default) only makes sense before a session has started —
    // once running, set_model needs a concrete model string.
    const modelOptions = this.started ? models : ["", ...models];
    const modelBtns = modelOptions.map((m) => h(
      "button",
      { class: "qa-option" + (m === curModel ? " selected" : ""), type: "button", onclick: () => this.applyModel(m) },
      m === "" ? "既定" : m
    ));
    const customInput = h("input", { type: "text", class: "qa-custom-input", placeholder: "カスタムモデル名", value: models.includes(curModel) ? "" : (curModel || "") });
    const customApply = () => { if (customInput.value.trim()) this.applyModel(customInput.value); };
    customInput.addEventListener("keydown", (e) => { if (e.key === "Enter") customApply(); });
    const modelSection = h(
      "div", { class: "qa-section", "data-qa-section": "model" },
      h("div", { class: "qa-section-title" }, "モデル"),
      h("div", { class: "qa-options" }, ...modelBtns),
      h("div", { class: "qa-custom-row" }, customInput, h("button", { class: "btn-ghost", type: "button", onclick: customApply }, "適用"))
    );

    const effortBtns = EFFORT_LEVELS.map((lvl) => h(
      "button",
      { class: "qa-option" + (lvl === this.effort ? " selected" : ""), type: "button", onclick: () => this.applyEffort(lvl) },
      lvl
    ));
    const effortSection = h(
      "div", { class: "qa-section", "data-qa-section": "effort" },
      h("div", { class: "qa-section-title" }, "Effort"),
      h("div", { class: "qa-options" }, ...effortBtns)
    );

    const modes = (App.info.permissionModes && App.info.permissionModes.length) ? App.info.permissionModes : DEFAULT_PERMISSION_MODES;
    const curMode = this.currentPermissionMode();
    const permBtns = modes.map((m) => {
      const val = m === "default" ? "" : m;
      return h(
        "button",
        { class: "qa-option" + (val === curMode ? " selected" : ""), type: "button", onclick: () => this.applyPermissionMode(val) },
        permissionPillLabel(val)
      );
    });
    const permSection = h(
      "div", { class: "qa-section", "data-qa-section": "permission" },
      h("div", { class: "qa-section-title" }, "権限モード"),
      h("div", { class: "qa-options" }, ...permBtns)
    );

    const actionsSection = h(
      "div", { class: "qa-section", "data-qa-section": "actions" },
      h("div", { class: "qa-section-title" }, "アクション"),
      h(
        "div", { class: "qa-options" },
        h("button", { class: "btn-ghost", type: "button", onclick: () => this.runCompact() }, "/compact 実行"),
        h("button", { class: "btn-ghost", type: "button", onclick: () => this.startNewSession() }, "新規セッション")
      )
    );

    const pushSection = this.buildPushSection();

    this.qaBody.appendChild(modelSection);
    this.qaBody.appendChild(effortSection);
    this.qaBody.appendChild(permSection);
    this.qaBody.appendChild(pushSection);
    this.qaBody.appendChild(actionsSection);

    if (focusSection) {
      setTimeout(() => {
        const el = this.qaBody.querySelector('[data-qa-section="' + focusSection + '"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
      }, 20);
    }
  }

  openActionSheet(section) {
    this._qaOpen = true;
    this.renderActionSheetContent(section);
    this.qaBackdrop.style.display = "";
    this.qaBackdrop.classList.add("open");
    this.qaSheet.classList.add("open");
    this.qaSheet.style.transform = "";

    if (!isMobile()) {
      // Desktop: anchor as a popover near the trigger that opened it.
      const anchor = this.qaTrigger || this.gaugeBtn;
      const rect = anchor.getBoundingClientRect();
      this.qaSheet.style.position = "fixed";
      this.qaSheet.style.left = Math.max(8, rect.right - 320) + "px";
      this.qaSheet.style.bottom = Math.max(8, window.innerHeight - rect.top + 8) + "px";
      this.qaSheet.style.top = "auto";
    } else {
      this.qaSheet.style.position = "";
      this.qaSheet.style.left = "";
      this.qaSheet.style.bottom = "";
      this.qaSheet.style.top = "";
    }

    updateBottomNavActiveState();
    this.refreshContextUsage();
  }

  closeActionSheet() {
    this._qaOpen = false;
    this.qaSheet.classList.remove("open");
    this.qaBackdrop.classList.remove("open");
    this.qaSheet.style.transform = "";
    setTimeout(() => { if (!this._qaOpen) this.qaBackdrop.style.display = "none"; }, 200);
    updateBottomNavActiveState();
  }

  /* ---- transcript (resume) ---- */

  async loadTranscript() {
    if (!this.resumeId) return;
    // Phase 4: idempotence guard so the attach_failed fallback can call this
    // unconditionally without re-rendering an already-loaded transcript.
    if (this._transcriptLoaded) return;
    this._transcriptLoaded = true;
    try {
      const events = await apiJson(`/api/sessions/${encodeURIComponent(this.resumeId)}/transcript?cwd=${encodeURIComponent(this.cwd)}`);
      if (Array.isArray(events)) {
        events.forEach((ev) => {
          // Record every row's uuid (even rows that render nothing, e.g.
          // tool_result echoes) so an attach replay of the same events is a
          // no-op rather than a duplicate render.
          if (ev && typeof ev.uuid === "string" && ev.uuid) this._renderedUuids.add(ev.uuid);
          try { this.renderTranscriptEvent(ev); } catch (e) { console.warn("transcript event failed", e); }
        });
      }
      const firstUserMsg = this.messagesEl.querySelector(".msg-user .msg-body");
      this.updateTitle(firstUserMsg ? truncate(firstUserMsg.textContent, 40) : "チャット");
      this.scrollToBottom(true);
    } catch (e) {
      toast("履歴の読み込みに失敗しました: " + e.message);
    }
  }

  /**
   * Render one simplified transcript event from /api/sessions/:id/transcript.
   * Shape (observed): { type: "user"|"assistant", timestamp, text: string|null, toolUses?: [{name, input}] }
   * Rows with no text and no toolUses (e.g. tool_result echo rows) render nothing.
   */
  renderTranscriptEvent(ev) {
    if (!ev || typeof ev !== "object") return;
    const hasText = typeof ev.text === "string" && ev.text.trim().length > 0;
    if (ev.type === "user") {
      if (hasText) this.renderUserMessage(ev.text);
      return;
    }
    if (ev.type === "assistant") {
      const toolUses = Array.isArray(ev.toolUses) ? ev.toolUses : [];
      if (!hasText && toolUses.length === 0) return;
      const wrapper = this.startAssistantWrapper();
      if (hasText) {
        this.renderContentBlock(wrapper.bodyEl, { type: "text", text: ev.text });
      }
      toolUses.forEach((tu) => {
        if (!tu || typeof tu !== "object") return;
        this.renderContentBlock(wrapper.bodyEl, { type: "tool_use", name: tu.name, input: tu.input });
      });
    }
    // unknown types: render nothing, never throw
  }

  /* ---- input handling ---- */

  onInput() {
    const v = this.textarea.value;
    this.textarea.style.height = "auto";
    this.textarea.style.height = Math.min(220, this.textarea.scrollHeight) + "px";

    const m = /^\/(\S*)$/.exec(v);
    if (m && this.slashCommands.length) {
      this.showSlashPopup(m[1]);
    } else {
      this.hideSlashPopup();
    }
  }

  showSlashPopup(prefix) {
    const matches = this.slashCommands.filter((c) => c.name.startsWith(prefix)).slice(0, 20);
    clear(this.slashPopup);
    if (!matches.length) { this.hideSlashPopup(); return; }
    matches.forEach((c, i) => {
      const item = h(
        "div", { class: "slash-item" + (i === 0 ? " sel" : ""), onclick: () => this.applySlash(c.name) },
        "/" + c.name,
        c.description ? h("span", { class: "sc-desc" }, c.description) : null
      );
      this.slashPopup.appendChild(item);
    });
    this.slashPopup.classList.add("open");
    this.updateScrollBtn();
  }

  hideSlashPopup() {
    this.slashPopup.classList.remove("open");
    clear(this.slashPopup);
    this.updateScrollBtn();
  }

  applySlash(name) {
    this.textarea.value = "/" + name + " ";
    this.hideSlashPopup();
    this.textarea.focus();
  }

  onKeydown(e) {
    if (this.slashPopup.classList.contains("open")) {
      const items = Array.from(this.slashPopup.querySelectorAll(".slash-item"));
      let idx = items.findIndex((it) => it.classList.contains("sel"));
      if (e.key === "ArrowDown") { e.preventDefault(); if (idx < items.length - 1) { items[idx]?.classList.remove("sel"); items[idx + 1].classList.add("sel"); } return; }
      if (e.key === "ArrowUp") { e.preventDefault(); if (idx > 0) { items[idx]?.classList.remove("sel"); items[idx - 1].classList.add("sel"); } return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        const sel = items[idx] || items[0];
        if (sel) { e.preventDefault(); sel.click(); return; }
      }
      if (e.key === "Escape") { this.hideSlashPopup(); return; }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.onSendOrInterrupt();
    } else if (e.key === "Escape") {
      // F3: handle here and stop the document-level Escape from firing a second interrupt.
      e.stopPropagation();
      if (this.streaming) { e.preventDefault(); this.sendInterrupt(); }
    }
  }

  onSendOrInterrupt() {
    if (this.streaming) { this.sendInterrupt(); return; }
    const text = this.textarea.value.trim();
    if (!text) return;
    this.textarea.value = "";
    this.textarea.style.height = "auto";
    this.hideSlashPopup();
    this.sendUserMessage(text);
  }

  /* ---- ws lifecycle ---- */

  ensureConnected() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.ws = openAuthenticatedWebSocket("/ws/chat");
    this.ws.addEventListener("open", () => this.onWsOpen());
    this.ws.addEventListener("message", (ev) => this.onWsMessage(ev));
    this.ws.addEventListener("close", () => this.onWsClose());
    this.ws.addEventListener("error", () => {});
  }

  /* ---- Phase 5b: passive JSONL tail ("watch") ----
     Used only for a tab that resumed a session's history without starting or
     attaching its own `claude` child (the common case for tapping a sidebar
     history/"最近のセッション" row) — instead of showing a static transcript
     forever, it opens its own ws and asks the server to tail the file, so
     progress made elsewhere (a GUI terminal `--resume`, or another chat tab)
     still renders live. Reuses the exact same cli_event dispatch/uuid-dedup
     path as a live connection (see onWsMessage's "transcript_append" case). */
  ensureWatching() {
    if (this.started || this.attachId) return; // this tab (will) have its own live child — no need to watch
    if (!this.resumeId) return; // nothing on disk to tail yet
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.watching = true;
    const ws = openAuthenticatedWebSocket("/ws/chat");
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws !== ws) return; // superseded before the socket finished opening
      ws.send(JSON.stringify({ type: "watch", sessionId: this.resumeId, cwd: this.cwd }));
    });
    ws.addEventListener("message", (ev) => this.onWsMessage(ev));
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return; // already superseded (e.g. stopWatching() ran first)
      this.watching = false;
      this.ws = null;
      this.hideWatchBanner();
      // Transient (server restart, brief network blip) — retry quietly rather
      // than surfacing a disconnect banner for what is, from this tab's point
      // of view, just "not currently watching".
      clearTimeout(this._watchRetryTimer);
      if (!this._disposing && this.resumeId && !this.started && !this.attachId) {
        this._watchRetryTimer = setTimeout(() => this.ensureWatching(), 3000);
      }
    });
    ws.addEventListener("error", () => {});
  }

  /* Tears down the watch-only ws so the tab can become a real (start/attach)
     connection instead — called right before sending a message from a
     watch-only tab (see sendUserMessage): "送信すると新しい子プロセスで
     --resume を張る" per .ai/current-task.md's documented existing behavior. */
  stopWatching() {
    if (!this.watching) return;
    this.watching = false;
    clearTimeout(this._watchRetryTimer);
    this.hideWatchBanner();
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
      this.ws = null;
    }
  }

  showWatchBanner() {
    this.watchBanner.style.display = "flex";
    clear(this.watchBanner);
    this.watchBanner.appendChild(h("span", null, "このセッションは他の場所で実行中です（閲覧モード）"));
  }

  hideWatchBanner() {
    this.watchBanner.style.display = "none";
    clear(this.watchBanner);
  }

  onWsOpen() {
    this.disconnectBanner.style.display = "none";
    this.panelEl.classList.remove("conn-lost");
    clearTimeout(this._autoReconnectTimer);
    // Phase 4: if we hold an attachId from a previous connection on this same
    // session, try to rejoin the (possibly still-generating) server-side
    // session before ever falling back to a fresh `start`.
    if (this.attachId && !this.started) {
      this.ws.send(JSON.stringify({ type: "attach", attachId: this.attachId }));
      this.started = true;
      return;
    }
    if (!this.started) {
      // Fresh CLI process: any mid-session set_model/set_permission_mode/get_context_usage
      // overrides from a previous connection no longer apply.
      this._activeModel = null;
      this._activePermissionMode = null;
      this._cliContextPercent = null;
      const startMsg = { type: "start", cwd: this.cwd };
      const model = this.selectedModel();
      const permissionMode = (this.permissionMode || "").trim();
      if (model) startMsg.model = model;
      if (permissionMode) startMsg.permissionMode = permissionMode;
      if (this.effort) startMsg.effort = this.effort;
      if (this.resumeId) startMsg.resume = this.resumeId;
      this.ws.send(JSON.stringify(startMsg));
      this.started = true;
      this.updateStatusCluster();
    }
    if (this._pendingText != null) {
      this.ws.send(JSON.stringify({ type: "user_message", text: this._pendingText }));
      this._pendingText = null;
    }
  }

  sendUserMessage(text) {
    this.renderUserMessage(text);
    this.setStreaming(true);
    this.startStatus();
    // Phase 5b: a watch-only tab has no child to send to (the server ignores
    // client messages on a watch connection) — tear it down first so the
    // fallthrough below opens a real start/attach connection instead.
    if (this.watching) this.stopWatching();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this._pendingText = text;
      this.ensureConnected();
      return;
    }
    this.ws.send(JSON.stringify({ type: "user_message", text }));
  }

  sendInterrupt() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
    // F5: optimistically restore the send button so the user can type/send again;
    // a following result/exit event is idempotent with this.
    this.setStreaming(false);
    clearTimeout(this._interruptFallback);
  }

  onWsClose() {
    // F1: reset so the next (re)connection re-issues `start`/`attach`.
    this.started = false;
    if (this._disposing) return;
    // Phase 4: an attachId means the server-side session may still be
    // generating in the background — never imply the turn was lost, and
    // keep the composer usable-looking rather than dead.
    const canAttach = !!this.attachId;
    if (!canAttach) this.setStreaming(false);
    this.panelEl.classList.add("conn-lost");
    this.disconnectBanner.style.display = "flex";
    clear(this.disconnectBanner);
    this.disconnectBanner.appendChild(
      h("span", null, canAttach ? "切断中（バックグラウンドで実行中の可能性があります）…再接続を試みます" : "サーバーから切断されました。")
    );
    this.disconnectBanner.appendChild(h("button", { onclick: () => { this.started = false; this.ensureConnected(); } }, "再接続"));
    toast(canAttach ? "接続が切れました。再接続を試みます…" : "チャットの接続が切れました。");
    // Auto-retry once, quickly — covers the common "app backgrounded, WS
    // dropped, user comes back" case without requiring the manual button.
    clearTimeout(this._autoReconnectTimer);
    this._autoReconnectTimer = setTimeout(() => {
      if (!this._disposing) this.ensureConnected();
    }, 800);
  }

  onWsMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || typeof msg.type !== "string") return;
    try {
      switch (msg.type) {
        case "cli_event": this.handleCliEvent(msg.event); break;
        case "permission_request": this.handlePermissionRequest(msg); break;
        case "session_started":
          this.sessionId = msg.sessionId;
          this.resumeId = msg.sessionId;
          this.sessionIdEl.textContent = msg.sessionId;
          renderChatList();
          scheduleSessionsReload();
          persistChatAttachRecord(this);
          break;
        case "attached":
          // Phase 4: server-issued session handle — remember it so a later
          // unintended disconnect can rejoin instead of losing the turn.
          this.attachId = msg.attachId;
          persistChatAttachRecord(this);
          break;
        case "attach_failed":
          // Phase 4: the server has no live session for this attachId
          // (TTL-expired, server restarted, etc). If nothing has been
          // rendered yet (e.g. a boot-time restore that skipped the eager
          // REST fetch to avoid double-rendering an eventual replay), load
          // the transcript now — then fall back to the existing --resume
          // flow on a fresh connection.
          if (this.resumeId && !this._transcriptLoaded) this.loadTranscript();
          clearChatAttachRecord(this);
          this.attachId = null;
          this.started = false;
          this.ensureConnected();
          break;
        case "attach_complete":
          // Phase 4: replay finished — this is the server's authoritative
          // word on whether generation is still in flight, so the spinner
          // reflects reality instead of a client-side guess.
          this.panelEl.classList.remove("conn-lost");
          // If the replay put content on screen, leave "fresh" greeting mode
          // (replayed buffers contain no user-message echo, so renderUserMessage
          // — the usual trigger — may never fire on this code path).
          if (this.messagesEl.children.length) this.setFresh(false);
          if (msg.generating) {
            this.setStreaming(true);
            this.startStatus();
          } else {
            this.setStreaming(false);
          }
          break;
        case "exit":
          this.setStreaming(false);
          this.appendSystemLine(`プロセスが終了しました (code ${msg.code})`);
          break;
        case "error":
          this.setStreaming(false);
          this.appendError(msg.message || "不明なエラー");
          break;
        case "watch_started":
          // Phase 5b: server confirmed the tail is active — only now show the
          // "閲覧モード" notice, so a denied/failed watch never claims one.
          if (this.watching) this.showWatchBanner();
          break;
        case "watch_denied":
          // Over the watcher cap, or an invalid (cwd, sessionId) — stay a
          // silent static transcript view rather than surfacing an error for
          // what is, from the user's perspective, just "no live updates".
          this.watching = false;
          this.hideWatchBanner();
          break;
        case "transcript_append":
          // Phase 5b: one appended JSONL row (user/assistant), same shape as
          // a live cli_event — reuse the existing dispatch + uuid dedup as-is.
          this.handleCliEvent(msg.line);
          break;
        default:
          // unknown top-level type: ignore gracefully
          break;
      }
    } catch (e) {
      console.warn("Failed handling ws message", e, msg);
    }
  }

  /* ---- cli_event dispatch ---- */

  handleCliEvent(event) {
    if (!event || typeof event !== "object") return;
    // Phase 4 dedup: skip any event whose uuid was already rendered from the
    // REST transcript (reload restore). The uuid is the CLI's per-event id,
    // identical on the live stream and in the JSONL — an exact-match skip can
    // never suppress a genuinely new event.
    if (typeof event.uuid === "string" && this._renderedUuids.has(event.uuid)) return;
    switch (event.type) {
      case "system":
        this.handleSystemEvent(event);
        break;
      case "assistant":
        this.handleAssistantEvent(event);
        break;
      case "user":
        this.handleUserEvent(event);
        break;
      case "result":
        this.handleResultEvent(event);
        break;
      case "stream_event":
        this.handleStreamEvent(event.event);
        break;
      case "control_response":
        this.handleControlResponse(event);
        break;
      case "control_request":
      case "keep_alive":
      case "rate_limit_event":
        break; // handled elsewhere or informational only
      case "summary":
      case "last-prompt":
        break; // transcript-only bookkeeping types
      default:
        // unknown/future event type — never throw
        break;
    }
  }

  handleSystemEvent(event) {
    if (event.subtype === "init") {
      if (event.session_id && !this.sessionId) {
        this.sessionId = event.session_id;
        this.resumeId = event.session_id;
        this.sessionIdEl.textContent = event.session_id;
        renderChatList();
      }
      if (Array.isArray(event.slash_commands)) {
        this.slashCommands = event.slash_commands.map((c) =>
          typeof c === "string" ? { name: c, description: "" } : { name: c.name || String(c), description: c.description || "" }
        );
      }
    }
  }

  handleAssistantEvent(event) {
    const message = event.message || {};
    const content = Array.isArray(message.content) ? message.content : [];
    // replace any in-progress streaming render for this turn
    const wrapper = this.streamState && this.streamState.wrapperEl ? this.streamState.wrapperEl : this.startAssistantWrapper();
    clear(wrapper.bodyEl);
    content.forEach((block) => this.renderContentBlock(wrapper.bodyEl, block));
    this.streamState = null;
    if (message.usage) this.noteUsage(message.usage);
    this.scrollToBottom();
    if (!this.firstUserTextSet) this.firstUserTextSet = true;
  }

  handleUserEvent(event) {
    const message = event.message || {};
    const content = Array.isArray(message.content) ? message.content : [];
    content.forEach((block) => {
      if (block && block.type === "tool_result") {
        this.attachToolResult(block);
      }
      // plain text blocks here are echoes of what we already rendered locally; skip.
    });
  }

  handleResultEvent(event) {
    this.setStreaming(false);
    if (event.usage) this.noteUsage(event.usage);
    this.refreshContextUsage(); // prefer the CLI's own accounting once a turn completes

    // `✻ Worked for Ns` + optional dim cost/tokens (round 3).
    const verb = TURN_VERBS[Math.floor(Math.random() * TURN_VERBS.length)];
    const secs = Math.max(0, Math.round((event.duration_ms || 0) / 1000));
    const meta = h(
      "div", { class: "cc-turn-meta" },
      h("span", { class: "cc-turn-glyph" }, "✻"),
      ` ${verb} for ${secs}s`
    );
    const extras = [];
    const cost = formatCost(event.total_cost_usd != null ? event.total_cost_usd : event.cost_usd);
    if (cost) extras.push(cost);
    const toks = sumUsage(event.usage);
    if (toks > 0) extras.push(`${formatCompactTokens(toks)} tokens`);
    if (event.is_error) extras.push("error");
    if (extras.length) meta.appendChild(h("span", { class: "cc-turn-extra" }, "  · " + extras.join(" · ")));

    this.messagesEl.appendChild(meta);
    this.scrollToBottom();
    scheduleSessionsReload();
  }

  handleStreamEvent(raw) {
    if (!raw || typeof raw !== "object") return;
    switch (raw.type) {
      case "message_start":
        this.streamState = { wrapperEl: this.startAssistantWrapper(), blocks: new Map() };
        // Status: request accepted, now generating → downstream arrow.
        this._statusArrow = "↓";
        this.renderStatusByline();
        break;
      case "content_block_start": {
        if (!this.streamState) this.streamState = { wrapperEl: this.startAssistantWrapper(), blocks: new Map() };
        const idx = raw.index;
        const block = raw.content_block || {};
        // Status thinking flag: on only while a thinking block is active.
        if (block.type === "thinking") this._statusThinking = true;
        else if (block.type === "text") this._statusThinking = false;
        this.renderStatusByline();
        const el = this.renderContentBlock(this.streamState.wrapperEl.bodyEl, block, true);
        this.streamState.blocks.set(idx, { type: block.type, el, textAccum: block.type === "text" ? "" : undefined, thinkingAccum: block.type === "thinking" ? "" : undefined, jsonAccum: block.type === "tool_use" ? "" : undefined });
        break;
      }
      case "content_block_delta": {
        if (!this.streamState) break;
        const st = this.streamState.blocks.get(raw.index);
        if (!st) break;
        const delta = raw.delta || {};
        if (delta.type === "text_delta" && st.el) {
          st.textAccum = (st.textAccum || "") + (delta.text || "");
          this.bumpEstimatedTokens(delta.text);
          // R1: batch renders per animation frame + freeze confirmed prefix (O(n) overall).
          st.dirty = true;
          this.scheduleStreamRender();
        } else if (delta.type === "thinking_delta" && st.el) {
          st.thinkingAccum = (st.thinkingAccum || "") + (delta.thinking || "");
          this.bumpEstimatedTokens(delta.thinking);
          st.el.textContent = st.thinkingAccum;
          this.scrollToBottom();
        } else if (delta.type === "input_json_delta") {
          // F4: show the tool input as it streams (pretty-print when valid, else raw partial).
          st.jsonAccum = (st.jsonAccum || "") + (delta.partial_json || "");
          if (st.el) {
            let shown = st.jsonAccum;
            try { shown = JSON.stringify(JSON.parse(st.jsonAccum), null, 2); } catch (e) { /* partial json */ }
            st.el.textContent = shown;
          }
        }
        break;
      }
      case "content_block_stop": {
        const st = this.streamState && this.streamState.blocks.get(raw.index);
        if (st && st.type === "thinking") { this._statusThinking = false; this.renderStatusByline(); }
        // R1 step 3: one authoritative full parse of the completed text block (safety net).
        if (st && st.type === "text") this.finalizeStreamingText(st);
        break;
      }
      case "message_delta":
        if (raw.usage && typeof raw.usage.output_tokens === "number") {
          // Snap the live estimate to the authoritative count.
          this._statusTokensOfficial = true;
          this._statusOutputTokens = raw.usage.output_tokens;
          this.renderStatusByline();
        }
        if (raw.usage) this.noteUsage(raw.usage);
        break;
      case "message_stop":
        break;
      default:
        break;
    }
  }

  /* ---- streaming markdown render (rAF batch + frozen-prefix, round 4) ---- */

  scheduleStreamRender() {
    if (this._rafId != null) return;
    const raf = (typeof requestAnimationFrame === "function")
      ? requestAnimationFrame
      : (cb) => setTimeout(() => cb(), 16);
    this._rafId = raf(() => { this._rafId = null; this.flushStreamRender(); });
  }

  flushStreamRender() {
    if (!this.streamState) return;
    let rendered = false;
    for (const st of this.streamState.blocks.values()) {
      if (st.type === "text" && st.dirty) {
        this.renderStreamingText(st);
        st.dirty = false;
        rendered = true;
      }
    }
    if (rendered) this.scrollToBottom();
  }

  /* Freeze confirmed markdown once; only re-parse the unconfirmed tail each frame. */
  renderStreamingText(st) {
    if (!st.el) return;
    const text = st.textAccum || "";
    if (!st.frozenEl) {
      st.frozenEl = h("div", { class: "cc-md-part" });
      st.tailEl = h("div", { class: "cc-md-part" });
      clear(st.el);
      st.el.appendChild(st.frozenEl);
      st.el.appendChild(st.tailEl);
      st.frozenLen = 0;
    }
    const boundary = confirmedMarkdownBoundary(text);
    if (boundary > st.frozenLen) {
      // Parse only the newly-confirmed segment and append; never re-parse frozen content.
      st.frozenEl.appendChild(renderMarkdown(text.slice(st.frozenLen, boundary)));
      st.frozenLen = boundary;
    }
    const tail = text.slice(st.frozenLen);
    clear(st.tailEl);
    if (tail) st.tailEl.appendChild(renderMarkdown(tail));
  }

  /*
   * Complete the streamed block by flushing frozen prefix + tail once (tail-only parse).
   * We do NOT full-parse here: the authoritative `assistant` event re-renders the whole
   * message right after and fixes any freeze-boundary artifact — avoiding a double full
   * parse (the 52ms completion spike). renderStreamingText handles the never-flushed and
   * short-message cases with a single pass of the tail.
   */
  finalizeStreamingText(st) {
    if (!st.el) return;
    st.dirty = false;
    if (this._rafId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.renderStreamingText(st);
  }

  startAssistantWrapper() {
    const bodyEl = h("div", { class: "msg-body" });
    const wrapper = h("div", { class: "msg msg-assistant" }, bodyEl);
    wrapper.bodyEl = bodyEl;
    this.messagesEl.appendChild(wrapper);
    this.scrollToBottom();
    return wrapper;
  }

  renderUserMessage(text) {
    this.setFresh(false);
    const el = h(
      "div", { class: "msg msg-user" },
      h("div", { class: "msg-body" }, text)
    );
    this.messagesEl.appendChild(el);
    if (!this.firstUserTextSet) {
      this.firstUserTextSet = true;
      this.updateTitle(truncate(text, 40));
    }
    this.autoScroll = true;
    this.scrollToBottom(true);
  }

  /** Render a single content block. Returns the element representing the "live" region (for streaming updates). */
  renderContentBlock(container, block, streamingPlaceholder) {
    if (!block || typeof block !== "object") return null;
    if (block.type === "text") {
      // Claude Code: assistant speech is prefixed with a normal-colored ● bullet.
      const content = h("div", { class: "cc-text block-text" });
      if (block.text) content.appendChild(renderMarkdown(block.text));
      const line = h(
        "div", { class: "cc-line" },
        h("span", { class: "cc-bullet text" }, "●"),
        content
      );
      container.appendChild(line);
      return content; // streaming updates re-render only the content div
    }
    if (block.type === "thinking") {
      const body = h("div", { class: "thinking-body" }, block.thinking || "");
      const details = h(
        "details", { class: "block-thinking" },
        h("summary", null, "思考プロセス", h("span", { class: "chevron" }, svgIcon("chevronDown"))),
        body
      );
      container.appendChild(details);
      return body;
    }
    if (block.type === "tool_use") {
      const card = this.renderToolUseCard(block);
      container.appendChild(card);
      if (block.id) this.toolCards.set(block.id, card);
      return card.inputPre;
    }
    // unknown block type — render raw json, never throw
    const pre = h("pre", null, safeJsonStringify(block));
    container.appendChild(pre);
    return pre;
  }

  renderToolUseCard(block) {
    const { name, args } = formatToolCall(block.name, block.input, this.cwd);
    const inputPre = h("pre", null, safeJsonStringify(block.input ?? {}));
    const bullet = h("span", { class: "cc-bullet" }, "●"); // dim while pending

    // Header line: `● ToolName(args)` — clicking the caret reveals the raw input JSON.
    const callEl = args
      ? h("span", { class: "cc-tool-call" },
          h("span", { class: "tool-name" }, name), "(", h("span", { class: "tool-args" }, args), ")")
      : h("span", { class: "cc-tool-call" }, h("span", { class: "tool-name" }, name));

    // R5: diff / TODO render inline by default (not behind the caret).
    let inlineSpecial = null;
    if (name === "Edit" || name === "Write" || name === "MultiEdit") {
      inlineSpecial = h("div", { class: "cc-tool-body" }, buildDiffView(name, block.input));
    } else if (name === "TodoWrite" && block.input && Array.isArray(block.input.todos)) {
      inlineSpecial = h("div", { class: "cc-tool-body" }, buildTodoView(block.input.todos));
    }

    // Only the raw input JSON stays behind the caret.
    const detail = h(
      "details", { class: "tool-card cc-tool-detail" },
      h(
        "summary", null,
        callEl,
        h("span", { class: "chevron" }, svgIcon("chevronDown"))
      ),
      h("div", { class: "tool-section" },
        h("div", { class: "tool-section-label" }, "入力"),
        inputPre
      )
    );

    const resultEl = h("div", { class: "cc-result" });
    resultEl.style.display = "none";

    const container = h(
      "div", { class: "cc-tool" },
      h("div", { class: "cc-line cc-tool-line" }, bullet, detail),
      inlineSpecial,
      resultEl
    );
    container.inputPre = inputPre;
    container.bulletEl = bullet;
    container.resultEl = resultEl;
    return container;
  }

  attachToolResult(block) {
    const container = this.toolCards.get(block.tool_use_id);
    if (!container) return;

    let text;
    if (typeof block.content === "string") {
      text = block.content;
    } else if (Array.isArray(block.content)) {
      text = block.content.map((b) => {
        if (b && b.type === "text") return b.text;
        if (b && b.type === "image") return "[画像]";
        return safeJsonStringify(b);
      }).join("\n");
    } else if (block.content == null) {
      text = "";
    } else {
      text = safeJsonStringify(block.content);
    }

    // ● color reflects outcome; ⎿ result block shows the body (3-line collapse).
    if (container.bulletEl) {
      container.bulletEl.classList.remove("ok", "err");
      container.bulletEl.classList.add(block.is_error ? "err" : "ok");
    }
    const resultEl = container.resultEl;
    resultEl.style.display = "";
    clear(resultEl);
    resultEl.appendChild(buildResultBlock(text, !!block.is_error));
    this.scrollToBottom();
  }

  appendSystemLine(text) {
    this.messagesEl.appendChild(h("div", { class: "system-line" }, text));
    this.scrollToBottom();
  }

  appendError(text) {
    this.messagesEl.appendChild(h("div", { class: "error-line" }, text));
    this.scrollToBottom();
  }

  /* ---- scrolling (U4) ---- */

  onScroll() {
    const el = this.scrollEl;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    this.autoScroll = nearBottom;
    this.updateScrollBtn();
  }

  updateScrollBtn() {
    const el = this.scrollEl;
    const scrollable = el.scrollHeight - el.clientHeight > 20;
    // T8: never overlap the slash popup.
    const slashOpen = this.slashPopup.classList.contains("open");
    this.scrollBtn.style.display = (!slashOpen && !this.autoScroll && scrollable) ? "flex" : "none";
  }

  scrollToBottom(force) {
    // Keep the generating status line pinned to the very bottom as content streams in.
    if (this.statusEl && this.statusEl !== this.messagesEl.lastElementChild) {
      this.messagesEl.appendChild(this.statusEl);
    }
    if (force || this.autoScroll) {
      this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
      if (force) this.autoScroll = true;
    }
    this.updateScrollBtn();
  }

  /* ---- generating status line (Claude Code style) ---- */

  startStatus() {
    this.stopStatus(); // never double-start (multi-turn / multi-view safe)
    this._statusStart = Date.now();
    this._statusVerb = SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
    this._statusOutputTokens = 0;
    this._statusEstTokens = 0;        // running local estimate
    this._statusTokensOfficial = false; // once true, prefer message_delta.usage
    this._statusThinking = false;
    this._statusArrow = "↑"; // before message_start (still uploading the request)
    this._statusFrame = 0;
    this._statusBylineText = null;    // diff guard for DOM updates

    const glyph = h("span", { class: "status-glyph" });
    const verb = h("span", { class: "status-verb" }, this._statusVerb + "…");
    const byline = h("span", { class: "status-byline" });
    this._statusGlyphEl = glyph;
    this._statusBylineEl = byline;
    this.statusEl = h("div", { class: "status-line mono", "aria-live": "polite" }, glyph, " ", verb, " ", byline);
    this.messagesEl.appendChild(this.statusEl);
    this.scrollToBottom();

    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      glyph.textContent = "●"; // ● blink for reduced motion
      let on = true;
      this._statusTimers.push(setInterval(() => {
        on = !on;
        glyph.style.opacity = on ? "1" : "0.3";
      }, 1000));
    } else {
      glyph.textContent = SPINNER_BOUNCE[0];
      this._statusTimers.push(setInterval(() => {
        this._statusFrame = (this._statusFrame + 1) % SPINNER_BOUNCE.length;
        glyph.textContent = SPINNER_BOUNCE[this._statusFrame];
      }, 120));
    }
    this._statusTimers.push(setInterval(() => this.renderStatusByline(), 1000));
    this.renderStatusByline();
  }

  renderStatusByline() {
    if (!this._statusBylineEl) return;
    const parts = [];
    parts.push(Math.floor((Date.now() - this._statusStart) / 1000) + "s");
    if (this._statusOutputTokens > 0) {
      parts.push(this._statusArrow + " " + formatCompactTokens(this._statusOutputTokens) + " tokens");
    }
    if (this._statusThinking) parts.push("thinking");
    const text = "(" + parts.join(" · ") + ")";
    // Only touch the DOM when the string actually changed.
    if (text === this._statusBylineText) return;
    this._statusBylineText = text;
    this._statusBylineEl.textContent = text;
  }

  /* Live-estimate tokens from streamed text until the official count snaps in. */
  bumpEstimatedTokens(text) {
    if (!this.statusEl || this._statusTokensOfficial) return;
    this._statusEstTokens += estimateTokens(text);
    this._statusOutputTokens = Math.floor(this._statusEstTokens);
    this.renderStatusByline();
  }

  /* Clears every status timer — the single choke point that guarantees no setInterval leak. */
  stopStatus() {
    if (this._statusTimers && this._statusTimers.length) {
      for (const t of this._statusTimers) clearInterval(t);
    }
    this._statusTimers = [];
    if (this.statusEl) { this.statusEl.remove(); this.statusEl = null; }
    this._statusGlyphEl = null;
    this._statusBylineEl = null;
  }

  /* ---- streaming state / send button morph (U4) ---- */

  setStreaming(v) {
    this.streaming = v;
    clear(this.sendBtn);
    this.sendBtn.appendChild(svgIcon(v ? "stop" : "arrowUp"));
    this.sendBtn.classList.toggle("stop", v);
    this.sendBtn.setAttribute("aria-label", v ? "停止" : "送信");
    this.sendBtn.setAttribute("title", v ? "停止 (Esc)" : "送信 (Enter)");
    if (this.escHint) this.escHint.style.display = v ? "" : "none";
    // Any transition out of "generating" tears down the status line + timers.
    if (!v) this.stopStatus();
    renderChatList();
  }

  /* ---- permission request: inline card (U3) ---- */

  handlePermissionRequest(msg) {
    // F6: do NOT steal focus if this view is in the background; surface a sidebar badge instead.
    if (App.activeViewId !== this.id) {
      this.pendingPermCount = (this.pendingPermCount || 0) + 1;
      renderChatList();
    }
    const toolName = msg.toolName || "tool";
    const preview = permissionPreview(msg.input);

    const card = h("div", { class: "perm-card" });
    const title = h(
      "div", { class: "perm-title" },
      h("span", { class: "tool-name" }, toolName),
      " の実行を許可しますか？"
    );
    const previewEl = preview ? h("div", { class: "perm-preview" }, preview) : null;
    // suggestions live inside the collapsed details, not on the card surface
    const suggestionsEl = (msg.suggestions && msg.suggestions.length)
      ? h("div", { class: "perm-suggestions" }, "候補: " + msg.suggestions.map((s) => (typeof s === "string" ? s : safeJsonStringify(s))).join(", "))
      : null;
    const detailsEl = h(
      "details", { class: "perm-details" },
      h("summary", null, "入力の詳細を表示"),
      h("pre", null, safeJsonStringify(msg.input ?? {})),
      suggestionsEl
    );

    const respond = (behavior) => {
      const resp = { type: "permission_response", requestId: msg.requestId, behavior };
      if (behavior === "allow") resp.updatedInput = msg.input;
      else resp.message = "User denied";
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(resp));
      if (this.pendingPermCount > 0) { this.pendingPermCount -= 1; renderChatList(); }
      // collapse card into a compact one-line status (U3)
      clear(card);
      card.classList.add("resolved");
      card.appendChild(h(
        "div", { class: "perm-done" },
        svgIcon(behavior === "allow" ? "check" : "x"),
        h(
          "span", { class: "perm-done-text" },
          h("span", { class: "tool-name" }, toolName),
          behavior === "allow" ? " を許可しました" : " を拒否しました"
        )
      ));
      this.scrollToBottom();
    };

    const actions = h(
      "div", { class: "perm-actions" },
      h("button", { class: "btn-ghost", onclick: () => respond("deny") }, "拒否"),
      h("button", { class: "btn-primary", onclick: () => respond("allow") }, "許可")
    );

    card.appendChild(title);
    if (previewEl) card.appendChild(previewEl);
    card.appendChild(detailsEl);
    card.appendChild(actions);

    this.messagesEl.appendChild(card);
    this.scrollToBottom(true);
  }

  dispose() {
    this._disposing = true;
    clearTimeout(this._interruptFallback);
    clearTimeout(this._autoReconnectTimer);
    clearTimeout(this._watchRetryTimer); // Phase 5b: no leaked watch-retry timer on tab close
    this.watching = false;
    clearChatAttachRecord(this); // Phase 4: an explicitly closed tab is not resumable
    if (this._rafId != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.stopStatus(); // guarantee no leaked status timers on view destroy
    if (this._pendingControl && this._pendingControl.size) {
      for (const [, p] of this._pendingControl) clearTimeout(p.timer);
      this._pendingControl.clear();
    }
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "stop" }));
      } catch (e) { /* ignore */ }
      this.ws.close();
      this.ws = null;
    }
  }
}

/* Human-first one-line summary for tool cards (U5): prefer the field a person cares about. */
const SUMMARY_KEYS = ["command", "file_path", "path", "pattern", "url", "query", "prompt", "description"];

function summarizeInput(input) {
  if (!input || typeof input !== "object") return "";
  for (const k of SUMMARY_KEYS) {
    if (typeof input[k] === "string" && input[k].trim()) return truncate(input[k].replace(/\s+/g, " "), 70);
  }
  const keys = Object.keys(input);
  if (!keys.length) return "";
  const k = keys[0];
  let v = input[k];
  if (typeof v === "string") v = truncate(v.replace(/\s+/g, " "), 60);
  else v = truncate(safeJsonStringify(v), 60);
  return `${k}: ${v}` + (keys.length > 1 ? ` (+${keys.length - 1})` : "");
}

/* Primary-field preview for the permission card. */
function permissionPreview(input) {
  if (!input || typeof input !== "object") return "";
  for (const k of SUMMARY_KEYS) {
    if (typeof input[k] === "string" && input[k].trim()) return input[k];
  }
  const keys = Object.keys(input);
  if (!keys.length) return "";
  const v = input[keys[0]];
  return typeof v === "string" ? v : safeJsonStringify(v);
}

/* Claude Code display helpers (round 1) --------------------------------------- */

function deriveHome(cwd) {
  const m = /^(\/home\/[^/]+|\/root|\/Users\/[^/]+)/.exec(cwd || "");
  return m ? m[1] : null;
}

/* Display a path the way Claude Code does: cwd-relative, ~/-relative, else absolute. */
function displayPath(p, cwd) {
  if (typeof p !== "string" || !p) return p || "";
  if (cwd) {
    const base = cwd.replace(/\/+$/, "");
    if (p === base) return ".";
    if (p.startsWith(base + "/")) return p.slice(base.length + 1);
  }
  // Prefer the server-reported home; fall back to a heuristic from cwd.
  const home = (App.info && App.info.home) || deriveHome(cwd);
  if (home && (p === home || p.startsWith(home + "/"))) return "~" + p.slice(home.length);
  return p;
}

/* `● <ToolName>(<primary arg>)` — pick the argument a person cares about, per tool. */
function formatToolCall(name, input, cwd) {
  const n = name || "tool";
  input = (input && typeof input === "object") ? input : {};
  let args = "";
  switch (n) {
    case "Bash": {
      let c = typeof input.command === "string" ? input.command.replace(/\s+/g, " ").trim() : "";
      args = c.length > 160 ? c.slice(0, 159) + "…" : c;
      break;
    }
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      args = displayPath(input.file_path || input.path || input.notebook_path || "", cwd);
      break;
    case "Glob":
    case "Grep":
      args = input.pattern != null ? String(input.pattern) : "";
      break;
    default:
      args = summarizeInput(input);
      break;
  }
  return { name: n, args };
}

/* Tool result as a `⎿  <body>` block; >3 lines collapse to first 3 + expand toggle. */
function buildResultBlock(text, isError) {
  const full = text == null ? "" : String(text).replace(/\s+$/, "");
  const lines = full.length ? full.split("\n") : ["(出力なし)"];
  const elbow = h("span", { class: "cc-result-elbow" }, "⎿");
  const body = h("div", { class: "cc-result-body" + (isError ? " err" : "") });

  const pre = h("pre", { class: "cc-result-pre" });
  const extra = lines.length - 3;
  if (extra > 0) {
    pre.textContent = lines.slice(0, 3).join("\n");
    const toggle = h(
      "button", { class: "cc-result-expand" },
      `… +${extra} 行（クリックで展開）`
    );
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pre.textContent = full;
      toggle.remove();
    });
    body.appendChild(pre);
    body.appendChild(toggle);
  } else {
    pre.textContent = full || "(出力なし)";
    body.appendChild(pre);
  }
  return h("div", { class: "cc-result-row" }, elbow, body);
}

/* Line-level diff (LCS) between two strings. Empty old => all-adds (new file). */
function computeLineDiff(oldStr, newStr) {
  const a = oldStr ? String(oldStr).split("\n") : [];
  const b = newStr ? String(newStr).split("\n") : [];
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0, j = 0, oldNo = 1, newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: "ctx", text: a[i], oldNo: oldNo++, newNo: newNo++ }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: "del", text: a[i], oldNo: oldNo++, newNo: null }); i++; }
    else { rows.push({ type: "add", text: b[j], oldNo: null, newNo: newNo++ }); j++; }
  }
  while (i < n) { rows.push({ type: "del", text: a[i], oldNo: oldNo++, newNo: null }); i++; }
  while (j < m) { rows.push({ type: "add", text: b[j], oldNo: null, newNo: newNo++ }); j++; }
  return rows;
}

/* Build the diff view for Edit / MultiEdit / Write. Text is always a text node (no innerHTML). */
function buildDiffView(name, input) {
  input = (input && typeof input === "object") ? input : {};
  const blocks = [];
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    for (const e of input.edits) blocks.push({ old: e && e.old_string || "", new: e && e.new_string || "" });
  } else if (name === "Write") {
    blocks.push({ old: input.old_string || "", new: input.content != null ? String(input.content) : (input.new_string || "") });
  } else {
    blocks.push({ old: input.old_string || "", new: input.new_string != null ? String(input.new_string) : "" });
  }
  const wrap = h("div", { class: "cc-diff mono" });
  blocks.forEach((blk, bi) => {
    if (bi > 0) wrap.appendChild(h("div", { class: "cc-diff-sep" }));
    const rows = computeLineDiff(blk.old, blk.new);
    if (!rows.length) { wrap.appendChild(h("div", { class: "cc-diff-row ctx" }, h("span", { class: "cc-diff-lno" }, ""), h("span", { class: "cc-diff-sign" }, " "), h("span", { class: "cc-diff-text" }, "(変更なし)"))); return; }
    for (const r of rows) {
      const sign = r.type === "add" ? "+" : r.type === "del" ? "-" : " ";
      const lno = r.newNo != null ? String(r.newNo) : (r.oldNo != null ? String(r.oldNo) : "");
      wrap.appendChild(h(
        "div", { class: "cc-diff-row " + r.type },
        h("span", { class: "cc-diff-lno" }, lno),
        h("span", { class: "cc-diff-sign" }, sign),
        h("span", { class: "cc-diff-text" }, r.text.length ? r.text : " ")
      ));
    }
  });
  return wrap;
}

/* TodoWrite checklist: completed ✔ (strike), in_progress ◼ (accent), pending ◻. */
function buildTodoView(todos) {
  const wrap = h("div", { class: "cc-todos mono" });
  for (const t of (Array.isArray(todos) ? todos : [])) {
    if (!t || typeof t !== "object") continue;
    const status = t.status || "pending";
    const label = status === "in_progress"
      ? (t.activeForm || t.content || "")
      : (t.content || t.activeForm || "");
    const glyph = status === "completed" ? "✔" : status === "in_progress" ? "◼" : "◻";
    wrap.appendChild(h(
      "div", { class: "cc-todo " + status },
      h("span", { class: "cc-todo-glyph" }, glyph),
      h("span", { class: "cc-todo-text" }, label)
    ));
  }
  return wrap;
}

/* ============================== terminal view ============================== */

async function createTerminalView(opts = {}) {
  try {
    await ensureTerminalAssets();
  } catch (error) {
    toast(error.message || "ターミナルの読み込みに失敗しました。");
    return null;
  }
  const id = uid();
  const view = new TerminalTab(id, opts);
  registerView(view);
  return view;
}

class TerminalTab {
  constructor(id, opts) {
    this.id = id;
    this.kind = "terminal";
    this.cwd = opts.cwd || App.cwd;
    this.title = "ターミナル";
    this.resume = opts.resume || null;
    this.streaming = false;
    this.disconnected = false;
    this.ws = null;

    this.container = h("div", { class: "xterm-container" });
    this.disconnectBanner = h("div", { class: "system-line reconnect-line" });
    this.disconnectBanner.style.display = "none";
    this.panelEl = h(
      "div", { class: "view terminal-view" },
      h(
        "div", { class: "view-header" },
        h("span", { class: "view-title" }, this.title),
        h("span", { class: "view-cwd mono" }, this.cwd)
      ),
      h("div", { class: "terminal-card" }, this.container),
      this.disconnectBanner
    );

    /* Terminal is always a dark card, in both themes. */
    this.term = new window.Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SF Mono, Cascadia Code, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#1F1E1D",
        foreground: "#F0EEE7",
        cursor: "#D97757",
        selectionBackground: "#4A4844",
      },
      scrollback: 5000,
    });
    this.fitAddon = new window.FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    if (window.WebLinksAddon) this.term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
    this.term.open(this.container);

    this.term.onData((data) => {
      if (this.disconnected) {
        if (data === "\r" || data === "\n") this.connect();
        return;
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    this._resizeObserver = new ResizeObserver(() => {
      if (App.activeViewId === this.id) this.fitAndResize();
    });
    this._resizeObserver.observe(this.container);

    this.connect();
  }

  onActivate() {
    setTimeout(() => { this.fitAndResize(); this.term.focus(); }, 0);
  }

  fitAndResize() {
    try { this.fitAddon.fit(); } catch (e) { return; /* hidden panel */ }
    const cols = this.term.cols, rows = this.term.rows;
    if (!cols || !rows) return;
    // Additional: only send when size actually changed, and debounce the frame.
    if (cols === this._lastCols && rows === this._lastRows) return;
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && (cols !== this._lastCols || rows !== this._lastRows)) {
        this.ws.send(JSON.stringify({ type: "resize", cols, rows }));
        this._lastCols = cols;
        this._lastRows = rows;
      }
    }, 120);
  }

  connect() {
    // Avoid stacking sockets when restarting after an exit.
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
    this.disconnected = false;
    this.disconnectBanner.style.display = "none";
    // Force the next fit to re-send size on the fresh connection.
    this._lastCols = null;
    this._lastRows = null;
    let cols = this.term.cols || 80;
    let rows = this.term.rows || 24;
    const params = { cwd: this.cwd, cols, rows };
    if (this.resume) params.resume = this.resume;
    this.ws = openAuthenticatedWebSocket("/ws/terminal", params);
    this.ws.addEventListener("open", () => {
      setTimeout(() => this.fitAndResize(), 50);
    });
    this.ws.addEventListener("message", (ev) => this.onMessage(ev));
    this.ws.addEventListener("close", () => this.onClose());
    this.ws.addEventListener("error", () => {});
  }

  onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "output") {
      this.term.write(msg.data);
    } else if (msg.type === "exit") {
      // Additional: PTY process ended — go to disconnected state with a restart affordance.
      this.term.write(`\r\n\x1b[31m[プロセスが終了しました (code ${msg.code})]\x1b[0m`);
      this.markDisconnected();
    }
  }

  markDisconnected() {
    if (this.disconnected) return;
    this.disconnected = true;
    this.term.write("\r\n\x1b[90m[切断されました — Enter で新しいセッションを開始]\x1b[0m\r\n");
    this.disconnectBanner.style.display = "flex";
    clear(this.disconnectBanner);
    this.disconnectBanner.appendChild(h("span", null, "ターミナルのセッションが終了しました。"));
    this.disconnectBanner.appendChild(h("button", { onclick: () => this.connect() }, "新しいセッションを開始"));
  }

  onClose() {
    this.markDisconnected();
  }

  dispose() {
    this._disposing = true;
    clearTimeout(this._resizeTimer);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
    try { this.term.dispose(); } catch (e) {}
  }
}

/* ============================== global keys (U7) ============================== */

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isModalOpen()) {
    // T1: closable modals dismiss on Escape.
    if (isModalClosable()) { e.preventDefault(); closeModal(); }
    return;
  }
  if (e.key === "Escape" && App.activeViewId) {
    const view = App.views.get(App.activeViewId);
    if (view && view.kind === "chat" && view._qaOpen) {
      e.preventDefault();
      view.closeActionSheet();
      return;
    }
    if (view && view.kind === "chat" && view.streaming) {
      view.sendInterrupt();
    }
    return;
  }
  // Cmd+K / Ctrl+K: focus composer and open slash completion
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    const view = App.views.get(App.activeViewId);
    if (view && view.kind === "chat") {
      e.preventDefault();
      view.textarea.focus();
      if (!view.textarea.value) {
        view.textarea.value = "/";
        view.onInput();
      }
    }
  }
});

/* Phase 4: coming back from background (screen lock, app switch) is the
   primary trigger for reattach on mobile — the WS may already be closed
   (onWsClose's own auto-retry will have fired) or may just be stale; either
   way, nudge every open chat's connection when the page becomes visible. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  for (const view of App.views.values()) {
    if (view.kind !== "chat") continue;
    const wsDown = !view.ws || view.ws.readyState === WebSocket.CLOSED;
    if (!wsDown) continue;
    // Phase 5b: a watch-only tab (no child of its own) must never be nudged
    // into ensureConnected() here — that would start a real `claude --resume`
    // process just because the tab was backgrounded. It gets its own retry.
    if (view.watching) view.ensureWatching();
    else view.ensureConnected();
  }
});

/* ============================== mobile sidebar ============================== */

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function setSidebarOpen(open) {
  document.getElementById("sidebar").classList.toggle("open", open);
  document.body.classList.toggle("sidebar-open", open);
  updateBottomNavActiveState();
}

function toggleSidebar() {
  setSidebarOpen(!document.getElementById("sidebar").classList.contains("open"));
}

/** Close the off-canvas sidebar after an action, on mobile only. */
function closeSidebarIfMobile() {
  if (isMobile()) setSidebarOpen(false);
}

/* T9: reset the off-canvas open state whenever we cross the mobile breakpoint. */
function wireBreakpointReset() {
  const mq = window.matchMedia("(max-width: 768px)");
  const onChange = () => setSidebarOpen(false);
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

/* ============================== bottom nav (mobile, Phase 1) ============================== */

const BOTTOM_NAV_SPECS = [
  ["bn-sessions", "list", "セッション"],
  ["bn-chat", "chat", "チャット"],
  ["bn-terminal", "terminal", "端末"],
  ["bn-actions", "bolt", "操作"],
];

function renderBottomNav() {
  for (const [id, icon, label] of BOTTOM_NAV_SPECS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    clear(btn);
    btn.appendChild(iconSpan(icon, "bn-icon"));
    btn.appendChild(h("span", { class: "bn-label" }, label));
  }
}

function wireBottomNav() {
  document.getElementById("bn-sessions").addEventListener("click", () => {
    setSidebarOpen(!document.getElementById("sidebar").classList.contains("open"));
  });
  document.getElementById("bn-chat").addEventListener("click", () => {
    setSidebarOpen(false);
    const id = App.lastChatViewId;
    // Phase 2: only a genuinely *new* session goes through the cwd picker;
    // switching back to an already-open chat stays instant (no picker).
    if (id && App.views.has(id)) activateView(id);
    else openLastChatOrPicker(); // Phase 5a: continue the previous session instead of a picker
  });
  document.getElementById("bn-terminal").addEventListener("click", () => {
    setSidebarOpen(false);
    const id = App.lastTerminalViewId;
    if (id && App.views.has(id)) activateView(id);
    else openNewSessionCwdPicker("terminal");
  });
  document.getElementById("bn-actions").addEventListener("click", () => {
    const view = App.activeViewId ? App.views.get(App.activeViewId) : null;
    if (view && view.kind === "chat") {
      setSidebarOpen(false);
      view.openActionSheet(null);
    } else {
      toast("チャットを開いてから使えます。");
    }
  });
}

/** Highlight whichever bottom-nav tab matches the current UI state. */
function updateBottomNavActiveState() {
  const sidebarEl = document.getElementById("sidebar");
  const sidebarOpen = !!(sidebarEl && sidebarEl.classList.contains("open"));
  const activeView = App.activeViewId ? App.views.get(App.activeViewId) : null;
  const qaOpen = !!(activeView && activeView.kind === "chat" && activeView._qaOpen);
  const active = {
    "bn-sessions": sidebarOpen,
    "bn-actions": qaOpen,
    "bn-chat": !sidebarOpen && !qaOpen && !!activeView && activeView.kind === "chat",
    "bn-terminal": !sidebarOpen && !qaOpen && !!activeView && activeView.kind === "terminal",
  };
  for (const [id, isActive] of Object.entries(active)) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", isActive);
  }
}

/* ============================== init ============================== */

function wireSidebar() {
  // Plain fs-browser: only repositions the sidebar's current cwd, no session started.
  document.getElementById("cwd-chip").addEventListener("click", () => openCwdPicker());
  // Phase 2: "new" chat/terminal now goes through the pinned/recent/browse picker.
  document.getElementById("new-chat-btn").addEventListener("click", () => openNewSessionCwdPicker("chat"));
  document.getElementById("new-terminal-btn").addEventListener("click", () => openNewSessionCwdPicker("terminal"));
  document.getElementById("sidebar-toggle").addEventListener("click", toggleSidebar);
  document.getElementById("sidebar-scrim").addEventListener("click", () => setSidebarOpen(false));
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
}

async function init() {
  // Phase 5a: snapshot the saved workspace *before* anything else runs. loadInfo()
  // below calls setCwd() (to seed App.cwd), and setCwd persists workspace state —
  // with App.viewOrder still empty at that point, an unguarded read-at-restore-time
  // would have that empty-tabs snapshot clobber the very state we're about to
  // restore. Capturing the raw value up front sidesteps the ordering hazard entirely.
  _bootWorkspaceSnapshotRaw = (() => { try { return localStorage.getItem(WORKSPACE_KEY); } catch (e) { return null; } })();
  Auth.init();
  updateThemeToggle();
  await Auth.ensure();
  wireSidebar();
  wireBreakpointReset();
  renderBottomNav();
  wireBottomNav();
  updateViewportEmpty();
  await loadInfo();
  loadRecentSessions(); // Phase 5b: cross-project sidebar list; independent of the selected cwd
  // Land on a fresh chat, like claude.ai — but first, Phase 5a: restore the
  // whole prior workspace (every open chat/terminal tab, active tab, sidebar
  // cwd) if we have one; else Phase 4's older single-chat restore (if the
  // last active chat before a reload still has a live server-side session,
  // try to rejoin it — falls back to a normal resume on its own); else fresh.
  if (App.viewOrder.length === 0) {
    if (!(await tryRestoreWorkspaceOnBoot())) {
      if (!tryRestoreLastChatOnBoot()) createChatView({ cwd: App.cwd });
    }
  }
  // PWA: register the service worker and check push-subscription state in the
  // background — neither should delay first paint / first chat view.
  registerServiceWorker();
  Push.refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
