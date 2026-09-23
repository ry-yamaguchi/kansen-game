import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG, TOOLS, planWorld } from '../sim/config';
import { modeOf } from '../sim/modes';
import {
  buildResult,
  canPlaceIsolation,
  createSim,
  drift,
  placeIsolation,
  placeVaccine,
  previewCounts,
  scoreOf,
  step,
  triggerLockdown,
} from '../sim/engine';
import type { GameResult, ModeId, Notice, Period, Phase, SimState, ToolId } from '../sim/types';
import { createRenderer, type Preview, type Renderer } from '../render/draw';
import { computeView, screenToWorld } from '../render/view';

/** 固定タイムステップ。フレームレートが揺れても挙動を変えないため */
const STEP = 1 / 60;
/** HUD の更新間隔。毎フレーム React を再描画すると無駄が大きい */
const HUD_INTERVAL = 1 / 15;

export interface HudSnapshot {
  timeLeft: number;
  susceptible: number;
  infected: number;
  recovered: number;
  population: number;
  points: number;
  score: number;
  danger: number;
  lockdownTimer: number;
  lockdownCooldown: number;
  /** 0..100 */
  social: number;
  /** 設置中の隔離エリア数 */
  zones: number;
  /** 変異株による感染力の倍率。1 より大きければ変異株が出ている */
  transmissionMul: number;
  /** 変異株による耐性時間の倍率。1 より小さければ短縮されている */
  resistanceMul: number;
  /** 大型イベントで人が集まっている残り時間 */
  gatherTimer: number;
  /** 今の時間帯 */
  period: Period;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}

const EMPTY_HUD: HudSnapshot = {
  timeLeft: CONFIG.duration,
  susceptible: 0,
  infected: 0,
  recovered: 0,
  population: 0,
  points: CONFIG.startPoints,
  score: 0,
  danger: 0,
  lockdownTimer: 0,
  lockdownCooldown: 0,
  social: CONFIG.socialMax,
  zones: 0,
  transmissionMul: 1,
  resistanceMul: 1,
  gatherTimer: 0,
  period: 'morning',
};

function snapshot(sim: SimState): HudSnapshot {
  return {
    timeLeft: sim.timeLeft,
    susceptible: sim.susceptible,
    infected: sim.infected,
    recovered: sim.recovered,
    population: sim.agents.length,
    points: Math.floor(sim.points),
    score: scoreOf(sim),
    danger: sim.danger,
    lockdownTimer: sim.lockdownTimer,
    lockdownCooldown: sim.lockdownCooldown,
    social: sim.social,
    zones: sim.zones.length,
    transmissionMul: sim.transmissionMul,
    resistanceMul: sim.resistanceMul,
    gatherTimer: sim.gatherTimer,
    period: sim.period,
  };
}

