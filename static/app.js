/*
 * Cooking To-Do Planner — engine + UI.
 * Pure client side. Takes the user's day, builds a structured meal plan,
 * grocery list, substitutions, and a budget feasibility verdict.
 */

// Diet hierarchy: a person on a given diet can eat anything at or below their level.
const DIET_ALLOWS = {
  vegan:  ["vegan"],
  veg:    ["vegan", "veg"],
  egg:    ["vegan", "veg", "egg"],
  nonveg: ["vegan", "veg", "egg", "nonveg"],
};

const MEALS = ["breakfast", "lunch", "dinner"];

// --- helpers ---------------------------------------------------------------

function pickRecipe(meal, diet, cuisine, maxPrep, avoidIds) {
  const allowed = DIET_ALLOWS[diet] || DIET_ALLOWS.nonveg;
  let pool = RECIPES.filter(r =>
    r.meal === meal &&
    allowed.includes(r.diet) &&
    r.prep <= maxPrep &&
    !avoidIds.has(r.id)
  );
  // Relax the time limit before giving up, so we always return something.
  if (pool.length === 0) {
    pool = RECIPES.filter(r => r.meal === meal && allowed.includes(r.diet) && !avoidIds.has(r.id));
  }
  if (pool.length === 0) return null;

  // Prefer the requested cuisine, fall back to anything.
  const preferred = pool.filter(r => r.cuisine === cuisine);
  const finalPool = preferred.length ? preferred : pool;

  // Rotate by day-seed so "Regenerate" gives variety.
  const seed = Math.floor(Math.random() * finalPool.length);
  return finalPool[seed];
}

