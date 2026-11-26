// feat/nyangdabang-link 브랜치에서 추가한 기능의 단위 테스트
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PUBLIC_RANK_ORIGINS, arcadeLeaderboard, publicRank } from "../lib/cafe-arcade.mjs";
import { BOARD_LIMITS, boardApi } from "../lib/cafe-board.mjs";
import { pvpArena } from "../lib/cafe-pvp.mjs";
import { canWalk, noticeBoard } from "../lib/cafe-world.mjs";
import {
  CAKE_CELLS,
  PLATE_SIZE,
  createCakeGame,
  findCakeHint,
  placeCakePlate,
  plateSize,
  sweepCakeCell,
} from "../public/cake-sort-engine.mjs";
import {
  createKnitStage,
  isCellReachable,
  isKnitWon,
  pickKnitCell,
  stepKnitUnravel,
  undoKnit,
  TRAY_COLS,
  TRAY_ROWS,
} from "../public/knit-unravel-engine.mjs";
import { moveMergeBoard } from "../public/merge-board.js";
import { omokMoveVerdict } from "../public/omok-rules.mjs";
import { chooseOmokAiMove } from "../public/pvp-ai.mjs";
import { canMoveToTableau, createSolitaireGame, wasteFanCount } from "../public/solitaire-engine.mjs";
import { clearSudokuPeerNotes, restoreSudokuPeerNotes } from "../public/sudoku-board.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function makeDb(...migrations) {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of migrations) {
    for (const stmt of read(`../drizzle/${file}`).split("--> statement-breakpoint")) {
      if (stmt.trim()) sqlite.exec(stmt);
    }
  }
  const reader = /^\s*(SELECT|PRAGMA|WITH)/i;
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          const bound = sqlite.prepare(sql);
          return {
            sql,
            async first() { return bound.get(...values) ?? null; },
            async all() { return { results: reader.test(sql) ? bound.all(...values) : [] }; },
            async run() { return { success: true, meta: { changes: Number(bound.run(...values).changes) } }; },
          };
        },
      };
    },
    async batch(statements) {
      const out = [];
      for (const st of statements) {
        if (reader.test(st.sql)) out.push({ results: (await st.all()).results, meta: { changes: 0 } });
        else out.push({ results: [], meta: (await st.run()).meta });
      }
      return out;
    },
  };
  return { sqlite, db };
}

const postJson = (url, body) => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const at = (row, col) => row * 15 + col;
const emptyOmok = () => new Array(225).fill(0);

test("sudoku: real entries tidy peer memos, skip duplicates, and erasing restores them", () => {
  const values = new Array(81).fill(0);
  const notes = Array.from({ length: 81 }, () => new Set());
  notes[1].add(5); // 같은 행
  notes[9].add(5); // 같은 열·구역
  notes[80].add(5); // 관계없는 칸
  const cleared = clearSudokuPeerNotes(values, notes, 0, 5);
  values[0] = 5;
  assert.deepEqual(cleared.sort((a, b) => a - b), [1, 9]);
  assert.ok(notes[80].has(5), "unrelated cells keep their memo");

  values[0] = 0;
  restoreSudokuPeerNotes(values, notes, cleared, 5);
  assert.ok(notes[1].has(5) && notes[9].has(5), "erasing the entry brings the memos back");

  // 이미 같은 줄에 5가 있으면(중복 오입력) 메모를 건드리지 않는다.
  values[8] = 5;
  assert.deepEqual(clearSudokuPeerNotes(values, notes, 0, 5), []);
  assert.ok(notes[1].has(5));
});

