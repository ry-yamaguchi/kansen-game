import { CONFIG } from './config';
import { WAVES, WAVE_EFFECT } from './events';
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

/** 時間の進みに応じて 0..1 を返す。流入の強さを時間で変えるのに使う */
function progress(state: SimState): number {
  return Math.min(1, state.time / CONFIG.duration);
}

/**
 * 画面の端から感染者を送り込む。
 * これが無いと、一度抑え込んだ時点でプレイヤーのやることが消えてしまう。
 */
function spawnInflow(state: SimState): void {
  const p = progress(state);
  const count = Math.round(
    CONFIG.inflowCountStart + (CONFIG.inflowCountEnd - CONFIG.inflowCountStart) * p,
  );
  const r = CONFIG.agentRadius;
  for (let i = 0; i < count; i += 1) {
    if (state.agents.length >= CONFIG.maxPopulation) break;
    const agent = makeAgent(state.agents.length, state.world);
    // 4辺のどこかから、内側を向いて入ってくる
    const side = Math.floor(Math.random() * 4);
    if (side === 0) {
      agent.x = r;
      agent.y = rand(r, state.world.h - r);
      agent.dir = rand(-0.7, 0.7);
    } else if (side === 1) {
      agent.x = state.world.w - r;
      agent.y = rand(r, state.world.h - r);
      agent.dir = Math.PI + rand(-0.7, 0.7);
    } else if (side === 2) {
      agent.x = rand(r, state.world.w - r);
      agent.y = r;
      agent.dir = Math.PI / 2 + rand(-0.7, 0.7);
    } else {
      agent.x = rand(r, state.world.w - r);
      agent.y = state.world.h - r;
      agent.dir = -Math.PI / 2 + rand(-0.7, 0.7);
    }
    state.agents.push(agent);
    infect(agent, state);
    state.inflowTotal += 1;
  }
  // 時間が経つほど間隔が詰まる
  const interval =
    CONFIG.inflowIntervalStart + (CONFIG.inflowIntervalEnd - CONFIG.inflowIntervalStart) * p;
  state.inflowTimer = interval;
}

/** 時刻に達したウェーブを発生させる */
function applyWaves(state: SimState): void {
  while (state.nextWave < WAVES.length && state.time >= WAVES[state.nextWave].at) {
    const wave = WAVES[state.nextWave];
    state.nextWave += 1;
    switch (wave.kind) {
      case 'variant':
        state.transmissionMul *= WAVE_EFFECT.variantTransmission;
        break;
      case 'gathering':
        state.gatherTimer = WAVE_EFFECT.gatheringDuration;
        break;
      case 'support':
        state.points = Math.min(CONFIG.maxPoints, state.points + WAVE_EFFECT.supportPoints);
        break;
      case 'weakImmunity':
        state.resistanceMul *= WAVE_EFFECT.weakImmunityFactor;
        break;
    }
    state.nextNoticeId += 1;
    state.notice = {
      id: state.nextNoticeId,
      title: wave.title,
      detail: wave.detail,
      tone: wave.tone,
    };
  }
}

