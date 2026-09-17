import { CONFIG } from './config';
import type { Agent, GameResult, SimState, World } from './types';

const TAU = Math.PI * 2;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeAgent(id: number, world: World): Agent {
  const r = CONFIG.agentRadius;
  return {
    id,
    x: rand(r, world.w - r),
    y: rand(r, world.h - r),
    dir: Math.random() * TAU,
    speed: rand(CONFIG.speedMin, CONFIG.speedMax),
    state: 'susceptible',
    everInfected: false,
    infectionTimer: 0,
    exposure: 0,
    immunity: 0,
    zone: -1,
    contacts: 0,
    load: 0,
    flash: 0,
  };
}

function infect(agent: Agent, state: SimState): void {
  agent.state = 'infected';
  agent.everInfected = true;
  agent.exposure = 0;
  agent.immunity = 0;
  agent.flash = 1;
  agent.infectionTimer = rand(CONFIG.recoveryMin, CONFIG.recoveryMax);
  state.totalInfected += 1;
}

export function createSim(world: World, population: number): SimState {
  const agents: Agent[] = [];
  for (let i = 0; i < population; i += 1) agents.push(makeAgent(i, world));

  const state: SimState = {
    world,
    agents,
    zones: [],
    pulses: [],
    links: [],
    time: 0,
    timeLeft: CONFIG.duration,
    points: CONFIG.startPoints,
    lockdownTimer: 0,
    lockdownCooldown: 0,
    actions: { isolation: 0, vaccine: 0, lockdown: 0 },
    pointsSpent: 0,
    susceptible: population,
    infected: 0,
    recovered: 0,
    peakInfected: 0,
    totalInfected: 0,
    infectionRate: 0,
    danger: 0,
    nextZoneId: 1,
  };

  // 初期感染者は互いに離れた場所から始めて、複数のクラスタができるようにする
  const startIndexes = new Set<number>();
  while (startIndexes.size < Math.min(CONFIG.initialInfected, population)) {
    startIndexes.add(Math.floor(Math.random() * population));
  }
  for (const i of startIndexes) infect(agents[i], state);
  state.totalInfected = startIndexes.size;
  recount(state);
  return state;
}

/** 世界の外周で反射させる */
function bounceWorld(a: Agent, world: World): void {
  const r = CONFIG.agentRadius;
  if (a.x < r) {
    a.x = r;
    a.dir = Math.PI - a.dir;
  } else if (a.x > world.w - r) {
    a.x = world.w - r;
    a.dir = Math.PI - a.dir;
  }
  if (a.y < r) {
    a.y = r;
    a.dir = -a.dir;
  } else if (a.y > world.h - r) {
    a.y = world.h - r;
    a.dir = -a.dir;
  }
}

/**
 * 隔離エリアの境界処理。
 * - エリア所属者は外に出られない
 * - 非所属者は中に入れない
 * これにより隔離エリアは「壁」としても機能する。
 */
function applyZoneBounds(a: Agent, state: SimState): void {
  const ar = CONFIG.agentRadius;
  for (const z of state.zones) {
    const dx = a.x - z.x;
    const dy = a.y - z.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    const nx = dx / d;
    const ny = dy / d;

    if (a.zone === z.id) {
      const limit = z.r - ar;
      if (d > limit) {
        a.x = z.x + nx * limit;
        a.y = z.y + ny * limit;
        // 内向きに反射
        a.dir = Math.atan2(-ny, -nx) + rand(-0.6, 0.6);
      }
    } else {
      const limit = z.r + ar;
      if (d < limit) {
        a.x = z.x + nx * limit;
        a.y = z.y + ny * limit;
        // 外向きに反射
        a.dir = Math.atan2(ny, nx) + rand(-0.6, 0.6);
      }
    }
  }
}

function recount(state: SimState): void {
  let s = 0;
  let i = 0;
  let r = 0;
  for (const a of state.agents) {
    if (a.state === 'susceptible') s += 1;
    else if (a.state === 'infected') i += 1;
    else r += 1;
  }
  state.susceptible = s;
  state.infected = i;
  state.recovered = r;
  if (i > state.peakInfected) state.peakInfected = i;
}