test("solitaire: 1-card draw shows one waste card and easy mode is opt-in", () => {
  assert.equal(wasteFanCount(1), 1);
  assert.equal(wasteFanCount(3), 3);
  assert.match(read("../public/solitaire.js"), /wasteFanCount\(drawCount\)/);

  const redSix = { suit: "hearts", rank: 6, faceUp: true };
  const redSeven = [{ suit: "diamonds", rank: 7, faceUp: true }];
  assert.equal(canMoveToTableau(redSix, redSeven), false, "classic rule stays the default");
  assert.equal(canMoveToTableau(redSix, redSeven, { easy: true }), true);
  assert.equal(canMoveToTableau({ suit: "hearts", rank: 5, faceUp: true }, redSeven, { easy: true }), false);
  assert.equal(createSolitaireGame({ seed: 1 }).easy, false);
  assert.equal(createSolitaireGame({ seed: 1, easy: true }).easy, true);
});

test("2048: move results describe every sliding tile", () => {
  const board = [2, 0, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const result = moveMergeBoard(board, "left", () => 0.99);
  assert.deepEqual(result.board.slice(0, 4), [4, 4, 0, 0]);
  assert.deepEqual(result.slides, [
    { from: 2, to: 0, value: 2 },
    { from: 3, to: 1, value: 4 },
  ]);
  assert.deepEqual(moveMergeBoard([2, 4, 8, 16, ...Array(12).fill(0)], "left").slides, []);
});

test("omok: double-three and overline are forbidden, exact five always wins", () => {
  let board = emptyOmok();
  for (const [r, c] of [[7, 5], [7, 6], [5, 7], [6, 7]]) board[at(r, c)] = 1;
  assert.deepEqual(omokMoveVerdict(board, at(7, 7), 1), { ok: false, win: false, reason: "double-three" });
  assert.equal(omokMoveVerdict(board, at(7, 7), 2).ok, true, "the other colour is not affected by black threes");

  board = emptyOmok();
  for (const c of [3, 4, 5, 7, 8]) board[at(7, c)] = 1;
  assert.equal(omokMoveVerdict(board, at(7, 6), 1).reason, "overline");

  board = emptyOmok();
  for (const c of [3, 4, 5, 6]) board[at(7, c)] = 1;
  assert.deepEqual(omokMoveVerdict(board, at(7, 7), 1), { ok: true, win: true, reason: "" });

  // 한쪽이 막힌 3 + 열린 3 은 쌍삼이 아니다.
  board = emptyOmok();
  for (const [r, c] of [[7, 5], [7, 6], [5, 7], [6, 7]]) board[at(r, c)] = 1;
  board[at(7, 4)] = 2;
  board[at(7, 8)] = 2;
  assert.equal(omokMoveVerdict(board, at(7, 7), 1).ok, true);

  // AI 는 금수 자리를 고르지 않는다.
  board = emptyOmok();
  for (const [r, c] of [[7, 5], [7, 6], [5, 7], [6, 7]]) board[at(r, c)] = 2;
  for (const level of ["easy", "medium", "hard"]) {
    for (let i = 0; i < 10; i++) {
      assert.equal(omokMoveVerdict(board, chooseOmokAiMove(board, level, 2), 2).ok, true);
    }
  }
});

test("omok: the server rejects a forbidden move and keeps the turn", async () => {
  const { db, sqlite } = makeDb("0009_arcade_and_pvp.sql");
  try {
    const host = randomUUID(), guest = randomUUID();
    const url = "https://pcbang.test/api/pvp";
    let now = 1_800_000_000_000;
    const send = async (token, body) => (await pvpArena(postJson(url, { token, name: "손님", ...body }), db, now += 10));
    const matchId = (await (await send(host, { action: "create", game: "omok" })).json()).match.id;
    await send(guest, { action: "join", matchId });
    const hostMoves = [at(7, 5), at(7, 6), at(5, 7), at(6, 7)];
    const guestMoves = [at(0, 0), at(0, 2), at(0, 4), at(0, 6)];
    for (let i = 0; i < 4; i++) {
      assert.equal((await send(host, { action: "move", matchId, index: hostMoves[i] })).status, 200);
      assert.equal((await send(guest, { action: "move", matchId, index: guestMoves[i] })).status, 200);
    }
    const refused = await send(host, { action: "move", matchId, index: at(7, 7) });
    assert.equal(refused.status, 400);
    const body = await refused.json();
    assert.equal(body.error, "forbidden");
    assert.equal(body.reason, "double-three");
    assert.equal(body.match.turn, "host", "the turn stays with the player");
    assert.equal(body.match.state.board[at(7, 7)], 0);
  } finally {
    sqlite.close();
  }
});

test("knit: the optional column rule only activates column tops and slides spools up", () => {
  assert.equal(createKnitStage(1).rule, "path", "default rule is unchanged");
  const game = createKnitStage(5, { rule: "column" });
  for (let c = 0; c < TRAY_COLS; c++) {
    for (let r = 1; r < TRAY_ROWS; r++) {
      const cell = game.tray[r][c];
      if (cell?.type !== "spool" || cell.pairId) continue;
      assert.equal(isCellReachable(game, r, c), false, `row ${r} must wait for the spools above it`);
    }
  }
  const col = [...Array(TRAY_COLS).keys()].find((c) => !game.tray[0][c].pairId && !game.tray[0][c].ice);
  const below = game.tray[1][col];
  assert.equal(pickKnitCell(game, 0, col).ok, true);
  assert.equal(game.tray[0][col]?.id, below.id, "the spool below slides up to the top");
  assert.equal(game.tray[0][col].mystery, false, "a spool that reaches the top is revealed");
  assert.equal(undoKnit(game), true);
  assert.equal(game.tray[1][col].id, below.id);

  // 두 규칙 모두 도우미만으로 끝까지 풀 수 있다.
  for (const rule of ["path", "column"]) {
    const stage = createKnitStage(3, { rule });
    for (let guard = 0; guard < 400 && !isKnitWon(stage); guard++) {
      while (stepKnitUnravel(stage, 1).length);
      const exposed = new Set();
      for (let c = 0; c < stage.cols; c++) {
        for (let r = stage.rows - 1; r >= 0; r--) {
          if (stage.tapestry[r][c] !== null) { exposed.add(stage.tapestry[r][c]); break; }
        }
      }
      const options = [];
      for (let r = 0; r < TRAY_ROWS; r++) {
        for (let c = 0; c < TRAY_COLS; c++) {
          if (isCellReachable(stage, r, c)) options.push([exposed.has(stage.tray[r][c].color) ? 0 : 1, r, c]);
        }
      }
      options.sort((a, b) => a[0] - b[0]);
      if (!options.some(([, r, c]) => pickKnitCell(stage, r, c).ok)) break;
    }
    assert.equal(isKnitWon(stage), true, `${rule} rule clears stage 3`);
  }
});

test("public rank: read-only, minimal fields, CORS for the neighbour game only", async () => {
  const { db, sqlite } = makeDb("0009_arcade_and_pvp.sql");
  try {
    for (const [nickname, score] of [["테트리스왕", 12400], ["초보", 4200]]) {
      await arcadeLeaderboard(postJson("https://pcbang.test/api/arcade", {
        action: "submit", game: "tetris", mode: "standard", member: randomUUID(), nickname, score, metric: "32줄",
      }), db, 1_800_000_000_000);
    }
    const origin = PUBLIC_RANK_ORIGINS[0];
    assert.equal(origin, "https://nyangdabang.epsiloneri.com");
    const ok = await publicRank(new Request("https://pcbang.test/api/public/rank?game=tetris&limit=1", { headers: { Origin: origin } }), db);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("Access-Control-Allow-Origin"), origin);
    const data = await ok.json();
    assert.deepEqual(data, {
      site: "길모퉁이PC방", game: "tetris", gameName: "모퉁이 블록 드롭", mode: "standard", lowerIsBetter: false,
      ranks: [{ rank: 1, nickname: "테트리스왕", score: 12400 }],
    });

    const other = await publicRank(new Request("https://pcbang.test/api/public/rank?game=tetris", { headers: { Origin: "https://evil.example" } }), db);
    assert.equal(other.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal((await other.json()).ranks.length, 2);

    const huge = await publicRank(new Request("https://pcbang.test/api/public/rank?game=tetris&limit=9999"), db);
    assert.ok((await huge.json()).ranks.length <= 10);
    assert.equal((await publicRank(new Request("https://pcbang.test/api/public/rank?game=nope"), db)).status, 400);

    // 초대제 예외는 GET/HEAD 의 이 경로 하나뿐이다.
    const gate = read("../lib/invite-gate.ts");
    assert.match(gate, /const publicRankPath = "\/api\/public\/rank";/);
    assert.match(gate, /\(request\.method === "GET" \|\| request\.method === "HEAD"\) && path === publicRankPath\) return null;/);
  } finally {
    sqlite.close();
  }
});

