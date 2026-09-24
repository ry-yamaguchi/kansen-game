import { buildCity, homeSpots, pushOutOfHouses, randomPointInBlock, routeTo } from './city';
import type { Blocker } from './city';
import { CONFIG } from './config';
import { WAVE_EFFECT, modeOf } from './modes';
import { createRng } from './rng';
import type { Rng } from './rng';
import type {
  CityBlock,
  Agent,
  City,
  GameResult,
  ModeId,
  Notice,
  Period,
  Purpose,
  SimState,
  TraitId,
  Tuning,
  World,
} from './types';

const TAU = Math.PI * 2;

/** 家の候補点は住宅1つあたりこの数だけ用意する。30人（既定）はもちろん、流入で増えても賄える */
const HOME_DOORS_PER_HOUSE = 4;
/** 目的地の区画に入るときの縁からの余白（壁に張り付かないようにする） */
const BLOCK_MARGIN = CONFIG.agentRadius * 1.5;
/** 家で待つときに歩き回る範囲の半径。通りの幅を超えて隣の区画にはみ出さない大きさに抑える */
const HOME_WANDER_HALF = 28;
/** 「小さく歩き回る」ときの速さの倍率。移動中より控えめにする */
const WANDER_SPEED_MUL = 0.4;

function rand(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

function makeAgent(
  id: number,
  tuning: Tuning,
  rng: Rng,
  city: City,
  homePool: { x: number; y: number }[],
): Agent {
  const home = homePool[rng.int(homePool.length)];
  return {
    id,
    x: home.x,
    y: home.y,
    dir: rng.next() * TAU,
    speed: rand(rng, tuning.speedMin, tuning.speedMax),
    state: 'susceptible',
    everInfected: false,
    infectionTimer: 0,
    exposure: 0,
    immunity: 0,
    zone: -1,
    contacts: 0,
    load: 0,
    flash: 0,

    homeX: home.x,
    homeY: home.y,
    commuteRole: rng.next() < 0.5 ? 'school' : 'work',
    noonToStation: rng.next() < CONFIG.noonStationRatio,
    departureOffset: rand(rng, 0, CONFIG.departureJitterMax),
    lane: rand(rng, -city.streetWidth * 0.32, city.streetWidth * 0.32),
    purpose: 'home',
    pendingPurpose: null,
    departAt: 0,
    arrived: true,
    path: [],
    pathIndex: 0,
    targetX: home.x,
    targetY: home.y,
    stay: homeStay(city, home.x, home.y),
    blockedFor: 0,
    redirected: false,

    sickStaysHome: rng.next() < CONFIG.sickStayHomeRate,
    avoidThreshold: rand(rng, 0.15, 0.6),
    compliesLockdown: true,

    trait: null,
  };
}

/** 特性を配る順序。CONFIG.traitCounts の各人数ぶんだけ、この順に選ぶ（表の並びと合わせる） */
const TRAIT_ORDER: readonly TraitId[] = ['social', 'popular', 'medic'];

/**
 * 最初の人数のうちから、特性を持つ人をちょうど CONFIG.traitCounts ぶんだけ選ぶ。決定論を保つため rng だけを使う。
 * 必要な合計人数に満たない盤面（小さなテストなど）では、誰にも付けない。
 * 中途半端に一部だけ配ると、少人数の盤面の前提（特性なし）を崩してしまうため。
 */
function assignTraits(agents: Agent[], rng: Rng): void {
  const total = TRAIT_ORDER.reduce((sum, id) => sum + CONFIG.traitCounts[id], 0);
  if (agents.length < total) return;
  const pool = agents.map((_, i) => i);
  for (const id of TRAIT_ORDER) {
    for (let k = 0; k < CONFIG.traitCounts[id]; k += 1) {
      const pick = rng.int(pool.length);
      const idx = pool[pick];
      pool.splice(pick, 1);
      agents[idx].trait = id;
    }
  }
}

/** 家の前で留まる範囲（通りの中の小さな四角） */
function homeStay(city: City, x: number, y: number): { x: number; y: number; w: number; h: number } {
  const half = Math.min(HOME_WANDER_HALF, city.streetWidth * 0.42);
  return { x: x - half, y: y - half, w: half * 2, h: half * 2 };
}

/** 場所の区画の中で留まる範囲（縁から少し内側） */
function blockStay(block: CityBlock): { x: number; y: number; w: number; h: number } {
  const pad = CONFIG.agentRadius * 1.4;
  return {
    x: block.x + pad,
    y: block.y + pad,
    w: Math.max(1, block.w - pad * 2),
    h: Math.max(1, block.h - pad * 2),
  };
}

/** 時刻から今の時間帯を決める。純粋関数（CONFIG の境目だけを見る） */
function periodOf(time: number): Period {
  if (time < CONFIG.periodMorningEnd) return 'morning';
  if (time < CONFIG.periodNoonEnd) return 'noon';
  return 'evening';
}

/** 今この人が向かうべき目的。大型イベント中は隔離区画の外にいる人だけ広場へ割り込む */
function purposeForPeriod(state: SimState, a: Agent): Purpose {
  if (state.gatherTimer > 0 && a.zone < 0) return 'gather';
  // 体調が悪くても出勤・登校する人が大半だが、家で休む人もいる（大型イベント中を除く。B3）
  if (a.state === 'infected' && a.sickStaysHome) return 'home';
  if (state.period === 'morning') return 'commute';
  if (state.period === 'noon') {
    // 街の感染が目に見えて増えると、しきい値を超えた人は広場・駅を避けて通う先に留まる（B4）
    const infectedRatio = state.agents.length > 0 ? state.infected / state.agents.length : 0;
    if (infectedRatio > a.avoidThreshold) return 'commute';
    return 'noon';
  }
  return 'home';
}

/** purpose に応じた目的地を決める。区画の中はそのつど別の点を選ぶ（着くたびに立ち位置が変わる） */
function targetFor(state: SimState, a: Agent, purpose: Purpose): { x: number; y: number } {
  const city = state.city;
  switch (purpose) {
    case 'home':
      return { x: a.homeX, y: a.homeY };
    case 'commute':
      return randomPointInBlock(state.rng, a.commuteRole === 'school' ? city.school : city.work, BLOCK_MARGIN);
    case 'noon':
      return randomPointInBlock(state.rng, a.noonToStation ? city.station : city.plaza, BLOCK_MARGIN);
    case 'gather':
      return randomPointInBlock(state.rng, city.plaza, BLOCK_MARGIN);
    default:
      return { x: a.homeX, y: a.homeY };
  }
}

/**
 * purpose を切り替え、新しい経路を計算する。経路は目的が変わったこのタイミングだけで作り、
 * 毎フレームは作り直さない。
 */
/** 封鎖の円（経路探索に渡す形） */
function blockersOf(state: SimState): Blocker[] {
  return state.zones.map((z) => ({ x: z.x, y: z.y, r: z.r }));
}

/** 場所の区画の中心が封鎖の中なら、その場所は閉まっているとみなす */
function isClosed(state: SimState, block: CityBlock): boolean {
  const cx = block.x + block.w / 2;
  const cy = block.y + block.h / 2;
  return state.zones.some((z) => Math.hypot(cx - z.x, cy - z.y) <= z.r);
}

/** purpose に応じた本来の行き先の区画。家へ帰るときは null */
function blockFor(state: SimState, a: Agent, purpose: Purpose): CityBlock | null {
  const city = state.city;
  switch (purpose) {
    case 'commute':
      return a.commuteRole === 'school' ? city.school : city.work;
    case 'noon':
      return a.noonToStation ? city.station : city.plaza;
    case 'gather':
      return city.plaza;
    default:
      return null;
  }
}

interface TripCandidate {
  x: number;
  y: number;
  stay: { x: number; y: number; w: number; h: number };
}

/**
 * 行き先の候補を、行きたい順に並べる。
 * 本来の行き先 → 家 → 開いている場所を近い順。封鎖で行けないときに順に試す。
 * 封鎖の手前で待たせないための歯止めである（docs/design-city.md「前歴と歯止め」）
 */
function tripCandidates(state: SimState, a: Agent, purpose: Purpose): TripCandidate[] {
  const out: TripCandidate[] = [];
  const primary = blockFor(state, a, purpose);
  if (primary) {
    if (!isClosed(state, primary)) {
      const p = targetFor(state, a, purpose);
      out.push({ x: p.x, y: p.y, stay: blockStay(primary) });
    }
  }
  out.push({ x: a.homeX, y: a.homeY, stay: homeStay(state.city, a.homeX, a.homeY) });
  const city = state.city;
  const others = [city.plaza, city.station, city.school, city.work]
    .filter((b) => b !== primary && !isClosed(state, b))
    .sort(
      (b1, b2) =>
        Math.hypot(b1.x + b1.w / 2 - a.x, b1.y + b1.h / 2 - a.y) -
        Math.hypot(b2.x + b2.w / 2 - a.x, b2.y + b2.h / 2 - a.y),
    );
  for (const b of others) {
    const p = randomPointInBlock(state.rng, b, BLOCK_MARGIN);
    out.push({ x: p.x, y: p.y, stay: blockStay(b) });
  }
  return out;
}

function beginTrip(state: SimState, a: Agent, purpose: Purpose): void {
  a.purpose = purpose;
  a.pendingPurpose = null;
  a.blockedFor = 0;
  const blockers = blockersOf(state);
  const candidates = tripCandidates(state, a, purpose);
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    const path = routeTo(state.city, { x: a.x, y: a.y }, { x: c.x, y: c.y }, a.lane, blockers);
    if (!path) continue;
    a.path = path;
    a.pathIndex = 0;
    a.targetX = c.x;
    a.targetY = c.y;
    a.stay = c.stay;
    a.arrived = path.length === 0;
    // 本来の行き先（家へ帰るなら家）以外へ向かうなら、封鎖が消えたときに予定へ戻す
    const primaryIsHome = blockFor(state, a, purpose) === null;
    a.redirected = !(i === 0 && (primaryIsHome || !isClosed(state, blockFor(state, a, purpose)!)));
    if (purpose === 'home' && i === 0) a.redirected = false;
    return;
  }
  // どこへも行けない（封鎖に囲まれた）。封鎖の縁で待たず、いまいる所で小さく歩き回る
  a.path = [];
  a.pathIndex = 0;
  a.targetX = a.x;
  a.targetY = a.y;
  a.stay = homeStay(state.city, a.x, a.y);
  a.arrived = true;
  a.redirected = true;
}

