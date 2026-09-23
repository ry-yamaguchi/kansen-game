/**
 * 街の盤面（区画・通り・経路）。
 *
 * 世界の大きさから比率で組み立てる。座標を固定値で書かない
 * （テストは800×600など別の大きさでも盤面を作るため）。
 * 横長（w >= h）は5列×3行、縦長は3列×5行。区画の間と外周が通りである。
 *
 * 縦長は横長の街を時計回りに90°回した配置にする（鏡像にしない）。
 * 回転の計算をコードで行うと向きを間違えやすいため、手で導出した結果を
 * そのまま2つの区画表として持つ。導出手順は docs/design-city.md 起票時のレビューに残る。
 *
 * このファイルは純粋・決定論を保つ（CLAUDE.md 掟2）。乱数を使う関数は Rng を引数に取る。
 */
import { CONFIG } from './config';
import type { Rng } from './rng';
import type { BlockRole, City, CityBlock, CityNode, World } from './types';

const HORIZONTAL_ROLES: BlockRole[][] = [
  ['house', 'school', 'house', 'work', 'house'],
  ['house', 'house', 'plaza', 'house', 'house'],
  ['house', 'house', 'house', 'house', 'station'],
];

// 横長の表を時計回りに90°回した並び（鏡像ではない）。
// 学校・職場は右列に集まり、駅は右下から左下へ移る。広場は回しても中央のまま
const VERTICAL_ROLES: BlockRole[][] = [
  ['house', 'house', 'house'],
  ['house', 'house', 'school'],
  ['house', 'plaza', 'house'],
  ['house', 'house', 'work'],
  ['station', 'house', 'house'],
];

/** 世界の大きさから街の盤面を組み立てる */
export function buildCity(world: World): City {
  const roles = world.w >= world.h ? HORIZONTAL_ROLES : VERTICAL_ROLES;
  const rows = roles.length;
  const cols = roles[0].length;
  const streetWidth = Math.min(world.w, world.h) * CONFIG.streetWidthRatio;
  const blockW = (world.w - streetWidth * (cols + 1)) / cols;
  const blockH = (world.h - streetWidth * (rows + 1)) / rows;

  const blocks: CityBlock[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      blocks.push({
        role: roles[r][c],
        x: streetWidth + c * (blockW + streetWidth),
        y: streetWidth + r * (blockH + streetWidth),
        w: blockW,
        h: blockH,
        col: c,
        row: r,
      });
    }
  }

  // 交差点：区画の角と一致する (cols+1) × (rows+1) の格子
  const nodes: CityNode[][] = [];
  for (let r = 0; r <= rows; r += 1) {
    const line: CityNode[] = [];
    for (let c = 0; c <= cols; c += 1) {
      line.push({
        x: streetWidth / 2 + c * (blockW + streetWidth),
        y: streetWidth / 2 + r * (blockH + streetWidth),
        r,
        c,
      });
    }
    nodes.push(line);
  }

  const find = (role: BlockRole): CityBlock => {
    const b = blocks.find((x) => x.role === role);
    if (!b) throw new Error(`街の区画表に ${role} が無い`);
    return b;
  };

  return {
    cols,
    rows,
    streetWidth,
    blocks,
    nodes,
    houses: blocks.filter((b) => b.role === 'house'),
    plaza: find('plaza'),
    station: find('station'),
    school: find('school'),
    work: find('work'),
  };
}

// --- 経路探索 ---------------------------------------------------------------

/**
 * 線分 (x1,y1)-(x2,y2) が矩形の内部を通るか（Liang-Barsky によるクリッピング判定）。
 * 端点が矩形内にある場合も含め、軸並行の矩形との交差を漏れなく拾える。
 */
function segmentHitsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return false; // 軸に平行で、そもそも範囲の外
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

/**
 * 点から直線で行ける、最も近い交差点を探す。
 * 住宅を突っ切る直線は選ばない（区画の角どうし・通りの中の点から通りの交差点へは
 * 常に直線で届くため、実際にはここで弾かれるのは稀である）。
 */
function nearestReachableNode(city: City, point: { x: number; y: number }): CityNode {
  let best: CityNode | null = null;
  let bestDist = Infinity;
  let closest = city.nodes[0][0];
  let closestDist = Infinity;
  for (const line of city.nodes) {
    for (const node of line) {
      const d = Math.hypot(node.x - point.x, node.y - point.y);
      if (d < closestDist) {
        closestDist = d;
        closest = node;
      }
      if (d < bestDist) {
        const blocked = city.houses.some((h) => segmentHitsRect(point.x, point.y, node.x, node.y, h));
        if (!blocked) {
          best = node;
          bestDist = d;
        }
      }
    }
  }
  // best が見つからないのは街の作りが壊れているときだけである。念のため最寄りへ逃がす
  return best ?? closest;
}

