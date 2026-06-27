// ============================================================================
// Recipe AI backend for the Family Dinner Planner — Cloudflare Worker.
//
// Handles three tasks:
//   task: "revise"      {dish, recipe, note}            -> {recipe}   (fold a cook's note in)
//   task: "ingredients" {dish, recipe}                  -> {ingredients:[...]}  (steps -> grocery list)
//   task: "recipe"      {dish, ingredients[], notes}    -> {recipe}   (ingredients -> draft recipe)
//
// Your Anthropic API key stays SECRET here as an environment variable. It must
// NEVER be put in index.html or committed to GitHub. See RECIPE_AI_SETUP.md.
// ============================================================================

const ALLOW_ORIGIN = "*"; // optional: lock to your site, e.g. "https://yourname.github.io"

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
    let prompt, mode;

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
        `Write a simple home dinner recipe for "${dish}" using these ingredients: ${ingredients}.` +
        (notes ? ` Notes: ${notes}.` : "") +
        ` Keep it family-friendly and concise: short numbered steps, no headings, no ` +
        `commentary. Return ONLY the recipe steps.`;
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
          max_tokens: 1024,
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
    return json({ recipe: out });
  },
};
