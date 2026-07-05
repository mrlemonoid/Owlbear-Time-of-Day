import OBR from "@owlbear-rodeo/sdk";
import "./style.css";
import {
  DEFAULT_ANCHORS,
  DEFAULT_STATE,
  ANCHOR_ORDER,
  clamp01,
  clampHour,
  makeStateFromHour,
  normalizeState,
} from "./constants.js";
import {
  disableSceneState,
  getSceneState,
  getSelectedMapIds,
  renderLocalOverlaysFromState,
  setSceneState,
} from "./filterEngine.js";

const app = document.querySelector("#app");

let state = { ...DEFAULT_STATE };
let connected = false;
let saveTimer = null;
let previewTimer = null;
let lastLocalUpdatedAt = 0;
let detailsOpen = true;
let transitionFrame = null;

function pct(value) {
  return Math.round(clamp01(value) * 100);
}

function formatTime(hourValue) {
  const total = Math.round(clampHour(hourValue) * 60) % 1440;
  const hh = Math.floor(total / 60).toString().padStart(2, "0");
  const mm = (total % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function hourToDegrees(hourValue) {
  return ((clampHour(hourValue) - 12) / 24) * 360;
}

function tintToCss(tint) {
  return `rgb(${Math.round((tint?.x ?? 1) * 255)}, ${Math.round((tint?.y ?? 1) * 255)}, ${Math.round((tint?.z ?? 1) * 255)})`;
}

function anchorLabel(key) {
  return {
    dawn: "Dawn",
    day: "Day",
    sunset: "Sunset",
    night: "Night",
  }[key] ?? key;
}

function selectedAnchor() {
  return state.anchors?.[state.selectedAnchor] ?? state.anchors?.day ?? DEFAULT_STATE.anchors.day;
}

function range(id, label, value) {
  const percent = pct(value);
  return `
    <label class="field" for="${id}">
      <span class="field__top"><span>${label}</span><strong id="${id}Value">${percent}%</strong></span>
      <input
        id="${id}"
        class="native-range"
        type="range"
        min="0"
        max="100"
        step="1"
        value="${percent}"
        data-setting="${id}"
      />
    </label>
  `;
}

function stopTransition() {
  if (transitionFrame !== null) {
    cancelAnimationFrame(transitionFrame);
    transitionFrame = null;
  }
}

function forwardHourDelta(fromHour, toHour) {
  const from = clampHour(fromHour);
  const to = clampHour(toHour);
  return (to - from + 24) % 24;
}

function lerpNumber(a, b, t) {
  return a + (b - a) * t;
}

function lerpTint(a, b, t) {
  return {
    x: lerpNumber(a?.x ?? 1, b?.x ?? 1, t),
    y: lerpNumber(a?.y ?? 1, b?.y ?? 1, t),
    z: lerpNumber(a?.z ?? 1, b?.z ?? 1, t),
  };
}

function interpolateVisualState(fromState, toState, t, hour) {
  return {
    ...toState,
    hour,
    label: t < 0.5 ? fromState.label : toState.label,
    darkness: lerpNumber(fromState.darkness ?? 0, toState.darkness ?? 0, t),
    tintAlpha: lerpNumber(fromState.tintAlpha ?? 0, toState.tintAlpha ?? 0, t),
    vignette: lerpNumber(fromState.vignette ?? 0, toState.vignette ?? 0, t),
    gradient: lerpNumber(fromState.gradient ?? 0, toState.gradient ?? 0, t),
    brighten: lerpNumber(fromState.brighten ?? 0, toState.brighten ?? 0, t),
    tint: lerpTint(fromState.tint, toState.tint, t),
  };
}

function animateToHour(targetHour, durationMs = 5000) {
  stopTransition();

  const startState = {
    ...state,
    tint: { ...(state.tint ?? {}) },
    anchors: structuredClone(state.anchors),
  };

  const targetState = makeStateFromHour(targetHour, {
    enabled: true,
    targetMode: state.targetMode,
    targetIds: state.targetIds ?? [],
    selectedAnchor: state.selectedAnchor,
    anchors: state.anchors,
  });

  const startHour = clampHour(state.hour);
  const delta = forwardHourDelta(startHour, clampHour(targetHour));
  const transition = {
    startedAt: Date.now(),
    durationMs,
    startHour,
    targetHour: clampHour(targetHour),
    hourDelta: delta,
    startState,
    targetState,
  };

  // Save the transition immediately so every connected client can animate it locally.
  void setSceneState({
    ...targetState,
    enabled: true,
    targetMode: state.targetMode,
    targetIds: state.targetIds ?? [],
    selectedAnchor: state.selectedAnchor,
    anchors: state.anchors,
    transition,
  });

  const start = performance.now();

  const tick = (now) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = t * t * (3 - 2 * t);
    const currentHour = clampHour(startHour + delta * eased);

    const frameState = {
      ...state,
      ...interpolateVisualState(startState, targetState, eased, currentHour),
      enabled: true,
      targetMode: state.targetMode,
      targetIds: state.targetIds ?? [],
      anchors: structuredClone(state.anchors),
      updatedAt: Date.now(),
    };

    state = frameState;
    updateDisplayOnly();
    void renderLocalOverlaysFromState(frameState);

    if (t < 1) {
      transitionFrame = requestAnimationFrame(tick);
    } else {
      transitionFrame = null;
      setHourFromMinutes(targetHour * 60, true);
    }
  };

  transitionFrame = requestAnimationFrame(tick);
}

function render() {

  const degree = hourToDegrees(state.hour);
  const time = formatTime(state.hour);
  const tintColor = tintToCss(state.tint);
  const anchor = selectedAnchor();

  app.innerHTML = `
    <section class="panel">
      <header class="hero">
        <div class="hero__title">
          <div>
            <p class="eyebrow">Owlbear Rodeo</p>
            <div class="title-row">
              <h1>Time of Day</h1>
              <div class="quick-actions" aria-label="Quick transitions">
                <button id="goDay" class="quick-action" type="button" title="Transition to day" aria-label="Transition to day">
                  <svg viewBox="0 0 24 24" class="quick-action__svg" aria-hidden="true">
                    <circle cx="12" cy="12" r="4.2"></circle>
                    <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"></path>
                  </svg>
                </button>
                <button id="goNight" class="quick-action" type="button" title="Transition to night" aria-label="Transition to night">
                  <svg viewBox="0 0 24 24" class="quick-action__svg" aria-hidden="true">
                    <path d="M16.5 4.8a7.8 7.8 0 1 0 2.7 14.9A8.6 8.6 0 1 1 16.5 4.8Z"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="status ${state.enabled ? "on" : "off"}">${state.enabled ? "LIVE" : "OFF"}</div>
      </header>

      <section class="card time-card">
        <div
          id="timeWheel"
          class="time-wheel draggable-wheel minimal-wheel"
          style="--angle: ${degree}deg; --tint: ${tintColor};"
          aria-label="Time of day preview"
        >
          <div class="wheel__halo"></div>
          <div class="wheel__dial"></div>
          <div class="wheel__knob"></div>

          <div class="wheel-icon wheel-icon--noon" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="wheel-icon__svg">
              <circle cx="12" cy="12" r="4.2"></circle>
              <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"></path>
            </svg>
          </div>

          <div class="wheel-icon wheel-icon--evening" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="wheel-icon__svg">
              <path d="M3 15.5h18M5 18h14M7 12.5c1.3-1.9 3-2.8 5-2.8s3.7.9 5 2.8"></path>
              <path d="M12 4.5v2.5"></path>
            </svg>
          </div>

          <div class="wheel-icon wheel-icon--midnight" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="wheel-icon__svg">
              <path d="M16.5 4.8a7.8 7.8 0 1 0 2.7 14.9A8.6 8.6 0 1 1 16.5 4.8Z"></path>
            </svg>
          </div>

          <div class="wheel-icon wheel-icon--morning" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="wheel-icon__svg">
              <path d="M3 15.5h18M5 18h14M7 12.5c1.3 1.9 3 2.8 5 2.8s3.7-.9 5-2.8"></path>
              <path d="M12 4.5v2.5"></path>
            </svg>
          </div>

          <div class="wheel__center">
            <strong id="timeText">${time}</strong>
            <span id="labelText">${state.label}</span>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Target</h2>
        <div class="segmented" role="group" aria-label="Target mode">
          <button id="allMaps" class="${state.targetMode === "allMaps" ? "selected" : ""}" type="button">All Maps</button>
          <button id="selectedMaps" class="${state.targetMode === "selectedMaps" ? "selected" : ""}" type="button">Selected Maps</button>
        </div>
        <p class="muted">
          ${state.targetMode === "selectedMaps" ? `${state.targetIds?.length ?? 0} selected map(s) saved.` : "The effect applies to every image on the MAP layer."}
        </p>
      </section>

      <section class="card compact">
        <details ${detailsOpen ? "open" : ""} id="fineTuneDetails">
          <summary>Fine Tuning</summary>
          <div class="anchor-tabs" role="group" aria-label="Anchor preset editor">
            ${ANCHOR_ORDER.map((key) => `<button type="button" class="anchor-tab ${state.selectedAnchor === key ? "selected" : ""}" data-anchor="${key}">${anchorLabel(key)}</button>`).join("")}
          </div>
          <p class="muted small">Editing this state: <strong>${anchorLabel(state.selectedAnchor)}</strong></p>
          ${range("darkness", "Darkness", anchor.darkness)}
          ${range("tintAlpha", "Tint", anchor.tintAlpha)}
          ${range("vignette", "Edge Darkening", anchor.vignette)}
          ${range("gradient", "Top Gradient", anchor.gradient)}
          ${range("brighten", "Brighten", anchor.brighten ?? 0)}
          <div class="mini-actions">
            <button id="resetPresets" type="button">Reset Presets</button>
          </div>
        </details>
      </section>

      <footer class="actions">
        <button id="toggleEnabled" class="primary" type="button">${state.enabled ? "Disable" : "Enable"}</button>
      </footer>
    </section>
  `;

  wireEvents();
}

function updateDisplayOnly() {
  const time = formatTime(state.hour);
  const wheel = document.querySelector("#timeWheel");
  const timeText = document.querySelector("#timeText");
  const labelText = document.querySelector("#labelText");
  if (wheel) {
    wheel.style.setProperty("--angle", `${hourToDegrees(state.hour)}deg`);
    wheel.style.setProperty("--tint", tintToCss(state.tint));
  }
  if (timeText) timeText.textContent = time;
  if (labelText) labelText.textContent = state.label ?? "Custom";
}

function schedulePreview() {
  if (!connected) return;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    void renderLocalOverlaysFromState({
      ...state,
      enabled: true,
      anchors: structuredClone(state.anchors),
      updatedAt: Date.now(),
    });
  }, 16);
}