/** 交差点の格子を4方向グラフとして辿る幅優先探索。既定は空にならない（from 自身を含む） */
function bfsNodePath(city: City, from: CityNode, to: CityNode): CityNode[] {
  if (from.r === to.r && from.c === to.c) return [from];
  const width = city.cols + 1;
  const key = (r: number, c: number): number => r * width + c;
  const prev = new Map<number, CityNode>();
  const visited = new Set<number>([key(from.r, from.c)]);
  const queue: CityNode[] = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head];
    head += 1;
    if (cur.r === to.r && cur.c === to.c) break;
    const deltas: Array<[number, number]> = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (const [dr, dc] of deltas) {
      const r = cur.r + dr;
      const c = cur.c + dc;
      if (r < 0 || r > city.rows || c < 0 || c > city.cols) continue;
      const k = key(r, c);
      if (visited.has(k)) continue;
      visited.add(k);
      prev.set(k, cur);
      queue.push(city.nodes[r][c]);
    }
  }
  if (!visited.has(key(to.r, to.c))) return [from, to]; // 格子は必ず繋がっているため、理論上ここには来ない

  const path: CityNode[] = [];
  let cur: CityNode | undefined = city.nodes[to.r][to.c];
  while (cur) {
    path.push(cur);
    if (cur.r === from.r && cur.c === from.c) break;
    cur = prev.get(key(cur.r, cur.c));
  }
  path.reverse();
  return path;
}

/** 通りの中での横ずれ（lane）を、進む向きに対して垂直に足す。最後の点（目的地そのもの）はずらさない */
function applyLane(raw: { x: number; y: number }[], lane: number): { x: number; y: number }[] {
  if (lane === 0) return raw;
  return raw.map((p, i) => {
    if (i === raw.length - 1) return p;
    const next = raw[i + 1];
    // 通りは軸並行なので、どちらの成分が大きいかで水平・垂直の通りを見分けられる
    const horizontal = Math.abs(next.x - p.x) >= Math.abs(next.y - p.y);
    return horizontal ? { x: p.x, y: p.y + lane } : { x: p.x + lane, y: p.y };
  });
}

/**
 * from から to まで、通りをたどる経路を作る。
 * 交差点を節点とする最短経路（BFS）に、両端の区画内への直線を足す。
 * lane は通りの中での横ずれ量（固定・個人ごと）。呼び出す側は目的地が変わったときだけ呼ぶこと
 * （経路は毎フレーム計算しない）。
 */
export function routeTo(
  city: City,
  from: { x: number; y: number },
  to: { x: number; y: number },
  lane: number,
): { x: number; y: number }[] {
  const entry = nearestReachableNode(city, from);
  const exit = nearestReachableNode(city, to);
  const nodePath = bfsNodePath(city, entry, exit);
  const raw = [...nodePath.map((n) => ({ x: n.x, y: n.y })), { x: to.x, y: to.y }];
  return applyLane(raw, lane);
}

// --- 区画上の点 ---------------------------------------------------------------

/** 区画の中の1点をランダムに選ぶ（margin は縁からの余白） */
export function randomPointInBlock(
  rng: Rng,
  block: CityBlock,
  margin: number,
): { x: number; y: number } {
  const w = Math.max(0, block.w - margin * 2);
  const h = Math.max(0, block.h - margin * 2);
  return {
    x: block.x + margin + rng.next() * w,
    y: block.y + margin + rng.next() * h,
  };
}

/**
 * 住宅区画に面した、通り沿いの「家」候補点。
 * 各住宅の南側の通りの中心線に等間隔で置く（どの辺にするかは向きを問わないため、実装を単純にする南側で統一）。
 */
export function homeSpots(city: City, perHouse = 4): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  for (const h of city.houses) {
    for (let i = 0; i < perHouse; i += 1) {
      const t = (i + 1) / (perHouse + 1);
      spots.push({ x: h.x + h.w * t, y: h.y + h.h + city.streetWidth / 2 });
    }
  }
  return spots;
}

/**
 * 建物（住宅）の中に入り込んでいたら、最も近い辺の外側（margin ぶん離した所）へ押し戻す。
 * 経路探索やずらしが正しければ本来は起きないはずだが、念のための安全弁として毎フレーム呼ぶ。
 */
export function pushOutOfHouses(
  city: City,
  point: { x: number; y: number },
  margin: number,
): { x: number; y: number } {
  for (const h of city.houses) {
    const left = h.x - margin;
    const right = h.x + h.w + margin;
    const top = h.y - margin;
    const bottom = h.y + h.h + margin;
    if (point.x <= left || point.x >= right || point.y <= top || point.y >= bottom) continue;
    const dl = point.x - left;
    const dr = right - point.x;
    const dt = point.y - top;
    const db = bottom - point.y;
    const min = Math.min(dl, dr, dt, db);
    if (min === dl) return { x: left, y: point.y };
    if (min === dr) return { x: right, y: point.y };
    if (min === dt) return { x: point.x, y: top };
    return { x: point.x, y: bottom };
  }
  return point;
}
