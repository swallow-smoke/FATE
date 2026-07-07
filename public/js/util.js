// NarrativeOS front-end — shared helpers + global namespace.
"use strict";

window.NOS = {
  campaign: null, // current campaign id (game view)
  lastTrace: null,
  settingsCache: null, // current campaign settings (choices_ui etc.)
  emotion: { name: "calm", intensity: 0 },
};

function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Light markdown for narrative: paragraphs + <br>, **bold**, *italic*.
function renderNarrative(text) {
  return String(text)
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${inlineMd(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
function inlineMd(s) {
  // Phase 10 G1 — monologue: parentheses wrapping a longer run (>=8 chars) are
  // an inner voice; short parentheticals (e.g. "리아(25)") stay as plain text.
  return s
    .replace(/\(([^)]{8,})\)/g, '<span class="monologue">($1)</span>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>");
}

// fetch wrapper with the Phase 5 error banner.
async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json (e.g. markdown export) */ }
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    // Wave 1: the banner is player-facing — short and generic. Full detail
    // (msg) still reaches the thrown Error for the debug tab / console.
    if (res.status === 429 || res.status >= 500) showBanner("서버/AI 응답이 지연되고 있습니다 — 잠시 후 다시 시도해주세요.");
    console.error("API error:", path, msg, data || "");
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
async function apiPost(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}

// --- error banner (Wave 1) --------------------------------------------------
let bannerTimer = null;
function showBanner(msg) {
  const b = $("errorBanner");
  b.textContent = msg;
  b.classList.remove("hidden");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add("hidden"), 6000);
}

// --- shared modal -------------------------------------------------------------
function openModal(html) {
  $("modalBox").innerHTML = html;
  $("modalBack").classList.remove("hidden");
}
function closeModal() { $("modalBack").classList.add("hidden"); }
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "modalBack") closeModal();
});
// Phase 6 G — keyboard accessibility: Escape closes the modal from anywhere.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("modalBack").classList.contains("hidden")) closeModal();
});

function fmtDate(d) {
  if (!d) return "";
  const t = new Date(d);
  return `${t.getFullYear()}.${String(t.getMonth() + 1).padStart(2, "0")}.${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

function download(filename, text, type) {
  const blob = new Blob([text], { type: type || "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function emotionTone(emotion) {
  const e = String(emotion || "calm").toLowerCase();
  if (/(anger|angry|rage|fury|분노|격노)/.test(e)) return "angry";
  if (/(tense|tension|unease|fear|dread|despair|불안|긴장|공포|절망)/.test(e)) return "tense";
  return "calm";
}

function setEmotionalResonance(emotion, intensity) {
  const tone = emotionTone(emotion);
  const raw = Number(intensity ?? 0);
  const level = raw > 5 ? Math.min(5, raw / 2) : Math.max(0, Math.min(5, raw));
  NOS.emotion = { name: emotion || "calm", intensity: level, tone };
  document.body.dataset.emotion = tone;
  document.documentElement.style.setProperty("--pulse-speed", `${Math.max(1.8, 6.2 - level * 0.58)}s`);
  document.documentElement.style.setProperty("--pulse-alpha", (0.018 + level * 0.011).toFixed(3));
  document.documentElement.style.setProperty("--pulse-spread", `${5 + level * 4}px`);
}

function animatePaperIn(el, fromY) {
  if (!el || isLowSpec()) return;
  if (window.gsap) {
    gsap.fromTo(el,
      { y: fromY ?? 30, opacity: 0, rotateX: 3, filter: "blur(5px)" },
      { y: 0, opacity: 1, rotateX: 0, filter: "blur(0px)", duration: 0.62, ease: "back.out(1.35)" });
  } else {
    el.classList.add("paper-enter");
    setTimeout(() => el.classList.remove("paper-enter"), 700);
  }
}

function splitNarrativeChars(root) {
  if (!root) return [];
  if (window.gsap && window.SplitText) {
    try {
      const split = new SplitText(root, { type: "chars", charsClass: "kt-char" });
      root._splitText = split;
      return split.chars;
    } catch (e) {
      console.warn("SplitText fallback:", e);
    }
  }
  const chars = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    const frag = document.createDocumentFragment();
    [...node.textContent].forEach((ch) => {
      const span = document.createElement("span");
      span.className = "kt-char";
      span.textContent = ch;
      frag.appendChild(span);
      chars.push(span);
    });
    node.parentNode.replaceChild(frag, node);
  });
  return chars;
}

function animateKineticText(root, emotion, intensity) {
  if (!root || isLowSpec()) return;
  const tone = emotionTone(emotion);
  root.classList.add("kinetic-text", `emo-${tone}`);
  const textLength = (root.textContent || "").length;
  if (textLength > 900 || localStorage.getItem("nos_theme") === "plain") {
    if (window.gsap) gsap.fromTo(root, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28, ease: "sine.out" });
    return;
  }
  const chars = splitNarrativeChars(root);
  if (!chars.length) return;
  const level = Math.max(0, Math.min(5, Number(intensity ?? NOS.emotion.intensity ?? 0)));
  if (!window.gsap) {
    root.classList.add("kinetic-css");
    return;
  }
  gsap.set(chars, { opacity: 0, y: tone === "calm" ? -10 : 0, x: 0 });
  if (tone === "tense") {
    gsap.to(chars, {
      opacity: 1,
      y: 0,
      x: () => gsap.utils.random(-2, 2),
      duration: 0.18,
      stagger: 0.012,
      ease: "power2.out",
      onComplete: () => gsap.to(chars, { x: 0, duration: 0.08, stagger: 0.002 }),
    });
  } else if (tone === "angry") {
    root.classList.add("impact-text");
    gsap.fromTo(chars,
      { opacity: 0, y: -2, scale: 1.18, textShadow: "3px 0 0 rgba(223,64,55,.68)" },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        textShadow: "0px 0 0 rgba(223,64,55,0)",
        duration: 0.12,
        stagger: 0.009,
        ease: "expo.out",
        onComplete: () => screenShake(level),
      });
  } else {
    gsap.to(chars, { opacity: 1, y: 0, duration: 0.42, stagger: 0.011, ease: "sine.out" });
  }
}

function screenShake(intensity) {
  if (isLowSpec() || !window.gsap) return;
  gsap.fromTo("#view-game", { x: 0 }, {
    x: () => gsap.utils.random(-1.5 - intensity, 1.5 + intensity),
    duration: 0.045,
    repeat: 5,
    yoyo: true,
    clearProps: "x",
    ease: "rough({ strength: 1, points: 10 })",
  });
}

function moveCurrentTurnMarker(target) {
  const log = $("log");
  if (!log || !target || isLowSpec()) return;
  let marker = $("currentTurnMarker");
  if (!marker) {
    marker = document.createElement("div");
    marker.id = "currentTurnMarker";
    log.appendChild(marker);
  }
  const y = target.offsetTop + 14;
  const h = Math.max(42, target.offsetHeight - 28);
  if (window.gsap) {
    gsap.to(marker, { y, height: h, opacity: 1, duration: 0.58, ease: "power3.out" });
  } else {
    marker.style.transform = `translateY(${y}px)`;
    marker.style.height = `${h}px`;
    marker.style.opacity = "1";
  }
}
