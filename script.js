const labArea = document.getElementById("labArea");
const canvas = document.getElementById("spaceCanvas");
const ctx = canvas.getContext("2d");
const clearButton = document.getElementById("clearButton");
const pauseButton = document.getElementById("pauseButton");
const bodyCount = document.getElementById("bodyCount");
const massTotal = document.getElementById("massTotal");
const debrisCount = document.getElementById("debrisCount");
const observationTitle = document.getElementById("observationTitle");
const observationText = document.getElementById("observationText");

const COLORS = ["#f7c948", "#7c3cff", "#42f5d7", "#ff4f8b", "#7cff6b", "#f97316"];

const G = 0.38;
const SOFTENING = 3800;
const MIN_RADIUS = 10;
const MAX_RADIUS = 115;
const GROWTH_RATE = 0.04;
const LAUNCH_SCALE = 0.04;
const MAX_SPEED = 20;
const ORBIT_ASSIST = 0.68;
const ORBIT_CORRECTION = 0.0018;
const SUN_ANCHOR_RATIO = 0.7;
const COLLISION_DISTANCE = 0.86;
const SLOW_MERGE_SPEED = 2.45;
const MAX_TRAIL_POINTS = 520;
const MAX_DEBRIS = 360;

let bodies = [];
let debris = [];
let draftBody = null;
let pointerIsDown = false;
let pointerId = null;
let animationId = null;
let isPaused = false;
let lastTime = 0;
let observationCooldown = 0;

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

  try {
    labArea.setPointerCapture(event.pointerId);
  } catch (error) {
    // Safe fallback for browsers that do not allow pointer capture here.
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

  const velocity = getLaunchVelocity(draftBody);
  const assistedVelocity = getAssistedOrbitVelocity(draftBody, velocity);

  draftBody.velocityX = assistedVelocity.x;
  draftBody.velocityY = assistedVelocity.y;
  draftBody.isDraft = false;
  draftBody.trail = [];

  const target = findBestOrbitTarget(draftBody);

  bodies.push(draftBody);

  if (target && isLikelyOrbit(draftBody, target)) {
    draftBody.orbitScore = 80;
    draftBody.orbitTarget = target.id;
    setObservation("Orbit Created", "You created an orbit. The body is balanced between falling inward and moving sideways.", 220);
  } else if (bodies.length === 1) {
    setObservation("Observations", "Create a smaller mass nearby and drag sideways to give it orbital velocity.", 160);
  } else {
    setObservation("Observations", "The body is moving freely. Gravity may bend its path if it passes near a larger mass.", 130);
  }

  draftBody = null;
  pointerIsDown = false;
  pointerId = null;

  startLoop();
}

function cancelDraft() {
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
  draftBody.mass = radius * radius;
}

function makeBody({ x, y, radius, color, velocityX, velocityY, isDraft = false }) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
    x,
    y,
    radius,
    mass: radius * radius,
    color,
    velocityX,
    velocityY,
    isDraft,
    trail: [],
    orbitScore: 0,
    orbitTarget: null,
    facets: createFacets()
  };
}

function createFacets() {
  const facets = [];
  const count = 18;

  for (let i = 0; i < count; i++) {
    facets.push({
      start: (i / count) * Math.PI * 2,
      end: ((i + 1.15) / count) * Math.PI * 2,
      inner: 0.15 + Math.random() * 0.2,
      outer: 0.78 + Math.random() * 0.26,
      alpha: 0.08 + Math.random() * 0.18,
      light: Math.random() > 0.5
    });
  }

  return facets;
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
  applyGravity(delta);
  applyOrbitCorrection(delta);
  moveBodies(delta);
  updateTrails();
  detectOrbits();
  handleCollisions();
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

      if (dist < 1) continue;

      const nx = dx / dist;
      const ny = dy / dist;

      let aAccel = (G * b.mass) / (distSq + SOFTENING);
      let bAccel = (G * a.mass) / (distSq + SOFTENING);

      if (actsLikeSun(a, b)) aAccel *= 0.04;
      if (actsLikeSun(b, a)) bAccel *= 0.04;

      a.velocityX += nx * aAccel * delta;
      a.velocityY += ny * aAccel * delta;
      b.velocityX -= nx * bAccel * delta;
      b.velocityY -= ny * bAccel * delta;
    }
  }
}

function applyOrbitCorrection(delta) {
  bodies.forEach((body) => {
    const target = findBestOrbitTarget(body);

    if (!target || body.mass >= target.mass * SUN_ANCHOR_RATIO) {
      return;
    }

    const assisted = getAssistedOrbitVelocity(body, {
      x: body.velocityX,
      y: body.velocityY
    });

    body.velocityX = lerp(body.velocityX, assisted.x, ORBIT_CORRECTION * delta);
    body.velocityY = lerp(body.velocityY, assisted.y, ORBIT_CORRECTION * delta);
  });
}

