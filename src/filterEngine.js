import OBR, { buildEffect, isImage } from "@owlbear-rodeo/sdk";
import {
  DEFAULT_STATE,
  LOCAL_EFFECT_KEY,
  STATE_KEY,
  clamp01,
  isNeutralState,
  normalizeState,
  serializeState,
} from "./constants.js";

// Conservative overlay: mostly black darkening.
// Tinting is intentionally subtle to avoid washing out map colors.
const OVERLAY_SKSL = `
uniform vec2 size;
uniform vec3 tint;
uniform float tintAlpha;
uniform float darkness;
uniform float vignette;
uniform float gradient;
uniform float brighten;

half4 main(float2 coord) {
  vec2 uv = coord / size;

  float centerDistance = distance(uv, vec2(0.5, 0.5));
  float vignetteMask = smoothstep(0.34, 0.86, centerDistance);

  float topMask = 1.0 - smoothstep(0.0, 1.0, uv.y);

  float darkAlpha = darkness * 0.78;
  float vignetteAlpha = vignette * vignetteMask * 0.55;
  float gradientAlpha = gradient * topMask * 0.28;
  float colorAlpha = tintAlpha * 0.18;
  float brightenAlpha = brighten * 0.58;

  float alpha = clamp(darkAlpha + vignetteAlpha + gradientAlpha + colorAlpha + brightenAlpha, 0.0, 0.88);

  vec3 mostlyBlack = vec3(0.0, 0.0, 0.0);
  vec3 subtleTint = mix(mostlyBlack, tint, clamp(tintAlpha * 0.32, 0.0, 0.18));
  vec3 brightenTint = vec3(1.0, 1.0, 1.0);
  vec3 finalColor = mix(subtleTint, brightenTint, clamp(brighten * 1.25, 0.0, 1.0));

  return half4(finalColor, alpha);
}
`;

function isMapImage(item) {
  return item?.layer === "MAP" && isImage(item);
}

function isOurLocalEffect(item) {
  return Boolean(item?.metadata?.[LOCAL_EFFECT_KEY]);
}

function targetMatches(state, item) {
  if (!isMapImage(item)) return false;
  if (state.targetMode === "selectedMaps") {
    return Array.isArray(state.targetIds) && state.targetIds.includes(item.id);
  }
  return true;
}

function getExistingEffectByTarget(localItems) {
  const map = new Map();
  for (const item of localItems) {
    const meta = item?.metadata?.[LOCAL_EFFECT_KEY];
    if (meta?.targetId) map.set(meta.targetId, item);
  }
  return map;
}

function makeUniforms(state) {
  return [
    { name: "tint", value: state.tint ?? DEFAULT_STATE.tint },
    { name: "tintAlpha", value: clamp01(state.tintAlpha) },
    { name: "darkness", value: clamp01(state.darkness) },
    { name: "vignette", value: clamp01(state.vignette) },
    { name: "gradient", value: clamp01(state.gradient) },
    { name: "brighten", value: clamp01(state.brighten ?? 0) },
  ];
}

function buildOverlayForMap(mapItem, state) {
  const effect = buildEffect()
    .name(`Time of Day - ${state.label ?? "Filter"}`)
    .effectType("ATTACHMENT")
    .attachedTo(mapItem.id)
    .layer("MAP")
    .sksl(OVERLAY_SKSL)
    .uniforms(makeUniforms(state))
    .locked(true)
    .disableHit(true)
    .build();

  effect.metadata = {
    ...(effect.metadata ?? {}),
    [LOCAL_EFFECT_KEY]: {
      targetId: mapItem.id,
      updatedAt: state.updatedAt,
    },
  };

  return effect;
}

export async function clearLocalOverlays() {
  const localItems = await OBR.scene.local.getItems(isOurLocalEffect);
  if (localItems.length) {
    await OBR.scene.local.deleteItems(localItems.map((item) => item.id));
  }
}

export async function renderLocalOverlaysFromState(stateInput) {
  const state = { ...DEFAULT_STATE, ...stateInput };
  const ready = await OBR.scene.isReady();

  if (!ready || !state.enabled || isNeutralState(state)) {
    await clearLocalOverlays();
    return;
  }

  const [sceneItems, localItems] = await Promise.all([
    OBR.scene.items.getItems(isMapImage),
    OBR.scene.local.getItems(isOurLocalEffect),
  ]);

  const targets = sceneItems.filter((item) => targetMatches(state, item));
  const targetIds = new Set(targets.map((item) => item.id));
  const existingByTarget = getExistingEffectByTarget(localItems);
  const obsoleteIds = [];

  for (const localItem of localItems) {
    const targetId = localItem?.metadata?.[LOCAL_EFFECT_KEY]?.targetId;
    if (!targetId || !targetIds.has(targetId)) obsoleteIds.push(localItem.id);
  }

  if (obsoleteIds.length) await OBR.scene.local.deleteItems(obsoleteIds);

  const toAdd = [];
  const toUpdate = [];
  for (const target of targets) {
    const existing = existingByTarget.get(target.id);
    if (!existing) toAdd.push(buildOverlayForMap(target, state));
    else toUpdate.push(existing.id);
  }

  if (toAdd.length) await OBR.scene.local.addItems(toAdd);

  if (toUpdate.length) {
    await OBR.scene.local.updateItems(toUpdate, (items) => {
      for (const item of items) {
        item.name = `Time of Day - ${state.label ?? "Filter"}`;
        item.sksl = OVERLAY_SKSL;
        item.uniforms = makeUniforms(state);
        item.layer = "MAP";
        item.locked = true;
        item.disableHit = true;
        item.metadata = item.metadata ?? {};
        item.metadata[LOCAL_EFFECT_KEY] = {
          ...(item.metadata[LOCAL_EFFECT_KEY] ?? {}),
          updatedAt: state.updatedAt,
        };
      }
    });
  }
}

export async function renderLocalOverlaysFromMetadata(metadata) {
  const state = normalizeState(metadata);
  await renderLocalOverlaysFromState(state);
}

export async function getSceneState() {
  const metadata = await OBR.scene.getMetadata();
  return normalizeState(metadata);
}

export async function setSceneState(state) {
  const next = serializeState(state);
  await OBR.scene.setMetadata({ [STATE_KEY]: next });
  return normalizeState({ [STATE_KEY]: next });
}

export async function disableSceneState() {
  const state = await getSceneState();
  await setSceneState({ ...state, enabled: false, updatedAt: Date.now() });
}

export async function getSelectedMapIds() {
  const selection = await OBR.player.getSelection();
  if (!selection?.length) return [];
  const selected = await OBR.scene.items.getItems(
    (item) => selection.includes(item.id) && isMapImage(item),
  );
  return selected.map((item) => item.id);
}
