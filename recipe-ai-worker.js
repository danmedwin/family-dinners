// ============================================================================
// Recipe AI backend for the Family Dinner Planner — Cloudflare Worker.
//
// Handles four tasks:
//   task: "revise"      {dish, recipe, note}          -> {recipe}
//   task: "ingredients" {dish, recipe}                -> {ingredients:[...]}
//   task: "recipe"      {dish, ingredients[], notes}  -> {recipe}
//   task: "ideas"       {count, criteria, have}       -> {ideas:[{name,desc,type,dairy,healthy,prep,ing,recipe}]}
//
// Your Anthropic API key stays SECRET here as an environment variable. It must
// NEVER be put in index.html or committed to GitHub. See RECIPE_AI_SETUP.md.
// ============================================================================

const ALLOW_ORIGIN = "*"; // optional: lock to your site, e.g. "https://techrabbi.org"

function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...cors(), "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });
    if (request.method !== "POST") return json({ error: "POST only" }, 405);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: "invalid JSON body" }, 400); }

    const dish = String(body.dish || "a dish").slice(0, 200);
    const task = body.task || "revise";
    let prompt, mode, maxTokens = 1024;

    if (task === "ingredients") {
      mode = "ingredients";
      const steps = String(body.recipe || "").slice(0, 4000);
      if (!steps) return json({ error: "no steps provided" }, 400);
      prompt =
        `From the cooking steps for "${dish}", list the grocery ingredients needed. ` +
        `One ingredient per line. Use simple shopping names only — no quantities, no ` +
        `measurements, no step numbers, no bullets. Skip water, salt, and pepper. ` +
        `Return ONLY the list.\n\nSTEPS:\n${steps}`;
    } else if (task === "recipe") {
      mode = "recipe";
      const ingredients = Array.isArray(body.ingredients)
        ? body.ingredients.join(", ")
        : String(body.ingredients || "");
      if (!ingredients.trim()) return json({ error: "no ingredients provided" }, 400);
      const notes = String(body.notes || "").slice(0, 500);
      prompt =
        `Write a simple home dinner recipe for "${dish}" using these ingredients: ${ingredients}. ` +
        `You don't need to use every ingredient — use what makes a good dish, and you may add ` +
        `common pantry staples.` + (notes ? ` Notes: ${notes}.` : "") +
        ` Keep it family-friendly and concise: short numbered steps, no headings, no ` +
        `commentary. Return ONLY the recipe steps.`;
    } else if (task === "ideas") {
      mode = "ideas";
      maxTokens = 3500;
      const c = body.criteria || {};
      const have = String(body.have || "").slice(0, 1000);
      const count = Math.min(Math.max(parseInt(body.count) || 6, 1), 10);
      const typeMap = { veg: "vegetarian", poultry: "poultry (chicken/turkey)", meat: "beef", fish: "fish" };
      const types = Array.isArray(c.types) && c.types.length
        ? c.types.map((t) => typeMap[t] || t).join(", ") : "any protein";
      const prepMap = { u15: "under 15 minutes", "15-30": "15–30 minutes", "30-45": "30–45 minutes", any: "any prep time" };
      const prep = prepMap[c.prep] || "any prep time";
      const constraints = ["protein types: " + types, "prep time: " + prep];
      if (c.healthy) constraints.push("healthy");
      if (c.nondairy) constraints.push("non-dairy (avoid heavy dairy like alfredo)");
      if (c.notes) constraints.push("notes: " + String(c.notes).slice(0, 200));
      prompt =
        `Suggest ${count} family dinner ideas. Keep them Reform-kosher: no pork, no shellfish; ` +
        `meat and dairy together is allowed but prefer non-dairy. Constraints: ${constraints.join("; ")}.` +
        (have ? ` The family has these ingredients on hand — build dishes mainly around them; you do ` +
          `NOT need to use all of them, and you may add common pantry items: ${have}.` : "") +
        ` Return ONLY a JSON array (no markdown fences, no commentary) of exactly ${count} objects, ` +
        `each with keys: "name" (string), "desc" (one short sentence), "type" (one of "veg","poultry",` +
        `"meat","fish"), "dairy" (boolean; true only if it needs real dairy), "healthy" (boolean), ` +
        `"prep" (one of "under 15 min","15–30 min","30–45 min"), "ing" (array of simple grocery item ` +
        `names, no quantities), "recipe" (string of short numbered steps separated by \\n). Return only the JSON array.`;
    } else if (task === "align") {
      mode = "align";
      maxTokens = 600;
      const recipe = String(body.recipe || "").slice(0, 4000);
      const ingredients = Array.isArray(body.ingredients) ? body.ingredients.join(", ") : String(body.ingredients || "");
      if (!recipe || !ingredients.trim()) return json({ issues: [] });
      prompt =
        `Compare the ingredient list and the recipe steps for "${dish}". Identify mismatches: ` +
        `(a) ingredients listed but never used in the steps, and (b) items used in the steps but ` +
        `missing from the ingredient list. Ignore water, salt, and pepper. Be concise. Return ONLY ` +
        `a JSON array of short strings, one per issue (e.g. "garlic is in the steps but not the ingredient list"). ` +
        `If everything lines up, return [].\n\nINGREDIENTS:\n${ingredients}\n\nRECIPE:\n${recipe}`;
    } else {
      mode = "recipe";
      const recipe = String(body.recipe || "").slice(0, 4000);
      const note = String(body.note || "").slice(0, 1000);
      if (!note) return json({ error: "no note provided" }, 400);
      prompt =
        `You are helping a family keep their dinner recipes up to date. Update the recipe ` +
        `below for "${dish}" to incorporate the cook's note. Make the smallest change that ` +
        `captures the note; keep the rest, the tone, and the formatting the same. Do not add ` +
        `commentary or headings. Return ONLY the revised recipe text.\n\n` +
        `CURRENT RECIPE:\n${recipe || "(no recipe yet)"}\n\nCOOK'S NOTE:\n${note}`;
    }

    let r, text;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: env.MODEL || "claude-haiku-4-5-20251001",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      text = await r.text();
    } catch (e) {
      return json({ error: "could not reach Anthropic", detail: String(e) }, 502);
    }

    if (!r.ok) return json({ error: "anthropic " + r.status, detail: text.slice(0, 500) }, 502);

    let data = {};
    try { data = JSON.parse(text); } catch (e) {}
    const out = ((data.content && data.content[0] && data.content[0].text) || "").trim();

    if (mode === "ingredients") {
      const ingredients = out
        .split("\n")
        .map((l) => l.replace(/^[\s\-\*\d\.\)]+/, "").trim())
        .filter(Boolean);
      return json({ ingredients });
    }
    if (mode === "align") {
      let txt = out.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
      let issues = [];
      try { issues = JSON.parse(txt); }
      catch (e) { const s = txt.indexOf("["), ei = txt.lastIndexOf("]"); if (s >= 0 && ei > s) { try { issues = JSON.parse(txt.slice(s, ei + 1)); } catch (e2) {} } }
      if (!Array.isArray(issues)) issues = [];
      return json({ issues });
    }
    if (mode === "ideas") {
      let txt = out.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
      let ideas = [];
      try { ideas = JSON.parse(txt); }
      catch (e) {
        const s = txt.indexOf("["), ei = txt.lastIndexOf("]");
        if (s >= 0 && ei > s) { try { ideas = JSON.parse(txt.slice(s, ei + 1)); } catch (e2) {} }
      }
      if (!Array.isArray(ideas)) ideas = [];
      return json({ ideas });
    }
    return json({ recipe: out });
  },
};
