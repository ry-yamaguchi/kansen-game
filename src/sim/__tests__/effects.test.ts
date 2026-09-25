import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createSim, placeIsolation, placeVaccine, step } from '../engine';
import type { Agent, CityBlock, SimState } from '../types';

const DT = 1 / 60;
const WORLD = { w: 1000, h: 600 };

function centerOf(b: CityBlock): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** その場に固定する。speed=0にすることで、目的地の切り替え・経路探索が走っても座標は動かない */
function freeze(a: Agent, x: number, y: number): void {
  a.x = x;
  a.y = y;
  a.speed = 0;
  a.arrived = true;
  a.path = [];
  a.pathIndex = 0;
  a.stay = { x: x - 1, y: y - 1, w: 2, h: 2 };
}

describe('CHAIN（連鎖）', () => {
  it('短い間隔で続く接触感染は連鎖として数え、3以上でCHAIN文字を積む。間が空くと1から数え直す', () => {
    const sim = createSim(WORLD, 30, 'epidemic', 501);
    sim.nextWave = Number.MAX_SAFE_INTEGER;
    const c = centerOf(sim.city.plaza);

    // 盤面全員をいったん遠くへ固定し、意図しない接触を無くす
    for (const a of sim.agents) freeze(a, 5, 5 + a.id * 2);

    const source = sim.agents[0];
    source.state = 'infected';
    source.infectionTimer = 999;
    freeze(source, c.x, c.y);

    // 感染源のすぐそば（接触半径30の内側）に、しきい値の手前まで感染圧を積んだ未感染者を10人並べる。
    // infectionChance=0.9なので、1ステップでほぼ全員が接触感染し、同時刻＝連鎖として数えられる
    const targets = sim.agents.slice(1, 11);
    for (const t of targets) {
      t.state = 'susceptible';
      freeze(t, c.x + 1, c.y);
      t.exposure = CONFIG.exposureThreshold - 0.001;
    }

    step(sim, DT);

    expect(sim.chainCount).toBeGreaterThanOrEqual(CONFIG.chainPopupThreshold);
    const chainPopups = sim.popups.filter((p) => p.text.startsWith('CHAIN'));
    expect(chainPopups.length).toBeGreaterThan(0);
    // しきい値(3)に達した最初の1件がそのまま出る（近い場所への連続表示は間引かれる）
    expect(chainPopups[0].text).toBe(`CHAIN ×${CONFIG.chainPopupThreshold}`);
    expect(chainPopups[0].tone).toBe('bad');
    expect(chainPopups[0].big).toBe(false);

    // 間をchainWindowより空けてから、別の1人だけを接触感染させる。
    // 感染判定にはinfectionChance(90%)のrng成功判定が挟まるため、必要なら数回試す
    // （失敗した回はregisterChainInfectionを呼ばないので、連鎖状態には影響せず安全に再試行できる）
    const soloTarget = sim.agents[11];
    soloTarget.state = 'susceptible';
    sim.time += CONFIG.chainWindow + 0.5;
    freeze(soloTarget, c.x + 1, c.y - 1);
    for (let attempt = 0; attempt < 30 && soloTarget.state !== ('infected' as Agent['state']); attempt += 1) {
      soloTarget.exposure = CONFIG.exposureThreshold - 0.001;
      step(sim, DT);
    }

    expect(soloTarget.state).toBe('infected'); // 意図通り、この1人が接触感染した
    expect(sim.chainCount).toBe(1); // 間が空いたので1から数え直す
  });

  it('新商品モードでは「口コミ ×N」になる', () => {
    const sim = createSim(WORLD, 30, 'product', 502);
    sim.nextWave = Number.MAX_SAFE_INTEGER;
    const c = centerOf(sim.city.plaza);
    for (const a of sim.agents) freeze(a, 5, 5 + a.id * 2);

    const source = sim.agents.find((a) => a.state === 'infected')!;
    source.infectionTimer = 999;
    freeze(source, c.x, c.y);

    // 複合的な伝染は「勧められた人数」がadoptThresholdに達すると試す。1人に固定して単純化する
    const targets = sim.agents.filter((a) => a.state === 'susceptible').slice(0, 10);
    for (const t of targets) {
      t.adoptThreshold = 1;
      freeze(t, c.x + 1, c.y);
      t.recommendedBy = [];
      t.recommendProgress = [{ id: source.id, seconds: CONFIG.recommendTime - 0.001 }];
    }

    step(sim, DT);

    expect(sim.chainCount).toBeGreaterThanOrEqual(CONFIG.chainPopupThreshold);
    const chainPopups = sim.popups.filter((p) => p.text.startsWith('口コミ'));
    expect(chainPopups.length).toBeGreaterThan(0);
    expect(chainPopups[0].text).toBe(`口コミ ×${CONFIG.chainPopupThreshold}`);
  });
});

