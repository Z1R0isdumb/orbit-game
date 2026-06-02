const labArea = document.getElementById("labArea");
const canvas = document.getElementById("spaceCanvas");
const ctx = canvas.getContext("2d");
const clearButton = document.getElementById("clearButton");
const pauseButton = document.getElementById("pauseButton");
const fullscreenButton = document.getElementById("fullscreenButton");
const bodyCount = document.getElementById("bodyCount");
const massTotal = document.getElementById("massTotal");
const debrisCount = document.getElementById("debrisCount");
const observationTitle = document.getElementById("observationTitle");
const observationText = document.getElementById("observationText");

const COLORS = ["#f7c948", "#42f5d7", "#7c3cff", "#ff4f8b", "#7cff6b", "#f97316", "#60a5fa"];

const G = 0.58;
const SOFTENING = 760;
const MIN_RADIUS = 3;
const MAX_RADIUS = 110;
const GROWTH_RATE = 0.015;
const LAUNCH_SCALE = 0.038;
const MAX_SPEED = 24;

const RELEASE_ASSIST = 0.34;
const LOW_SPEED_RELEASE_ASSIST = 0.56;

const CANDIDATE_ORBIT_CORRECTION = 0.011;
const LOCKED_ORBIT_CORRECTION = 0.06;
const MOON_LOCK_CORRECTION = 0.095;
const LOCKED_RADIUS_CORRECTION = 0.024;
const MOON_RADIUS_CORRECTION = 0.048;

const COLLISION_DISTANCE = 0.9;
const SLOW_MERGE_SPEED = 2.8;
const MAX_TRAIL_POINTS = 620;
const MAX_DEBRIS = 420;

const ORBIT_SAMPLE_LIMIT = 180;
const ORBIT_CONFIRM_SCORE = 64;
const PHYSICS_STEP = 0.5;

const TINY_IMPACT_MASS_RATIO = 0.08;
const TINY_IMPACT_RADIUS_RATIO = 0.34;

const THIRD_BODY_DAMPING = 0.008;
const SMALL_BODY_INTERACTION = 0;

const MOON_TARGET_DISTANCE_MULTIPLIER = 28;
const MOON_LOCK_DISTANCE_MULTIPLIER = 38;

let bodies = [];
let debris = [];
let draftBody = null;
let pointerIsDown = false;
let pointerId = null;
let animationId = null;
let isPaused = false;
let lastTime = 0;
let observationCooldown = 0;

const SOUND_VOLUME = 0.65;
const LOOP_VOLUME = 0.18;
const SOUND_FADE_MS = 4000;
const LOOP_CROSSFADE_SECONDS = 4;

const SOUND_FILES = {
  planetAdd: "Orbit/planetadd.wav",
  planetChange: "Orbit/planetchange.wav",
  planetGrow: "Orbit/planetgrow.wav",
  planetLoop: "Orbit/planetloop.wav",
  planetMerge: "Orbit/planetmerge.wav"
};

const sounds = {};
let growSound = null;
let loopSound = null;
let nextLoopSound = null;
let loopCrossfadeTimer = null;
let loopIsStopping = false;

function setupSounds() {
  Object.entries(SOUND_FILES).forEach(([name, src]) => {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.volume = SOUND_VOLUME;
    sounds[name] = audio;
  });
}

function playSound(name, volume = SOUND_VOLUME) {
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
  const rect = labArea.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
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
  debrisCount.textContent = debris.length;
}