/**
 * 目的の切り替えを検知し、出発時刻（個人差つき）に達していれば経路を作り直す。
 * まだなら今の目的（滞在・移動）を続けさせるだけで、ここでは何もしない。
 */
function updateAgentPurpose(state: SimState, a: Agent): void {
  const desired = purposeForPeriod(state, a);
  if (a.purpose === desired) {
    a.pendingPurpose = null;
    return;
  }
  if (a.pendingPurpose !== desired) {
    a.pendingPurpose = desired;
    a.departAt = state.time + a.departureOffset;
    return;
  }
  if (state.time < a.departAt) return;
  beginTrip(state, a, desired);
}

function infect(agent: Agent, state: SimState): void {
  agent.state = 'infected';
  agent.everInfected = true;
  agent.exposure = 0;
  agent.immunity = 0;
  agent.flash = 1;
  agent.infectionTimer = rand(state.rng, state.tuning.spreadMin, state.tuning.spreadMax);
  state.totalInfected += 1;
}

/** 時間の進みに応じて 0..1 を返す。流入の強さを時間で変えるのに使う */
function progress(state: SimState): number {
  return Math.min(1, state.time / CONFIG.duration);
}

/** 通知を出す（既存の通知は上書きされる）。ウェーブと時間帯の通知で共有する */
function pushNotice(state: SimState, title: string, detail: string, tone: Notice['tone']): void {
  state.nextNoticeId += 1;
  state.notice = { id: state.nextNoticeId, title, detail, tone };
}