test("cake tidy: slices gather, six of a kind completes a cake, and plates never overflow", () => {
  const game = createCakeGame(42);
  game.queue = [{ s: 3 }, { s: 3 }, { c: 2 }];
  assert.equal(placeCakePlate(game, 0, 0).ok, true);
  const result = placeCakePlate(game, 1, 1);
  assert.equal(result.ok, true);
  assert.equal(game.cakes, 1);
  assert.equal(game.board[0], null);
  assert.equal(game.board[1], null);
  assert.ok(result.events.some((event) => event.type === "cake" && event.flavor === "s"));
  assert.equal(placeCakePlate(game, 2, 5).ok, true);
  assert.equal(game.queue.filter(Boolean).length, 3, "a fresh set of three plates arrives");
  game.queue[1] = null;
  assert.equal(placeCakePlate(game, 1, 6).reason, "plate");
  assert.equal(placeCakePlate(game, 0, 5).reason, "occupied");

  assert.equal(sweepCakeCell(game, 5).ok, true);
  assert.equal(game.board[5], null);
  assert.equal(game.sweeps, 1);

  for (const seed of [1, 7, 99, 2026]) {
    const run = createCakeGame(seed);
    while (!run.over && run.moves < 2000) {
      const hint = findCakeHint(run);
      assert.ok(hint, "a hint exists while the board has room");
      assert.equal(placeCakePlate(run, hint.queueIndex, hint.cell).ok, true);
      for (const plate of run.board) if (plate) assert.ok(plateSize(plate) <= PLATE_SIZE);
    }
    assert.ok(run.cakes > 0);
    assert.ok(run.board.length === CAKE_CELLS);
  }
  const source = read("../public/cake-sort.js") + read("../public/cake-sort-engine.mjs");
  assert.doesNotMatch(source, /광고 보기|결제|구매|purchase|\bads?\b/i, "no ads or purchases");
});