export function useGame(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const simRef = useRef<SimState | null>(null);
  const phaseRef = useRef<Phase>('ready');
  const previewRef = useRef<Preview | null>(null);
  const toolRef = useRef<ToolId | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  // useRef(createRenderer()) にすると再描画ごとにオフスクリーンキャンバスを作ってしまう
  const rendererRef = useRef<Renderer | null>(null);
  if (!rendererRef.current) rendererRef.current = createRenderer();
  const pointerActiveRef = useRef(false);

  const countdownRef = useRef(0);
  const modeRef = useRef<ModeId>('epidemic');

  const [mode, setModeState] = useState<ModeId>('epidemic');
  const [phase, setPhase] = useState<Phase>('ready');
  /** 表示中のカウント。0 は START、-1 は非表示 */
  const [countdown, setCountdown] = useState(-1);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(EMPTY_HUD);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toastId = useRef(0);
  const pushToast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((prev) => [...prev.slice(-2), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 1900);
  }, []);

  const selectTool = useCallback((next: ToolId | null) => {
    toolRef.current = next;
    setTool(next);
    if (next !== 'isolation' && next !== 'vaccine') previewRef.current = null;
  }, []);

  /** 新しい局面を作る。画面サイズから世界の広さと人数を決める */
  const reset = useCallback(() => {
    const { w, h } = sizeRef.current;
    const { world, population } = planWorld(w || 1000, h || 640);
    // 乱数の発生源は UI 側に置く。シミュレーション自体は毎回渡されたシードで決定論的に動く
    const seed = Math.floor(Math.random() * 2 ** 32);
    simRef.current = createSim(world, population, modeRef.current, seed);
    previewRef.current = null;
    pointerActiveRef.current = false;
    setResult(null);
    setNotice(null);
    setHud(snapshot(simRef.current));
  }, []);

  /** 開始。すぐには動かさず、カウントダウンのあいだに初期配置を見せる */
  /** モードを選び直す。待機中の盤面もそのモードで作り直して見せる */
  const setMode = useCallback(
    (next: ModeId) => {
      modeRef.current = next;
      setModeState(next);
      if (phaseRef.current === 'ready') reset();
    },
    [reset],
  );

  const start = useCallback(() => {
    reset();
    countdownRef.current = CONFIG.countdown;
    setCountdown(CONFIG.countdown);
    phaseRef.current = 'countdown';
    setPhase('countdown');
    selectTool('isolation');
  }, [reset, selectTool]);

  /** 開始画面へ戻る。結果を見たあとにモードを選び直せるようにする */
  const backToTitle = useCallback(() => {
    phaseRef.current = 'ready';
    setPhase('ready');
    toolRef.current = null;
    setTool(null);
    reset();
  }, [reset]);

  const finish = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    phaseRef.current = 'finished';
    setPhase('finished');
    setResult(buildResult(sim));
    previewRef.current = null;
    toolRef.current = null;
    setTool(null);
  }, []);

  // --- キャンバスのサイズ追従 ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const apply = () => {
      const rect = parent.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      sizeRef.current = { w, h };
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      // 開始前ならこのサイズに合わせて世界を作り直す
      if (phaseRef.current === 'ready') reset();
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [canvasRef, reset]);

  // --- メインループ ---
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;
    let elapsed = 0;
    let lastCount = -1;
    let lastNotice = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const sim = simRef.current;
      const canvas = canvasRef.current;
      if (!sim || !canvas) return;

      let dt = (now - last) / 1000;
      last = now;
      // タブを離れて戻ったときに一気に進まないよう頭を打つ
      if (dt > 0.25) dt = 0.25;
      elapsed += dt;

      if (phaseRef.current === 'countdown') {
        drift(sim, dt);
        countdownRef.current -= dt;
        const shown = Math.max(0, Math.ceil(countdownRef.current));
        if (shown !== lastCount) {
          lastCount = shown;
          setCountdown(shown);
        }
        if (countdownRef.current <= 0) {
          phaseRef.current = 'playing';
          setPhase('playing');
          // START の表示だけ少し残してから消す
          window.setTimeout(() => setCountdown(-1), 450);
        }
      } else if (phaseRef.current !== 'playing') {
        // 待機中・結果表示中も人は動かしておく
        drift(sim, dt);
      } else {
        acc += dt;
        let guard = 0;
        while (acc >= STEP && guard < 8) {
          step(sim, STEP);
          acc -= STEP;
          guard += 1;
          // 伝播が0でも終わらせない。時間切れか、手に負えなくなったときだけ終わる
          if (sim.outcome !== 'playing') break;
        }
        // ウェーブの通知を拾う
        if (sim.notice && sim.notice.id !== lastNotice) {
          lastNotice = sim.notice.id;
          setNotice(sim.notice);
          window.setTimeout(() => {
            setNotice((cur) => (cur && cur.id === lastNotice ? null : cur));
          }, 2600);
        }
        hudAcc += dt;
        if (hudAcc >= HUD_INTERVAL) {
          hudAcc = 0;
          setHud(snapshot(sim));
        }
        if (sim.outcome !== 'playing') {
          setHud(snapshot(sim));
          finish();
        }
      }

      const ctx = canvas.getContext('2d');
      const renderer = rendererRef.current;
      if (!ctx || !renderer) return;
      const { w, h } = sizeRef.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const view = computeView(w, h, sim.world);
      renderer.draw(ctx, sim, view, w, h, previewRef.current, elapsed);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, finish]);

  // --- 入力 ---
  const toolRadius = (id: ToolId): number =>
    id === 'isolation' ? CONFIG.zoneRadius : CONFIG.vaccineRadius;

  const updatePreview = useCallback(
    (clientX: number, clientY: number) => {
      const sim = simRef.current;
      const canvas = canvasRef.current;
      const id = toolRef.current;
      if (!sim || !canvas || !id || id === 'lockdown') {
        previewRef.current = null;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const view = computeView(sizeRef.current.w, sizeRef.current.h, sim.world);
      const p = screenToWorld(view, clientX - rect.left, clientY - rect.top);
      const r = toolRadius(id);
      // 世界の外にはみ出さないよう中心を寄せる
      const x = Math.min(sim.world.w - r * 0.35, Math.max(r * 0.35, p.x));
      const y = Math.min(sim.world.h - r * 0.35, Math.max(r * 0.35, p.y));
      const counts = previewCounts(sim, x, y, r);
      const meta = TOOLS.find((t) => t.id === id);
      const words = modeOf(sim.mode);
      previewRef.current = {
        x,
        y,
        r,
        color: meta ? meta.color : '#ffffff',
        affordable: sim.points >= CONFIG.costs[id],
        infected: counts.infected,
        healthy: counts.healthy,
        infectedLabel: words.states.infected,
        healthyLabel: words.states.susceptible,
        showCounts: true,
      };
    },
    [canvasRef],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (phaseRef.current !== 'playing') return;
      const id = toolRef.current;
      if (!id || id === 'lockdown') {
        pushToast('下のボタンで対策を選んでから、画面をタップしてください');
        return;
      }
      pointerActiveRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      updatePreview(e.clientX, e.clientY);
    },
    [pushToast, updatePreview],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (phaseRef.current !== 'playing') return;
      // マウスは押していなくても狙いを見せる。指は押している間だけ
      if (!pointerActiveRef.current && e.pointerType !== 'mouse') return;
      updatePreview(e.clientX, e.clientY);
    },
    [updatePreview],
  );

  const commit = useCallback(() => {
    const sim = simRef.current;
    const id = toolRef.current;
    const preview = previewRef.current;
    if (!sim || !id || !preview) return;

    const cost = CONFIG.costs[id];
    if (sim.points < cost) {
      const short = Math.ceil(cost - sim.points);
      pushToast(`対策ポイントがあと ${short} 足りません。少し待つと回復します`, 'warn');
      return;
    }

    const words = modeOf(sim.mode);
    if (id === 'isolation') {
      if (!canPlaceIsolation(sim)) {
        pushToast(
          `${words.tools.isolation.label}は同時に ${CONFIG.maxZones} つまでです。どれかが消えるまで待ってください`,
          'warn',
        );
        return;
      }
      if (placeIsolation(sim, preview.x, preview.y)) {
        pushToast(
          `${words.tools.isolation.label}を設置しました（${words.states.infected} ${preview.infected} / ${words.states.susceptible} ${preview.healthy}）`,
        );
      }
    } else if (id === 'vaccine') {
      if (placeVaccine(sim, preview.x, preview.y)) {
        pushToast(`${words.tools.vaccine.label}を実施しました`);
      }
    }
    setHud(snapshot(sim));
  }, [pushToast]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (phaseRef.current !== 'playing') return;
      if (!pointerActiveRef.current) return;
      pointerActiveRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      commit();
      // 指の場合は置いたあとの丸を残さない
      if (e.pointerType !== 'mouse') previewRef.current = null;
    },
    [commit],
  );

  const onPointerLeave = useCallback(() => {
    if (!pointerActiveRef.current) previewRef.current = null;
  }, []);

  const useLockdown = useCallback(() => {
    const sim = simRef.current;
    if (!sim || phaseRef.current !== 'playing') return;
    const words = modeOf(sim.mode);
    if (sim.lockdownCooldown > 0) {
      pushToast(
        `${words.tools.lockdown.label}はあと ${Math.ceil(sim.lockdownCooldown)} 秒で使えます`,
        'warn',
      );
      return;
    }
    if (sim.points < CONFIG.costs.lockdown) {
      const short = Math.ceil(CONFIG.costs.lockdown - sim.points);
      pushToast(`対策ポイントがあと ${short} 足りません。少し待つと回復します`, 'warn');
      return;
    }
    if (triggerLockdown(sim)) {
      pushToast(`${words.tools.lockdown.label}を発動しました`);
      setHud(snapshot(sim));
    }
  }, [pushToast]);

  return {
    mode,
    setMode,
    phase,
    countdown,
    notice,
    hud,
    tool,
    result,
    toasts,
    start,
    backToTitle,
    selectTool,
    useLockdown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
  };
}
