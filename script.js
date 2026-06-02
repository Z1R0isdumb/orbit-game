const labArea = document.getElementById("labArea");
const canvas = document.getElementById("spaceCanvas");
const ctx = canvas.getContext("2d");
const clearButton = document.getElementById("clearButton");
const pauseButton = document.getElementById("pauseButton");
const fullscreenButton = document.getElementById("fullscreenButton");
const bodyCount = document.getElementById("bodyCount");
const massTotal = document.getElementById("massTotal");
const debrisCount = document.getElementById("debrisCount");
const debrisStat = debrisCount ? debrisCount.closest(".stat, .hud-stat, .counter, div") : null;

if (debrisStat) {
  debrisStat.style.display = "none";
}

const observationTitle = document.getElementById("observationTitle");
const observationText = document.getElementById("observationText");

const COLORS = ["#f7c948", "#42f5d7", "#7c3cff", "#ff4f8b", "#7cff6b", "#f97316", "#60a5fa"];

const G = 1.75;
const SOFTENING = 420;
const MIN_RADIUS = 3;
const MAX_RADIUS = 110;
const GROWTH_RATE = 0.015;
const LAUNCH_SCALE = 0.034;
const MAX_SPEED = 38;
const PHYSICS_STEP = 0.34;

const GRAVITY_RADIUS_MULTIPLIER = 10;
const MIN_GRAVITY_RADIUS = 35;
const MAX_GRAVITY_RADIUS = 1100;
const GRAVITY_EDGE_FADE_START = 1;

const GRAVITY_CAPTURE_STRENGTH = 0.018;
const GRAVITY_CAPTURE_MIN_TANGENT = 0.18;
const GRAVITY_CAPTURE_MAX_DISTANCE_RATIO = 0.96;

const MIN_REACTION_MASS_RATIO = 0.6;
const BLACK_HOLE_GRAVITY = 16;
const BLACK_HOLE_RADIUS_MULTIPLIER = 3.2;
const BLACK_HOLE_DRAG = 0.018;
const BLACK_HOLE_INWARD_PULL = 0.0001;
const BLACK_HOLE_MAX_SPEED = 0.2;
const MOON_MASS_RATIO = 0.1;

const ORBIT_FOLLOW_STRENGTH = 0.075;
const ORBIT_RADIUS_STRENGTH = 0.035;
const MOON_FOLLOW_STRENGTH = 0.13;
const MOON_RADIUS_STRENGTH = 1.07;


const MIN_VIEW_ZOOM = 0.22;
const MAX_VIEW_ZOOM = 3.2;
const ZOOM_STEP = 1.12;

const COLLISION_DISTANCE = 0.9;
const SLOW_MERGE_SPEED = 2.8;
const MAX_TRAIL_POINTS = 1200;
const MAX_DEBRIS = 420;

const ORBIT_SAMPLE_LIMIT = 220;
const ORBIT_CONFIRM_SCORE = 74;
const ORBIT_VARIANCE_LIMIT = 0.52;

const TINY_IMPACT_MASS_RATIO = 0.08;
const TINY_IMPACT_RADIUS_RATIO = 0.34;

let bodies = [];
let debris = [];
let draftBody = null;
let pointerIsDown = false;
let pointerId = null;
let animationId = null;
let isPaused = false;
let lastTime = 0;
let observationCooldown = 0;
let cameraX = 0;
let cameraY = 0;
let cameraZoom = 1;

let isCameraDragging = false;
let cameraDragPointerId = null;
let cameraDragStartX = 0;
let cameraDragStartY = 0;
let cameraStartX = 0;
let cameraStartY = 0;

let massPanel = null;
let massPanelList = null;

let configPanel = null;
let hideTrails = false;
let isMuted = false;
let hideAllUi = false;

let lastMassPanelSignature = "";
let lastMassPanelBodyIds = "";

const SOUND_VOLUME = 0.65;
const LOOP_VOLUME = 0.18;
const BLACK_HOLE_LOOP_VOLUME = LOOP_VOLUME;
const BLACK_HOLE_SOUND_MIN_SCREEN_RADIUS = 8;
const BLACK_HOLE_SOUND_FULL_SCREEN_RADIUS = 95;
const SOUND_FADE_MS = 4000;
const LOOP_CROSSFADE_SECONDS = 4;
const BLACK_HOLE_SOUND_SCREEN_RANGE = 0.72;

const SOUND_FILES = {
  planetAdd: "Orbit/planetadd.wav",
  planetChange: "Orbit/planetchange.wav",
  planetGrow: "Orbit/planetgrow.wav",
  planetLoop: "Orbit/planetloop.wav",
  planetMerge: "Orbit/planetmerge.wav",
  blackHole: "Orbit/blackhole.wav"
};

const sounds = {};
let growSound = null;
let loopSound = null;
let nextLoopSound = null;
let loopCrossfadeTimer = null;
let loopIsStopping = false;

let blackHoleLoopSound = null;
let nextBlackHoleLoopSound = null;
let blackHoleLoopTimer = null;
let blackHoleLoopIsStopping = false;
let blackHoleLoopTargetVolume = 0;

function setupSounds() {
  Object.entries(SOUND_FILES).forEach(([name, src]) => {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.volume = SOUND_VOLUME;
    sounds[name] = audio;
  });
}



function playSound(name, volume = SOUND_VOLUME) {
  if (isMuted) {
  return;
}
  const baseSound = sounds[name];

  if (!baseSound) {
    return;
  }

  const sound = baseSound.cloneNode();
  sound.volume = volume;
  sound.currentTime = 0;

  sound.play().catch(() => {
    // Browser blocked audio or file path is wrong.
  });
}

function setAudioStartTime(audio, seconds) {
  const setTime = () => {
    try {
      if (Number.isFinite(audio.duration) && audio.duration > seconds) {
        audio.currentTime = seconds;
      } else {
        audio.currentTime = 0;
      }
    } catch (error) {
      audio.currentTime = 0;
    }
  };

  if (audio.readyState >= 1) {
    setTime();
  } else {
    audio.addEventListener("loadedmetadata", setTime, { once: true });
  }
}

function fadeAudio(audio, targetVolume, duration = SOUND_FADE_MS, onDone = null) {
  const startVolume = audio.volume;
  const startTime = performance.now();

  function step(now) {
    const progress = clamp((now - startTime) / duration, 0, 1);
    audio.volume = startVolume + (targetVolume - startVolume) * progress;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else if (onDone) {
      onDone();
    }
  }

  requestAnimationFrame(step);
}

function startGrowSound() {
  if (growSound) {
    return;
  }

  const baseSound = sounds.planetGrow;

  if (!baseSound) {
    return;
  }

  growSound = baseSound.cloneNode();
  growSound.loop = true;
  growSound.volume = 0;

  setAudioStartTime(growSound, 20);

  growSound.play().then(() => {
    fadeAudio(growSound, SOUND_VOLUME, SOUND_FADE_MS);
  }).catch(() => {
    growSound = null;
  });
}

function stopGrowSound() {
  if (!growSound) {
    return;
  }

  const soundToStop = growSound;
  growSound = null;

  fadeAudio(soundToStop, 0, 250, () => {
    soundToStop.pause();
    soundToStop.currentTime = 0;
  });
}

function startSpaceLoopSound() {
  if (loopSound) {
    return;
  }

  const baseSound = sounds.planetLoop;

  if (!baseSound) {
    return;
  }

  loopIsStopping = false;

  loopSound = createLoopSoundInstance();
  loopSound.volume = 0;

  loopSound.play().then(() => {
    fadeAudio(loopSound, LOOP_VOLUME, SOUND_FADE_MS);
    scheduleLoopCrossfade(loopSound);
  }).catch(() => {
    loopSound = null;
  });
}

function stopSpaceLoopSound() {
  loopIsStopping = true;

  if (loopCrossfadeTimer) {
    clearTimeout(loopCrossfadeTimer);
    loopCrossfadeTimer = null;
  }

  const current = loopSound;
  const next = nextLoopSound;

  loopSound = null;
  nextLoopSound = null;

  if (current) {
    fadeAudio(current, 0, 500, () => {
      current.pause();
      current.currentTime = 0;
    });
  }

  if (next) {
    fadeAudio(next, 0, 500, () => {
      next.pause();
      next.currentTime = 0;
    });
  }
}

function createLoopSoundInstance() {
  const audio = sounds.planetLoop.cloneNode();

  audio.loop = false;
  audio.volume = 0;
  audio.currentTime = 0;
  audio.muted = isMuted;

  return audio;
}

function scheduleLoopCrossfade(currentSound) {
  if (!currentSound || loopIsStopping) {
    return;
  }

  const schedule = () => {
    if (loopIsStopping || currentSound !== loopSound) {
      return;
    }

    const duration = currentSound.duration;

    if (!Number.isFinite(duration) || duration <= LOOP_CROSSFADE_SECONDS + 1) {
      loopCrossfadeTimer = setTimeout(() => {
        crossfadeToNextLoop(currentSound);
      }, 10000);

      return;
    }

    const delay = Math.max(500, (duration - LOOP_CROSSFADE_SECONDS) * 1000);

    loopCrossfadeTimer = setTimeout(() => {
      crossfadeToNextLoop(currentSound);
    }, delay);
  };

  if (currentSound.readyState >= 1) {
    schedule();
  } else {
    currentSound.addEventListener("loadedmetadata", schedule, { once: true });
  }
}