/** 固定タイムステップで 1 ステップ進める（dt は 1/60 前後を想定） */
export function step(state: SimState, dt: number): void {
  state.time += dt;
  state.timeLeft = Math.max(0, CONFIG.duration - state.time);
  state.points = Math.min(CONFIG.maxPoints, state.points + CONFIG.pointRegen * dt);
  if (state.lockdownTimer > 0) state.lockdownTimer = Math.max(0, state.lockdownTimer - dt);
  if (state.lockdownCooldown > 0) state.lockdownCooldown = Math.max(0, state.lockdownCooldown - dt);

  // --- 隔離エリアの寿命 ---
  for (let i = state.zones.length - 1; i >= 0; i -= 1) {
    const z = state.zones[i];
    z.life -= dt;
    if (z.life <= 0) {
      for (const a of state.agents) if (a.zone === z.id) a.zone = -1;
      state.pulses.push({ x: z.x, y: z.y, r: z.r, age: 0, ttl: 0.6, kind: 'zone-expire' });
      state.zones.splice(i, 1);
    }
  }

  // --- エフェクトの更新 ---
  for (let i = state.pulses.length - 1; i >= 0; i -= 1) {
    const p = state.pulses[i];
    p.age += dt;
    if (p.age >= p.ttl) state.pulses.splice(i, 1);
  }

  const globalSpeed = state.lockdownTimer > 0 ? CONFIG.lockdownSpeedFactor : 1;

  // --- 移動 ---
  for (const a of state.agents) {
    a.dir += rand(-CONFIG.turnRate, CONFIG.turnRate) * dt;
    const mul = globalSpeed * (a.zone >= 0 ? CONFIG.zoneSpeedFactor : 1);
    const v = a.speed * mul;
    a.x += Math.cos(a.dir) * v * dt;
    a.y += Math.sin(a.dir) * v * dt;
    bounceWorld(a, state.world);
    applyZoneBounds(a, state);
    if (a.flash > 0) a.flash = Math.max(0, a.flash - dt * 1.6);
    if (a.immunity > 0) a.immunity = Math.max(0, a.immunity - dt);
    a.contacts = 0;
    a.load = 0;
  }

  // --- 接触判定（感染者 × 未感染者） ---
  state.links.length = 0;
  const cr = CONFIG.contactRadius;
  const cr2 = cr * cr;
  const agents = state.agents;
  const n = agents.length;
  for (let i = 0; i < n; i += 1) {
    const a = agents[i];
    if (a.state !== 'infected') continue;
    for (let j = 0; j < n; j += 1) {
      const b = agents[j];
      if (b.state !== 'susceptible') continue;
      // 隔離エリアをまたぐ接触は起きない
      if (a.zone !== b.zone) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > cr2) continue;
      b.contacts += 1;
      // 隔離エリア内は接触が制限されるので、同じ距離でも感染圧が下がる
      b.load += a.zone >= 0 ? CONFIG.zoneContactFactor : 1;
      if (state.links.length < 240) state.links.push(i, j);
    }
  }

  // --- 感染の進行 ---
  let newInfections = 0;
  for (const a of agents) {
    if (a.state !== 'susceptible') continue;
    if (a.load > 0) {
      const stack = Math.min(a.load, CONFIG.maxContactStack);
      const resist = a.immunity > 0 ? CONFIG.immunityFactor : 1;
      a.exposure += CONFIG.exposureGain * stack * resist * dt;
      if (a.exposure >= CONFIG.exposureThreshold) {
        if (Math.random() < CONFIG.infectionChance) {
          infect(a, state);
          newInfections += 1;
        } else {
          a.exposure = CONFIG.exposureThreshold * 0.45;
        }
      }
    } else if (a.exposure > 0) {
      a.exposure = Math.max(0, a.exposure - CONFIG.exposureDecay * dt);
    }
  }

  // --- 回復 ---
  for (const a of agents) {
    if (a.state !== 'infected') continue;
    a.infectionTimer -= dt;
    if (a.infectionTimer <= 0) {
      a.state = 'recovered';
      a.flash = 1;
      a.contacts = 0;
    }
  }

  recount(state);

  // --- 危険度（新規感染ペースと感染者比率の合成） ---
  const decay = Math.exp(-dt / 1.8);
  state.infectionRate = state.infectionRate * decay + newInfections;
  const ratio = state.infected / Math.max(1, agents.length);
  const paceDanger = Math.min(1, state.infectionRate / 6);
  const sizeDanger = Math.min(1, ratio / 0.3);
  state.danger = Math.min(1, Math.max(paceDanger, sizeDanger * 0.9));
}