function scheduleSave(immediate = false) {
  if (!connected) return;
  window.clearTimeout(saveTimer);

  const run = async () => {
    const saved = await setSceneState({ ...state, enabled: true });
    lastLocalUpdatedAt = saved.updatedAt;
    state = saved;
  };

  if (immediate) void run();
  else saveTimer = window.setTimeout(run, 120);
}

function deriveFromHour() {
  const derived = makeStateFromHour(state.hour, {
    enabled: true,
    targetMode: state.targetMode,
    targetIds: state.targetIds ?? [],
    selectedAnchor: state.selectedAnchor,
    anchors: state.anchors,
  });

  state = {
    ...state,
    ...derived,
    anchors: structuredClone(state.anchors),
    selectedAnchor: state.selectedAnchor,
    updatedAt: Date.now(),
  };
}

function setHourFromMinutes(minutes, immediate = false) {
  let nextHour = clampHour(Number(minutes) / 60);
  if (Math.abs(nextHour - 24) < 0.001) nextHour = 0;

  state = {
    ...state,
    hour: nextHour,
    enabled: true,
    updatedAt: Date.now(),
  };

  deriveFromHour();
  updateDisplayOnly();
  schedulePreview();
  scheduleSave(immediate);
}

function setAnchorValue(key, percent) {
  const value = clamp01(Number(percent) / 100);
  const anchorKey = state.selectedAnchor;

  state = {
    ...state,
    enabled: true,
    anchors: {
      ...state.anchors,
      [anchorKey]: {
        ...state.anchors[anchorKey],
        [key]: value,
      },
    },
    updatedAt: Date.now(),
  };

  const valueEl = document.querySelector(`#${key}Value`);
  if (valueEl) valueEl.textContent = `${pct(value)}%`;

  deriveFromHour();
  updateDisplayOnly();
  schedulePreview();
  scheduleSave(false);
}