function startDraft(event) {
  if (event.target.closest(".lab-controls")) {
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

  const userVelocity = getLaunchVelocity(draftBody);
  const parent = chooseOrbitParent(draftBody);
  const assistedVelocity = parent
    ? getReleaseAssistedVelocity(draftBody, parent, userVelocity)
    : userVelocity;

  draftBody.velocityX = assistedVelocity.x;
  draftBody.velocityY = assistedVelocity.y;
  draftBody.isDraft = false;
  draftBody.trail = [];
  draftBody.recentDistances = [];
  draftBody.angleHistory = [];
  draftBody.orbitScore = 0;
  draftBody.orbitTarget = parent ? parent.id : null;
  draftBody.orbitAnnounced = false;
  draftBody.lockedOrbit = false;
  draftBody.orbitRadius = parent ? getDistance(draftBody, parent) : null;
  draftBody.orbitKind = parent && !isMainMass(parent) ? "moon" : parent ? "planet" : "free";

  const wasFirstBody = bodies.length === 0;

bodies.push(draftBody);

if (wasFirstBody) {
  startSpaceLoopSound();
}
  reassignParentLocks();

  if (parent) {
    const isMoon = draftBody.orbitKind === "moon";

    setObservation(
      isMoon ? "Moon Path" : "Planet Path",
      isMoon
        ? "The small body is near a planet. If it curves around that planet, it will lock into a moon orbit."
        : "The body is moving around the biggest mass. If it curves enough, it will lock into a circular orbit.",
      180
    );
  } else if (bodies.length === 1) {
    setObservation(
      "Observations",
      "Create another mass nearby and drag sideways to try forming an orbit.",
      150
    );
  }

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
}

function makeBody({ x, y, radius, color, velocityX, velocityY, isDraft = false }) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
    x,
    y,
    radius,
  mass: getMassForRadius(radius),
    gravity: 1,
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

  if (observationCooldown > 0) {
    observationCooldown -= 1;
  }

  animationId = requestAnimationFrame(loop);
  stopLoopIfIdle();
}

function update(delta) {
  updateDraftBody();
  reassignParentLocks();

  const steps = Math.max(1, Math.ceil(delta / PHYSICS_STEP));
  const stepDelta = delta / steps;

  for (let i = 0; i < steps; i++) {
    applyGravity(stepDelta);
    applyOrbitCorrection(stepDelta);
    moveBodies(stepDelta);
    handleCollisions();
  }

  updateTrails();
  detectOrbits();
  updateDebris(delta);
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

      let aAccel = (G * b.mass * b.gravity) / (distSq + SOFTENING);
      let bAccel = (G * a.mass * a.gravity) / (distSq + SOFTENING);

      aAccel *= getGravityMultiplierForPair(a, b);
      bAccel *= getGravityMultiplierForPair(b, a);

      a.velocityX += nx * aAccel * delta;
      a.velocityY += ny * aAccel * delta;

      b.velocityX -= nx * bAccel * delta;
      b.velocityY -= ny * bAccel * delta;
    }
  }
}

function getGravityMultiplierForPair(bodyBeingPulled, sourceBody) {
  const mainMass = getMainMass();

  if (!mainMass) {
    return 1;
  }

  if (bodyBeingPulled === mainMass) {
    return 0;
  }

  const parent = getCurrentOrbitTarget(bodyBeingPulled);

  if (parent && parent.id === sourceBody.id) {
    return 1;
  }

  if (bodyBeingPulled.orbitKind === "moon") {
    return THIRD_BODY_DAMPING;
  }

  if (sourceBody === mainMass) {
    return 1;
  }

  return SMALL_BODY_INTERACTION;
}

function applyOrbitCorrection(delta) {
  bodies.forEach((body) => {
    const target = getCurrentOrbitTarget(body);

    if (!target || body.mass >= target.mass) {
      return;
    }

    const orbitStatus = evaluateOrbitCandidate(body, target);

    if (!body.lockedOrbit && !orbitStatus.candidate) {
      return;
    }

    if (!body.lockedOrbit && orbitStatus.candidate) {
      const assistedCandidate = getCircularizedVelocity(
        body,
        target,
        {
          x: body.velocityX,
          y: body.velocityY
        },
        1
      );

      body.velocityX = lerp(body.velocityX, assistedCandidate.x, CANDIDATE_ORBIT_CORRECTION * delta);
      body.velocityY = lerp(body.velocityY, assistedCandidate.y, CANDIDATE_ORBIT_CORRECTION * delta);
      return;
    }

    const assisted = getCircularizedVelocity(
      body,
      target,
      {
        x: body.velocityX,
        y: body.velocityY
      },
      1
    );

    const velocityCorrection = body.orbitKind === "moon"
      ? MOON_LOCK_CORRECTION
      : LOCKED_ORBIT_CORRECTION;

    body.velocityX = lerp(body.velocityX, assisted.x, velocityCorrection * delta);
    body.velocityY = lerp(body.velocityY, assisted.y, velocityCorrection * delta);

    const radiusCorrection = body.orbitKind === "moon"
      ? MOON_RADIUS_CORRECTION
      : LOCKED_RADIUS_CORRECTION;

    correctOrbitRadius(body, target, radiusCorrection * delta);
  });
}

