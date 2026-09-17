/**
 * 開発中の画面を撮って確認するための道具。
 *
 * ブラウザゲームなので、型が通っただけでは「見えているか」が分からない。
 * ヘッドレスの Chrome を DevTools Protocol で操作し、実際に遊んだ状態の
 * スクリーンショットと HUD の値を取り出す。Node 24 の組み込み WebSocket と
 * fetch だけを使うため、依存は増やしていない。
 *
 * 使い方（先に npm run dev を起動しておく）:
 *   1. Chrome をデバッグポート付きで起動する
 *      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *        --headless=new --disable-gpu --user-data-dir=/tmp/kansen-prof \
 *        --window-size=1280,800 --remote-debugging-port=9222 \
 *        http://localhost:5173/kansen-game/ &
 *   2. node scripts/shot.mjs <モード番号0-2> <待つ秒数> <出力先png>
 */
const PORT = Number(process.env.CDP_PORT ?? 9222);
const URL = process.env.GAME_URL ?? 'http://localhost:5173/kansen-game/';

const modeIndex = Number(process.argv[2] ?? 0);
const waitSeconds = Number(process.argv[3] ?? 20);
const outPath = process.argv[4] ?? 'shot.png';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('Chrome のページが見つからない。デバッグポート付きで起動しているか確認する');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(d.exception?.description ?? d.text);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    seq += 1;
    pending.set(seq, resolve);
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(2500);

await evaluate(`document.querySelectorAll('.mode')[${modeIndex}].click()`);
await sleep(400);
const mode = await evaluate(
  `document.querySelectorAll('.mode')[${modeIndex}].querySelector('.mode__name').textContent`,
);
await evaluate(`document.querySelector('.cta').click()`);
await sleep(waitSeconds * 1000);

const hud = await evaluate(`
  (() => {
    const t = (s) => document.querySelector(s)?.textContent ?? null;
    return {
      残り: t('.timer__value'),
      状態: [...document.querySelectorAll('.stat__label')].map((e, i) =>
        e.textContent + [...document.querySelectorAll('.stat__value')][i].textContent).join(' '),
      指標: t('.social__label') + '=' + t('.social__value'),
      スコア: t('.score__value'),
      効果: [...document.querySelectorAll('.badge')].map((e) => e.textContent),
      結果: t('#result-title'),
    };
  })()
`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs');
fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));

console.log(`モード: ${mode}`);
console.log(`HUD: ${JSON.stringify(hud, null, 1)}`);
console.log(`例外: ${errors.length ? errors.join('\n') : 'なし'}`);
console.log(`保存先: ${outPath}`);

ws.close();
process.exit(0);