function crossfadeToNextLoop(currentSound) {
  if (loopIsStopping || currentSound !== loopSound) {
    return;
  }

  nextLoopSound = createLoopSoundInstance();
  nextLoopSound.volume = 0;

  nextLoopSound.play().then(() => {
    fadeAudio(nextLoopSound, LOOP_VOLUME, LOOP_CROSSFADE_SECONDS * 1000);

    fadeAudio(currentSound, 0, LOOP_CROSSFADE_SECONDS * 1000, () => {
      currentSound.pause();
      currentSound.currentTime = 0;
    });

    loopSound = nextLoopSound;
    nextLoopSound = null;

    scheduleLoopCrossfade(loopSound);
  }).catch(() => {
    scheduleLoopCrossfade(currentSound);
  });
}

function startBlackHoleLoopSound(volume = BLACK_HOLE_LOOP_VOLUME) {
  if (blackHoleLoopSound) {
    blackHoleLoopTargetVolume = volume;
    return;
  }

  const baseSound = sounds.blackHole;

  if (!baseSound) {
    return;
  }

  blackHoleLoopIsStopping = false;
  blackHoleLoopTargetVolume = volume;

  blackHoleLoopSound = createBlackHoleLoopInstance();
  blackHoleLoopSound.volume = 0;

  blackHoleLoopSound.play().then(() => {
    fadeAudio(blackHoleLoopSound, blackHoleLoopTargetVolume, 900);
    scheduleBlackHoleLoopCrossfade(blackHoleLoopSound);
  }).catch(() => {
    blackHoleLoopSound = null;
  });
}

function stopBlackHoleLoopSound() {
  blackHoleLoopIsStopping = true;
  blackHoleLoopTargetVolume = 0;

  if (blackHoleLoopTimer) {
    clearTimeout(blackHoleLoopTimer);
    blackHoleLoopTimer = null;
  }

  const current = blackHoleLoopSound;
  const next = nextBlackHoleLoopSound;

  blackHoleLoopSound = null;
  nextBlackHoleLoopSound = null;

  if (current) {
    fadeAudio(current, 0, 900, () => {
      current.pause();
      current.currentTime = 0;
    });
  }

  if (next) {
    fadeAudio(next, 0, 900, () => {
      next.pause();
      next.currentTime = 0;
    });
  }
}

function createBlackHoleLoopInstance() {
  const audio = sounds.blackHole.cloneNode();

  audio.loop = false;
  audio.volume = 0;
  audio.currentTime = 0;
  audio.muted = isMuted;

  return audio;
}

function scheduleBlackHoleLoopCrossfade(currentSound) {
  if (!currentSound || blackHoleLoopIsStopping) {
    return;
  }

  const schedule = () => {
    if (blackHoleLoopIsStopping || currentSound !== blackHoleLoopSound) {
      return;
    }

    const duration = currentSound.duration;

    if (!Number.isFinite(duration) || duration <= LOOP_CROSSFADE_SECONDS + 1) {
      blackHoleLoopTimer = setTimeout(() => {
        crossfadeToNextBlackHoleLoop(currentSound);
      }, 10000);

      return;
    }

    const delay = Math.max(500, (duration - LOOP_CROSSFADE_SECONDS) * 1000);

    blackHoleLoopTimer = setTimeout(() => {
      crossfadeToNextBlackHoleLoop(currentSound);
    }, delay);
  };

  if (currentSound.readyState >= 1) {
    schedule();
  } else {
    currentSound.addEventListener("loadedmetadata", schedule, { once: true });
  }
}

function crossfadeToNextBlackHoleLoop(currentSound) {
  if (blackHoleLoopIsStopping || currentSound !== blackHoleLoopSound) {
    return;
  }

  nextBlackHoleLoopSound = createBlackHoleLoopInstance();
  nextBlackHoleLoopSound.volume = 0;

  nextBlackHoleLoopSound.play().then(() => {
    fadeAudio(nextBlackHoleLoopSound, blackHoleLoopTargetVolume, LOOP_CROSSFADE_SECONDS * 1000);

    fadeAudio(currentSound, 0, LOOP_CROSSFADE_SECONDS * 1000, () => {
      currentSound.pause();
      currentSound.currentTime = 0;
    });

    blackHoleLoopSound = nextBlackHoleLoopSound;
    nextBlackHoleLoopSound = null;

    scheduleBlackHoleLoopCrossfade(blackHoleLoopSound);
  }).catch(() => {
    scheduleBlackHoleLoopCrossfade(currentSound);
  });
}

function updateBlackHoleLoopSound() {
  const blackHoles = bodies.filter((body) => body.isBlackHole);

  if (blackHoles.length === 0 || isMuted) {
    stopBlackHoleLoopSound();
    return;
  }

  const rect = labArea.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY) * BLACK_HOLE_SOUND_SCREEN_RANGE;

  let loudestVolume = 0;

  blackHoles.forEach((blackHole) => {
    const screenPoint = worldToScreen(blackHole.x, blackHole.y);
    const dx = screenPoint.x - centerX;
    const dy = screenPoint.y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxDistance) {
      return;
    }

    const apparentRadius = blackHole.radius * cameraZoom;

    const distancePower = 1 - clamp(distance / maxDistance, 0, 1);
    const sizePower = clamp(
      (apparentRadius - BLACK_HOLE_SOUND_MIN_SCREEN_RADIUS) /
        (BLACK_HOLE_SOUND_FULL_SCREEN_RADIUS - BLACK_HOLE_SOUND_MIN_SCREEN_RADIUS),
      0,
      1
    );

    const volume =
      BLACK_HOLE_LOOP_VOLUME *
      Math.pow(distancePower, 1.25) *
      Math.pow(sizePower, 0.75);

    if (volume > loudestVolume) {
      loudestVolume = volume;
    }
  });

  if (loudestVolume <= 0.005) {
    stopBlackHoleLoopSound();
    return;
  }

  startBlackHoleLoopSound(loudestVolume);

  if (blackHoleLoopSound) {
    blackHoleLoopSound.volume = lerp(blackHoleLoopSound.volume, loudestVolume, 0.06);
  }

  if (nextBlackHoleLoopSound) {
    nextBlackHoleLoopSound.volume = lerp(nextBlackHoleLoopSound.volume, loudestVolume, 0.06);
  }

  blackHoleLoopTargetVolume = loudestVolume;
}


function applyMuteState() {
  Object.values(sounds).forEach((audio) => {
    audio.muted = isMuted;
  });

  if (growSound) {
    growSound.muted = isMuted;
  }

  if (loopSound) {
    loopSound.muted = isMuted;
  }

  if (nextLoopSound) {
    nextLoopSound.muted = isMuted;
  }
  if (blackHoleLoopSound) {
  blackHoleLoopSound.muted = isMuted;
}

if (nextBlackHoleLoopSound) {
  nextBlackHoleLoopSound.muted = isMuted;
}

if (isMuted) {
  stopBlackHoleLoopSound();
}
}