function hourFromWheelEvent(event) {
  const wheel = document.querySelector("#timeWheel");
  if (!wheel) return state.hour;

  const rect = wheel.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const angle = Math.atan2(dx, -dy) * (180 / Math.PI);
  return ((angle / 360) * 24 + 12 + 24) % 24;
}

function wireEvents() {
  const wheel = document.querySelector("#timeWheel");
  wheel?.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    stopTransition();

    let activePointerId = event.pointerId;
    try { wheel.setPointerCapture(activePointerId); } catch (_) {}

    const update = (pointerEvent, immediate = false) => {
      if (activePointerId !== null && pointerEvent.pointerId !== activePointerId) return;
      pointerEvent.preventDefault();
      const hour = hourFromWheelEvent(pointerEvent);
      setHourFromMinutes(hour * 60, immediate);
    };

    const move = (moveEvent) => update(moveEvent, false);
    const up = (upEvent) => {
      update(upEvent, true);
      cleanup();
    };
    const cancel = () => cleanup();
    const cleanup = () => {
      try { wheel.releasePointerCapture(activePointerId); } catch (_) {}
      activePointerId = null;
      window.removeEventListener("pointermove", move, { capture: true });
      window.removeEventListener("pointerup", up, { capture: true });
      window.removeEventListener("pointercancel", cancel, { capture: true });
    };

    update(event, false);
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", up, { capture: true, passive: false });
    window.addEventListener("pointercancel", cancel, { capture: true, passive: false });
  }, { passive: false });

  document.querySelector("#goDay")?.addEventListener("click", () => {
    animateToHour(12, 5000);
  });

  document.querySelector("#goNight")?.addEventListener("click", () => {
    animateToHour(0, 5000);
  });

  document.querySelector("#allMaps")?.addEventListener("click", () => {
    state = { ...state, targetMode: "allMaps", targetIds: [] };
    render();
    schedulePreview();
    scheduleSave(true);
  });

  document.querySelector("#selectedMaps")?.addEventListener("click", async () => {
    if (!connected) return;
    const ids = await getSelectedMapIds();
    if (!ids.length) {
      await OBR.notification.show("Select at least one image on the MAP layer.", "WARNING");
      return;
    }
    state = { ...state, targetMode: "selectedMaps", targetIds: ids };
    render();
    schedulePreview();
    scheduleSave(true);
  });

  document.querySelector("#fineTuneDetails")?.addEventListener("toggle", (event) => {
    detailsOpen = event.currentTarget.open;
  });

  document.querySelectorAll(".anchor-tab").forEach((button) => {
    button.addEventListener("click", (event) => {
      const key = event.currentTarget.dataset.anchor;
      if (!key) return;
      state = { ...state, selectedAnchor: key };
      render();
    });
  });

  document.querySelectorAll(".native-range[data-setting]").forEach((input) => {
    input.addEventListener("input", (event) => {
      setAnchorValue(event.currentTarget.dataset.setting, event.currentTarget.value);
    });
    input.addEventListener("change", () => {
      scheduleSave(true);
    });
  });

  document.querySelector("#resetPresets")?.addEventListener("click", () => {
    stopTransition();
    state = {
      ...state,
      anchors: structuredClone(DEFAULT_ANCHORS),
      selectedAnchor: "day",
      hour: 12,
      enabled: true,
    };
    deriveFromHour();
    render();
    schedulePreview();
    scheduleSave(true);
  });

  document.querySelector("#toggleEnabled")?.addEventListener("click", async () => {
    stopTransition();
    if (!connected) return;

    if (state.enabled) {
      window.clearTimeout(saveTimer);
      await disableSceneState();
      state = { ...state, enabled: false };
      await renderLocalOverlaysFromState({ ...state, enabled: false });
      render();
      await OBR.notification.show("Time of Day disabled.");
      return;
    }

    state = {
      ...state,
      enabled: true,
      updatedAt: Date.now(),
    };
    deriveFromHour();
    render();
    schedulePreview();
    scheduleSave(true);
    await OBR.notification.show("Time of Day enabled.");
  });
}

async function init() {
  render();

  if (!OBR.isAvailable) return;

  OBR.onReady(async () => {
    connected = true;
    const ready = await OBR.scene.isReady();
    state = ready ? await getSceneState() : { ...DEFAULT_STATE };
    render();

    OBR.scene.onReadyChange(async (isReady) => {
      state = isReady ? await getSceneState() : { ...DEFAULT_STATE };
      render();
    });

    OBR.scene.onMetadataChange((metadata) => {
      const next = normalizeState(metadata);
      if (next.updatedAt && next.updatedAt === lastLocalUpdatedAt) return;
      state = next;
      render();
    });
  });
}

init();
