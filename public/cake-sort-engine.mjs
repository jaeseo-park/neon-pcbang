// 케이크 정리 (Cake tidy) — 순수 규칙 엔진. 브라우저 없이 Node 테스트 가능.
// 4x5 접시 자리, 접시당 최대 6조각. 대기 접시 3개 중 하나를 빈칸에 놓으면
// 상하좌우 이웃과 같은 맛 조각이 한쪽으로 모이고, 같은 맛 6조각이 되면 케이크가 완성되어 사라진다.
// 광고·과금·시간 제한 없음. 도우미는 무료 힌트와 판당 2회 "접시 치우기"뿐이다.

export const CAKE_COLS = 4;
export const CAKE_ROWS = 5;
export const CAKE_CELLS = CAKE_COLS * CAKE_ROWS;
export const PLATE_SIZE = 6;
export const QUEUE_SIZE = 3;
export const CAKE_SWEEPS = 2;

// 색만으로 구분하지 않도록 맛마다 기호(mark)를 함께 쓴다.
export const CAKE_FLAVORS = Object.freeze([
  { id: "s", name: "딸기", mark: "●", fill: "#eb7aa4", hi: "#ffb3d0", ink: "#261c29" },
  { id: "c", name: "초코", mark: "■", fill: "#85524f", hi: "#c48870", ink: "#fff3dc" },
  { id: "m", name: "말차", mark: "▲", fill: "#72bf52", hi: "#a8e67e", ink: "#261c29" },
  { id: "y", name: "치즈", mark: "◆", fill: "#f2c64b", hi: "#ffec94", ink: "#261c29" },
  { id: "b", name: "블루베리", mark: "✚", fill: "#5a6fc4", hi: "#8ea2ee", ink: "#fff3dc" },
  { id: "w", name: "생크림", mark: "★", fill: "#f7ebd4", hi: "#ffffff", ink: "#261c29" },
]);

function nextRandom(game) {
  game.seed = (Math.imul(1664525, game.seed) + 1013904223) >>> 0;
  return game.seed / 4294967296;
}

export function plateSize(plate) {
  let total = 0;
  for (const id in plate) total += plate[id];
  return total;
}

function plateKinds(plate) {
  return Object.keys(plate).length;
}

// 화면에 그릴 때 쓰는 조각 배열 (많은 맛부터)
export function plateSlices(plate) {
  return Object.entries(plate)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .flatMap(([id, count]) => Array(count).fill(id));
}

export function flavorsInPlay(cakes) {
  return Math.min(CAKE_FLAVORS.length, 3 + Math.floor(cakes / 4));
}

function makePlate(game) {
  const pool = CAKE_FLAVORS.slice(0, flavorsInPlay(game.cakes)).map((flavor) => flavor.id);
  const kinds = nextRandom(game) < 0.45 ? 1 : 2;
  const plate = {};
  let room = 2 + Math.floor(nextRandom(game) * 3); // 2~4조각
  for (let k = 0; k < kinds && room > 0; k++) {
    const id = pool.splice(Math.floor(nextRandom(game) * pool.length), 1)[0];
    const count = k === kinds - 1 ? room : 1 + Math.floor(nextRandom(game) * (room - 1));
    plate[id] = count;
    room -= count;
  }
  return plate;
}

function refillQueue(game) {
  if (game.queue.some(Boolean)) return;
  game.queue = Array.from({ length: QUEUE_SIZE }, () => makePlate(game));
}

export function createCakeGame(seed = (Date.now() ^ 0x2f6e2b1) >>> 0) {
  const game = {
    seed: (seed >>> 0) || 1,
    board: Array(CAKE_CELLS).fill(null),
    queue: [],
    score: 0,
    cakes: 0,
    moves: 0,
    sweeps: CAKE_SWEEPS,
    over: false,
  };
  refillQueue(game);
  return game;
}

function neighbors(cell) {
  const row = Math.floor(cell / CAKE_COLS);
  const col = cell % CAKE_COLS;
  const out = [];
  if (col < CAKE_COLS - 1) out.push(cell + 1);
  if (row < CAKE_ROWS - 1) out.push(cell + CAKE_COLS);
  return out;
}