function resizeCanvas() {
  const rect = labArea.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function getPointerPosition(event) {
  const screenPoint = getScreenPointerPosition(event);

  return screenToWorld(screenPoint.x, screenPoint.y);
}

function getScreenPointerPosition(event) {
  const rect = labArea.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function screenToWorld(screenX, screenY) {
  return {
    x: cameraX + screenX / cameraZoom,
    y: cameraY + screenY / cameraZoom
  };
}

function worldToScreen(worldX, worldY) {
  return {
    x: (worldX - cameraX) * cameraZoom,
    y: (worldY - cameraY) * cameraZoom
  };
}

function setObservation(title, text, cooldown = 120) {
  if (observationCooldown > 0 && title === "Observations") {
    return;
  }

  observationTitle.textContent = title;
  observationText.textContent = text;
  observationCooldown = cooldown;
}

function updateHud() {
  const totalMass = bodies.reduce((sum, body) => sum + body.mass, 0) + (draftBody ? draftBody.mass : 0);

  bodyCount.textContent = bodies.length;
  massTotal.textContent = Math.round(totalMass);
  if (debrisCount) {
  debrisCount.textContent = debris.length;
}
  updateMassPanel();
}

function startDraft(event) {
  if (event.target.closest(".lab-controls") || event.target.closest(".mass-panel")) {
    return;
  }

  if (isCameraDragGesture(event)) {
    startCameraDrag(event);
    return;
  }

  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  event.preventDefault();

  if (draftBody) {
    releaseDraft();
  }

  const point = getPointerPosition(event);
  const color = COLORS[bodies.length % COLORS.length];

  pointerIsDown = true;
  pointerId = event.pointerId;

  draftBody = makeBody({
    x: point.x,
    y: point.y,
    radius: MIN_RADIUS,
    color,
    velocityX: 0,
    velocityY: 0,
    isDraft: true
  });

  draftBody.startX = point.x;
  draftBody.startY = point.y;
  draftBody.aimX = point.x;
  draftBody.aimY = point.y;
  draftBody.startTime = performance.now();

  setObservation("Observations", "Mass is forming. Hold longer to create a heavier body.", 0);
  startGrowSound();

  try {
    labArea.setPointerCapture(event.pointerId);
  } catch (error) {
    // Safe fallback.
  }

  startLoop();
}

function aimDraft(event) {
  if (!draftBody || !pointerIsDown) {
    return;
  }

  if (pointerId !== null && event.pointerId !== pointerId) {
    return;
  }

  event.preventDefault();

  const point = getPointerPosition(event);
  draftBody.aimX = point.x;
  draftBody.aimY = point.y;
}

function releaseDraft(event) {
  if (!draftBody) {
    return;
  }

  if (event) {
    event.preventDefault();
  }

  updateDraftBody();
  stopGrowSound();
  playSound("planetAdd");

  draftBody.gravity = getGravityForBody(draftBody);
  draftBody.gravityRadius = getGravityRadiusForBody(draftBody);

  const userVelocity = getLaunchVelocity(draftBody);

  draftBody.velocityX = userVelocity.x;
  draftBody.velocityY = userVelocity.y;
  draftBody.isDraft = false;
  draftBody.trail = [];
  draftBody.recentDistances = [];
  draftBody.angleHistory = [];
  draftBody.orbitScore = 0;
  draftBody.orbitTarget = null;
  draftBody.orbitAnnounced = false;
  draftBody.lockedOrbit = false;
  draftBody.orbitKind = "free";

  const wasFirstBody = bodies.length === 0;

  bodies.push(draftBody);

  if (wasFirstBody) {
    startSpaceLoopSound();
  }

  setObservation(
    "Mass Added",
    "Every body now has its own gravity radius. Objects keep their inertia and can be pulled by any nearby mass.",
    150
  );

  draftBody = null;
  pointerIsDown = false;
  pointerId = null;

  startLoop();
}

function cancelDraft() {
  stopGrowSound();

  if (draftBody) {
    releaseDraft();
  }
}

function updateDraftBody() {
  if (!draftBody) {
    return;
  }

  const holdTime = Math.max(0, performance.now() - draftBody.startTime);
  const radius = clamp(MIN_RADIUS + holdTime * GROWTH_RATE, MIN_RADIUS, MAX_RADIUS);

  draftBody.radius = radius;
  draftBody.mass = getMassForRadius(radius);
  draftBody.gravity = getGravityForBody(draftBody);
  draftBody.gravityRadius = getGravityRadiusForBody(draftBody);
}

function makeBody({ x, y, radius, color, velocityX, velocityY, isDraft = false }) {
  const body = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
    x,
    y,
    radius,
    mass: getMassForRadius(radius),
    gravity: 1,
    gravityRadius: MIN_GRAVITY_RADIUS,
    isBlackHole: false,
    color,
    velocityX,
    velocityY,
    isDraft,
    trail: [],
    orbitScore: 0,
    orbitTarget: null,
    orbitAnnounced: false,
    lockedOrbit: false,
    orbitKind: "free",
    orbitRadius: null,
    recentDistances: [],
    angleHistory: [],
    texture: createSurfaceTexture(color)
  };

  body.gravity = getGravityForBody(body);
  body.gravityRadius = getGravityRadiusForBody(body);

  return body;
}

function createSurfaceTexture(baseColor) {
  const bandCount = Math.floor(random(3, 6));
  const bands = [];
  const spots = [];

  for (let i = 0; i < bandCount; i++) {
    bands.push({
      offset: random(-0.55, 0.55),
      width: random(0.1, 0.24),
      alpha: random(0.08, 0.18),
      color: shadeHex(baseColor, random(-35, 22)),
      tilt: random(-0.9, 0.9)
    });
  }

  const spotCount = Math.floor(random(2, 7));

  for (let i = 0; i < spotCount; i++) {
    spots.push({
      angle: random(0, Math.PI * 2),
      distance: random(0.08, 0.48),
      radius: random(0.08, 0.22),
      alpha: random(0.08, 0.18),
      color: shadeHex(baseColor, random(-32, 16))
    });
  }

  return { bands, spots };
}

function startLoop() {
  if (animationId === null) {
    lastTime = performance.now();
    animationId = requestAnimationFrame(loop);
  }
}

function stopLoopIfIdle() {
  if (bodies.length === 0 && debris.length === 0 && !draftBody) {
    cancelAnimationFrame(animationId);
    animationId = null;
    stopSpaceLoopSound();
  }
}

function loop(now) {
  const delta = clamp((now - lastTime) / 16.666, 0.3, 2.2);

  lastTime = now;

  if (!isPaused) {
    update(delta);
  }

  draw();
updateHud();
updateBlackHoleLoopSound();

if (observationCooldown > 0) {
  observationCooldown -= 1;
}

  animationId = requestAnimationFrame(loop);
  stopLoopIfIdle();
}

function update(delta) {
  updateDraftBody();
  updateGravityRadii();

  const steps = Math.max(1, Math.ceil(delta / PHYSICS_STEP));
  const stepDelta = delta / steps;

  for (let i = 0; i < steps; i++) {
  applyGravity(stepDelta);
  applyGravityCapture(stepDelta);
  applyBlackHoleDrag(stepDelta);
  applyOrbitFollow(stepDelta);
  moveBodies(stepDelta);
  handleCollisions();
}

  updateTrails();
  detectOrbits();
  updateDebris(delta);
}

function updateGravityRadii() {
  bodies.forEach((body) => {
    body.gravity = getGravityForBody(body);
    body.gravityRadius = getGravityRadiusForBody(body);
  });
}

function applyGravity(delta) {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);

      if (dist < 1) {
        continue;
      }

      const nx = dx / dist;
      const ny = dy / dist;

      const bFieldStrength = getGravityFieldStrength(b, dist);
      const aFieldStrength = getGravityFieldStrength(a, dist);

      if (bFieldStrength > 0 && shouldReactToGravity(a, b)) {
        const aAccel = (G * b.mass * b.gravity * bFieldStrength) / (distSq + SOFTENING);

        a.velocityX += nx * aAccel * delta;
        a.velocityY += ny * aAccel * delta;
      }

      if (aFieldStrength > 0 && shouldReactToGravity(b, a)) {
        const bAccel = (G * a.mass * a.gravity * aFieldStrength) / (distSq + SOFTENING);

        b.velocityX -= nx * bAccel * delta;
        b.velocityY -= ny * bAccel * delta;
      }
    }
  }
}


function applyGravityCapture(delta) {
  bodies.forEach((body) => {
    if (body.isBlackHole || body.lockedOrbit) {
      return;
    }

    const target = findStrongestGravitySource(body);

    if (!target || target.isBlackHole || target.mass <= body.mass) {
      return;
    }

    const distance = getDistance(body, target);
    const targetRadius = target.gravityRadius || MIN_GRAVITY_RADIUS;

    if (distance <= target.radius + body.radius + 8) {
      return;
    }

    if (distance > targetRadius * GRAVITY_CAPTURE_MAX_DISTANCE_RATIO) {
      return;
    }

    const dx = body.x - target.x;
    const dy = body.y - target.y;

    if (distance < 1) {
      return;
    }

    const nx = dx / distance;
    const ny = dy / distance;

    let tangentX = -ny;
    let tangentY = nx;

    const relativeVX = body.velocityX - target.velocityX;
    const relativeVY = body.velocityY - target.velocityY;

    if (relativeVX * tangentX + relativeVY * tangentY < 0) {
      tangentX = -tangentX;
      tangentY = -tangentY;
    }

    const radialVelocity = Math.abs(relativeVX * nx + relativeVY * ny);
    const tangentVelocity = Math.abs(relativeVX * tangentX + relativeVY * tangentY);

    if (tangentVelocity < GRAVITY_CAPTURE_MIN_TANGENT && radialVelocity < 0.4) {
      return;
    }

    const circularSpeed = getCircularOrbitSpeed(target, distance);

    const desiredVelocityX = target.velocityX + tangentX * circularSpeed;
    const desiredVelocityY = target.velocityY + tangentY * circularSpeed;

    const distanceRatio = clamp(distance / targetRadius, 0, 1);
    const capturePower = (1 - distanceRatio * 0.55) * GRAVITY_CAPTURE_STRENGTH;

    body.velocityX = lerp(body.velocityX, desiredVelocityX, capturePower * delta);
    body.velocityY = lerp(body.velocityY, desiredVelocityY, capturePower * delta);
  });
}



function applyOrbitFollow(delta) {
  bodies.forEach((body) => {
    if (!body.lockedOrbit || body.isBlackHole || !body.orbitTarget) {
      return;
    }

    const target = getBodyById(body.orbitTarget);

    if (!target || target === body || target.isBlackHole) {
      body.lockedOrbit = false;
      body.orbitTarget = null;
      body.orbitRadius = null;
      body.orbitKind = "free";
      return;
    }

    const dx = body.x - target.x;
    const dy = body.y - target.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < target.radius + body.radius + 4) {
      return;
    }

    if (!body.orbitRadius) {
      body.orbitRadius = distance;
    }

    const nx = dx / distance;
    const ny = dy / distance;

    let tangentX = -ny;
    let tangentY = nx;

    const relativeVX = body.velocityX - target.velocityX;
    const relativeVY = body.velocityY - target.velocityY;

    if (relativeVX * tangentX + relativeVY * tangentY < 0) {
      tangentX = -tangentX;
      tangentY = -tangentY;
    }

    const circularSpeed = getCircularOrbitSpeed(target, body.orbitRadius);

    const desiredVelocityX = target.velocityX + tangentX * circularSpeed;
    const desiredVelocityY = target.velocityY + tangentY * circularSpeed;

    const velocityStrength = body.orbitKind === "moon"
      ? MOON_FOLLOW_STRENGTH
      : ORBIT_FOLLOW_STRENGTH;

    const radiusStrength = body.orbitKind === "moon"
      ? MOON_RADIUS_STRENGTH
      : ORBIT_RADIUS_STRENGTH;

    body.velocityX = lerp(body.velocityX, desiredVelocityX, velocityStrength * delta);
    body.velocityY = lerp(body.velocityY, desiredVelocityY, velocityStrength * delta);

    const radiusDifference = body.orbitRadius - distance;

    body.x += nx * radiusDifference * radiusStrength * delta;
    body.y += ny * radiusDifference * radiusStrength * delta;
  });
}