test("notice board: anyone can post, limits apply, and only an admin session can moderate", async () => {
  const { db, sqlite } = makeDb("0010_board_posts.sql");
  try {
    const url = "https://pcbang.test/api/board";
    const member = randomUUID();
    let now = 1_800_000_000_000;
    const call = async (body, admin = false) => boardApi(postJson(url, body), db, admin, now += 1000);

    const created = await (await call({ action: "create", member, nickname: "단골", category: "bug", body: "스도쿠 메모가 사라져요", context: "Windows Chrome · 화면 1920×1080" })).json();
    assert.equal(created.posts.length, 1);
    assert.equal(created.posts[0].status, "waiting");
    assert.equal(created.posts[0].nickname, "단골");
    assert.equal(created.admin, false);
    assert.ok(!("context" in created.posts[0]) && !("hidden" in created.posts[0]), "visitors do not get admin-only fields");
    assert.ok(!JSON.stringify(created).includes(member), "the member token never leaves the server");
    const id = created.posts[0].id;

    assert.equal((await call({ action: "create", member, nickname: "단골", category: "nope", body: "내용" })).status, 400);
    assert.equal((await call({ action: "create", member, nickname: "단골", category: "suggestion", body: "x" })).status, 400);
    assert.equal((await call({ action: "create", member, nickname: "단골", category: "suggestion", body: "가".repeat(BOARD_LIMITS.bodyMax + 1) })).status, 400);

    // 관리자 세션이 아니면 요청 본문에 무엇을 넣어도 상태를 바꿀 수 없다.
    for (const body of [
      { action: "status", id, status: "accepted", admin: true, isAdmin: true },
      { action: "hide", id, hidden: true },
      { action: "delete", id },
    ]) assert.equal((await call(body)).status, 403);

    const accepted = await (await call({ action: "status", id, status: "accepted" }, true)).json();
    assert.equal(accepted.posts[0].status, "accepted");
    assert.equal(accepted.posts[0].context, "Windows Chrome · 화면 1920×1080");
    assert.equal((await call({ action: "status", id, status: "nope" }, true)).status, 400);

    await call({ action: "hide", id, hidden: true }, true);
    assert.equal((await (await call({ action: "list" })).json()).posts.length, 0, "hidden posts disappear for visitors");
    assert.equal((await (await call({ action: "list" }, true)).json()).posts[0].hidden, true);
    assert.equal((await (await call({ action: "delete", id }, true)).json()).posts.length, 0);

    // 도배 방지: 같은 브라우저는 하루 perDay 건까지 (위에서 이미 1건 썼지만 삭제됨)
    for (let i = 0; i < BOARD_LIMITS.perDay; i++) {
      assert.equal((await call({ action: "create", member, nickname: "단골", category: "suggestion", body: `건의 ${i}번` })).status, 200);
    }
    assert.equal((await call({ action: "create", member, nickname: "단골", category: "suggestion", body: "한 번 더" })).status, 429);
    assert.equal((await call({ action: "create", member: randomUUID(), nickname: "단골", category: "suggestion", body: "닉네임만 같은 글" })).status, 429);
    assert.equal((await call({ action: "create", member: randomUUID(), nickname: "다른손님", category: "suggestion", body: "다른 사람 글" })).status, 200);

    const cross = await boardApi(new Request(url, { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" }, body: "{}" }), db, true);
    assert.equal(cross.status, 403);
  } finally {
    sqlite.close();
  }
});

test("notice board and new windows are wired into the page, layout and smoke list", () => {
  const html = read("../app/cafe.html");
  for (const id of ["cake", "board"]) assert.match(html, new RegExp(`<dialog id="${id}"`));
  assert.match(html, /data-open="cake"/);
  assert.match(html, /class="stage-room-door board-pin" type="button" data-open="board"/);
  assert.match(html, /href="https:\/\/nyangdabang\.epsiloneri\.com\/" target="_blank" rel="noopener"/);
  assert.match(read("../public/cafe-layout.js"), /board: \{ label: "게시판"/);
  assert.match(read("../public/cafe-art.js"), /function noticeBoard\(/);
  assert.equal(canWalk(noticeBoard.x, noticeBoard.y), true, "the interaction point is reachable on foot");
  assert.match(read("../public/nyangdabang-link.js"), /rankApi: "https:\/\/nyangdabang\.epsiloneri\.com\/api\/public\/rank\?limit=10"/);
  assert.match(read("../public/arcade-leaderboard.js"), /랭킹을 불러오지 못했어요/);
  const smoke = read("./smoke-live-game.mjs");
  for (const file of [
    "omok-rules.mjs", "nyangdabang-link.js", "arcade-leaderboard.js", "cake-sort.js", "cake-sort-engine.mjs",
    "cafe-board.js", "cafe-board.css", "merge.js", "merge-board.js", "sudoku-board.js",
  ]) assert.ok(smoke.includes(`"${file}"`), `${file} is in the live smoke list`);
});