function moveBodies(delta) {
  bodies.forEach((body) => {
    limitBodySpeed(body);

    body.x += body.velocityX * delta;
    body.y += body.velocityY * delta;

    if (isDominantSun(body)) {
      body.velocityX *= Math.pow(0.9, delta);
      body.velocityY *= Math.pow(0.9, delta);

      if (Math.abs(body.velocityX) < 0.01) body.velocityX = 0;
      if (Math.abs(body.velocityY) < 0.01) body.velocityY = 0;
    } else {
      body.velocityX *= Math.pow(0.9996, delta);
      body.velocityY *= Math.pow(0.9996, delta);
    }
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
    const target = findBestOrbitTarget(body);

    if (!target) {
      body.orbitScore = Math.max(0, body.orbitScore - 1);
      return;
    }

    if (isLikelyOrbit(body, target)) {
      body.orbitScore += 1;
    } else {
      body.orbitScore = Math.max(0, body.orbitScore - 1);
    }

    if (body.orbitScore === 90) {
      body.orbitTarget = target.id;
      setObservation("Orbit Created", "A stable orbit formed. Distance and sideways velocity are working together.", 220);
    }
  });
}

function handleCollisions() {
  let handled = true;

  while (handled) {
    handled = false;

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];

        if (!areColliding(a, b)) continue;

        const relativeSpeed = getRelativeSpeed(a, b);

        if (relativeSpeed <= SLOW_MERGE_SPEED) {
          mergeBodies(a, b);
        } else {
          shatterBodies(a, b, relativeSpeed);
        }

        handled = true;
        break;
      }

      if (handled) break;
    }
  }
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

  return limitVelocity({
    x: dx * LAUNCH_SCALE * sizeFactor,
    y: dy * LAUNCH_SCALE * sizeFactor
  }, MAX_SPEED);
}

function getAssistedOrbitVelocity(body, userVelocity) {
  const target = findBestOrbitTarget(body);

  if (!target) {
    return userVelocity;
  }

  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < target.radius * 1.7) {
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

  const circularSpeed = getCircularOrbitSpeed(target, distance) * 0.96;
  const circularVelocity = {
    x: tx * circularSpeed + target.velocityX,
    y: ty * circularSpeed + target.velocityY
  };

  const blend = userSpeed < 0.1 ? 0.82 : ORBIT_ASSIST;

  return limitVelocity({
    x: lerp(userVelocity.x, circularVelocity.x, blend),
    y: lerp(userVelocity.y, circularVelocity.y, blend)
  }, MAX_SPEED);
}

function findBestOrbitTarget(body) {
  let best = null;
  let bestScore = -Infinity;

  bodies.forEach((target) => {
    if (target === body || target.mass <= body.mass) return;

    const dx = target.x - body.x;
    const dy = target.y - body.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < (target.radius + body.radius) * 1.05 || distance > 2600) {
      return;
    }

    const score = target.mass * 2.8 - distance * 0.22;

    if (score > bestScore) {
      bestScore = score;
      best = target;
    }
  });

  return best;
}

function isLikelyOrbit(body, target) {
  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < target.radius * 2.1) return false;

  const vx = body.velocityX - target.velocityX;
  const vy = body.velocityY - target.velocityY;
  const speed = Math.sqrt(vx * vx + vy * vy);
  const circularSpeed = getCircularOrbitSpeed(target, distance);

  if (circularSpeed <= 0) return false;

  const speedRatio = speed / circularSpeed;
  const radialSpeed = Math.abs((vx * dx + vy * dy) / distance);
  const tangentSpeed = Math.sqrt(Math.max(0, speed * speed - radialSpeed * radialSpeed));

  return speedRatio > 0.55 && speedRatio < 1.58 && tangentSpeed > radialSpeed * 1.05;
}

function getCircularOrbitSpeed(target, distance) {
  const tunedDistance = Math.max(distance, target.radius * 3.1);
  return Math.sqrt((G * target.mass) / tunedDistance);
}

function actsLikeSun(big, other) {
  return big.mass > other.mass && other.mass < big.mass * SUN_ANCHOR_RATIO;
}

