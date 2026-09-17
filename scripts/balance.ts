/**
 * バランス確認用の一時スクリプト（ヘッドレス実行）。
 * 「放置すると負ける」「介入すると効く」が成立しているかを数値で確認する。
 */
import { CONFIG, planWorld } from '../src/sim/config';
import { buildResult, createSim, placeIsolation, placeVaccine, step, triggerLockdown } from '../src/sim/engine';
import type { ModeId, SimState } from '../src/sim/types';

const DT = 1 / 60;

type Strategy =
  | 'none'
  | 'greedy'
  | 'isolation-only'
  | 'vaccine-only'
  | 'lockdown-only'
  | 'isolation-spam';

interface Trial {
  protection: number;
  social: number;
  peak: number;
  finalInfected: number;
  score: number;
  acts: number;
  leftover: number;
  population: number;
  collapsed: boolean;
  survived: number;
}

function runGame(strategy: Strategy, mode: ModeId = 'epidemic'): Trial {
  const { world, population } = planWorld(1280, 720);
  const sim = createSim(world, population, mode);
  const steps = Math.ceil(CONFIG.duration / DT);
  for (let i = 0; i < steps; i += 1) {
    if (i % 30 === 0) act(sim, strategy);
    step(sim, DT);
    // 打ち切りに達したらそこで終わる
    if (sim.outcome !== 'playing') break;
  }
  const r = buildResult(sim);
  return {
    protection: r.protectionRatio,
    social: r.avgSocial,
    peak: r.peakInfected,
    finalInfected: r.finalInfected,
    score: r.score,
    acts: r.actions.isolation + r.actions.vaccine + r.actions.lockdown,
    leftover: r.pointsLeft,
    population: r.population,
    collapsed: r.outcome === 'collapsed',
    survived: r.survivedSeconds,
  };
}

/** 感染者が最も密集している中心を探す */
function hotspot(sim: SimState, radius: number) {
  let best = { x: 0, y: 0, infected: 0, healthy: 0 };
  for (const a of sim.agents) {
    if (a.state !== 'infected') continue;
    let inf = 0;
    let heal = 0;
    for (const b of sim.agents) {
      if (Math.hypot(a.x - b.x, a.y - b.y) > radius) continue;
      if (b.state === 'infected') inf += 1;
      else if (b.state === 'susceptible') heal += 1;
    }
    if (inf > best.infected) best = { x: a.x, y: a.y, infected: inf, healthy: heal };
  }
  return best;
}

function act(sim: SimState, strategy: Strategy): void {
  if (strategy === 'none') return;
  if (sim.infected === 0) return;

  if (strategy === 'lockdown-only') {
    triggerLockdown(sim);
    return;
  }
  if (strategy === 'isolation-only') {
    const h = hotspot(sim, CONFIG.zoneRadius);
    if (h.infected > 0) placeIsolation(sim, h.x, h.y);
    return;
  }
  // かつて最強だった「隔離して待つ」。社会活動度の代償で沈むことを確かめる
  if (strategy === 'isolation-spam') {
    const h = hotspot(sim, CONFIG.zoneRadius);
    placeIsolation(sim, h.infected > 0 ? h.x : sim.world.w / 2, h.infected > 0 ? h.y : sim.world.h / 2);
    return;
  }
  if (strategy === 'vaccine-only') {
    const h = hotspot(sim, CONFIG.vaccineRadius);
    if (h.infected > 0) placeVaccine(sim, h.x, h.y);
    return;
  }
  greedyAct(sim);
}

/** 状況に応じて手を選ぶ簡易AI */
function greedyAct(sim: SimState): void {
  const ratio = sim.infected / sim.agents.length;
  // 波が来ているあいだはロックダウンで頭を押さえる。
  // ただし社会活動度が落ちているときは打たない
  if (ratio > 0.18 && sim.lockdownCooldown === 0 && sim.social > 55) {
    if (triggerLockdown(sim)) return;
  }
  const best = hotspot(sim, CONFIG.zoneRadius);
  if (best.infected === 0) return;
  // 感染者が固まっているなら隔離、健康な人のほうが多いならワクチン
  if (best.infected >= 3 && best.infected >= best.healthy) {
    if (placeIsolation(sim, best.x, best.y)) return;
  }
  placeVaccine(sim, best.x, best.y);
}

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function report(label: string, trials: number, strategy: Strategy, mode: ModeId = 'epidemic'): void {
  const out: Trial[] = [];
  for (let i = 0; i < trials; i += 1) out.push(runGame(strategy, mode));
  const prot = out.map((t) => t.protection);
  const collapsed = out.filter((t) => t.collapsed);
  console.log(
    `${label.padEnd(12)} 抑えた割合 avg=${(avg(prot) * 100).toFixed(1)}% ` +
      `社会 avg=${(avg(out.map((t) => t.social)) * 100).toFixed(0)} | ` +
      `最大同時 avg=${avg(out.map((t) => t.peak)).toFixed(1)} | ` +
      `打ち切り ${collapsed.length}/${trials}` +
      (collapsed.length ? `(${avg(collapsed.map((t) => t.survived)).toFixed(0)}秒)` : '') +
      ` | 手数 avg=${avg(out.map((t) => t.acts)).toFixed(1)} | ` +
      `スコア avg=${avg(out.map((t) => t.score)).toFixed(0)}`,
  );
}

const TRIALS = 20;
console.log('=== 感染症モード ===');
report('放置', TRIALS, 'none');
report('隔離のみ', TRIALS, 'isolation-only');
report('隔離連打', TRIALS, 'isolation-spam');
report('ワクチンのみ', TRIALS, 'vaccine-only');
report('LDのみ', TRIALS, 'lockdown-only');
report('簡易AI', TRIALS, 'greedy');

for (const mode of ['rumor', 'anger'] as ModeId[]) {
  console.log(`=== ${mode} モード ===`);
  report('放置', TRIALS, 'none', mode);
  report('簡易AI', TRIALS, 'greedy', mode);
}