function applyBlackHoleDrag(delta) {
  const blackHoles = bodies.filter((body) => body.isBlackHole);

  if (blackHoles.length === 0) {
    return;
  }

  bodies.forEach((body) => {
    if (body.isBlackHole) {
      return;
    }

    blackHoles.forEach((blackHole) => {
      const dx = blackHole.x - body.x;
      const dy = blackHole.y - body.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 1 || distance > blackHole.gravityRadius) {
        return;
      }

      const nx = dx / distance;
      const ny = dy / distance;
      const influence = 1 - clamp(distance / blackHole.gravityRadius, 0, 1);

      const relativeVX = body.velocityX - blackHole.velocityX;
      const relativeVY = body.velocityY - blackHole.velocityY;

      const radialVelocity = relativeVX * nx + relativeVY * ny;
      const radialVX = nx * radialVelocity;
      const radialVY = ny * radialVelocity;

      const tangentVX = relativeVX - radialVX;
      const tangentVY = relativeVY - radialVY;

      body.velocityX -= tangentVX * BLACK_HOLE_DRAG * influence * delta;
      body.velocityY -= tangentVY * BLACK_HOLE_DRAG * influence * delta;

      body.velocityX += nx * BLACK_HOLE_INWARD_PULL * influence * delta;
      body.velocityY += ny * BLACK_HOLE_INWARD_PULL * influence * delta;
    });
  });
}

function shouldReactToGravity(bodyBeingPulled, sourceBody) {
  if (sourceBody.isBlackHole) {
    return true;
  }

  if (bodyBeingPulled.isBlackHole) {
    return false;
  }

  return sourceBody.mass >= bodyBeingPulled.mass * MIN_REACTION_MASS_RATIO;
}

function getGravityFieldStrength(sourceBody, distance) {
  if (sourceBody.isBlackHole) {
    return 1;
  }

  const radius = sourceBody.gravityRadius || MIN_GRAVITY_RADIUS;

  if (distance > radius) {
    return 0;
  }

  return 1;
}

function moveBodies(delta) {
  bodies.forEach((body) => {
    const speedLimit = body.isBlackHole ? BLACK_HOLE_MAX_SPEED : MAX_SPEED;

    limitBodySpeed(body, speedLimit);

    body.x += body.velocityX * delta;
    body.y += body.velocityY * delta;
  });
}

function updateTrails() {
  bodies.forEach((body) => {
    body.trail.push({ x: body.x, y: body.y });

    if (body.trail.length > MAX_TRAIL_POINTS) {
      body.trail.shift();
    }
  });
}

function detectOrbits() {
  bodies.forEach((body) => {
    const lockedTarget = body.lockedOrbit && body.orbitTarget
    ? getBodyById(body.orbitTarget)
    : null;

    const target = lockedTarget || findStrongestGravitySource(body);

    if (!target) {
      body.orbitScore = Math.max(0, body.orbitScore - 2);
      body.lockedOrbit = false;
      return;
    }

    if (body.orbitTarget !== target.id) {
      body.orbitTarget = target.id;
      body.recentDistances = [];
      body.angleHistory = [];
      body.orbitScore = 0;
      body.orbitAnnounced = false;
      body.lockedOrbit = false;
    }

    const dx = body.x - target.x;
    const dy = body.y - target.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    body.recentDistances.push(distance);
    body.angleHistory.push(angle);

    if (body.recentDistances.length > ORBIT_SAMPLE_LIMIT) {
      body.recentDistances.shift();
    }

    if (body.angleHistory.length > ORBIT_SAMPLE_LIMIT) {
      body.angleHistory.shift();
    }

    const orbitStatus = evaluateOrbitCandidate(body, target);

    if (orbitStatus.steady) {
      body.orbitScore = Math.min(ORBIT_CONFIRM_SCORE + 40, body.orbitScore + 3);
    } else if (orbitStatus.candidate) {
      body.orbitScore = Math.min(ORBIT_CONFIRM_SCORE, body.orbitScore + 1);
    } else {
      body.orbitScore = Math.max(0, body.orbitScore - 3);
    }

    if (!body.lockedOrbit && body.orbitScore >= ORBIT_CONFIRM_SCORE && orbitStatus.steady) {
  if (target.isBlackHole) {
    body.lockedOrbit = false;
    body.orbitTarget = null;
    body.orbitRadius = null;
    body.orbitKind = "free";
    return;
  }

  body.lockedOrbit = true;
  body.orbitAnnounced = true;
  body.orbitRadius = orbitStatus.averageDistance || distance;
  body.orbitKind = target.mass > body.mass ? "planet" : "free";
  playSound("planetMerge");

      setObservation(
        "Orbit Detected",
        "A body is orbiting naturally. — gravity and inertia are doing the work.",
        240
      );
    }
  });
}

function evaluateOrbitCandidate(body, target) {
  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < target.radius * 1.7) {
    return {
      candidate: false,
      steady: false,
      averageDistance: distance
    };
  }

  const vx = body.velocityX - target.velocityX;
  const vy = body.velocityY - target.velocityY;
  const speed = Math.sqrt(vx * vx + vy * vy);
  const circularSpeed = getCircularOrbitSpeed(target, distance);

  if (circularSpeed <= 0) {
    return {
      candidate: false,
      steady: false,
      averageDistance: distance
    };
  }

  const speedRatio = speed / circularSpeed;
  const radialSpeed = Math.abs((vx * dx + vy * dy) / Math.max(distance, 1));
  const tangentSpeed = Math.sqrt(Math.max(0, speed * speed - radialSpeed * radialSpeed));

  const candidate =
    speedRatio > 0.28 &&
    speedRatio < 2.9 &&
    tangentSpeed > radialSpeed * 0.32;

  if (!candidate || !body.recentDistances || body.recentDistances.length < 70) {
    return {
      candidate,
      steady: false,
      averageDistance: distance
    };
  }

  const recent = body.recentDistances;
  const averageDistance = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const minDistance = Math.min(...recent);
  const maxDistance = Math.max(...recent);
  const distanceVariance = (maxDistance - minDistance) / Math.max(averageDistance, 1);
  const angularTravel = getAngularTravel(body.angleHistory || []);

  const steady =
    candidate &&
    distanceVariance < ORBIT_VARIANCE_LIMIT &&
    angularTravel > Math.PI * 1.05;

  return {
    candidate,
    steady,
    averageDistance
  };
}

function findStrongestGravitySource(body) {
  let bestSource = null;
  let bestInfluence = 0;

  bodies.forEach((source) => {
    if (source === body) {
      return;
    }

    if (!shouldReactToGravity(body, source)) {
      return;
    }

    const distance = getDistance(body, source);
    const fieldStrength = getGravityFieldStrength(source, distance);

    if (fieldStrength <= 0) {
      return;
    }

    const influence = (source.mass * source.gravity * fieldStrength) / (distance * distance + SOFTENING);

    if (influence > bestInfluence) {
      bestInfluence = influence;
      bestSource = source;
    }
  });

  return bestSource;
}

function getAngularTravel(angles) {
  if (!angles || angles.length < 2) {
    return 0;
  }

  let travel = 0;

  for (let i = 1; i < angles.length; i++) {
    travel += Math.abs(normalizeAngleDelta(angles[i] - angles[i - 1]));
  }

  return travel;
}

function normalizeAngleDelta(angle) {
  while (angle > Math.PI) {
    angle -= Math.PI * 2;
  }

  while (angle < -Math.PI) {
    angle += Math.PI * 2;
  }

  return angle;
}

function handleCollisions() {
  let handled = true;

  while (handled) {
    handled = false;

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];

        if (!areColliding(a, b)) {
          continue;
        }

        if (a.isBlackHole || b.isBlackHole) {
          const blackHole = a.isBlackHole ? a : b;
          const otherBody = blackHole === a ? b : a;
          absorbIntoBlackHole(blackHole, otherBody);
          handled = true;
          break;
        }

        const relativeSpeed = getRelativeSpeed(a, b);

        if (shouldAccreteTinyImpact(a, b) || relativeSpeed <= SLOW_MERGE_SPEED) {
          mergeBodies(a, b);
        } else {
          shatterBodies(a, b, relativeSpeed);
        }

        handled = true;
        break;
      }

      if (handled) {
        break;
      }
    }
  }
}

function shouldAccreteTinyImpact(a, b) {
  const bigger = a.mass >= b.mass ? a : b;
  const smaller = bigger === a ? b : a;

  const massRatio = smaller.mass / Math.max(bigger.mass, 1);
  const radiusRatio = smaller.radius / Math.max(bigger.radius, 1);

  return massRatio <= TINY_IMPACT_MASS_RATIO || radiusRatio <= TINY_IMPACT_RADIUS_RATIO;
}

function updateDebris(delta) {
  debris.forEach((piece) => {
    piece.x += piece.velocityX * delta;
    piece.y += piece.velocityY * delta;
    piece.velocityX *= Math.pow(0.992, delta);
    piece.velocityY *= Math.pow(0.992, delta);
    piece.life -= piece.decay * delta;
  });

  debris = debris.filter((piece) => piece.life > 0);
}

function getLaunchVelocity(body) {
  const dx = body.aimX - body.startX;
  const dy = body.aimY - body.startY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 8) {
    return { x: 0, y: 0 };
  }

  const sizeFactor = clamp(34 / Math.max(body.radius, 1), 0.28, 1.45);

  return limitVelocity(
    {
      x: dx * LAUNCH_SCALE * sizeFactor,
      y: dy * LAUNCH_SCALE * sizeFactor
    },
    MAX_SPEED
  );
}

function getCircularOrbitSpeed(target, distance) {
  const safeDistance = Math.max(distance, target.radius * 3.1);
  const targetGravity = target.gravity || 1;

  return Math.sqrt((G * target.mass * targetGravity * safeDistance) / (safeDistance * safeDistance + SOFTENING));
}

function getGravityForBody(body) {
  if (body.isBlackHole) {
    return BLACK_HOLE_GRAVITY;
  }

  if (body.radius >= 85) {
    return 1.35;
  }

  if (body.radius >= 45) {
    return 1.1;
  }

  if (body.radius <= 18) {
    return 0.85;
  }

  return 1;
}