function buildGroceryList(recipes, people) {
  // Aggregate ingredients, noting how many dishes use each and scaling by people.
  const map = new Map();
  recipes.forEach(r => {
    r.ingredients.forEach(ing => {
      const key = ing.toLowerCase();
      if (!map.has(key)) map.set(key, { label: ing, count: 0 });
      map.get(key).count += 1;
    });
  });
  return [...map.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(item => {
      const scale = people > 1 ? ` ×${people}` : "";
      const used = item.count > 1 ? ` (used in ${item.count} dishes)` : "";
      return `${item.label}${scale}${used}`;
    });
}

function buildSubstitutions(recipes) {
  const found = [];
  const seen = new Set();
  recipes.forEach(r => {
    r.ingredients.forEach(ing => {
      const low = ing.toLowerCase();
      SUBSTITUTIONS.forEach(sub => {
        if (low.includes(sub.match) && !seen.has(sub.match)) {
          seen.add(sub.match);
          found.push({ from: sub.match, swap: sub.swap, note: sub.note });
        }
      });
    });
  });
  return found;
}

function assessBudget(perDayCost, budget, people) {
  const dailyBudget = budget; // user enters per-day budget for the whole household
  const ratio = perDayCost / Math.max(dailyBudget, 1);
  let verdict, klass, advice;
  if (ratio <= 0.85) {
    verdict = "Comfortably within budget";
    klass = "ok";
    advice = `You have about ₹${Math.round(dailyBudget - perDayCost)} of headroom per day.`;
  } else if (ratio <= 1.0) {
    verdict = "Tight but feasible";
    klass = "warn";
    advice = "You're close to the limit. The substitutions below can add a safety margin.";
  } else {
    verdict = "Over budget";
    klass = "over";
    advice = `Over by ~₹${Math.round(perDayCost - dailyBudget)}/day. Apply the substitutions or drop one premium dish.`;
  }
  return { verdict, klass, advice, perDayCost, dailyBudget, ratio };
}

// --- main flow -------------------------------------------------------------

function generatePlan(input) {
  const avoid = new Set();
  const plan = {};
  let total = 0;

  input.meals.forEach(meal => {
    const r = pickRecipe(meal, input.diet, input.cuisine, input.maxPrep, avoid);
    if (r) {
      avoid.add(r.id);
      const perServing = r.cost;
      const mealCost = perServing * input.people;
      total += mealCost;
      plan[meal] = { ...r, mealCost };
    }
  });

  const chosen = Object.values(plan);
  return {
    input,
    plan,
    grocery: buildGroceryList(chosen, input.people),
    subs: buildSubstitutions(chosen),
    budget: assessBudget(total, input.budget, input.people),
  };
}

// --- rendering -------------------------------------------------------------

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const MEAL_ICON = { breakfast: "🌅", lunch: "☀️", dinner: "🌙" };

function renderResult(result) {
  const out = document.getElementById("result");
  out.innerHTML = "";

  // Budget banner
  const b = result.budget;
  const banner = el("div", `budget-banner ${b.klass}`);
  const srcLabel = result.source === "ai"
    ? `<span class="src ai">⚡ AI generated</span>`
    : `<span class="src off">offline mode</span>`;
  banner.innerHTML = `
    <div class="budget-head">
      <span class="badge">${b.verdict}</span>
      <span class="budget-figure">₹${Math.round(b.perDayCost)} <small>/ ₹${b.dailyBudget} per day</small></span>
    </div>
    <p>${b.advice} ${srcLabel}</p>
    <div class="meter"><div class="fill" style="width:${Math.min(b.ratio * 100, 100)}%"></div></div>`;
  out.appendChild(banner);

  // Meal plan (to-do cards)
  const grid = el("div", "meal-grid");
  MEALS.forEach(meal => {
    const r = result.plan[meal];
    if (!r) return;
    const card = el("div", "meal-card");
    const steps = r.ingredients
      .map((ing, i) => `<li><label><input type="checkbox"> ${ing}</label></li>`).join("");
    card.innerHTML = `
      <div class="meal-card-head">
        <span class="meal-name">${MEAL_ICON[meal]} ${meal[0].toUpperCase() + meal.slice(1)}</span>
        <span class="meal-meta">${r.prep} min · ₹${r.mealCost}</span>
      </div>
      <h3>${r.name}</h3>
      <ul class="todo">${steps}</ul>`;
    grid.appendChild(card);
  });
  out.appendChild(grid);

  // Two-column: grocery + substitutions
  const cols = el("div", "two-col");

  const grocery = el("div", "panel");
  grocery.innerHTML = `<h3>🛒 Grocery list</h3>`;
  const gl = el("ul", "todo");
  result.grocery.forEach(g => {
    gl.appendChild(el("li", null, `<label><input type="checkbox"> ${g}</label>`));
  });
  grocery.appendChild(gl);
  cols.appendChild(grocery);

  const subs = el("div", "panel");
  subs.innerHTML = `<h3>🔄 Substitutions</h3>`;
  if (result.subs.length) {
    const sl = el("ul", "sub-list");
    result.subs.forEach(s => {
      sl.appendChild(el("li", null,
        `<b>${s.from}</b> → <span class="swap">${s.swap}</span> <em>${s.note}</em>`));
    });
    subs.appendChild(sl);
  } else {
    subs.appendChild(el("p", "muted", "No swaps needed — your plan is already lean."));
  }
  cols.appendChild(subs);
  out.appendChild(cols);

  // Actions
  const actions = el("div", "result-actions");
  const copyBtn = el("button", "ghost", "📋 Copy plan");
  copyBtn.onclick = () => copyPlan(result, copyBtn);
  const againBtn = el("button", "ghost", "🔁 Regenerate");
  againBtn.onclick = async () => {
    if (!window._lastInput) return;
    showLoading();
    renderResult(await requestPlan(window._lastInput));
  };
  actions.append(copyBtn, againBtn);
  out.appendChild(actions);

  out.scrollIntoView({ behavior: "smooth", block: "start" });
}

function copyPlan(result, btn) {
  let text = `My Cooking To-Do (${result.input.people} ppl, ₹${result.input.budget}/day)\n\n`;
  MEALS.forEach(m => {
    const r = result.plan[m];
    if (r) text += `${m.toUpperCase()}: ${r.name} (${r.prep} min, ₹${r.mealCost})\n`;
  });
  text += `\nGROCERY:\n- ${result.grocery.join("\n- ")}\n`;
  if (result.subs.length) {
    text += `\nSUBSTITUTIONS:\n` + result.subs.map(s => `- ${s.from} -> ${s.swap} (${s.note})`).join("\n") + "\n";
  }
  text += `\nBUDGET: ${result.budget.verdict} — ₹${Math.round(result.budget.perDayCost)} of ₹${result.budget.dailyBudget}/day\n`;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = "✅ Copied!";
    setTimeout(() => (btn.textContent = "📋 Copy plan"), 1500);
  });
}

// --- form wiring -----------------------------------------------------------

function showLoading() {
  const out = document.getElementById("result");
  out.innerHTML = `
    <div class="empty">
      <div class="empty-icon spin">🍳</div>
      <p>Cooking up your plan…</p>
    </div>`;
}

// Try the AI backend; fall back to the offline engine on any failure.
async function requestPlan(input) {
  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("ai_unavailable");
    const data = await res.json();
    if (!data || !data.plan) throw new Error("bad_response");
    data.input = data.input || { people: input.people, budget: input.budget };
    return data;
  } catch (err) {
    // Offline / no key / network: deterministic local engine keeps the demo alive.
    const local = generatePlan(input);
    local.source = "offline";
    return local;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("planner-form");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const meals = MEALS.filter(m => fd.get(m));
    if (meals.length === 0) {
      alert("Pick at least one meal to plan.");
      return;
    }
    const input = {
      breakfast: !!fd.get("breakfast"),
      lunch: !!fd.get("lunch"),
      dinner: !!fd.get("dinner"),
      people: Math.max(1, parseInt(fd.get("people"), 10) || 1),
      budget: Math.max(1, parseInt(fd.get("budget"), 10) || 200),
      diet: fd.get("diet"),
      cuisine: fd.get("cuisine"),
      maxPrep: parseInt(fd.get("maxPrep"), 10) || 60,
      dayText: (fd.get("dayText") || "").toString(),
      meals,
    };
    window._lastInput = input;
    showLoading();
    const result = await requestPlan(input);
    renderResult(result);
  });
});
