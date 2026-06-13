/*
 * MannMitra UI — DOM rendering, events, and wiring.
 * Pure-logic helpers, the offline engine, storage, and network calls live in
 * engine.js (loaded first); the knowledge base lives in data.js.
 */

// el builds a DOM node; esc/num (from engine.js) sanitize and coerce values.
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// The most recent check-in input, kept so "Reflect again" can re-run it.
let lastInput = null;

// --- reflection rendering --------------------------------------------------

function crisisBanner(safety) {
  const box = el("div", "crisis-banner");
  const lines = safety.helplines
    .map(h => `<li><b>${esc(h.name)}</b> · <span class="hl-num">${esc(h.contact)}</span> <em>${esc(h.note)}</em></li>`)
    .join("");
  box.innerHTML = `
    <div class="crisis-head">🤍 You deserve support right now</div>
    <p>${esc(safety.message)}</p>
    <ul class="helplines">${lines}</ul>`;
  return box;
}

function renderReflection(result) {
  const out = document.getElementById("result");
  out.innerHTML = "";

  if (result.safety && result.safety.crisis) {
    out.appendChild(crisisBanner(result.safety));
  }

  // Wellness banner
  const w = result.wellness;
  const banner = el("div", `wellness-banner ${w.klass}`);
  const srcLabel = result.source === "ai"
    ? `<span class="src ai">⚡ AI reflection</span>`
    : `<span class="src off">offline mode</span>`;
  banner.innerHTML = `
    <div class="wellness-head">
      <span class="badge">${esc(w.state)}</span>
      <span class="wellness-figure">${num(w.score)}<small>/100 wellness</small></span>
    </div>
    <p class="emotion-line">You sound <b>${esc(result.emotion)}</b> today. ${srcLabel}</p>
    <div class="meter"><div class="fill" style="width:${Math.min(num(w.score), 100)}%"></div></div>
    <p>${esc(w.advice)}</p>`;
  out.appendChild(banner);

  // Insight panel: what MannMitra notices
  const insight = el("div", "panel");
  insight.innerHTML = `<h3>🔎 What I'm noticing</h3><p class="pattern">${esc(result.patterns)}</p>`;
  if (result.triggers.length) {
    const chips = el("div", "trigger-chips");
    result.triggers.forEach(t => chips.appendChild(el("span", "trig", esc(t.label))));
    insight.appendChild(el("div", "field-label", "Possible stress triggers"));
    insight.appendChild(chips);
  }
  out.appendChild(insight);

  // Coping strategies
  const strat = el("div", "panel");
  strat.innerHTML = `<h3>🧭 Coping strategies to try</h3>`;
  const sl = el("ul", "strategy-list");
  result.strategies.forEach(s => {
    sl.appendChild(el("li", null,
      `<label><input type="checkbox"><span><b>${esc(s.title)}</b><em>${esc(s.detail)}</em></span></label>`));
  });
  strat.appendChild(sl);
  out.appendChild(strat);

  // Mindfulness exercise (with a gentle breathing orb)
  const m = result.mindfulness;
  const mind = el("div", "panel mindful");
  const steps = m.steps.map(s => `<li>${esc(s)}</li>`).join("");
  mind.innerHTML = `
    <div class="mindful-head">
      <h3>🌬️ ${esc(m.name)}</h3>
      <span class="duration">${esc(m.duration)}</span>
    </div>
    <div class="breath" aria-hidden="true"><div class="orb"></div><span class="breath-label">breathe</span></div>
    <ol class="steps">${steps}</ol>`;
  out.appendChild(mind);

  // Encouragement
  const note = el("div", "encourage");
  note.innerHTML = `<span class="quote-mark">“</span>${esc(result.encouragement)}`;
  out.appendChild(note);

  // Actions
  const actions = el("div", "result-actions");
  const againBtn = el("button", "ghost", "🔁 Reflect again");
  againBtn.onclick = async () => {
    if (!lastInput) return;
    showReflecting();
    renderReflection(await requestReflection(lastInput));
  };
  const copyBtn = el("button", "ghost", "📋 Copy reflection");
  copyBtn.onclick = () => copyReflection(result, copyBtn);
  actions.append(againBtn, copyBtn);
  out.appendChild(actions);

  out.scrollIntoView({ behavior: "smooth", block: "start" });
}