// 붙어 있는 두 접시 사이에서 같은 맛을 한쪽으로 모은다.
// 옮긴 뒤 "맛별 조각 수의 제곱 합"이 반드시 커지는 이동만 허용하므로 무한 반복이 생기지 않는다.
function bestTransfer(board) {
  let best = null;
  for (let a = 0; a < CAKE_CELLS; a++) {
    if (!board[a]) continue;
    for (const b of neighbors(a)) {
      if (!board[b]) continue;
      for (const flavor in board[a]) {
        if (!board[b][flavor]) continue;
        for (const [to, from] of [[a, b], [b, a]]) {
          const have = board[to][flavor];
          const give = board[from][flavor];
          const count = Math.min(PLATE_SIZE - plateSize(board[to]), give);
          if (count <= 0 || count <= give - have) continue;
          const result = have + count;
          const completes = result === PLATE_SIZE && plateKinds(board[to]) === 1;
          const rank = (completes ? 1000 : 0) + result * 10 + (have >= give ? 1 : 0);
          if (!best || rank > best.rank) best = { from, to, flavor, count, rank };
        }
      }
    }
  }
  return best;
}

function settle(game, events) {
  let combo = 0;
  for (let guard = 0; guard < 500; guard++) {
    const move = bestTransfer(game.board);
    if (!move) break;
    const { from, to, flavor, count } = move;
    game.board[to][flavor] += count;
    game.board[from][flavor] -= count;
    if (!game.board[from][flavor]) delete game.board[from][flavor];
    if (!plateSize(game.board[from])) game.board[from] = null;
    game.score += 10 * count;
    events.push({ type: "move", from, to, flavor, count });
    if (game.board[to][flavor] === PLATE_SIZE && plateKinds(game.board[to]) === 1) {
      combo++;
      game.board[to] = null;
      game.cakes++;
      game.score += 100 + 30 * (combo - 1);
      events.push({ type: "cake", cell: to, flavor, combo });
    }
  }
}

export function isCakeBoardFull(game) {
  return game.board.every(Boolean);
}

export function placeCakePlate(game, queueIndex, cell) {
  if (game.over) return { ok: false, reason: "over", events: [] };
  const plate = game.queue[queueIndex];
  if (!plate) return { ok: false, reason: "plate", events: [] };
  if (!Number.isInteger(cell) || cell < 0 || cell >= CAKE_CELLS) return { ok: false, reason: "cell", events: [] };
  if (game.board[cell]) return { ok: false, reason: "occupied", events: [] };
  const before = game.score;
  const events = [];
  game.board[cell] = plate;
  game.queue[queueIndex] = null;
  game.moves++;
  settle(game, events);
  refillQueue(game);
  game.over = isCakeBoardFull(game);
  return { ok: true, reason: "", events, gained: game.score - before };
}

// 도우미: 접시 하나 치우기 (판당 CAKE_SWEEPS 회, 무료)
export function sweepCakeCell(game, cell) {
  if (game.sweeps <= 0) return { ok: false, reason: "empty" };
  if (!game.board[cell]) return { ok: false, reason: "cell" };
  game.board[cell] = null;
  game.sweeps--;
  game.over = false;
  return { ok: true, reason: "" };
}

function cloneGame(game) {
  return {
    ...game,
    board: game.board.map((plate) => (plate ? { ...plate } : null)),
    queue: game.queue.map((plate) => (plate ? { ...plate } : null)),
  };
}

// 무료 힌트: 대기 접시와 빈칸의 모든 조합을 한 수 앞까지 놓아 보고 가장 이득인 자리를 알려 준다.
export function findCakeHint(game) {
  let best = null;
  for (let queueIndex = 0; queueIndex < game.queue.length; queueIndex++) {
    if (!game.queue[queueIndex]) continue;
    for (let cell = 0; cell < CAKE_CELLS; cell++) {
      if (game.board[cell]) continue;
      const trial = cloneGame(game);
      const result = placeCakePlate(trial, queueIndex, cell);
      const empty = trial.board.filter((plate) => !plate).length;
      const value = result.gained + empty * 8;
      if (!best || value > best.value) best = { queueIndex, cell, value };
    }
  }
  return best ? { queueIndex: best.queueIndex, cell: best.cell } : null;
}