function correctOrbitRadius(body, target, strength) {
  if (!body.orbitRadius) {
    body.orbitRadius = getDistance(body, target);
    return;
  }

  const dx = body.x - target.x;
  const dy = body.y - target.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 1) {
    return;
  }

  const nx = dx / distance;
  const ny = dy / distance;
  const desiredDistance = body.orbitRadius;
  const difference = desiredDistance - distance;

  body.x += nx * difference * strength;
  body.y += ny * difference * strength;
}

function forceCircularOrbit(body, target) {
  const dx = body.x - target.x;
  const dy = body.y - target.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 1) {
    return;
  }

  const orbitRadius = body.orbitRadius || distance;
  const nx = dx / distance;
  const ny = dy / distance;

  body.x = target.x + nx * orbitRadius;
  body.y = target.y + ny * orbitRadius;

  let tangentX = -ny;
  let tangentY = nx;

  const currentRelativeVelocityX = body.velocityX - target.velocityX;
  const currentRelativeVelocityY = body.velocityY - target.velocityY;

  if (currentRelativeVelocityX * tangentX + currentRelativeVelocityY * tangentY < 0) {
    tangentX = -tangentX;
    tangentY = -tangentY;
  }

  const circularSpeed = getCircularOrbitSpeed(target, orbitRadius);

  body.velocityX = target.velocityX + tangentX * circularSpeed;
  body.velocityY = target.velocityY + tangentY * circularSpeed;
}