/**
 * 駅の中から感染者を送り込む。
 * これが無いと、一度抑え込んだ時点でプレイヤーのやることが消えてしまう。
 * 駅の中から出てくるようにすることで、駅を押さえる価値が生まれる。
 * 出てきた人にも家と通う先を割り当て、出発時刻を待たずに今の時間帯の行き先へ向かわせる
 * （もとから街にいた人と同じ「個人差」を待たせる理由が無いため）。
 */
function spawnInflow(state: SimState): void {
  const p = progress(state);
  const count = Math.round(
    CONFIG.inflowCountStart + (CONFIG.inflowCountEnd - CONFIG.inflowCountStart) * p,
  );
  const homePool = homeSpots(state.city, HOME_DOORS_PER_HOUSE);
  for (let i = 0; i < count; i += 1) {
    if (state.agents.length >= CONFIG.maxPopulation) break;
    const agent = makeAgent(state.agents.length, state.tuning, state.rng, state.city, homePool);
    const spawn = randomPointInBlock(state.rng, state.city.station, BLOCK_MARGIN);
    agent.x = spawn.x;
    agent.y = spawn.y;
    agent.dir = state.rng.next() * TAU;
    const inside = state.zones.find((z) => Math.hypot(agent.x - z.x, agent.y - z.y) <= z.r);
    if (inside) {
      agent.zone = inside.id;
      agent.arrived = true;
    } else {
      beginTrip(state, agent, purposeForPeriod(state, agent));
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
  const waves = modeOf(state.mode).waves;
  while (state.nextWave < waves.length && state.time >= waves[state.nextWave].at) {
    const wave = waves[state.nextWave];
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
    pushNotice(state, wave.title, wave.detail, wave.tone);
  }
}

/** 時間帯が変わったことを知らせる通知の文面 */
function periodNoticeOf(period: Period): { title: string; detail: string } {
  if (period === 'noon') return { title: '昼になりました', detail: '人が広場へ向かいます' };
  if (period === 'evening') return { title: '夕方になりました', detail: '人が家へ向かいます' };
  // 'morning' への遷移は時刻0の初期値から始まるため、実際の対戦中には起きない
  return { title: '朝になりました', detail: '人が学校・職場へ向かいます' };
}

/** 社会活動度。閉じ込めるほど下がり、放っておくと戻る */
function updateSocial(state: SimState, dt: number): void {
  let delta = CONFIG.socialRecovery;
  delta -= state.zones.length * CONFIG.socialCostPerZone;
  if (state.lockdownTimer > 0) delta -= CONFIG.socialCostLockdown;
  state.social = Math.max(0, Math.min(CONFIG.socialMax, state.social + delta * dt));
}

export function createSim(
  world: World,
  population: number,
  mode: ModeId = 'epidemic',
  seed: number,
): SimState {
  const rng = createRng(seed);
  const tuning = { ...modeOf(mode).tuning };
  const city = buildCity(world);
  const homePool = homeSpots(city, HOME_DOORS_PER_HOUSE);
  const agents: Agent[] = [];
  for (let i = 0; i < population; i += 1) agents.push(makeAgent(i, tuning, rng, city, homePool));

  const state: SimState = {
    mode,
    tuning,
    world,
    city,
    period: 'morning',
    agents,
    rng,
    zones: [],
    pulses: [],
    links: [],
    time: 0,
    timeLeft: CONFIG.duration,
    points: CONFIG.startPoints,
    lockdownTimer: 0,
    lockdownCooldown: 0,
    lockdownCount: 0,
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
    outcome: 'playing',
  };

  // 初期感染者は互いに離れた場所から始めて、複数のクラスタができるようにする
  const startIndexes = new Set<number>();
  while (startIndexes.size < Math.min(CONFIG.initialInfected, population)) {
    startIndexes.add(rng.int(population));
  }
  for (const i of startIndexes) infect(agents[i], state);
  state.totalInfected = startIndexes.size;

  // 特性は流入で増えた人には付けないため、最初の人数だけを対象に、初期感染者を選び終えたあとに配る
  assignTraits(agents, rng);

  recount(state);
  return state;
}

/** 矩形の中に留まるよう反射させる（旧版で世界の外周に使っていたのと同じ考え方） */
function bounceRect(a: Agent, b: { x: number; y: number; w: number; h: number }): void {
  if (a.x < b.x) {
    a.x = b.x;
    a.dir = Math.PI - a.dir;
  } else if (a.x > b.x + b.w) {
    a.x = b.x + b.w;
    a.dir = Math.PI - a.dir;
  }
  if (a.y < b.y) {
    a.y = b.y;
    a.dir = -a.dir;
  } else if (a.y > b.y + b.h) {
    a.y = b.y + b.h;
    a.dir = -a.dir;
  }
}

/**
 * 滞在中に小さく歩き回る範囲。
 * home は家の前の通りの中に収まる大きさ、それ以外は目的の区画（学校・職場・広場・駅）の内側にする。
 */
function wanderBounds(_state: SimState, a: Agent): { x: number; y: number; w: number; h: number } {
  // 目的（purpose）ではなく、実際に向かった先で決める。封鎖で行き先を変えた人が、
  // 本来の区画へ瞬間移動しないようにするため
  return a.stay;
}

/** 経路をたどって進む。着いたら path を空にする */
function followPath(a: Agent, speed: number, dt: number): void {
  let remaining = speed * dt;
  while (remaining > 0 && a.pathIndex < a.path.length) {
    const wp = a.path[a.pathIndex];
    const dx = wp.x - a.x;
    const dy = wp.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6 || dist <= remaining) {
      a.x = wp.x;
      a.y = wp.y;
      remaining -= dist;
      a.pathIndex += 1;
    } else {
      a.dir = Math.atan2(dy, dx);
      a.x += (dx / dist) * remaining;
      a.y += (dy / dist) * remaining;
      remaining = 0;
    }
  }
  if (a.pathIndex >= a.path.length) {
    a.arrived = true;
    a.path = [];
    a.pathIndex = 0;
  }
}

/** 2人が同じ場所（同じ区画の留まる範囲）にいるか。留まる範囲は区画ごとに同じ値になる */
function sameStay(a: Agent, b: Agent): boolean {
  return a.stay.x === b.stay.x && a.stay.y === b.stay.y && a.stay.w === b.stay.w && a.stay.h === b.stay.h;
}

/** -PI..PI に収めた、from から to への向きの差（近い側を回る） */
function angleDiff(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * popular: 同じ場所に留まっている人の向きを、近くにいる人気者へ少しずつ寄せる（人が集まってくる。研究メモC3）。
 * 乱数は使わない（向きの差に比例した一定の割合で曲げるだけ）ため、決定論は崩れない。
 */
function pullTowardPopular(a: Agent, popularAgents: readonly Agent[], dt: number): void {
  for (const p of popularAgents) {
    if (p === a || !sameStay(a, p)) continue;
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    if (Math.hypot(dx, dy) < CONFIG.traitPopularMinDist) continue; // 近づきすぎたら曲げない
    a.dir += angleDiff(a.dir, Math.atan2(dy, dx)) * CONFIG.traitPopularPull * dt;
    return;
  }
}

/** 目的地（または家の前）に着いた人を、その場で小さく歩き回らせる */
function wanderInPlace(
  state: SimState,
  a: Agent,
  speed: number,
  dt: number,
  active: boolean,
  popularAgents: readonly Agent[],
): void {
  if (a.zone >= 0) {
    const z = state.zones.find((q) => q.id === a.zone);
    if (z) {
      a.dir += rand(state.rng, -2, 2) * dt;
      const v = speed * WANDER_SPEED_MUL;
      a.x += Math.cos(a.dir) * v * dt;
      a.y += Math.sin(a.dir) * v * dt;
      bounceRect(a, { x: z.x - z.r, y: z.y - z.r, w: z.r * 2, h: z.r * 2 });
      return;
    }
  }
  const t = state.tuning;
  const turn = t.turnRate * (active ? t.activeTurnMul : 1);
  a.dir += rand(state.rng, -turn, turn) * dt;
  pullTowardPopular(a, popularAgents, dt);
  const v = speed * WANDER_SPEED_MUL;
  a.x += Math.cos(a.dir) * v * dt;
  a.y += Math.sin(a.dir) * v * dt;
  bounceRect(a, wanderBounds(state, a));
}

/**
 * 封鎖（隔離エリア）の出入りを破っているか。
 * 閉じ込められた人は自分の円の外へ、それ以外の人はどの円の中へも入れない。
 *
 * 2026-09-17 には、中の人を閉じ込め外の人を押し出す「壁」にして逆効果になった
 * （塞いだぶん外が混み合い、隔離するほど外の感染が増えた）。いまは押し出さない。
 * 外の人は経路探索で封鎖を避けて迂回し、行けなければ行き先を変える（tripCandidates）。
 */
function violatesBlockade(state: SimState, a: Agent): boolean {
  if (a.zone >= 0) {
    const own = state.zones.find((z) => z.id === a.zone);
    return own ? Math.hypot(a.x - own.x, a.y - own.y) > own.r : false;
  }
  return state.zones.some((z) => Math.hypot(a.x - z.x, a.y - z.y) < z.r);
}

/** 行く手を阻まれ続けたら行き先を選び直すまでの秒数 */
const BLOCKED_REROUTE_AFTER = 1;

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

/**
 * 移動と、フレームごとに寿命が減る値の更新。
 *
 * 人は目的地を行き来する。ロックダウン中・隔離区画の中は、いまと同じ速度倍率で遅くなる
 * （止まったぶん予定が遅れるだけで、行き先そのものは変えない）。
 */
function moveAgents(state: SimState, dt: number): void {
  const t = state.tuning;
  // popular: 広場・職場・学校・駅に留まっている人だけが引き寄せの的になる（家では起きない）。
  // 1フレームに1回だけ集計し、歩いている最中の全員から毎回探させない
  const popularAgents = state.agents.filter(
    (p) => p.trait === 'popular' && p.arrived && p.zone < 0 && p.purpose !== 'home',
  );
  for (const a of state.agents) {
    // 閉じ込められている間は予定を進めない（封鎖が消えたら予定に戻す）
    if (a.zone < 0) updateAgentPurpose(state, a);
    const prevX = a.x;
    const prevY = a.y;

    // 広げている本人は動きが速い（怒りモードなど）。移動中・滞在中のどちらにも掛かる
    const active = a.state === 'infected';
    // ロックダウンの減速は従う人にだけ掛かる。従わない人は普段どおり動く（自粛疲れ。B5）
    const lockdownSlow = state.lockdownTimer > 0 && a.compliesLockdown ? CONFIG.lockdownSpeedFactor : 1;
    const mul = lockdownSlow * (a.zone >= 0 ? CONFIG.zoneSpeedFactor : 1) * (active ? t.activeSpeedMul : 1);
    const v = a.speed * mul;

    if (a.zone < 0 && !a.arrived && a.path.length > 0) {
      followPath(a, v, dt);
    } else {
      wanderInPlace(state, a, v, dt, active, popularAgents);
    }

    // 経路のずらしや境界の丸めで、まれに建物の中に入り込むことがある。念のため押し戻す
    const pushed = pushOutOfHouses(state.city, a, CONFIG.agentRadius);
    a.x = pushed.x;
    a.y = pushed.y;

    // 封鎖の出入りを破る一歩は取り消す。行く手を阻まれ続けたら行き先を選び直す
    if (violatesBlockade(state, a)) {
      a.x = prevX;
      a.y = prevY;
      a.dir += Math.PI;
      if (a.zone < 0) {
        a.blockedFor += dt;
        if (a.blockedFor >= BLOCKED_REROUTE_AFTER) beginTrip(state, a, a.purpose);
      }
    } else {
      a.blockedFor = 0;
    }
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

  // 時間帯の切り替わりを知らせる。ウェーブの通知と同じ枠（state.notice）を使うため、
  // 同じフレームで両方起きても上書きされるだけで壊れない
  const nextPeriod = periodOf(state.time);
  if (nextPeriod !== state.period) {
    state.period = nextPeriod;
    const n = periodNoticeOf(nextPeriod);
    pushNotice(state, n.title, n.detail, 'good');
  }

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
      state.pulses.push({ x: z.x, y: z.y, r: z.r, age: 0, ttl: 0.6, kind: 'zone-expire' });
      state.zones.splice(i, 1);
      for (const a of state.agents) {
        if (a.zone === z.id) {
          a.zone = -1;
          beginTrip(state, a, purposeForPeriod(state, a));
        } else if (a.zone < 0 && a.redirected) {
          beginTrip(state, a, a.purpose);
        }
      }
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
  const cr = state.tuning.contactRadius;
  const cr2 = cr * cr;
  // social: 接触と判定する距離が広い（研究メモB1）。半径だけ別に用意し、平方は先に計算しておく
  const socialR = cr * CONFIG.traitSocialRadiusMul;
  const socialR2 = socialR * socialR;
  const stayW = state.tuning.stayContact;
  const moveW = state.tuning.moveContact;
  const agents = state.agents;
  const n = agents.length;
  for (let i = 0; i < n; i += 1) {
    const a = agents[i];
    if (a.state !== 'infected') continue;
    // social: よく人と会う人は届く範囲が広く、1接触あたりの感染圧も重い（B1: 感染の2割が8割を広げる）
    const social = a.trait === 'social';
    const reach2 = social ? socialR2 : cr2;
    for (let j = 0; j < n; j += 1) {
      const b = agents[j];
      if (b.state !== 'susceptible') continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > reach2) continue;
      // 封鎖の境界をまたいだ接触は起きない。中の人どうし・外の人どうしは普通に接触する
      if (a.zone !== b.zone) continue;
      b.contacts += 1;
      // 留まっている者どうしは重く、どちらかが移動中なら軽い。モードで変わる（B2/D1）
      const w = a.arrived && b.arrived ? stayW : moveW;
      b.load += social ? w * CONFIG.traitSocialLoadMul : w;
      if (state.links.length < 240) state.links.push(i, j);
    }
  }

  // --- 感染の進行 ---
  let newInfections = 0;
  for (const a of agents) {
    if (a.state !== 'susceptible') continue;
    if (a.load > 0) {
      const stack = Math.min(a.load, CONFIG.maxContactStack);
      // 免疫の強さ（感染圧に掛ける倍率）はモードで変えられる。噂話は訂正情報の予防がよく効く（C2）
      const resist = a.immunity > 0 ? CONFIG.immunityFactor * state.tuning.immunityMul : 1;
      // ロックダウンによる感染圧の低下も、従う人にだけ掛かる（自粛疲れ。B5）
      const lockdown = state.lockdownTimer > 0 && a.compliesLockdown ? CONFIG.lockdownTransmissionFactor : 1;
      a.exposure +=
        state.tuning.exposureGain *
        CONFIG.exposureScale *
        state.transmissionMul *
        lockdown *
        stack *
        resist *
        dt;
      if (a.exposure >= CONFIG.exposureThreshold) {
        if (state.rng.next() < CONFIG.infectionChance) {
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
  // medic: 半径内の感染者は回復が早まる。本人の状態は問わない（medic自身が感染していても対象に含む）
  const medics = agents.filter((m) => m.trait === 'medic');
  const medicR2 = CONFIG.traitMedicRadius * CONFIG.traitMedicRadius;
  const nearMedic = (a: Agent): boolean =>
    medics.some((m) => {
      const dx = m.x - a.x;
      const dy = m.y - a.y;
      return dx * dx + dy * dy <= medicR2;
    });
  for (const a of agents) {
    if (a.state === 'infected') {
      const recoverMul = medics.length > 0 && nearMedic(a) ? CONFIG.traitMedicRecoverMul : 1;
      a.infectionTimer -= dt * recoverMul;
      if (a.infectionTimer <= 0) {
        a.state = 'recovered';
        a.flash = 1;
        a.contacts = 0;
        // 回復直後は耐性があるが、永久ではない。
        // 個体ごとにばらすことで、全員の耐性が同時に切れて
        // 波が同期し、静かな時間だけが続くのを防ぐ。
        a.immunity = state.tuning.resistanceDuration * state.resistanceMul * rand(state.rng, 0.6, 1.4);
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

  // --- 決着 ---
  // 広がりが0でも終わらせない。手に負えなくなったか、時間切れかの2つだけ。
  const collapse = modeOf(state.mode).collapseRatio;
  if (collapse !== undefined && state.infected / pop >= collapse) {
    state.outcome = 'collapsed';
  } else if (state.timeLeft <= 0) {
    state.outcome = 'timeup';
  }

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
  const r = CONFIG.zoneRadius;
  const zone = { id, x, y, r, life: CONFIG.zoneLife, maxLife: CONFIG.zoneLife };
  state.zones.push(zone);
  // 円の中にいた人は閉じ込める。封鎖が消えるまで変わらない
  for (const a of state.agents) {
    if (a.zone !== -1) continue;
    if (Math.hypot(a.x - x, a.y - y) <= r) {
      a.zone = id;
      a.path = [];
      a.pathIndex = 0;
      a.arrived = true;
    }
  }
  // 外の人のうち、封鎖に行く手を塞がれうる人（移動中・行き先が円の中）だけ経路を引き直す
  for (const a of state.agents) {
    if (a.zone !== -1) continue;
    const targetInside = Math.hypot(a.targetX - x, a.targetY - y) <= r;
    if (!a.arrived || targetInside) beginTrip(state, a, a.purpose);
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
      // 治療の効きはモードで変えられる。噂話はすでに広まった噂を止めにくい（C2）
      a.infectionTimer *= CONFIG.treatFactor * state.tuning.treatMul;
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

  // 使うたびに従う人が減る（自粛疲れ）。発動のたびに一人ずつ従うかを決め直す（B5）
  state.lockdownCount += 1;
  const complianceRatio = Math.max(
    CONFIG.lockdownComplianceFloor,
    1 - CONFIG.lockdownFatigue * (state.lockdownCount - 1),
  );
  for (const a of state.agents) {
    a.compliesLockdown = state.rng.next() < complianceRatio;
  }
  if (state.lockdownCount >= 2) {
    pushNotice(
      state,
      `${state.lockdownCount}回目のロックダウン`,
      `従う人はおよそ${Math.round(complianceRatio * 100)}%です`,
      'bad',
    );
  }

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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * スコアの内訳。
 *
 * 感染の抑制と社会活動の維持を掛け算で評価する。
 * どちらかが床を割ると係数が0になり、もう片方が満点でも点にならない。
 * 「閉じ込めて終わり」も「見ているだけ」も成立させないための形である。
 */
export function breakdownOf(state: SimState): GameResult['breakdown'] {
  const elapsed = Math.max(1, state.time);
  const protectionRatio = state.healthySeconds / elapsed;
  const avgSocial = state.socialSeconds / elapsed;
  const pop = Math.max(1, state.agents.length);
  const peakRatio = state.peakInfected / pop;

  return {
    base: CONFIG.scoreBase,
    protectionFactor: clamp01(
      (protectionRatio - CONFIG.scoreProtectionFloor) / CONFIG.scoreProtectionSpan,
    ),
    socialFactor: clamp01((avgSocial - CONFIG.scoreSocialFloor) / CONFIG.scoreSocialSpan),
    peakFactor: 1 - CONFIG.scorePeakWeight * clamp01(peakRatio / CONFIG.scorePeakRef),
    pointsBonus: Math.floor(state.points),
  };
}

/**
 * スコア。プレイ中の実況表示にも使う。
 * 経過時間の割合を掛けることで、耐えているあいだ積み上がっていくように見せる。
 */
export function scoreOf(state: SimState): number {
  const b = breakdownOf(state);
  const progressed = Math.min(1, state.time / CONFIG.duration);
  const core = b.base * b.protectionFactor * b.socialFactor * b.peakFactor;
  return Math.max(0, Math.round((core + b.pointsBonus) * progressed));
}

export function buildResult(state: SimState): GameResult {
  const elapsed = Math.max(1, state.time);
  const protectionRatio = state.healthySeconds / elapsed;
  const avgSocial = state.socialSeconds / elapsed;
  const breakdown = breakdownOf(state);
  const score = scoreOf(state);

  const def = modeOf(state.mode);
  const outcome: GameResult['outcome'] = state.outcome === 'playing' ? 'timeup' : state.outcome;

  // 抑えた度合いと社会活動の両立で評価する
  const balance = protectionRatio * 0.65 + avgSocial * 0.35;
  let rank: GameResult['rank'] = 'D';
  let verdict = '機能不全';
  let comment = `街は${def.spreadNoun}に飲まれました。固まった瞬間に${def.tools.isolation.label}を打つと効きます。`;
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
    comment = `${comment} 閉じすぎです。${def.socialLabel}が下がるとポイントの回復も鈍ります。`;
  }

  // 打ち切りは無条件で最低評価にする。時間まで耐えられなかったということ
  if (outcome === 'collapsed') {
    rank = 'D';
    verdict = '崩壊';
    const pct = Math.round((def.collapseRatio ?? 0.8) * 100);
    comment = `同時${def.spreadNoun}率が ${pct}% を超え、${Math.round(state.time)} 秒で打ち切られました。手が回らなくなる前に、早い段階で頭を押さえてください。`;
  }

  return {
    mode: state.mode,
    population: state.agents.length,
    protectionRatio,
    avgSocial,
    peakInfected: state.peakInfected,
    outcome,
    survivedSeconds: Math.round(state.time),
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
