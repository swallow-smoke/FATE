// Step 4 — Narrative Kernel (02-Kernel/NarrativeKernel.md)
//
// The single arbiter: Directors never write CampaignState directly, they call
// Kernel.request(). MVP scope (§8):
//   - one request() with a requestType switch
//   - Canon-consistency validation only (§5 rule 1)
//   - no Director Debate (Story Director's proposal is accepted as-is)
//   - integrity check = required-field presence only
//
// The turn lifecycle steps this participates in (§4): 3, 5, 8, 9, 10, 11, 12
// are wired together by src/turn.js.

const sceneComposer = require("../scene/sceneComposer");
const relationshipGraph = require("../relationship/relationshipGraph");

// Fixed set of request types (NarrativeKernel §3). Extending requires updating
// the spec first.
const REQUEST_TYPES = new Set([
  "memory.write",
  "memory.promote", // accepted but deferred (no-op approve for MVP)
  "canon.register",
  "canon.update",
  "emotion.directive",
  "story.beat",
  "relationship.update", // deferred
  "flag.set",
  "scene.request",
  "trait.create", // Phase 9 F3 — dynamic traits
  "trait.update",
  "trait.delete", // Phase 10 M3 — faded-trait removal
  "plugin.register", // Phase 15 CC — declarative plugin manifest (validated, app-global)
]);

const TRAIT_CREATE_COOLDOWN = 20; // no new trait on the same character within N turns
const TRAIT_UPDATE_INTERVAL = 5;  // a given trait updates at most every N turns

function resp(approved, reason, patch = null, conflicts = []) {
  return { approved, reason, patch, conflicts };
}