/** 社会活動度。閉じ込めるほど下がり、放っておくと戻る */
function updateSocial(state: SimState, dt: number): void {
  let delta = CONFIG.socialRecovery;
  delta -= state.zones.length * CONFIG.socialCostPerZone;
  if (state.lockdownTimer > 0) delta -= CONFIG.socialCostLockdown;
  state.social = Math.max(0, Math.min(CONFIG.socialMax, state.social + delta * dt));
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
    social: CONFIG.socialMax,
    transmissionMul: 1,
    resistanceMul: 1,
    gatherTimer: 0,
    nextWave: 0,
    notice: null,
    nextNoticeId: 1,
    inflowTimer: CONFIG.inflowIntervalStart,
    inflowTotal: 0,
    healthySeconds: 0,
    socialSeconds: 0,
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
 * いまどの隔離エリアの中にいるかを毎フレーム見直す。
 *
 * かつては所属者を閉じ込め、非所属者を外へ押し出す「壁」にしていたが、
 * それだと盤面の一部を塞いだぶん外側の密度が上がり、
 * 隔離するほど外の感染が増えるという逆効果になっていた。
 * いまは出入り自由な「接触を鈍らせる区画」として扱う。
 */
function updateZoneMembership(a: Agent, state: SimState): void {
  a.zone = -1;
  for (const z of state.zones) {
    if (Math.hypot(a.x - z.x, a.y - z.y) <= z.r) {
      a.zone = z.id;
      return;
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

/** 移動と、フレームごとに寿命が減る値の更新 */
function moveAgents(state: SimState, dt: number): void {
  const globalSpeed = state.lockdownTimer > 0 ? CONFIG.lockdownSpeedFactor : 1;
  const gathering = state.gatherTimer > 0;
  const cx = state.world.w / 2;
  const cy = state.world.h / 2;
  for (const a of state.agents) {
    a.dir += rand(-CONFIG.turnRate, CONFIG.turnRate) * dt;
    // 大型イベント中は中央へ引き寄せる。隔離された人は動けない
    if (gathering && a.zone < 0) {
      const want = Math.atan2(cy - a.y, cx - a.x);
      let diff = want - a.dir;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      a.dir += diff * WAVE_EFFECT.gatheringPull * dt;
    }
    const mul = globalSpeed * (a.zone >= 0 ? CONFIG.zoneSpeedFactor : 1);
    const v = a.speed * mul;
    a.x += Math.cos(a.dir) * v * dt;
    a.y += Math.sin(a.dir) * v * dt;
    bounceWorld(a, state.world);
    updateZoneMembership(a, state);
    if (a.flash > 0) a.flash = Math.max(0, a.flash - dt * 1.6);
    if (a.immunity > 0) a.immunity = Math.max(0, a.immunity - dt);
    a.contacts = 0;
    a.load = 0;
  }
}

/**
 * 開始前の待機画面用。人だけを動かし、感染も時間も進めない。
 * 止まった画面より、動いている画面のほうが何のゲームか伝わる。
 */
export function drift(state: SimState, dt: number): void {
  moveAgents(state, dt);
}

/** 固定タイムステップで 1 ステップ進める（dt は 1/60 前後を想定） */
export function step(state: SimState, dt: number): void {
  state.time += dt;
  state.timeLeft = Math.max(0, CONFIG.duration - state.time);

  applyWaves(state);
  updateSocial(state, dt);
  if (state.gatherTimer > 0) state.gatherTimer = Math.max(0, state.gatherTimer - dt);

  // 社会活動度が低いとポイントの回復が鈍る。
  // 「全部隔離して閉じておけば勝てる」を成立させないための要。
  const socialRatio = state.social / CONFIG.socialMax;
  const regenMul = CONFIG.socialRegenFloor + (1 - CONFIG.socialRegenFloor) * socialRatio;
  state.points = Math.min(CONFIG.maxPoints, state.points + CONFIG.pointRegen * regenMul * dt);

  // 外部からの流入
  state.inflowTimer -= dt;
  if (state.inflowTimer <= 0) spawnInflow(state);
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

  moveAgents(state, dt);

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
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > cr2) continue;
      b.contacts += 1;
      // どちらかが隔離区画の中なら、接触が制限されて感染圧が下がる
      const damped = a.zone >= 0 || b.zone >= 0;
      b.load += damped ? CONFIG.zoneContactFactor : 1;
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
      const lockdown = state.lockdownTimer > 0 ? CONFIG.lockdownTransmissionFactor : 1;
      a.exposure += CONFIG.exposureGain * state.transmissionMul * lockdown * stack * resist * dt;
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

  // --- 回復と、耐性切れ（SIRS）---
  for (const a of agents) {
    if (a.state === 'infected') {
      a.infectionTimer -= dt;
      if (a.infectionTimer <= 0) {
        a.state = 'recovered';
        a.flash = 1;
        a.contacts = 0;
        // 回復直後は耐性があるが、永久ではない。
        // 個体ごとにばらすことで、全員の耐性が同時に切れて
        // 波が同期し、静かな時間だけが続くのを防ぐ。
        a.immunity = CONFIG.resistanceDuration * state.resistanceMul * rand(0.6, 1.4);
      }
    } else if (a.state === 'recovered' && a.immunity <= 0) {
      // 耐性が切れたら未感染に戻る。これで盤面が回復者で埋まって終わらない
      a.state = 'susceptible';
      a.exposure = 0;
      a.flash = 0.6;
    }
  }

  recount(state);

  // --- スコアの素を積む ---
  // 終わった瞬間の状態ではなく、抑え続けられたかを見る
  const pop = Math.max(1, agents.length);
  state.healthySeconds += (1 - state.infected / pop) * dt;
  state.socialSeconds += (state.social / CONFIG.socialMax) * dt;

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

/** 隔離エリアをこれ以上置けるか */
export function canPlaceIsolation(state: SimState): boolean {
  return state.zones.length < CONFIG.maxZones;
}

/** 指定位置に隔離エリアを設置。成功したら true */
export function placeIsolation(state: SimState, x: number, y: number): boolean {
  // 同時に置ける数を絞ることで、どこを閉じるかの判断を生む
  if (!canPlaceIsolation(state)) return false;
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

/**
 * スコアの内訳。
 * 感染を抑えた時間と社会活動を維持した時間の両方を評価する。
 * 片方に振り切っても伸びないため、どこで妥協するかの判断が要る。
 */
export function breakdownOf(state: SimState): GameResult['breakdown'] {
  return {
    protection: Math.round(state.healthySeconds * CONFIG.scoreProtection),
    social: Math.round(state.socialSeconds * CONFIG.scoreSocial),
    peakPenalty: -Math.round(state.peakInfected * CONFIG.scorePeakPenalty),
    points: Math.round(Math.floor(state.points) * 1),
  };
}

/** プレイ中の実況表示にも使うスコア */
export function scoreOf(state: SimState): number {
  const b = breakdownOf(state);
  return Math.max(0, b.protection + b.social + b.peakPenalty + b.points);
}

export function buildResult(state: SimState): GameResult {
  const elapsed = Math.max(1, state.time);
  const protectionRatio = state.healthySeconds / elapsed;
  const avgSocial = state.socialSeconds / elapsed;
  const breakdown = breakdownOf(state);
  const score = scoreOf(state);

  // 抑えた度合いと社会活動の両立で評価する
  const balance = protectionRatio * 0.65 + avgSocial * 0.35;
  let rank: GameResult['rank'] = 'D';
  let verdict = '機能不全';
  let comment = '街は感染に飲まれました。感染者が固まった瞬間に隔離を打つと効きます。';
  if (balance >= 0.85) {
    rank = 'S';
    verdict = '完璧な統制';
    comment = '感染を抑えつつ街を動かし続けました。文句のつけようがありません。';
  } else if (balance >= 0.75) {
    rank = 'A';
    verdict = '良好';
    comment = 'よく持ちこたえました。あと少し社会活動を落とさずに済むはずです。';
  } else if (balance >= 0.62) {
    rank = 'B';
    verdict = '及第点';
    comment = '抑えられてはいます。隔離を畳むタイミングを見直すと伸びます。';
  } else if (balance >= 0.45) {
    rank = 'C';
    verdict = '苦戦';
    comment = '手が足りていません。流入してくる端の感染者を早めに潰しましょう。';
  }

  if (avgSocial < 0.45) {
    comment = `${comment} 閉じすぎです。社会活動度が下がるとポイントの回復も鈍ります。`;
  }

  return {
    population: state.agents.length,
    protectionRatio,
    avgSocial,
    peakInfected: state.peakInfected,
    finalInfected: state.infected,
    totalInfected: state.totalInfected,
    inflowTotal: state.inflowTotal,
    actions: { ...state.actions },
    pointsLeft: Math.floor(state.points),
    pointsSpent: state.pointsSpent,
    breakdown,
    score,
    rank,
    verdict,
    comment,
  };
}
