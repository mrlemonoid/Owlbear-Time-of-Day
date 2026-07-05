export const ID = "com.mrlemon.time-of-day-filter";
export const STATE_KEY = `${ID}/state`;
export const LOCAL_EFFECT_KEY = `${ID}/local-effect`;
export const SCHEMA_VERSION = 11;

export const ANCHOR_ORDER = ["night", "dawn", "day", "sunset"];

export const DEFAULT_ANCHORS = {
  night: {
    key: "night",
    label: "Night",
    hour: 0,
    tint: { x: 0.12, y: 0.18, z: 0.42 },
    tintAlpha: 1.00,
    darkness: 0.70,
    vignette: 0.27,
    gradient: 0.11,
    brighten: 0.00,
  },
  dawn: {
    key: "dawn",
    label: "Dawn",
    hour: 6,
    tint: { x: 1.0, y: 0.58, z: 0.46 },
    tintAlpha: 1.00,
    darkness: 0.15,
    vignette: 0.20,
    gradient: 0.10,
    brighten: 0.00,
  },
  day: {
    key: "day",
    label: "Day",
    hour: 12,
    tint: { x: 1, y: 1, z: 1 },
    tintAlpha: 0,
    darkness: 0,
    vignette: 0,
    gradient: 0,
    brighten: 0.00,
  },
  sunset: {
    key: "sunset",
    label: "Sunset",
    hour: 18,
    tint: { x: 1.0, y: 0.46, z: 0.32 },
    tintAlpha: 0.45,
    darkness: 0.30,
    vignette: 0.02,
    gradient: 0.05,
    brighten: 0.00,
  },
};
export const DEFAULT_STATE = {
  schemaVersion: SCHEMA_VERSION,
  enabled: false,
  targetMode: "allMaps",
  targetIds: [],
  hour: 12,
  selectedAnchor: "day",
  anchors: structuredClone(DEFAULT_ANCHORS),
  darkness: DEFAULT_ANCHORS.day.darkness,
  tintAlpha: DEFAULT_ANCHORS.day.tintAlpha,
  vignette: DEFAULT_ANCHORS.day.vignette,
  gradient: DEFAULT_ANCHORS.day.gradient,
  brighten: DEFAULT_ANCHORS.day.brighten,
  tint: { ...DEFAULT_ANCHORS.day.tint },
  label: DEFAULT_ANCHORS.day.label,
  updatedAt: 0,
};

