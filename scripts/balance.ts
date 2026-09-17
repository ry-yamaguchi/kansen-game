/**
 * バランス確認用の一時スクリプト（ヘッドレス実行）。
 * 「放置すると負ける」「介入すると効く」が成立しているかを数値で確認する。
 */
import { CONFIG, planWorld } from '../src/sim/config';
import { buildResult, createSim, placeIsolation, placeVaccine, step, triggerLockdown } from '../src/sim/engine';
import type { SimState } from '../src/sim/types';

const DT = 1 / 60;

type Strategy = 'none' | 'greedy' | 'isolation-only' | 'vaccine-only' | 'lockdown-only';

interface Trial {
  rate: number;
  peak: number;
  score: number;
  acts: number;
  leftover: number;
}

function runGame(strategy: Strategy): Trial {
  const { world, population } = planWorld(1280, 720);
  const sim = createSim(world, population);
  const steps = Math.ceil(CONFIG.duration / DT);
  for (let i = 0; i < steps; i += 1) {
    if (i % 30 === 0) act(sim, strategy);
    step(sim, DT);
  }
  const r = buildResult(sim);
  return {
    rate: r.infectionRate,
    peak: r.peakInfected,
    score: r.score,
    acts: r.actions.isolation + r.actions.vaccine + r.actions.lockdown,
    leftover: r.pointsLeft,
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
  if (strategy === 'vaccine-only') {
    const h = hotspot(sim, CONFIG.vaccineRadius);
    if (h.infected > 0) placeVaccine(sim, h.x, h.y);
    return;
  }
  greedyAct(sim);
}

/** 状況に応じて手を選ぶ簡易AI */
function greedyAct(sim: SimState): void {
  // 感染が広がりきっているときだけ、余裕があればロックダウンで時間を稼ぐ
  if (sim.infected / sim.agents.length > 0.2 && sim.lockdownCooldown === 0 && sim.points > 70) {
    if (triggerLockdown(sim)) return;
  }
  const best = hotspot(sim, CONFIG.zoneRadius);
  if (best.infected === 0) return;
  // 感染者が固まっているなら隔離、健康な人のほうが多いならワクチン
  if (best.infected >= 2 && best.infected >= best.healthy) {
    if (placeIsolation(sim, best.x, best.y)) return;
  }
  placeVaccine(sim, best.x, best.y);
}

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function report(label: string, trials: number, strategy: Strategy): void {
  const out: Trial[] = [];
  for (let i = 0; i < trials; i += 1) out.push(runGame(strategy));
  const rates = out.map((t) => t.rate);
  console.log(
    `${label.padEnd(12)} 感染率 avg=${(avg(rates) * 100).toFixed(1)}% ` +
      `min=${(Math.min(...rates) * 100).toFixed(0)}% max=${(Math.max(...rates) * 100).toFixed(0)}% | ` +
      `最大同時感染 avg=${avg(out.map((t) => t.peak)).toFixed(1)} | ` +
      `スコア avg=${avg(out.map((t) => t.score)).toFixed(0)} | ` +
      `手数 avg=${avg(out.map((t) => t.acts)).toFixed(1)} | ` +
      `余剰Pt avg=${avg(out.map((t) => t.leftover)).toFixed(0)}`,
  );
}

const TRIALS = 20;
report('放置', TRIALS, 'none');
report('隔離のみ', TRIALS, 'isolation-only');
report('ワクチンのみ', TRIALS, 'vaccine-only');
report('LDのみ', TRIALS, 'lockdown-only');
report('簡易AI', TRIALS, 'greedy');