describe('OUTBREAK！／BUZZ!（爆発的な広がり）', () => {
  it('勢い(infectionRate)が閾値を超えると1回だけ積まれ、クールダウン中は積まれない', () => {
    const sim = createSim(WORLD, 30, 'epidemic', 503);
    sim.nextWave = Number.MAX_SAFE_INTEGER;
    const outbreaks = () => sim.popups.filter((p) => p.text === 'OUTBREAK!');
    const outbreakPulses = () => sim.pulses.filter((p) => p.kind === 'outbreak');

    sim.infectionRate = CONFIG.outbreakRate + 5;
    step(sim, DT);
    expect(outbreaks()).toHaveLength(1);
    expect(outbreaks()[0].big).toBe(true);
    expect(outbreaks()[0].tone).toBe('bad');
    expect(outbreakPulses()).toHaveLength(1);
    expect(sim.outbreakCooldown).toBeGreaterThan(0);

    // クールダウン中は、勢いが閾値を超えたままでも増えない
    sim.infectionRate = CONFIG.outbreakRate + 5;
    step(sim, DT);
    expect(outbreaks()).toHaveLength(1);

    // クールダウンが明ければ、また出る
    sim.outbreakCooldown = 0;
    sim.infectionRate = CONFIG.outbreakRate + 5;
    step(sim, DT);
    expect(outbreaks()).toHaveLength(2);
  });

  it('閾値未満のままなら出ない', () => {
    const sim = createSim(WORLD, 30, 'epidemic', 504);
    sim.nextWave = Number.MAX_SAFE_INTEGER;
    sim.infectionRate = CONFIG.outbreakRate - 0.01;
    step(sim, DT);
    expect(sim.popups.filter((p) => p.text === 'OUTBREAK!')).toHaveLength(0);
  });

  it('新商品モードでは「BUZZ!」になる', () => {
    const sim = createSim(WORLD, 30, 'product', 505);
    sim.nextWave = Number.MAX_SAFE_INTEGER;
    sim.infectionRate = CONFIG.outbreakRate + 5;
    step(sim, DT);
    expect(sim.popups.some((p) => p.text === 'BUZZ!')).toBe(true);
    expect(sim.popups.some((p) => p.text === 'OUTBREAK!')).toBe(false);
  });
});

