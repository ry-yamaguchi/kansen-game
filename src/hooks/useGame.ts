import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG, TOOLS, planWorld } from '../sim/config';
import {
  buildResult,
  createSim,
  drift,
  placeIsolation,
  placeVaccine,
  previewCounts,
  scoreOf,
  step,
  triggerLockdown,
} from '../sim/engine';
import type { GameResult, Phase, SimState, ToolId } from '../sim/types';
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

  const [phase, setPhase] = useState<Phase>('ready');
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
    simRef.current = createSim(world, population);
    previewRef.current = null;
    pointerActiveRef.current = false;
    setResult(null);
    setHud(snapshot(simRef.current));
  }, []);

  const start = useCallback(() => {
    reset();
    phaseRef.current = 'playing';
    setPhase('playing');
    selectTool('isolation');
  }, [reset, selectTool]);

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

      if (phaseRef.current !== 'playing') {
        // 待機中・結果表示中も人は動かしておく
        drift(sim, dt);
      } else {
        acc += dt;
        let guard = 0;
        while (acc >= STEP && guard < 8) {
          step(sim, STEP);
          acc -= STEP;
          guard += 1;
          if (sim.timeLeft <= 0) break;
        }
        hudAcc += dt;
        if (hudAcc >= HUD_INTERVAL) {
          hudAcc = 0;
          setHud(snapshot(sim));
        }
        if (sim.timeLeft <= 0) {
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
      previewRef.current = {
        x,
        y,
        r,
        color: meta ? meta.color : '#ffffff',
        affordable: sim.points >= CONFIG.costs[id],
        infected: counts.infected,
        healthy: counts.healthy,
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

    if (id === 'isolation') {
      if (placeIsolation(sim, preview.x, preview.y)) {
        pushToast(`隔離エリアを設置しました（感染 ${preview.infected} / 健康 ${preview.healthy}）`);
      }
    } else if (id === 'vaccine') {
      if (placeVaccine(sim, preview.x, preview.y)) {
        pushToast('ワクチンを散布しました');
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
    if (sim.lockdownCooldown > 0) {
      pushToast(
        `ロックダウンはあと ${Math.ceil(sim.lockdownCooldown)} 秒で使えます`,
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
      pushToast('緊急ロックダウンを発動しました');
      setHud(snapshot(sim));
    }
  }, [pushToast]);

  return {
    phase,
    hud,
    tool,
    result,
    toasts,
    start,
    selectTool,
    useLockdown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
  };
}