function copyReflection(r, btn) {
  let t = `MannMitra reflection — feeling ${r.emotion} (wellness ${r.wellness.score}/100, ${r.wellness.state})\n\n`;
  if (r.triggers.length) t += `TRIGGERS:\n- ${r.triggers.map(x => x.label).join("\n- ")}\n\n`;
  t += `NOTICING: ${r.patterns}\n\n`;
  t += `STRATEGIES:\n` + r.strategies.map(s => `- ${s.title}: ${s.detail}`).join("\n") + "\n\n";
  t += `MINDFULNESS — ${r.mindfulness.name} (${r.mindfulness.duration}):\n- ` + r.mindfulness.steps.join("\n- ") + "\n\n";
  t += `${r.encouragement}\n`;
  navigator.clipboard.writeText(t).then(() => {
    btn.textContent = "✅ Copied!";
    setTimeout(() => (btn.textContent = "📋 Copy reflection"), 1500);
  });
}

function showReflecting() {
  const out = document.getElementById("result");
  out.innerHTML = `
    <div class="empty">
      <div class="empty-icon pulse">🌿</div>
      <p>Reading your words with care…</p>
    </div>`;
}

// --- companion chat (rendering + send) -------------------------------------

const chatHistory = []; // {role, content}

function renderChatMessage(role, content, safety) {
  const log = document.getElementById("chat-log");
  const row = el("div", `msg ${role}`);
  if (role === "assistant") {
    row.innerHTML = `<span class="avatar">🌿</span><div class="bubble">${esc(content)}</div>`;
  } else {
    row.innerHTML = `<div class="bubble">${esc(content)}</div>`;
  }
  log.appendChild(row);

  if (safety && safety.crisis) {
    const help = el("div", "msg assistant");
    const lines = safety.helplines
      .map(h => `<li><b>${esc(h.name)}</b> · <span class="hl-num">${esc(h.contact)}</span></li>`).join("");
    help.innerHTML = `<span class="avatar">🤍</span><div class="bubble crisis-bubble">
      Please reach out to someone who can be with you right now:
      <ul class="helplines">${lines}</ul></div>`;
    log.appendChild(help);
  }
  log.scrollTop = log.scrollHeight;
}

function showTyping() {
  const log = document.getElementById("chat-log");
  const row = el("div", "msg assistant typing-row");
  row.id = "typing";
  row.innerHTML = `<span class="avatar">🌿</span><div class="bubble typing"><span></span><span></span><span></span></div>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById("typing");
  if (t) t.remove();
}

async function sendChat(text) {
  chatHistory.push({ role: "user", content: text });
  renderChatMessage("user", text);
  showTyping();

  let result;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    });
    if (!res.ok) throw new Error("ai_unavailable");
    const data = await res.json();
    if (!data || !data.reply) throw new Error("bad_response");
    result = { reply: data.reply, safety: data.safety };
  } catch (err) {
    result = localReply(text);
  }

  removeTyping();
  chatHistory.push({ role: "assistant", content: result.reply });
  renderChatMessage("assistant", result.reply, result.safety);
}

// --- history view ----------------------------------------------------------

function renderHistory(items) {
  const list = document.getElementById("history-list");
  const trend = document.getElementById("trend");
  const sub = document.getElementById("history-sub");
  list.innerHTML = "";

  if (!items.length) {
    trend.classList.add("hidden");
    list.innerHTML = `<div class="empty"><div class="empty-icon">🗂️</div>
      <p>No check-ins yet. Do a daily check-in and it'll appear here.</p></div>`;
    return;
  }

  // Trend: oldest -> newest, last 12 scores.
  const chrono = items.slice().reverse().slice(-12);
  const bars = document.getElementById("trend-bars");
  bars.innerHTML = "";
  chrono.forEach(it => {
    const s = num(it.wellness_score);
    const bar = el("div", `tbar ${klassForScore(s)}`);
    bar.style.height = Math.max(6, s) + "%";
    bar.title = `${s}/100`;
    bars.appendChild(bar);
  });
  trend.classList.remove("hidden");
  sub.textContent = `${items.length} check-in${items.length > 1 ? "s" : ""} saved on this device.`;

  // List: newest first.
  items.forEach(it => {
    const s = num(it.wellness_score);
    const row = el("div", "hist-item");
    const chips = (it.triggers || []).slice(0, 3)
      .map(t => `<span class="trig sm">${esc(t.label)}</span>`).join("");
    row.innerHTML = `
      <span class="hist-mood">${MOOD_EMOJI[it.mood] || "😐"}</span>
      <div class="hist-body">
        <div class="hist-top">
          <span class="hist-score ${klassForScore(s)}">${s}</span>
          <b>${esc(it.wellness_state || "")}</b>
          <span class="muted">· feeling ${esc(it.emotion || "")}</span>
        </div>
        <div class="hist-date">${esc(fmtDate(it.created_at))}${it.crisis ? ' · <span class="hist-flag">support shown</span>' : ""}</div>
        ${chips ? `<div class="hist-trigs">${chips}</div>` : ""}
      </div>`;
    list.appendChild(row);
  });
}