function createKernel({ canonDb, memoryEngine }) {
  // Kernel.request(directorId, requestType, payload) but bound to the live
  // state so it can apply approved patches. state is passed per call.
  function request(state, directorId, requestType, payload) {
    if (!REQUEST_TYPES.has(requestType)) {
      return resp(false, `Unknown requestType "${requestType}"`);
    }
    const turn = state.turn_number;

    switch (requestType) {
      case "canon.register": {
        const r = canonDb.register(payload, turn);
        return resp(r.ok, r.reason || "registered", r.entity || null);
      }

      case "canon.update": {
        const r = canonDb.update(payload, turn);
        return resp(r.ok, r.reason || "updated", r.entity || null);
      }

      case "memory.write": {
        // Canon consistency: every canon_ref must be a registered entity
        // (CanonDatabase §6 / MemoryEngine §9). Otherwise reject.
        const missing = (payload.canon_refs || []).filter((r) => !canonDb.get(r));
        if (missing.length) {
          return resp(false, `memory references unregistered canon: ${missing.join(", ")}`);
        }
        const obj = memoryEngine.write(payload, turn);
        return resp(true, "memory written", obj);
      }

      case "flag.set": {
        if (!payload.flag_id) return resp(false, "flag_id required");
        // integrity (§6): guard against an obviously contradictory pair being
        // simultaneously true (e.g. saved_king vs killed_king).
        const contradiction = detectFlagContradiction(state, payload);
        if (contradiction) return resp(false, contradiction);

        const existing = state.story_flags.find((f) => f.flag_id === payload.flag_id);
        let flag;
        if (existing) {
          existing.value = payload.value;
          existing.set_at_turn = turn;
          if (payload.visible_to_player !== undefined) existing.visible_to_player = !!payload.visible_to_player;
          flag = existing;
        } else {
          flag = {
            flag_id: payload.flag_id,
            value: payload.value,
            set_at_turn: turn,
            visible_to_player: !!payload.visible_to_player,
          };
          state.story_flags.push(flag);
        }
        // Phase 11 T — a visible, true flag is a decision point (선택 히스토리
        // 트리). Logged once per flag; the journey view reads state.decision_points.
        if (flag.value === true && flag.visible_to_player) {
          state.decision_points = state.decision_points || [];
          if (!state.decision_points.some((d) => d.flag_id === flag.flag_id)) {
            state.decision_points.push({
              turn,
              flag_id: flag.flag_id,
              choice_summary: payload.choice_summary || String(flag.flag_id).replace(/_/g, " "),
              stage_at_time: (state.story_structure && state.story_structure.current_stage) || null,
              branch_origin: state.branch_origin || null,
            });
          }
        }
        return resp(true, "flag set", { flag_id: payload.flag_id, value: payload.value });
      }

      // Directives are transient turn artifacts, not persisted patches. With no
      // Director Debate, they pass through once Canon-consistent.
      case "emotion.directive":
        return resp(true, "emotion directive accepted", payload);

      case "story.beat":
        // MVP: accept Story Director's proposal as-is (no conflict adjudication).
        return resp(true, "story beat accepted", payload);

      case "scene.request": {
        const spec = sceneComposer.compose({
          emotion_directive: payload.emotion_directive,
          story_directive: payload.story_directive,
          rhythm_directive: payload.rhythm_directive,
          theme_directive: payload.theme_directive,
          sceneHistory: state.scene_history,
          turn,
          state,
        });
        return resp(true, "scene composed", spec);
      }

      // Phase 9 F3 — dynamic trait lifecycle. Owner defaults to the player; an
      // NPC owner is addressed by canon_ref (state.npcs[].dynamic_traits).
      case "trait.create": {
        if (!payload.name) return resp(false, "trait name required");
        const owner = traitOwner(state, payload.owner_ref);
        if (!owner) return resp(false, `trait owner "${payload.owner_ref}" not found`);
        owner.dynamic_traits = owner.dynamic_traits || [];
        // 1. duplicate name
        if (owner.dynamic_traits.some((t) => t.name === payload.name)) {
          return resp(false, `trait "${payload.name}" already exists`);
        }
        // 2. rate limit: one AI-detected trait per owner per cooldown window.
        //    Genre presets and manual adds are exempt — they must NOT count
        //    toward the window (otherwise the turn-0 preset blocks early traits).
        const lastCreated = owner.dynamic_traits
          .filter((t) => t.origin !== "genre_preset" && t.origin !== "manual")
          .reduce((m, t) => Math.max(m, t.origin_event_turn || 0), -Infinity);
        if (Number.isFinite(lastCreated) && turn - lastCreated < TRAIT_CREATE_COOLDOWN) {
          return resp(false, `trait rate-limited (last new trait ${turn - lastCreated} turns ago < ${TRAIT_CREATE_COOLDOWN})`);
        }
        // 3. origin must connect to this turn's canon (best-effort: refs registered)
        const refs = (payload.canon_refs || []).filter((r) => canonDb.get(r));
        const trait = {
          trait_id: `trait_${String((state.story_flags || []).length + owner.dynamic_traits.length + 1).padStart(4, "0")}_${turn}`,
          name: payload.name,
          category: payload.category || "psychological",
          origin_event_turn: turn,
          origin_summary: payload.origin_summary || "",
          canon_refs: refs,
          value: payload.value != null ? payload.value : 0.3,
          trend: "growing",
          last_updated_turn: turn,
          visible_to_player: payload.visible_to_player !== false, // default true (F1)
          origin: payload.origin || "auto",
          player_facing_description: payload.player_facing_description || payload.name,
        };
        owner.dynamic_traits.push(trait);
        return resp(true, "trait created", trait);
      }

      case "trait.update": {
        const owner = traitOwner(state, payload.owner_ref);
        if (!owner) return resp(false, `trait owner "${payload.owner_ref}" not found`);
        const trait = (owner.dynamic_traits || []).find((t) => t.trait_id === payload.trait_id || t.name === payload.name);
        if (!trait) return resp(false, "trait not found");
        if (turn - (trait.last_updated_turn || 0) < TRAIT_UPDATE_INTERVAL) {
          return resp(false, `trait update throttled (min ${TRAIT_UPDATE_INTERVAL} turns apart)`);
        }
        if (payload.value != null) trait.value = Math.max(0, Math.min(1, Number(payload.value)));
        if (payload.trend) trait.trend = payload.trend;
        if (payload.player_facing_description) trait.player_facing_description = payload.player_facing_description;
        trait.last_updated_turn = turn;
        return resp(true, "trait updated", trait);
      }

      // Phase 10 M3 — remove a faded trait, but keep a Historical memory note
      // that it once existed ("한때 이런 특성이 있었다").
      case "trait.delete": {
        const owner = traitOwner(state, payload.owner_ref);
        if (!owner) return resp(false, `trait owner "${payload.owner_ref}" not found`);
        const idx = (owner.dynamic_traits || []).findIndex((t) => t.trait_id === payload.trait_id || t.name === payload.name);
        if (idx < 0) return resp(false, "trait not found");
        const [removed] = owner.dynamic_traits.splice(idx, 1);
        try {
          memoryEngine.write({
            summary: `한때 지녔던 특성 "${removed.name}"이(가) 옅어져 사라졌다`,
            participants: ["player"], emotion_tags: ["change"], emotion_intensity: 1,
            canon_refs: [], tier: 3, tier_reason: "trait faded away -> Historical",
          }, turn);
        } catch (_) {}
        return resp(true, "trait deleted", removed);
      }

      case "relationship.update": {
        if (!payload.from || !payload.to) return resp(false, "relationship.update needs from/to");
        const edge = relationshipGraph.upsert(state, payload);
        return resp(true, "relationship updated", edge);
      }

      // Phase 15 CC3 — validate a plugin manifest through the same Kernel
      // envelope as everything else, then register it into the app-global table.
      // Not tied to CampaignState (plugins are global), so no state mutation.
      case "plugin.register": {
        const plugins = require("../plugins/plugins");
        const v = plugins.validateManifest(payload);
        if (!v.ok) return resp(false, v.reason || "plugin manifest invalid", { rejected: v.rejected || [] });
        const saved = plugins.register(v.manifest);
        return resp(true, "plugin registered", saved);
      }

      case "memory.promote":
        return resp(true, `${requestType} accepted (deferred no-op in MVP)`, null);

      default:
        return resp(false, `Unhandled requestType "${requestType}"`);
    }
  }

  // --- integrity check (§6) — required-field presence only for MVP --------
  function verifyIntegrity(state) {
    const required = ["campaign_id", "turn_number", "player", "npcs", "story_flags", "db_refs"];
    const missing = required.filter((k) => state[k] === undefined || state[k] === null);
    return { ok: missing.length === 0, missing };
  }

  return { request, verifyIntegrity, REQUEST_TYPES };
}

// Phase 9 F — resolve a dynamic-trait owner: the player by default, or an NPC
// addressed by canon_ref.
function traitOwner(state, ownerRef) {
  if (!ownerRef || ownerRef === "player" || ownerRef === "player_main") return state.player;
  return (state.npcs || []).find((n) => n.canon_ref === ownerRef) || null;
}

// Minimal contradictory-flag detection (§6). Recognizes verb-swapped pairs on
// the same subject, e.g. saved_king / killed_king both true.
const OPPOSITE_VERBS = [["saved", "killed"], ["freed", "captured"], ["helped", "betrayed"]];
function detectFlagContradiction(state, payload) {
  if (payload.value !== true) return null;
  for (const [a, b] of OPPOSITE_VERBS) {
    for (const [x, y] of [[a, b], [b, a]]) {
      if (payload.flag_id.startsWith(x + "_")) {
        const subject = payload.flag_id.slice(x.length);
        const opp = state.story_flags.find((f) => f.flag_id === y + subject && f.value === true);
        if (opp) return `contradicts existing flag "${opp.flag_id}"`;
      }
    }
  }
  return null;
}

module.exports = { createKernel, REQUEST_TYPES };