describe('打った手の手応え', () => {
  it('ワクチンを使うと守った人数の文字が積まれる。対象がいなければ「守る人がいません」', () => {
    const sim = createSim(WORLD, 30, 'epidemic', 506);
    sim.points = CONFIG.maxPoints;
    const c = centerOf(sim.city.plaza);
    // 対象を1人だけに絞るため、他の全員を両方の判定点から離れた隅へ退避させる
    const corner = { x: sim.world.w - 5, y: sim.world.h - 5 };
    for (const other of sim.agents) {
      other.x = corner.x;
      other.y = corner.y;
    }
    const a = sim.agents[0];
    a.state = 'susceptible';
    a.x = c.x;
    a.y = c.y;

    expect(placeVaccine(sim, c.x, c.y)).toBe(true);
    const hit = sim.popups.at(-1)!;
    expect(hit.text).toBe('+1 人を守りました');
    expect(hit.tone).toBe('good');

    sim.points = CONFIG.maxPoints;
    // 誰もいない場所（世界の隅）に打つ
    expect(placeVaccine(sim, 4, 4)).toBe(true);
    const miss = sim.popups.at(-1)!;
    expect(miss.text).toBe('ここには守る人がいません');
    expect(miss.tone).toBe('info');
  });

  it('隔離を使うと閉じ込めた人数の文字が積まれる', () => {
    const sim = createSim(WORLD, 30, 'epidemic', 507);
    sim.points = CONFIG.maxPoints;
    const c = centerOf(sim.city.plaza);
    // 対象を1人だけに絞るため、他の全員を遠くへ退避させる
    for (const other of sim.agents) {
      other.x = 5;
      other.y = 5;
    }
    const a = sim.agents[0];
    a.state = 'susceptible';
    a.zone = -1;
    a.x = c.x;
    a.y = c.y;

    expect(placeIsolation(sim, c.x, c.y)).toBe(true);
    const popup = sim.popups.at(-1)!;
    expect(popup.text).toBe('隔離 1人');
    expect(popup.tone).toBe('good');
  });

  it('噂話・悪感情はモードの言葉になる（例: 噂話のワクチン＝訂正情報は「人に先回り」）', () => {
    const rumor = createSim(WORLD, 30, 'rumor', 508);
    rumor.points = CONFIG.maxPoints;
    const rc = centerOf(rumor.city.plaza);
    const ra = rumor.agents[0];
    ra.state = 'susceptible';
    ra.x = rc.x;
    ra.y = rc.y;
    placeVaccine(rumor, rc.x, rc.y);
    expect(rumor.popups.at(-1)!.text).toBe('+1人に先回り');

    const anger = createSim(WORLD, 30, 'anger', 509);
    anger.points = CONFIG.maxPoints;
    const ac = centerOf(anger.city.plaza);
    const aa = anger.agents[0];
    aa.state = 'susceptible';
    aa.x = ac.x;
    aa.y = ac.y;
    placeIsolation(anger, ac.x, ac.y);
    // 人数は他の人の初期位置しだいで変わりうるので、言葉づかいだけを確かめる（人数の一致はepidemicの節で確認済み）
    expect(anger.popups.at(-1)!.text).toMatch(/^冷却 \d+人$/);
  });

  it('新商品では、試供品は「試しました」、イベントは「イベント開始」になる', () => {
    const sim = createSim(WORLD, 30, 'product', 510);
    sim.points = CONFIG.maxPoints;
    const c = centerOf(sim.city.plaza);
    const a = sim.agents.find(
      (ag) => ag.state === 'susceptible' && ag.adoptThreshold <= CONFIG.sampleAdoptMaxThreshold,
    );
    expect(a).toBeDefined();
    // 対象を1人だけに絞るため、他の全員を遠くへ退避させる
    for (const other of sim.agents) {
      if (other === a) continue;
      other.x = 5;
      other.y = 5;
    }
    a!.x = c.x;
    a!.y = c.y;

    expect(placeVaccine(sim, c.x, c.y)).toBe(true);
    expect(sim.popups.at(-1)!.text).toBe('+1 人が試しました');

    sim.points = CONFIG.maxPoints;
    expect(placeIsolation(sim, c.x, c.y)).toBe(true);
    expect(sim.popups.at(-1)!.text).toBe('イベント開始');
  });
});

describe('浮かぶ文字の寿命', () => {
  it('ttlを過ぎると消える', () => {
    const sim = createSim(WORLD, 30, 'epidemic', 511);
    sim.points = CONFIG.maxPoints;
    const c = centerOf(sim.city.plaza);
    placeVaccine(sim, c.x, c.y); // 誰もいなくても「守る人がいません」が積まれる
    expect(sim.popups.length).toBeGreaterThan(0);
    const popup = sim.popups[0];
    const id = popup.id;

    popup.age = popup.ttl - 0.001; // 期限の直前まで進める
    step(sim, DT); // DT(1/60) > 0.001 なので、この1歩で期限を超える

    expect(sim.popups.some((p) => p.id === id)).toBe(false);
  });
});

describe('決定論（演出の状態を含む）', () => {
  /** 決め打ちの操作列を流しながら進める。座標・間隔とも固定なので、乱数だけが結果を左右する */
  function runToEnd(seed: number): SimState {
    const sim = createSim(WORLD, 30, 'epidemic', seed);
    const maxSteps = Math.ceil(CONFIG.duration / DT) + 60;
    for (let i = 0; i < maxSteps; i += 1) {
      if (i % 70 === 0) placeIsolation(sim, 500, 300);
      if (i % 110 === 35) placeVaccine(sim, 300, 200);
      step(sim, DT);
      if (sim.outcome !== 'playing') break;
    }
    return sim;
  }

  it('同じシード・同じ操作列なら、CHAIN／OUTBREAKの状態や浮かぶ文字も完全に一致する', () => {
    const a = runToEnd(512);
    const b = runToEnd(512);

    expect(a.chainCount).toBe(b.chainCount);
    expect(a.lastChainAt).toBe(b.lastChainAt);
    expect(a.outbreakCooldown).toBe(b.outbreakCooldown);
    expect(a.popups).toEqual(b.popups);
  });
});
