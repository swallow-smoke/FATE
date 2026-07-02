// Phase 3 · Wave 2 · System 6 — Rhythm Director
//
// Promotes Phase 2's ad-hoc "low-intensity 3-type cycle" heuristic into a real
// Director. Aggregates the last 10 turns of scene_type + intensity, flags
// over-used types, and proposes intensity spikes when the pace goes flat. The
// intensity swing width widens with Narrative DNA survival/horror (Wave 3 §12).

const WINDOW = 10;
const OVERUSE_RATIO = 0.4;

function run(state) {
  const hist = (state.scene_history || []).slice(-WINDOW);
  const n = hist.length;

  // 1-2. scene_type distribution -> avoid over-used types (>= 40%).
  const typeCount = {};
  hist.forEach((h) => (h.scene_type || []).forEach((t) => (typeCount[t] = (typeCount[t] || 0) + 1)));
  const avoid_scene_types = Object.entries(typeCount)
    .filter(([, c]) => n >= 4 && c / n >= OVERUSE_RATIO)
    .map(([t]) => t);

  // 3. intensity variance -> propose a spike when everything hovers mid.
  const intensities = hist.map((h) => (h.intensity != null ? h.intensity : 2));
  let intensity_spike = null;
  if (n >= 4) {
    const mean = intensities.reduce((s, x) => s + x, 0) / n;
    const variance = intensities.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    const dna = state.narrative_dna || {};
    const allowHighSpike = (dna.survival || 0) + (dna.horror || 0) >= 5; // Wave 3 §12 wiring
    if (variance < 0.5) {
      if (mean >= 2.5 && !allowHighSpike) intensity_spike = "low"; // cool down
      else intensity_spike = allowHighSpike ? "high" : "low";
    }
  }

  const reasons = [];
  if (avoid_scene_types.length) reasons.push(`over-used: ${avoid_scene_types.join(",")}`);
  if (intensity_spike) reasons.push(`flat intensity -> ${intensity_spike} spike`);

  return {
    avoid_scene_types,
    intensity_spike, // null | "low" | "high"
    reason: reasons.join(" | ") || "pace ok",
  };
}

module.exports = { run };