function getGravityRadiusForBody(body) {
  if (body.isBlackHole) {
    return MAX_GRAVITY_RADIUS * BLACK_HOLE_RADIUS_MULTIPLIER;
  }

  return clamp(
    body.radius * GRAVITY_RADIUS_MULTIPLIER,
    MIN_GRAVITY_RADIUS,
    MAX_GRAVITY_RADIUS
  );
}

function getMainMass() {
  if (bodies.length === 0) {
    return null;
  }

  return bodies.reduce((biggest, body) => {
    return body.mass > biggest.mass ? body : biggest;
  }, bodies[0]);
}

function isMainMass(body) {
  return body === getMainMass();
}

function actsLikeSun(big, other) {
  return big.mass > other.mass;
}

function isDominantSun(body) {
  return body === getMainMass();
}

function areColliding(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return distance < (a.radius + b.radius) * COLLISION_DISTANCE;
}

function getRelativeSpeed(a, b) {
  const vx = b.velocityX - a.velocityX;
  const vy = b.velocityY - a.velocityY;

  return Math.sqrt(vx * vx + vy * vy);
}


function getBodyById(id) {
  return bodies.find((body) => body.id === id) || null;
}

function getDistance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  return Math.sqrt(dx * dx + dy * dy);
}

function mergeBodies(a, b) {
  const totalMass = a.mass + b.mass;
  const dominant = a.mass >= b.mass ? a : b;

  const mergedX = (a.x * a.mass + b.x * b.mass) / Math.max(totalMass, 1);
  const mergedY = (a.y * a.mass + b.y * b.mass) / Math.max(totalMass, 1);

  const mergedVX = (a.velocityX * a.mass + b.velocityX * b.mass) / Math.max(totalMass, 1);
  const mergedVY = (a.velocityY * a.mass + b.velocityY * b.mass) / Math.max(totalMass, 1);

  a.x = mergedX;
  a.y = mergedY;
  a.mass = totalMass;
  a.radius = getRadiusForMass(totalMass);
  a.gravity = getGravityForBody(a);
  a.gravityRadius = getGravityRadiusForBody(a);
  a.velocityX = mergedVX;
  a.velocityY = mergedVY;
  a.isBlackHole = Boolean(dominant.isBlackHole);
  a.color = a.isBlackHole ? "#020204" : dominant.color;
  a.gravity = getGravityForBody(a);
  a.gravityRadius = getGravityRadiusForBody(a);
  a.trail = [];
  a.orbitScore = 0;
  a.orbitTarget = null;
  a.orbitAnnounced = false;
  a.lockedOrbit = false;
  a.orbitKind = "free";
  a.orbitTarget = null;
  a.orbitRadius = null;
  a.recentDistances = [];
  a.angleHistory = [];
  a.texture = createSurfaceTexture(a.color);

  bodies = bodies.filter((body) => body !== b);

  playSound("planetMerge");
  createExplosion(mergedX, mergedY, dominant.color, 22, 0.9);
  setObservation("Fusion", "Masses collided and merged. Momentum is conserved, so the new body keeps moving.", 180);
}

function shatterBodies(a, b, speed) {
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;

  playSound("planetChange");

  createFragments(a, speed);
  createFragments(b, speed);
  createExplosion(x, y, "#ffffff", 18, 1.25);

  bodies = bodies.filter((body) => body !== a && body !== b);

  if (debris.length > MAX_DEBRIS) {
    debris = debris.slice(debris.length - MAX_DEBRIS);
  }

  setObservation("Collision", "Fast-moving masses shattered into fragments. Nearby bodies keep their inertia.", 200);
}

function createFragments(body, impactSpeed) {
  const amount = clamp(Math.floor(body.radius * 1.35), 24, 100);

  for (let i = 0; i < amount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = random(1.4, 4.8) + impactSpeed * 0.36;
    const distance = Math.random() * body.radius * 0.65;

    debris.push({
      x: body.x + Math.cos(angle) * distance,
      y: body.y + Math.sin(angle) * distance,
      velocityX: body.velocityX * 0.35 + Math.cos(angle) * speed,
      velocityY: body.velocityY * 0.35 + Math.sin(angle) * speed,
      radius: random(1.5, 4.8),
      color: shadeHex(body.color, random(-10, 22)),
      life: 1,
      decay: random(0.006, 0.016)
    });
  }
}

function createExplosion(x, y, color, amount, power) {
  for (let i = 0; i < amount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = random(1.1, 3.2) * power;

    debris.push({
      x,
      y,
      velocityX: Math.cos(angle) * speed,
      velocityY: Math.sin(angle) * speed,
      radius: random(2, 6),
      color,
      life: 1,
      decay: random(0.012, 0.028)
    });
  }
}

function clearSpace() {
  stopGrowSound();
  stopSpaceLoopSound();
  stopBlackHoleLoopSound();

  bodies = [];
  lastMassPanelSignature = "";
  lastMassPanelBodyIds = "";
  debris = [];
  draftBody = null;
  pointerIsDown = false;
  pointerId = null;

  setObservation("Observations", "Press and hold anywhere to create mass. Drag before releasing to add velocity.", 0);
  updateHud();
  draw();
}

function togglePause() {
  isPaused = !isPaused;
  pauseButton.textContent = isPaused ? "Resume" : "Pause";
  startLoop();
}

async function toggleFullscreen() {
  const cssFullscreen = document.body.classList.contains("game-fullscreen");
  const browserFullscreen = Boolean(document.fullscreenElement);
  const shouldExit = cssFullscreen || browserFullscreen;

  if (!shouldExit) {
    document.body.classList.add("game-fullscreen");

    if (fullscreenButton) {
      fullscreenButton.textContent = "Exit Fullscreen";
    }

    try {
      await document.documentElement.requestFullscreen();
    } catch (error) {
      // CSS fullscreen still works if browser fullscreen is blocked.
    }
  } else {
    document.body.classList.remove("game-fullscreen");

    if (fullscreenButton) {
      fullscreenButton.textContent = "Fullscreen";
    }

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        // Safe fallback.
      }
    }
  }

  setTimeout(resizeCanvas, 80);
  setTimeout(resizeCanvas, 240);
}

function syncFullscreenState() {
  if (!fullscreenButton) {
    return;
  }

  if (document.fullscreenElement) {
    document.body.classList.add("game-fullscreen");
    fullscreenButton.textContent = "Exit Fullscreen";
  } else {
    document.body.classList.remove("game-fullscreen");
    fullscreenButton.textContent = "Fullscreen";
  }

  setTimeout(resizeCanvas, 80);
}

function draw() {
  const rect = labArea.getBoundingClientRect();

  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.save();
  ctx.scale(cameraZoom, cameraZoom);
  ctx.translate(-cameraX, -cameraY);

  drawGravityWells();

if (!hideAllUi) {
  drawGravityRadiusRings();
}

  drawTrails();
  drawDebris();

  bodies.forEach(drawBody);

  if (draftBody) {
  if (!hideAllUi) {
    drawAimLine(draftBody);
    drawGravityRadiusRing(draftBody, 0.32);
  }

  drawBody(draftBody);
}

  ctx.restore();
}