// --- プレイヤーの介入 -------------------------------------------------

function spend(state: SimState, cost: number): boolean {
  if (state.points < cost) return false;
  state.points -= cost;
  state.pointsSpent += cost;
  return true;
}

/** 指定位置に隔離エリアを設置。成功したら true */
export function placeIsolation(state: SimState, x: number, y: number): boolean {
  if (!spend(state, CONFIG.costs.isolation)) return false;
  const id = state.nextZoneId;
  state.nextZoneId += 1;
  const zone = { id, x, y, r: CONFIG.zoneRadius, life: CONFIG.zoneLife, maxLife: CONFIG.zoneLife };
  state.zones.push(zone);
  for (const a of state.agents) {
    if (a.zone !== -1) continue;
    if (Math.hypot(a.x - x, a.y - y) <= zone.r - CONFIG.agentRadius) a.zone = id;
  }
  state.actions.isolation += 1;
  return true;
}

/** 指定位置にワクチン／治療エリアを展開。成功したら true */
export function placeVaccine(state: SimState, x: number, y: number): boolean {
  if (!spend(state, CONFIG.costs.vaccine)) return false;
  const r = CONFIG.vaccineRadius;
  for (const a of state.agents) {
    if (Math.hypot(a.x - x, a.y - y) > r) continue;
    if (a.state === 'susceptible') {
      a.immunity = CONFIG.immunityDuration;
      a.exposure = 0;
      a.flash = Math.max(a.flash, 0.7);
    } else if (a.state === 'infected') {
      a.infectionTimer *= CONFIG.treatFactor;
      a.flash = Math.max(a.flash, 0.7);
    }
  }
  state.pulses.push({ x, y, r, age: 0, ttl: 0.75, kind: 'vaccine' });
  state.actions.vaccine += 1;
  return true;
}

/** 緊急ロックダウンを発動。成功したら true */
export function triggerLockdown(state: SimState): boolean {
  if (state.lockdownCooldown > 0) return false;
  if (!spend(state, CONFIG.costs.lockdown)) return false;
  state.lockdownTimer = CONFIG.lockdownDuration;
  state.lockdownCooldown = CONFIG.lockdownCooldown + CONFIG.lockdownDuration;
  state.actions.lockdown += 1;
  return true;
}

/** 隔離エリアのプレビュー用に、その範囲の内訳を数える */
export function previewCounts(
  state: SimState,
  x: number,
  y: number,
  r: number,
): { infected: number; healthy: number } {
  let infected = 0;
  let healthy = 0;
  for (const a of state.agents) {
    if (Math.hypot(a.x - x, a.y - y) > r) continue;
    if (a.state === 'infected') infected += 1;
    else if (a.state === 'susceptible') healthy += 1;
  }
  return { infected, healthy };
}

// --- 結果 -------------------------------------------------------------

export function buildResult(state: SimState): GameResult {
  const population = state.agents.length;
  let protectedCount = 0;
  for (const a of state.agents) if (!a.everInfected) protectedCount += 1;
  const infectionRate = (population - protectedCount) / population;
  const pointsLeft = Math.floor(state.points);
  const score = Math.max(
    0,
    Math.round(protectedCount * 100 + pointsLeft * 2 - state.peakInfected * 20),
  );

  // 画面に出る文言なので「です・ます」調で、次にとれる行動を添える
  let rank: GameResult['rank'] = 'D';
  let comment = '街は感染に飲まれました。最初の1クラスタに、早く隔離を打ちましょう。';
  if (infectionRate <= 0.15) {
    rank = 'S';
    comment = 'ほぼ完全に封じ込めました。街はあなたに感謝しています。';
  } else if (infectionRate <= 0.3) {
    rank = 'A';
    comment = '見事な初動でした。被害は最小限に抑えられています。';
  } else if (infectionRate <= 0.5) {
    rank = 'B';
    comment = '半分は守りきりました。ポイントを溜めすぎていないか見直しましょう。';
  } else if (infectionRate <= 0.75) {
    rank = 'C';
    comment = '対応が後手に回りました。感染者が固まった瞬間に隔離すると効きます。';
  }

  return {
    population,
    infectionRate,
    peakInfected: state.peakInfected,
    protectedCount,
    totalInfected: state.totalInfected,
    actions: { ...state.actions },
    pointsLeft,
    pointsSpent: state.pointsSpent,
    score,
    rank,
    comment,
  };
}