export function clamp01(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function clampHour(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 12;
  return ((n % 24) + 24) % 24;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smooth(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function mixTint(a, b, t) {
  const k = smooth(t);
  return {
    x: clamp01(lerp(a.x, b.x, k)),
    y: clamp01(lerp(a.y, b.y, k)),
    z: clamp01(lerp(a.z, b.z, k)),
  };
}

export function mergeAnchors(anchors) {
  const merged = structuredClone(DEFAULT_ANCHORS);
  for (const key of ANCHOR_ORDER) {
    if (!anchors?.[key]) continue;
    merged[key] = {
      ...merged[key],
      ...anchors[key],
      tint: {
        ...merged[key].tint,
        ...(anchors[key].tint ?? {}),
      },
    };
  }
  return merged;
}

function anchorCopy(anchor) {
  return {
    darkness: clamp01(anchor.darkness),
    tintAlpha: clamp01(anchor.tintAlpha),
    vignette: clamp01(anchor.vignette),
    gradient: clamp01(anchor.gradient),
    brighten: clamp01(anchor.brighten ?? 0),
    tint: { ...anchor.tint },
    label: anchor.label,
  };
}

function mixAnchor(fromAnchor, toAnchor, t) {
  const k = smooth(t);
  return {
    label: `${fromAnchor.label} → ${toAnchor.label}`,
    darkness: clamp01(lerp(fromAnchor.darkness, toAnchor.darkness, k)),
    tintAlpha: clamp01(lerp(fromAnchor.tintAlpha, toAnchor.tintAlpha, k)),
    vignette: clamp01(lerp(fromAnchor.vignette, toAnchor.vignette, k)),
    gradient: clamp01(lerp(fromAnchor.gradient, toAnchor.gradient, k)),
    brighten: clamp01(lerp(fromAnchor.brighten ?? 0, toAnchor.brighten ?? 0, k)),
    tint: mixTint(fromAnchor.tint, toAnchor.tint, k),
  };
}

function blendForHour(hourValue, anchors) {
  const hour = clampHour(hourValue);

  // More natural day/night rhythm for tabletop play:
  // 21:00–04:30 sustained evening/night
  // 08:00–16:30 clean daylight
  // gradual transitions around dawn and sunset
  if (hour < 4.5) return anchorCopy(anchors.night);
  if (hour < 6.5) return mixAnchor(anchors.night, anchors.dawn, (hour - 4.5) / 2);
  if (hour < 8.0) return mixAnchor(anchors.dawn, anchors.day, (hour - 6.5) / 1.5);
  if (hour < 16.5) return anchorCopy(anchors.day);
  if (hour < 18.5) return mixAnchor(anchors.day, anchors.sunset, (hour - 16.5) / 2);
  if (hour < 21.0) return mixAnchor(anchors.sunset, anchors.night, (hour - 18.5) / 2.5);
  return anchorCopy(anchors.night);
}

export function nearestAnchorKey(hourValue) {
  const hour = clampHour(hourValue);
  if (hour >= 4.5 && hour < 8.0) return "dawn";
  if (hour >= 8.0 && hour < 16.5) return "day";
  if (hour >= 16.5 && hour < 21.0) return "sunset";
  return "night";
}

export function isCloseToDay(hour) {
  return Math.abs(clampHour(hour) - 12) <= 0.08;
}

export function isNeutralState(state) {
  return (
    clamp01(state.darkness) <= 0.002 &&
    clamp01(state.tintAlpha) <= 0.002 &&
    clamp01(state.vignette) <= 0.002 &&
    clamp01(state.gradient) <= 0.002 &&
    clamp01(state.brighten ?? 0) <= 0.002
  );
}

export function makeStateFromHour(hourValue, patch = {}) {
  const rawHour = clampHour(hourValue);
  const hour = isCloseToDay(rawHour) ? 12 : rawHour;
  const anchors = mergeAnchors(patch.anchors);
  const blend = blendForHour(hour, anchors);

  return {
    ...DEFAULT_STATE,
    enabled: patch.enabled ?? true,
    targetMode: patch.targetMode ?? DEFAULT_STATE.targetMode,
    targetIds: Array.isArray(patch.targetIds) ? patch.targetIds : [],
    hour,
    selectedAnchor: patch.selectedAnchor ?? nearestAnchorKey(hour),
    anchors,
    label: blend.label,
    darkness: blend.darkness,
    tintAlpha: blend.tintAlpha,
    vignette: blend.vignette,
    gradient: blend.gradient,
    brighten: blend.brighten ?? 0,
    tint: blend.tint,
    updatedAt: patch.updatedAt ?? Date.now(),
  };
}

export function serializeState(state) {
  const serialized = {
    schemaVersion: SCHEMA_VERSION,
    enabled: Boolean(state.enabled),
    targetMode: state.targetMode ?? DEFAULT_STATE.targetMode,
    targetIds: Array.isArray(state.targetIds) ? state.targetIds : [],
    hour: clampHour(state.hour ?? DEFAULT_STATE.hour),
    selectedAnchor: state.selectedAnchor ?? nearestAnchorKey(state.hour ?? DEFAULT_STATE.hour),
    anchors: mergeAnchors(state.anchors),
    updatedAt: Date.now(),
  };

  if (state.transition) {
    serialized.transition = state.transition;
  }

  return serialized;
}

export function normalizeState(metadata) {
  const saved = metadata?.[STATE_KEY];

  // New schema: intentionally ignores older saved values from previous experimental builds.
  if (!saved || saved.schemaVersion !== SCHEMA_VERSION) {
    return { ...DEFAULT_STATE, anchors: structuredClone(DEFAULT_ANCHORS) };
  }

  return makeStateFromHour(saved.hour ?? DEFAULT_STATE.hour, {
    enabled: saved.enabled ?? DEFAULT_STATE.enabled,
    targetMode: saved.targetMode ?? DEFAULT_STATE.targetMode,
    targetIds: Array.isArray(saved.targetIds) ? saved.targetIds : [],
    selectedAnchor: saved.selectedAnchor ?? nearestAnchorKey(saved.hour ?? DEFAULT_STATE.hour),
    anchors: mergeAnchors(saved.anchors),
    updatedAt: saved.updatedAt ?? 0,
  });
}