function isDominantSun(body) {
  return bodies.every((other) => other === body || other.mass < body.mass * SUN_ANCHOR_RATIO);
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

function mergeBodies(a, b) {
  const totalMass = a.mass + b.mass;
  const dominant = a.mass >= b.mass ? a : b;
  const weaker = dominant === a ? b : a;

  const mergedX = (a.x * a.mass + b.x * b.mass) / totalMass;
  const mergedY = (a.y * a.mass + b.y * b.mass) / totalMass;
  let mergedVX = (a.velocityX * a.mass + b.velocityX * b.mass) / totalMass;
  let mergedVY = (a.velocityY * a.mass + b.velocityY * b.mass) / totalMass;

  if (actsLikeSun(dominant, weaker)) {
    mergedVX *= 0.15;
    mergedVY *= 0.15;
  }

  a.x = mergedX;
  a.y = mergedY;
  a.mass = totalMass;
  a.radius = Math.sqrt(totalMass);
  a.velocityX = mergedVX;
  a.velocityY = mergedVY;
  a.color = dominant.color;
  a.trail = [];
  a.facets = createFacets();

  bodies = bodies.filter((body) => body !== b);

  createExplosion(mergedX, mergedY, dominant.color, 22, 0.9);
  setObservation("Fusion", "Slow-moving masses collided and fused into a larger body.", 180);
}

function shatterBodies(a, b, speed) {
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;

  createFragments(a, speed);
  createFragments(b, speed);
  createExplosion(x, y, "#ffffff", 18, 1.2);

  bodies = bodies.filter((body) => body !== a && body !== b);

  if (debris.length > MAX_DEBRIS) {
    debris = debris.slice(debris.length - MAX_DEBRIS);
  }

  setObservation("Collision", "Fast-moving masses collided and shattered into small pieces.", 200);
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
      color: body.color,
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

    gradient.addColorStop(0, hexToRgba(body.color, 0.16));
    gradient.addColorStop(0.38, hexToRgba(body.color, 0.055));
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(body.x, body.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawTrails() {
  bodies.forEach((body) => {
    if (body.trail.length < 3) return;

    ctx.beginPath();
    body.trail.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = hexToRgba(body.color, 0.42);
    ctx.lineWidth = body.orbitScore > 60 ? 1.6 : 1;
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
  const gradient = ctx.createRadialGradient(
    body.x - body.radius * 0.35,
    body.y - body.radius * 0.45,
    body.radius * 0.1,
    body.x,
    body.y,
    body.radius
  );

  gradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  gradient.addColorStop(0.18, hexToRgba(body.color, 0.92));
  gradient.addColorStop(1, shadeHex(body.color, -42));

  ctx.save();
  ctx.shadowBlur = clamp(body.radius * 0.9, 14, 90);
  ctx.shadowColor = body.color;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawLowPolyFacets(body);
  drawMassLabel(body);
}

function drawLowPolyFacets(body) {
  const rgb = hexToRgb(body.color);

  body.facets.forEach((facet) => {
    const x1 = body.x + Math.cos(facet.start) * body.radius * facet.inner;
    const y1 = body.y + Math.sin(facet.start) * body.radius * facet.inner;
    const x2 = body.x + Math.cos(facet.start) * body.radius * facet.outer;
    const y2 = body.y + Math.sin(facet.start) * body.radius * facet.outer;
    const x3 = body.x + Math.cos(facet.end) * body.radius * facet.outer;
    const y3 = body.y + Math.sin(facet.end) * body.radius * facet.outer;

    ctx.fillStyle = facet.light
      ? `rgba(255, 255, 255, ${facet.alpha})`
      : `rgba(${rgb.r * 0.35}, ${rgb.g * 0.35}, ${rgb.b * 0.35}, ${facet.alpha + 0.06})`;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  });
}

function drawMassLabel(body) {
  const label = `Mass ${Math.round(body.mass)}`;
  ctx.font = "800 11px Arial";
  const textWidth = ctx.measureText(label).width;
  const width = textWidth + 18;
  const height = 22;
  const x = body.x - width / 2;
  const y = body.y - body.radius - 30;

  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  roundRect(x, y, width, height, 999);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, body.x, y + height / 2 + 0.5);
}

function drawAimLine(body) {
  const dx = body.aimX - body.startX;
  const dy = body.aimY - body.startY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 8) return;

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

  if (speed <= maxSpeed) return velocity;

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

function hexToRgb(hex) {
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
  const rgb = hexToRgb(hex);
  const amount = Math.round(2.55 * percent);
  const r = clamp(rgb.r + amount, 0, 255);
  const g = clamp(rgb.g + amount, 0, 255);
  const b = clamp(rgb.b + amount, 0, 255);

  return `rgb(${r}, ${g}, ${b})`;
}

labArea.addEventListener("pointerdown", startDraft);
window.addEventListener("pointermove", aimDraft);
window.addEventListener("pointerup", releaseDraft);
window.addEventListener("pointercancel", cancelDraft);
window.addEventListener("blur", cancelDraft);

clearButton.addEventListener("click", clearSpace);
pauseButton.addEventListener("click", togglePause);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
updateHud();
draw();