function drawGravityWells() {
  bodies.forEach((body) => {
    const radius = clamp(body.radius * 5.2, 90, 480);
    const gradient = ctx.createRadialGradient(body.x, body.y, body.radius, body.x, body.y, radius);

    gradient.addColorStop(0, hexToRgba(body.color, 0.14));
    gradient.addColorStop(0.34, hexToRgba(body.color, 0.05));
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(body.x, body.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawGravityRadiusRings() {
  bodies.forEach((body) => {
    drawGravityRadiusRing(body, body.lockedOrbit ? 0.24 : 0.14);
  });
}

function drawGravityRadiusRing(body, alpha) {
  const radius = body.gravityRadius || MIN_GRAVITY_RADIUS;

  ctx.save();
  ctx.strokeStyle = hexToRgba(body.color, alpha);
  ctx.lineWidth = body.isBlackHole ? 2 : body.lockedOrbit ? 1.4 : 1;
  ctx.beginPath();
  ctx.arc(body.x, body.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTrails() {
  if (hideTrails) {
  return;
}
  bodies.forEach((body) => {
    if (body.trail.length < 3) {
      return;
    }

        ctx.beginPath();

    body.trail.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });

    ctx.strokeStyle = hexToRgba(body.color, body.lockedOrbit ? 0.58 : 0.34);
    ctx.lineWidth = body.lockedOrbit ? 1.7 : 1;
    ctx.stroke();
  });
}

function drawDebris() {
  debris.forEach((piece) => {
    ctx.globalAlpha = Math.max(0, piece.life);
    ctx.fillStyle = piece.color;
    ctx.beginPath();
    ctx.arc(piece.x, piece.y, piece.radius, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.globalAlpha = 1;
}

function drawBody(body) {
  if (body.isBlackHole) {
    drawBlackHole(body);

    if (!hideAllUi) {
      drawMassLabel(body);
    }

    return;
  }

  const shadowColor = hexToRgba(body.color, 0.7);

  ctx.save();
  ctx.shadowBlur = clamp(body.radius * 1.2, 16, 90);
  ctx.shadowColor = shadowColor;
  ctx.beginPath();
  ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
  ctx.fillStyle = createPlanetGradient(body);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
  ctx.clip();
  drawPlanetBands(body);
  drawPlanetSpots(body);
  drawPlanetShadow(body);
  ctx.restore();

  drawPlanetRim(body);

  if (!hideAllUi) {
    drawMassLabel(body);
  }
}

function drawBlackHoleDistortion(body) {
  const time = performance.now() * 0.001;
  const ringCount = 5;

  ctx.save();

  for (let i = 0; i < ringCount; i++) {
    const radius = body.radius * (1.55 + i * 0.55);
    const wobble = Math.sin(time * 2.2 + i) * body.radius * 0.08;
    const alpha = 0.18 - i * 0.025;

    ctx.strokeStyle = `rgba(185, 160, 255, ${alpha})`;
    ctx.lineWidth = Math.max(1, body.radius * 0.025);

    ctx.beginPath();

    for (let a = 0; a <= Math.PI * 2 + 0.08; a += 0.08) {
      const wave = Math.sin(a * 5 + time * 3 + i) * wobble;
      const x = body.x + Math.cos(a) * (radius + wave);
      const y = body.y + Math.sin(a) * (radius - wave * 0.6);

      if (a === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
}



function drawBlackHole(body) {
  const pullRadius = clamp(body.radius * 3.2, 40, 220);

  ctx.save();

  drawBlackHoleDistortion(body);

  const halo = ctx.createRadialGradient(body.x, body.y, body.radius * 0.5, body.x, body.y, pullRadius);
  halo.addColorStop(0, "rgba(255, 255, 255, 0.55)");
  halo.addColorStop(0.08, "rgba(40, 40, 55, 0.38)");
  halo.addColorStop(0.35, "rgba(125, 80, 255, 0.18)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");

  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(body.x, body.y, pullRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 45;
  ctx.shadowColor = "rgba(130, 90, 255, 0.9)";
  ctx.fillStyle = "#020204";
  ctx.beginPath();
  ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.68)";
  ctx.lineWidth = Math.max(1, body.radius * 0.08);
  ctx.beginPath();
  ctx.arc(body.x, body.y, body.radius * 1.05, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function createPlanetGradient(body) {
  const gradient = ctx.createRadialGradient(
    body.x - body.radius * 0.38,
    body.y - body.radius * 0.46,
    body.radius * 0.12,
    body.x,
    body.y,
    body.radius
  );

  gradient.addColorStop(0, "rgba(255, 255, 255, 0.96)");
  gradient.addColorStop(0.14, shadeHex(body.color, 26));
  gradient.addColorStop(0.62, body.color);
  gradient.addColorStop(1, shadeHex(body.color, -36));

  return gradient;
}

function drawPlanetBands(body) {
  body.texture.bands.forEach((band) => {
    const width = body.radius * (0.22 + band.width);
    const yOffset = body.radius * band.offset;

    ctx.save();
    ctx.translate(body.x, body.y + yOffset);
    ctx.rotate(band.tilt * 0.2);
    ctx.scale(1, 0.42);
    ctx.fillStyle = hexToRgba(band.color, band.alpha);
    ctx.beginPath();
    ctx.ellipse(0, 0, body.radius * 1.06, width, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawPlanetSpots(body) {
  body.texture.spots.forEach((spot) => {
    const px = body.x + Math.cos(spot.angle) * body.radius * spot.distance;
    const py = body.y + Math.sin(spot.angle) * body.radius * spot.distance;

    ctx.fillStyle = hexToRgba(spot.color, spot.alpha);
    ctx.beginPath();
    ctx.arc(px, py, body.radius * spot.radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPlanetShadow(body) {
  const shade = ctx.createLinearGradient(
    body.x - body.radius,
    body.y - body.radius,
    body.x + body.radius,
    body.y + body.radius
  );

  shade.addColorStop(0, "rgba(255, 255, 255, 0.04)");
  shade.addColorStop(0.48, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.28)");

  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlanetRim(body) {
  ctx.save();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = Math.max(1, body.radius * 0.045);
  ctx.beginPath();
  ctx.arc(body.x, body.y, body.radius - ctx.lineWidth * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.beginPath();
  ctx.arc(body.x - body.radius * 0.35, body.y - body.radius * 0.38, body.radius * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawMassLabel(body) {
  const label = body.isBlackHole ? `Black Hole ${Math.round(body.mass)}` : `Mass ${Math.round(body.mass)}`;

  ctx.font = "800 11px Arial";

  const textWidth = ctx.measureText(label).width;
  const width = textWidth + 18;
  const height = 22;
  const x = body.x - width / 2;
  const y = body.y - body.radius - 30;

  ctx.fillStyle = "rgba(0, 0, 0, 0.74)";
  roundRect(x, y, width, height, 999);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, body.x, y + height / 2 + 0.5);
}

function drawAimLine(body) {
  const dx = body.aimX - body.startX;
  const dy = body.aimY - body.startY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 8) {
    return;
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(body.startX, body.startY);
  ctx.lineTo(body.aimX, body.aimY);
  ctx.stroke();
}

function roundRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function limitBodySpeed(body, maxSpeed = MAX_SPEED) {
  const limited = limitVelocity({ x: body.velocityX, y: body.velocityY }, maxSpeed);

  body.velocityX = limited.x;
  body.velocityY = limited.y;
}

function limitVelocity(velocity, maxSpeed) {
  const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);

  if (speed <= maxSpeed) {
    return velocity;
  }

  return {
    x: (velocity.x / speed) * maxSpeed,
    y: (velocity.y / speed) * maxSpeed
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function getMassForRadius(radius) {
  return Math.max(0, radius * radius - MIN_RADIUS * MIN_RADIUS);
}

function getRadiusForMass(mass) {
  return Math.sqrt(Math.max(0, mass) + MIN_RADIUS * MIN_RADIUS);
}

function getBlackHoleRadiusForMass(mass) {
  return Math.sqrt(Math.max(0, mass) + MIN_RADIUS * MIN_RADIUS) * 1.05;
}


function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") {
    return { r: 255, g: 255, b: 255 };
  }

  if (hex.startsWith("rgb")) {
    const numbers = hex.match(/\d+/g);

    if (!numbers || numbers.length < 3) {
      return { r: 255, g: 255, b: 255 };
    }

    return {
      r: Number(numbers[0]),
      g: Number(numbers[1]),
      b: Number(numbers[2])
    };
  }

  const clean = hex.replace("#", "");

  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16)
  };
}

function hexToRgba(hex, alpha) {
  const rgb = hexToRgb(hex);

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function shadeHex(hex, percent) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) {
    return hex;
  }

  const rgb = hexToRgb(hex);
  const amount = Math.round(2.55 * percent);

  const r = clamp(rgb.r + amount, 0, 255);
  const g = clamp(rgb.g + amount, 0, 255);
  const b = clamp(rgb.b + amount, 0, 255);

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value) {
  return Math.round(value).toString(16).padStart(2, "0");
}

function createMassPanel() {
  if (massPanel) {
    return;
  }

  injectMassPanelStyles();

  massPanel = document.createElement("aside");
  massPanel.className = "mass-panel";
  massPanel.innerHTML = `
    <div class="mass-panel-card">
      <div class="mass-panel-header">
        <strong>Masses in action</strong>
      </div>
      <div class="mass-panel-list"></div>
    </div>
    <div class="mass-panel-tab">Masses</div>
  `;

  massPanelList = massPanel.querySelector(".mass-panel-list");
  labArea.appendChild(massPanel);

  massPanel.addEventListener("pointerdown", stopPanelInteraction, true);
  massPanel.addEventListener("pointerup", handleMassPanelAction, true);
  massPanel.addEventListener("click", stopPanelInteraction, true);
  massPanel.addEventListener("input", handleMassInput);
  massPanel.addEventListener("change", handleMassInput);
  massPanel.addEventListener("keydown", handleMassInputKeydown);
}

function injectMassPanelStyles() {
  if (document.getElementById("mass-panel-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "mass-panel-styles";
  style.textContent = `
    .mass-panel {
      position: absolute;
      left: 0;
      top: 18px;
      z-index: 120;
      display: flex;
      align-items: flex-start;
      transform: translateX(-292px);
      transition: transform 180ms ease, opacity 180ms ease;
      opacity: 0.82;
      pointer-events: auto;
      font-family: inherit;
    }

    .mass-panel:hover,
    .mass-panel:focus-within {
      transform: translateX(14px);
      opacity: 1;
    }

    .mass-panel-tab {
      width: 42px;
      min-height: 122px;
      display: grid;
      place-items: center;
      margin-left: 8px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.78);
      color: rgba(255, 255, 255, 0.86);
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      backdrop-filter: blur(10px);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
      cursor: default;
      user-select: none;
    }

    .mass-panel-card {
      width: 292px;
      max-height: min(640px, calc(100vh - 80px));
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      background: rgba(0, 0, 0, 0.82);
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(14px);
    }

    .mass-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 13px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.9);
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .mass-panel-list {
      max-height: min(570px, calc(100vh - 145px));
      overflow-y: auto;
      padding: 10px;
    }

    .mass-empty {
      padding: 15px;
      border: 1px dashed rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      color: rgba(255, 255, 255, 0.55);
      font-size: 0.82rem;
      line-height: 1.4;
    }

    .mass-row {
      display: grid;
      gap: 9px;
      margin-bottom: 10px;
      padding: 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.045);
    }

    .mass-row.is-black-hole {
      border-color: rgba(180, 150, 255, 0.34);
      background: linear-gradient(135deg, rgba(125, 80, 255, 0.16), rgba(255, 255, 255, 0.035));
    }

    .mass-row-top {
      display: grid;
      grid-template-columns: 14px 1fr auto;
      align-items: center;
      gap: 8px;
      color: rgba(255, 255, 255, 0.86);
      font-size: 0.82rem;
      font-weight: 900;
    }

    .mass-dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      box-shadow: 0 0 18px currentColor;
      background: currentColor;
    }

    .mass-meta {
      color: rgba(255, 255, 255, 0.48);
      font-size: 0.7rem;
      font-weight: 800;
    }
    .mass-input {
    width: 74px;
    min-width: 0;
    padding: 5px 7px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(0, 0, 0, 0.48);
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.72rem;
    font-weight: 900;
    text-align: right;
    outline: none;
}

.mass-input:focus {
  border-color: rgba(66, 245, 215, 0.75);
  box-shadow: 0 0 0 3px rgba(66, 245, 215, 0.12);
}

.mass-input::-webkit-outer-spin-button,
.mass-input::-webkit-inner-spin-button {
  margin: 0;
}


    .mass-actions {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px;
    }

    .mass-actions button {
      min-width: 0;
      min-height: 34px;
      padding: 8px 6px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.07);
      color: rgba(255, 255, 255, 0.76);
      font-size: 0.66rem;
      font-weight: 900;
      line-height: 1;
      cursor: pointer;
      pointer-events: auto;
    }

    .mass-actions button:hover {
      transform: none;
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.25);
    }

    .mass-actions button[data-action="destroy"] {
      color: rgba(255, 120, 145, 0.9);
    }

    .mass-actions button[data-action="blackhole"] {
      color: rgba(185, 160, 255, 0.94);
    }

    .mass-actions button:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
  `;

  document.head.appendChild(style);
}

  

function updateMassPanel() {
  if (!massPanelList) {
    return;
  }

  const activeInput = document.activeElement && document.activeElement.classList.contains("mass-input")
    ? document.activeElement
    : null;

  const bodyIds = bodies.map((body) => body.id).join("|");

  // If the row being edited was destroyed/absorbed, blur it and force refresh.
  if (activeInput) {
    const editedBodyStillExists = bodies.some((body) => body.id === activeInput.dataset.id);

    if (!editedBodyStillExists) {
      activeInput.blur();
    }
  }

  const isEditingExistingMass = document.activeElement && document.activeElement.classList.contains("mass-input");

  // While editing, only pause refresh if the actual body list did not change.
  if (isEditingExistingMass && bodyIds === lastMassPanelBodyIds) {
    return;
  }

  const signature = bodies.map((body) => {
    return `${body.id}:${Math.round(body.mass)}:${Math.round(body.radius)}:${Math.round(body.gravityRadius)}:${body.isBlackHole}`;
  }).join("|");

  if (signature === lastMassPanelSignature && bodyIds === lastMassPanelBodyIds) {
    return;
  }

  lastMassPanelSignature = signature;
  lastMassPanelBodyIds = bodyIds;

  if (bodies.length === 0) {
    massPanelList.innerHTML = `<div class="mass-empty">No masses yet. Hold and drag in space to create the first one.</div>`;
    return;
  }

  massPanelList.innerHTML = bodies.map((body, index) => {
    const name = body.isBlackHole ? `Black Hole ${index + 1}` : `Mass ${index + 1}`;
    const color = body.isBlackHole ? "#b9a0ff" : body.color;
    const speed = Math.sqrt(body.velocityX * body.velocityX + body.velocityY * body.velocityY);
    const rowClass = body.isBlackHole ? "mass-row is-black-hole" : "mass-row";
    const moonDisabled = body.isBlackHole ? "disabled" : "";

    return `
      <div class="${rowClass}" data-id="${body.id}">
        <div class="mass-row-top">
          <span class="mass-dot" style="color:${color}"></span>
          <span>${name}</span>
          <input
            class="mass-input"
            type="number"
            min="0"
            step="1"
            data-id="${body.id}"
            value="${Math.round(body.mass)}"
            title="Edit mass"
          >
        </div>
        <div class="mass-meta">radius ${Math.round(body.radius)} · gravity range ${Math.round(body.gravityRadius)} · speed ${speed.toFixed(1)}</div>
        <div class="mass-actions">
          <button type="button" data-action="moon" data-id="${body.id}" ${moonDisabled}>Add moon</button>
          <button type="button" data-action="destroy" data-id="${body.id}">Destroy</button>
          <button type="button" data-action="blackhole" data-id="${body.id}">Black hole</button>
        </div>
      </div>
    `;
  }).join("");
}

function forceMassPanelRefresh() {
  if (document.activeElement && document.activeElement.classList.contains("mass-input")) {
    document.activeElement.blur();
  }

  lastMassPanelSignature = "";
  lastMassPanelBodyIds = "";
  updateHud();
  draw();
}


function stopPanelInteraction(event) {
  event.stopPropagation();
}

function handleMassPanelAction(event) {
  event.stopPropagation();

  const button = event.target.closest("button[data-action]");

  if (!button || button.disabled) {
    return;
  }

  event.preventDefault();

  const body = bodies.find((item) => item.id === button.dataset.id);

  if (!body) {
    return;
  }

  const action = button.dataset.action;

  if (action === "moon") {
    addMoonToBody(body);
  }

  if (action === "destroy") {
    destroyBody(body);
  }

  if (action === "blackhole") {
    turnIntoBlackHole(body);
  }

  lastMassPanelSignature = "";
  updateHud();
  draw();
  startLoop();
}

function handleMassInput(event) {
  const input = event.target.closest(".mass-input");

  if (!input) {
    return;
  }

  event.stopPropagation();

  const body = bodies.find((item) => item.id === input.dataset.id);

  if (!body) {
    return;
  }

  const newMass = Number(input.value);

  if (!Number.isFinite(newMass) || newMass < 0) {
    return;
  }

  setBodyMass(body, newMass);
  draw();
}

function handleMassInputKeydown(event) {
  const input = event.target.closest(".mass-input");

  if (!input) {
    return;
  }

  event.stopPropagation();

  if (event.key === "Enter") {
    input.blur();
    lastMassPanelSignature = "";
    updateHud();
    draw();
  }
}

function setBodyMass(body, newMass) {
  body.mass = Math.max(0, newMass);

  if (body.isBlackHole) {
    body.radius = clamp(
      getBlackHoleRadiusForMass(body.mass),
      MIN_RADIUS + 10,
      MAX_RADIUS * 1.8
    );
  } else {
    body.radius = getRadiusForMass(body.mass);
  }

  body.gravity = getGravityForBody(body);
  body.gravityRadius = getGravityRadiusForBody(body);

  if (body.isBlackHole) {
    const limitedVelocity = limitVelocity(
      { x: body.velocityX, y: body.velocityY },
      BLACK_HOLE_MAX_SPEED
    );

    body.velocityX = limitedVelocity.x;
    body.velocityY = limitedVelocity.y;
  }

  body.trail = [];
  body.recentDistances = [];
  body.angleHistory = [];
  body.orbitScore = 0;

  bodies.forEach((otherBody) => {
    if (otherBody.orbitTarget === body.id) {
      otherBody.lockedOrbit = false;
      otherBody.orbitRadius = null;
      otherBody.recentDistances = [];
      otherBody.angleHistory = [];
      otherBody.orbitScore = 0;
    }
  });

  lastMassPanelSignature = "";
}

function addMoonToBody(parent) {
  if (!parent || parent.isBlackHole) {
    return;
  }

  const moonMass = Math.max(18, parent.mass * MOON_MASS_RATIO);
  const moonRadius = clamp(getRadiusForMass(moonMass), MIN_RADIUS + 2, MAX_RADIUS * 0.62);

  // Make sure the moon has room to spawn inside the parent's gravity field.
  const safeInnerDistance = parent.radius + moonRadius + 28;
  const safeOuterDistance = Math.max(
    safeInnerDistance + 10,
    parent.gravityRadius - moonRadius - 18
  );

  // Random distance: sometimes close, sometimes far, always inside gravity range.
  const orbitDistance = random(safeInnerDistance, safeOuterDistance);

  const angle = Math.random() * Math.PI * 2;

  const moonX = parent.x + Math.cos(angle) * orbitDistance;
  const moonY = parent.y + Math.sin(angle) * orbitDistance;

  let tangentX = -Math.sin(angle);
  let tangentY = Math.cos(angle);

  if (Math.random() < 0.5) {
    tangentX *= -1;
    tangentY *= -1;
  }

  const moonColor = COLORS[(bodies.length + 2) % COLORS.length];

  const moon = makeBody({
    x: moonX,
    y: moonY,
    radius: moonRadius,
    color: moonColor,
    velocityX: 0,
    velocityY: 0,
    isDraft: false
  });

  moon.mass = moonMass;
  moon.radius = moonRadius;
  moon.gravity = getGravityForBody(moon);
  moon.gravityRadius = getGravityRadiusForBody(moon);

  const orbitSpeed = getCircularOrbitSpeed(parent, orbitDistance);

  moon.velocityX = parent.velocityX + tangentX * orbitSpeed;
  moon.velocityY = parent.velocityY + tangentY * orbitSpeed;
  moon.orbitTarget = parent.id;
  moon.orbitRadius = orbitDistance;
  moon.lockedOrbit = true;
  moon.orbitKind = "moon";
  moon.orbitAnnounced = true;

  bodies.push(moon);

  lastMassPanelSignature = "";
  lastMassPanelBodyIds = "";

  playSound("planetMerge");
  setObservation("Moon Added", "A moon was placed at a random distance inside the selected body's gravity field.", 180);
  forceMassPanelRefresh();
}

function destroyBody(body) {
  playSound("planetChange");
  createExplosion(body.x, body.y, body.isBlackHole ? "#b9a0ff" : body.color, 34, 1.25);

  bodies = bodies.filter((item) => item !== body);

  bodies.forEach((otherBody) => {
    if (otherBody.orbitTarget === body.id) {
      otherBody.lockedOrbit = false;
      otherBody.orbitTarget = null;
      otherBody.orbitRadius = null;
      otherBody.orbitKind = "free";
      otherBody.recentDistances = [];
      otherBody.angleHistory = [];
      otherBody.orbitScore = 0;
    }
  });

  setObservation("Mass Destroyed", "The selected mass was removed.", 160);
  forceMassPanelRefresh();
}

function turnIntoBlackHole(body) {
  body.isBlackHole = true;
  body.color = "#020204";
  const limitedVelocity = limitVelocity(
  { x: body.velocityX, y: body.velocityY },
  BLACK_HOLE_MAX_SPEED
);

  body.velocityX = limitedVelocity.x;
  body.velocityY = limitedVelocity.y;
  body.gravity = getGravityForBody(body);
  body.gravityRadius = getGravityRadiusForBody(body);
  body.trail = [];
  body.lockedOrbit = false;
  body.orbitTarget = null;
  body.orbitRadius = null;
  body.orbitAnnounced = false;
  body.texture = createSurfaceTexture("#111827");

  playSound("planetChange");
  setObservation("Black Hole", "The selected mass became a fixed black hole. It will pull every body, including future masses.", 220);
}

function absorbIntoBlackHole(blackHole, otherBody) {
  const oldMass = blackHole.mass;
  const totalMass = blackHole.mass + otherBody.mass;

  const absorbedVelocity = limitVelocity(
    {
      x: (blackHole.velocityX * blackHole.mass + otherBody.velocityX * otherBody.mass) / Math.max(totalMass, 1),
      y: (blackHole.velocityY * blackHole.mass + otherBody.velocityY * otherBody.mass) / Math.max(totalMass, 1)
    },
    BLACK_HOLE_MAX_SPEED
  );

  blackHole.mass = totalMass;

  blackHole.radius = clamp(
    getBlackHoleRadiusForMass(totalMass),
    MIN_RADIUS + 10,
    MAX_RADIUS * 1.8
  );

  blackHole.gravity = getGravityForBody(blackHole);
  blackHole.gravityRadius = getGravityRadiusForBody(blackHole);
  blackHole.velocityX = absorbedVelocity.x;
  blackHole.velocityY = absorbedVelocity.y;
  blackHole.trail = [];

  bodies = bodies.filter((body) => body !== otherBody);

  bodies.forEach((body) => {
    if (body.orbitTarget === otherBody.id) {
      body.lockedOrbit = false;
      body.orbitTarget = null;
      body.orbitRadius = null;
      body.orbitKind = "free";
      body.recentDistances = [];
      body.angleHistory = [];
      body.orbitScore = 0;
    }
  });

  playSound("planetMerge");
  createExplosion(blackHole.x, blackHole.y, "#b9a0ff", 24, 0.95);

  setObservation(
    "Absorbed",
    `The black hole consumed ${Math.round(totalMass - oldMass)} mass.`,
    160
  );

  forceMassPanelRefresh();
}

function createConfigPanel() {
  if (configPanel) {
    return;
  }

  injectConfigPanelStyles();

  configPanel = document.createElement("aside");
  configPanel.className = "config-panel";
  configPanel.innerHTML = `
    <button class="config-button" type="button" aria-label="Open settings">⚙</button>

    <div class="config-card">
      <div class="config-title">Settings</div>

      <label class="config-option">
        <input type="checkbox" data-setting="hideTrails">
        <span>Hide trails</span>
      </label>

      <label class="config-option">
        <input type="checkbox" data-setting="mute">
        <span>Mute</span>
      </label>

      <label class="config-option">
        <input type="checkbox" data-setting="hideAllUi">
        <span>Hide all UI</span>
      </label>
    </div>
  `;

  labArea.appendChild(configPanel);

  configPanel.addEventListener("pointerdown", stopPanelInteraction, true);
  configPanel.addEventListener("pointerup", stopPanelInteraction, true);
  configPanel.addEventListener("click", stopPanelInteraction, true);
  configPanel.addEventListener("change", handleConfigChange);
  configPanel.addEventListener("mouseleave", () => {
  if (document.activeElement && configPanel.contains(document.activeElement)) {
    document.activeElement.blur();
  }
});
}

function injectConfigPanelStyles() {
  if (document.getElementById("config-panel-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "config-panel-styles";
  style.textContent = `
    .config-panel {
      position: absolute;
      right: 18px;
      bottom: 18px;
      z-index: 200;
      display: flex;
      flex-direction: column-reverse;
      align-items: flex-end;
      gap: 10px;
      font-family: inherit;
      pointer-events: auto;
}

    .config-button {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(0, 0, 0, 0.78);
      color: rgba(255, 255, 255, 0.9);
      font-size: 1rem;
      cursor: pointer;
      backdrop-filter: blur(12px);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
    }

    .config-card {
      width: 185px;
      padding: 12px;
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(0, 0, 0, 0.82);
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42);
     backdrop-filter: blur(14px);
      opacity: 0;
     transform: translateY(12px);
      pointer-events: none;
     transition: opacity 180ms ease, transform 180ms ease;
}

   .config-panel:hover .config-card {
   opacity: 1;
   transform: translateY(0);
    pointer-events: auto;
}

    .config-title {
      margin-bottom: 10px;
      color: rgba(255, 255, 255, 0.9);
      font-size: 0.74rem;
      font-weight: 900;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .config-option {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 9px 8px;
      border-radius: 12px;
      color: rgba(255, 255, 255, 0.78);
      font-size: 0.78rem;
      font-weight: 800;
      cursor: pointer;
      user-select: none;
    }

    .config-option:hover {
      background: rgba(255, 255, 255, 0.07);
    }

    .config-option input {
      width: 15px;
      height: 15px;
      accent-color: #42f5d7;
      cursor: pointer;
    }

    body.hide-game-ui .lab-controls,
    body.hide-game-ui .mass-panel {
      opacity: 0 !important;
      pointer-events: none !important;
    }

    body.hide-game-ui .config-panel {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
  `;

  document.head.appendChild(style);
}

function handleConfigChange(event) {
  const input = event.target.closest("input[data-setting]");

  if (!input) {
    return;
  }

  const setting = input.dataset.setting;

  if (setting === "hideTrails") {
    hideTrails = input.checked;
  }

  if (setting === "mute") {
    isMuted = input.checked;
    applyMuteState();
  }

  if (setting === "hideAllUi") {
    hideAllUi = input.checked;
    applyUiVisibility();
  }

  draw();
}

function applyUiVisibility() {
  document.body.classList.toggle("hide-game-ui", hideAllUi);

  const controls = document.querySelector(".lab-controls");
  const bodyStat = bodyCount ? bodyCount.closest("div") : null;
  const massStat = massTotal ? massTotal.closest("div") : null;
  const observationBox = observationTitle ? observationTitle.closest("aside, section, div") : null;

if (debrisStat) {
  debrisStat.style.display = "none";
}

[controls, bodyStat, massStat, observationBox, massPanel].forEach((element) => {
  if (!element || element.closest(".config-panel")) {
    return;
  }

  element.style.display = hideAllUi ? "none" : "";
});
}

function stopControlClicks(event) {
  event.stopPropagation();
}

function isCameraDragGesture(event) {
  return event.button === 1 || event.button === 2 || event.shiftKey;
}

function startCameraDrag(event) {
  event.preventDefault();

  isCameraDragging = true;
  cameraDragPointerId = event.pointerId;
  cameraDragStartX = event.clientX;
  cameraDragStartY = event.clientY;
  cameraStartX = cameraX;
  cameraStartY = cameraY;

  labArea.classList.add("panning");

  try {
    labArea.setPointerCapture(event.pointerId);
  } catch (error) {
    // Safe fallback.
  }
}

function dragCamera(event) {
  if (!isCameraDragging) {
    return;
  }

  if (cameraDragPointerId !== null && event.pointerId !== cameraDragPointerId) {
    return;
  }

  event.preventDefault();

  const dx = (event.clientX - cameraDragStartX) / cameraZoom;
  const dy = (event.clientY - cameraDragStartY) / cameraZoom;

  cameraX = cameraStartX - dx;
  cameraY = cameraStartY - dy;

  draw();
}

function stopCameraDrag(event) {
  if (!isCameraDragging) {
    return;
  }

  if (cameraDragPointerId !== null && event && event.pointerId !== cameraDragPointerId) {
    return;
  }

  isCameraDragging = false;
  cameraDragPointerId = null;
  labArea.classList.remove("panning");
}

function zoomView(event) {
  if (event.target.closest(".lab-controls") || event.target.closest(".mass-panel")) {
    return;
  }

  event.preventDefault();

  const screenPoint = getScreenPointerPosition(event);
  const worldBeforeZoom = screenToWorld(screenPoint.x, screenPoint.y);

  const zoomFactor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  const nextZoom = clamp(cameraZoom * zoomFactor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);

  cameraZoom = nextZoom;
  cameraX = worldBeforeZoom.x - screenPoint.x / cameraZoom;
  cameraY = worldBeforeZoom.y - screenPoint.y / cameraZoom;

  draw();
}

labArea.addEventListener("pointerdown", startDraft);
labArea.addEventListener("wheel", zoomView, { passive: false });
labArea.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("pointermove", dragCamera);
window.addEventListener("pointermove", aimDraft);

window.addEventListener("pointerup", stopCameraDrag);
window.addEventListener("pointerup", releaseDraft);

window.addEventListener("pointercancel", stopCameraDrag);
window.addEventListener("pointercancel", cancelDraft);

window.addEventListener("blur", stopCameraDrag);
window.addEventListener("blur", cancelDraft);

Array.from(document.querySelectorAll(".lab-controls button")).forEach((button) => {
  button.addEventListener("pointerdown", stopControlClicks);
  button.addEventListener("click", stopControlClicks);
});

clearButton.addEventListener("click", clearSpace);
pauseButton.addEventListener("click", togglePause);

if (fullscreenButton) {
  fullscreenButton.addEventListener("click", toggleFullscreen);
}

document.addEventListener("fullscreenchange", syncFullscreenState);
window.addEventListener("resize", resizeCanvas);

setupSounds();
createMassPanel();
createConfigPanel();
resizeCanvas();
draw();
updateHud();
updateBlackHoleLoopSound();