function moveBodies(delta) {
  const mainMass = getMainMass();

  bodies.forEach((body) => {
    limitBodySpeed(body);

    if (body === mainMass) {
      body.velocityX = 0;
      body.velocityY = 0;
      return;
    }

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
    const target = getCurrentOrbitTarget(body);

    if (!target) {
      return;
    }

    const dx = body.x - target.x;
    const dy = body.y - target.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    if (!body.recentDistances) {
      body.recentDistances = [];
    }

    if (!body.angleHistory) {
      body.angleHistory = [];
    }

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
      body.orbitScore = Math.min(ORBIT_CONFIRM_SCORE + 40, body.orbitScore + 4);
    } else if (orbitStatus.candidate) {
      body.orbitScore = Math.min(ORBIT_CONFIRM_SCORE, body.orbitScore + 1);
    } else {
      body.orbitScore = Math.max(0, body.orbitScore - 3);
    }

    if (!body.lockedOrbit && body.orbitScore >= ORBIT_CONFIRM_SCORE && orbitStatus.steady) {
      body.lockedOrbit = true;
      body.orbitRadius = orbitStatus.averageDistance || distance;
      body.trail = [];
      playSound("planetMerge");

      forceCircularOrbit(body, target);

      setObservation(
        body.orbitKind === "moon" ? "Moon Orbit Locked" : "Circular Orbit Locked",
        body.orbitKind === "moon"
          ? "The moon completed enough of a curve around the planet. It is now correcting into a circular orbit."
          : "The body completed enough of a curve around the main mass. It is now correcting into a circular orbit.",
        260
      );
    }

    if (body.lockedOrbit && !body.orbitAnnounced && body.angleHistory.length > 110) {
      body.orbitAnnounced = true;

      setObservation(
        body.orbitKind === "moon" ? "Moon Orbit" : "Planet Orbit",
        body.orbitKind === "moon"
          ? "The moon is now visibly orbiting the nearby planet."
          : "The planet is now visibly orbiting the biggest mass.",
        220
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
    speedRatio > 0.5 &&
    speedRatio < 1.95 &&
    tangentSpeed > radialSpeed * 0.9;

  if (!candidate || !body.recentDistances || body.recentDistances.length < 55) {
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
    distanceVariance < 0.34 &&
    angularTravel > Math.PI * 0.8;

  return {
    candidate,
    steady,
    averageDistance
  };
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

  const massRatio = smaller.mass / bigger.mass;
  const radiusRatio = smaller.radius / bigger.radius;

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

  const sizeFactor = clamp(34 / body.radius, 0.28, 1.45);

  return limitVelocity(
    {
      x: dx * LAUNCH_SCALE * sizeFactor,
      y: dy * LAUNCH_SCALE * sizeFactor
    },
    MAX_SPEED
  );
}

function getReleaseAssistedVelocity(body, target, userVelocity) {
  const userSpeed = Math.sqrt(userVelocity.x * userVelocity.x + userVelocity.y * userVelocity.y);

  if (userSpeed < 0.35) {
    return getCircularizedVelocity(body, target, userVelocity, LOW_SPEED_RELEASE_ASSIST);
  }

  return getCircularizedVelocity(body, target, userVelocity, RELEASE_ASSIST);
}

function getCircularizedVelocity(body, target, userVelocity, blendAmount) {
  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < target.radius * 1.8) {
    return userVelocity;
  }

  const nx = dx / distance;
  const ny = dy / distance;

  let tx = -ny;
  let ty = nx;

  const userSpeed = Math.sqrt(userVelocity.x * userVelocity.x + userVelocity.y * userVelocity.y);

  if (userSpeed > 0.1 && userVelocity.x * tx + userVelocity.y * ty < 0) {
    tx = -tx;
    ty = -ty;
  }

  const orbitDistance = body.lockedOrbit && body.orbitRadius
    ? body.orbitRadius
    : distance;

  const circularSpeed = getCircularOrbitSpeed(target, orbitDistance);

  const circularVelocity = {
    x: tx * circularSpeed + target.velocityX,
    y: ty * circularSpeed + target.velocityY
  };

  return limitVelocity(
    {
      x: lerp(userVelocity.x, circularVelocity.x, blendAmount),
      y: lerp(userVelocity.y, circularVelocity.y, blendAmount)
    },
    MAX_SPEED
  );
}

function chooseOrbitParent(body) {
  if (bodies.length === 0) {
    return null;
  }

  const mainMass = getMainMass();
  const closestMoonParent = findClosestMoonParent(body, mainMass);

  if (closestMoonParent) {
    return closestMoonParent;
  }

  if (mainMass && mainMass.mass > body.mass) {
    return mainMass;
  }

  return null;
}

function findClosestMoonParent(body, mainMass) {
  let closestParent = null;
  let closestDistance = Infinity;

  bodies.forEach((candidate) => {
    if (candidate === body) {
      return;
    }

    if (candidate === mainMass) {
      return;
    }

    if (candidate.mass <= body.mass) {
      return;
    }

    if (candidate.orbitKind !== "planet" && !candidate.lockedOrbit) {
      return;
    }

    const distanceToCandidate = getDistance(body, candidate);
    const moonZone = Math.max(
      candidate.radius * MOON_TARGET_DISTANCE_MULTIPLIER,
      candidate.radius + body.radius + 170
    );

    if (distanceToCandidate > moonZone) {
      return;
    }

    if (mainMass) {
      const distanceToSun = getDistance(body, mainMass);

      if (distanceToCandidate > distanceToSun) {
        return;
      }
    }

    if (distanceToCandidate < closestDistance) {
      closestDistance = distanceToCandidate;
      closestParent = candidate;
    }
  });

  return closestParent;
}

function reassignParentLocks() {
  const mainMass = getMainMass();

  if (!mainMass) {
    return;
  }

  bodies.forEach((body) => {
    if (body === mainMass) {
      body.orbitTarget = null;
      body.lockedOrbit = false;
      body.orbitKind = "sun";
      body.orbitRadius = null;
      return;
    }

    if (body.orbitKind === "moon") {
      const parent = getBodyById(body.orbitTarget);

      if (parent && parent !== mainMass && parent.mass > body.mass) {
        const distance = getDistance(body, parent);
        const maxMoonDistance = parent.radius * MOON_LOCK_DISTANCE_MULTIPLIER;

        if (distance <= maxMoonDistance) {
          return;
        }
      }
    }

    if (mainMass.mass > body.mass && body.orbitKind !== "moon") {
      if (body.orbitTarget !== mainMass.id) {
        body.orbitScore = 0;
        body.lockedOrbit = false;
        body.orbitRadius = getDistance(body, mainMass);
        body.trail = [];
      }

      body.orbitTarget = mainMass.id;
      body.orbitKind = "planet";
    }
  });
}

function getCurrentOrbitTarget(body) {
  if (!body.orbitTarget) {
    return null;
  }

  const target = getBodyById(body.orbitTarget);

  if (!target || target === body || target.mass <= body.mass) {
    body.orbitTarget = null;
    body.lockedOrbit = false;
    body.orbitKind = "free";
    body.orbitRadius = null;
    return null;
  }

  return target;
}

function getCircularOrbitSpeed(target, distance) {
  const safeDistance = Math.max(distance, target.radius * 3.1);
  const targetGravity = target.gravity || 1;

  return Math.sqrt((G * target.mass * targetGravity * safeDistance) / (safeDistance * safeDistance + SOFTENING));
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
  return big === getMainMass() && big.mass > other.mass;
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
  const weaker = dominant === a ? b : a;

  const mergedX = (a.x * a.mass + b.x * b.mass) / totalMass;
  const mergedY = (a.y * a.mass + b.y * b.mass) / totalMass;

  let mergedVX = (a.velocityX * a.mass + b.velocityX * b.mass) / totalMass;
  let mergedVY = (a.velocityY * a.mass + b.velocityY * b.mass) / totalMass;

  if (actsLikeSun(dominant, weaker)) {
    mergedVX *= 0.12;
    mergedVY *= 0.12;
  }

  a.x = mergedX;
  a.y = mergedY;
  a.mass = totalMass;
  a.radius = getRadiusForMass(totalMass);
  a.velocityX = mergedVX;
  a.velocityY = mergedVY;
  a.color = dominant.color;
  a.trail = [];
  a.orbitScore = 0;
  a.orbitTarget = null;
  a.orbitAnnounced = false;
  a.lockedOrbit = false;
  a.orbitKind = "free";
  a.orbitRadius = null;
  a.recentDistances = [];
  a.angleHistory = [];
  a.texture = createSurfaceTexture(a.color);

  bodies = bodies.filter((body) => body !== b);

  reassignParentLocks();
  playSound("planetMerge");
createExplosion(mergedX, mergedY, dominant.color, 22, 0.9);
setObservation("Fusion", "Masses collided and merged into a larger body.", 180);
}

function shatterBodies(a, b, speed) {
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  playSound("planetChange");

  createFragments(a, speed);
  createFragments(b, speed);
  createExplosion(x, y, "#ffffff", 18, 1.25);

  bodies = bodies.filter((body) => body !== a && body !== b);

  reassignParentLocks();

  if (debris.length > MAX_DEBRIS) {
    debris = debris.slice(debris.length - MAX_DEBRIS);
  }

  setObservation("Collision", "Fast-moving masses collided and shattered into small fragments.", 200);
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

  bodies = [];
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

  drawGravityWells();
  drawTrails();
  drawDebris();

  bodies.forEach(drawBody);

  if (draftBody) {
    drawAimLine(draftBody);
    drawBody(draftBody);
  }
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

function drawTrails() {
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
  drawMassLabel(body);
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
  const label = `Mass ${Math.round(body.mass)}`;

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

function limitBodySpeed(body) {
  const limited = limitVelocity({ x: body.velocityX, y: body.velocityY }, MAX_SPEED);

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

function random(min, max) {
  return Math.random() * (max - min) + min;
}


function getMassForRadius(radius) {
  return Math.max(0, radius * radius - MIN_RADIUS * MIN_RADIUS);
}

function getRadiusForMass(mass) {
  return Math.sqrt(Math.max(0, mass) + MIN_RADIUS * MIN_RADIUS);
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

function stopControlClicks(event) {
  event.stopPropagation();
}

function getGravityForBody(body) {
  if (body.radius >= 85) {
    return 1.35; // huge sun-like body
  }

  if (body.radius >= 45) {
    return 1.1; // medium planet
  }

  if (body.radius <= 18) {
    return 0.85; // tiny moon
  }

  return 1;
}

labArea.addEventListener("pointerdown", startDraft);
window.addEventListener("pointermove", aimDraft);
window.addEventListener("pointerup", releaseDraft);
window.addEventListener("pointercancel", cancelDraft);
window.addEventListener("blur", cancelDraft);

document.querySelectorAll(".lab-controls button").forEach((button) => {
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
resizeCanvas();
updateHud();
draw();