async function loadHistory() {
  let items = [];
  try {
    const res = await fetch("/api/checkins?anon_id=" + encodeURIComponent(getAnonId()));
    const data = await res.json();
    if (data && Array.isArray(data.items) && data.items.length) items = data.items;
  } catch (e) { /* fall back to local */ }
  if (!items.length) items = localHistory();
  renderHistory(items);
}

// --- wiring ----------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  // Tabs
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => {
        const on = t === tab;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      const which = tab.dataset.tab;
      document.getElementById("view-checkin").classList.toggle("hidden", which !== "checkin");
      document.getElementById("view-companion").classList.toggle("hidden", which !== "companion");
      document.getElementById("view-history").classList.toggle("hidden", which !== "history");
      if (which === "history") loadHistory();
    });
  });

  // Mood picker
  const moodInput = document.querySelector('input[name="mood"]');
  const moods = document.querySelectorAll(".mood");
  moods.forEach(btn => {
    btn.addEventListener("click", () => {
      moods.forEach(b => {
        const on = b === btn;
        b.classList.toggle("selected", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      moodInput.value = btn.dataset.mood;
    });
  });

  // Sleep slider: keep the readout in sync (was an inline handler in HTML).
  const sleepRange = document.getElementById("sleepRange");
  const sleepVal = document.getElementById("sleepVal");
  sleepRange.addEventListener("input", () => { sleepVal.textContent = sleepRange.value; });

  // Check-in form
  const form = document.getElementById("checkin-form");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const journal = (fd.get("journal") || "").toString().trim();
    if (journal.length < 3) {
      alert("Write a few words about your day first — even one honest line helps.");
      return;
    }
    const days = parseInt(fd.get("daysToExam"), 10);
    const input = {
      mood: parseInt(fd.get("mood"), 10) || 3,
      journal,
      exam: fd.get("exam") || "other",
      daysToExam: Number.isFinite(days) ? days : null,
      sleepHours: parseInt(fd.get("sleepHours"), 10),
    };
    lastInput = input;
    showReflecting();
    const result = await requestReflection(input);
    renderReflection(result);
    saveCheckin(input, result);
  });

  // Companion chat
  renderChatMessage("assistant", GREETING);
  chatHistory.push({ role: "assistant", content: GREETING });
  const chatForm = document.getElementById("chat-form");
  const chatText = document.getElementById("chat-text");
  chatForm.addEventListener("submit", e => {
    e.preventDefault();
    const text = chatText.value.trim();
    if (!text) return;
    chatText.value = "";
    sendChat(text);
  });
});
