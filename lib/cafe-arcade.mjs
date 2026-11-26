const validGames = new Set([
  "pvp", "tetris", "bungeoppang", "tycoon", "acidrain",
  "mines", "arcade", "merge", "sudoku", "solitaire", "knit", "cake",
]);
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const initializedDbs = new WeakSet();

function reply(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function fingerprint(token) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureTable(db) {
  if (initializedDbs.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cafe_leaderboard (
      id TEXT PRIMARY KEY NOT NULL,
      game TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'standard',
      member_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      score INTEGER NOT NULL,
      metric TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    )`).bind(),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS cafe_leaderboard_member_game ON cafe_leaderboard(game, mode, member_id)`).bind(),
    db.prepare(`CREATE INDEX IF NOT EXISTS cafe_leaderboard_top ON cafe_leaderboard(game, mode, score DESC, updated_at ASC)`).bind(),
  ]);
  initializedDbs.add(db);
}

// ── 읽기 전용 공개 랭킹 (이웃 게임 "냥다방 머지" 가 읽어 간다) ─────────────────────────
// GET /api/public/rank?game=<id>&limit=10[&mode=<mode>]
// 내보내는 값은 게임 이름, 순위, 닉네임, 점수뿐이다. member_id·metric·시각은 내보내지 않는다.
// 쓰기 기능은 없고, 브라우저에서는 PUBLIC_RANK_ORIGINS 에 적힌 출처만 읽을 수 있다(CORS).
export const PUBLIC_RANK_ORIGINS = Object.freeze(["https://nyangdabang.epsiloneri.com"]);
const publicGames = Object.freeze({
  pvp: { name: "모퉁이 대국장", mode: "omok" },
  tetris: { name: "모퉁이 블록 드롭", mode: "standard" },
  bungeoppang: { name: "길모퉁이 붕어빵 포차", mode: "standard" },
  tycoon: { name: "알바냥의 매점 러시", mode: "standard" },
  acidrain: { name: "코지 빗방울 산성비", mode: "standard" },
  mines: { name: "지뢰찾기", mode: "easy" },
  arcade: { name: "모퉁이 벽돌깨기 DX", mode: "standard" },
  merge: { name: "2048", mode: "standard" },
  sudoku: { name: "스도쿠", mode: "34" },
  solitaire: { name: "코지 솔리테어", mode: "draw3" },
  knit: { name: "뜨개 실풀기", mode: "stage1" },
  cake: { name: "케이크 정리", mode: "standard" },
});

function publicReply(request, data, status = 200) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin && PUBLIC_RANK_ORIGINS.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(data), { status, headers });
}

export async function publicRank(request, db) {
  const url = new URL(request.url);
  const game = url.searchParams.get("game") || "";
  const info = Object.hasOwn(publicGames, game) && validGames.has(game) ? publicGames[game] : null;
  if (!info) return publicReply(request, { error: "game", games: Object.keys(publicGames).filter((id) => validGames.has(id)) }, 400);
  const rawMode = url.searchParams.get("mode");
  const mode = rawMode && /^[a-z0-9_-]{1,18}$/i.test(rawMode) ? rawMode.toLowerCase() : info.mode;
  const requested = Number(url.searchParams.get("limit") ?? 10);
  const limit = Number.isInteger(requested) ? Math.min(10, Math.max(1, requested)) : 10;
  if (!db) return publicReply(request, { error: "unavailable" }, 503);
  try {
    await ensureTable(db);
    const lowerIsBetter = game === "mines";
    const [{ results }] = await db.batch([db.prepare(`SELECT nickname, score FROM cafe_leaderboard
      WHERE game = ? AND mode = ?
      ORDER BY score ${lowerIsBetter ? "ASC" : "DESC"}, updated_at ASC LIMIT ?`)
      .bind(game, mode, limit)]);
    return publicReply(request, {
      site: "길모퉁이PC방",
      game,
      gameName: info.name,
      mode,
      lowerIsBetter,
      ranks: results.map((row, index) => ({ rank: index + 1, nickname: row.nickname, score: row.score })),
    });
  } catch (error) {
    console.error("Public rank error", error instanceof Error ? error.message : "D1");
    return publicReply(request, { error: "unavailable" }, 503);
  }
}

export async function arcadeLeaderboard(request, db, now = Date.now()) {
  if (!db) return reply({ error: "unavailable" }, 503);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return reply({ error: "origin" }, 403);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return reply({ error: "size" }, 413);
    body = JSON.parse(raw);
  } catch {
    return reply({ error: "request" }, 400);
  }

  const game = typeof body?.game === "string" && validGames.has(body.game) ? body.game : "";
  const mode = typeof body?.mode === "string" && /^[a-z0-9_-]{1,18}$/i.test(body.mode) ? body.mode.toLowerCase() : "standard";
  const action = body?.action === "submit" ? "submit" : "list";
  if (!game) return reply({ error: "game" }, 400);

  try {
    await ensureTable(db);
    const lowerIsBetter = game === "mines";
    const ops = [];

    if (action === "submit") {
      if (typeof body.member !== "string" || !uuid.test(body.member)) return reply({ error: "member" }, 400);
      const score = Number(body.score);
      if (!Number.isInteger(score) || score < 1 || score > 9_999_999) return reply({ error: "score" }, 400);
      const memberId = await fingerprint(body.member);
      const rawName = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 12) : "";
      const nickname = /^[\p{L}\p{N} _·-]{1,12}$/u.test(rawName) ? rawName : "단골 " + memberId.slice(0, 4).toUpperCase();
      const metric = typeof body.metric === "string" ? body.metric.slice(0, 24) : "";

      ops.push(db.prepare(`INSERT INTO cafe_leaderboard (id, game, mode, member_id, nickname, score, metric, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game, mode, member_id) DO UPDATE SET
          nickname = excluded.nickname,
          metric = CASE WHEN ${lowerIsBetter ? "excluded.score < cafe_leaderboard.score" : "excluded.score > cafe_leaderboard.score"}
            THEN excluded.metric ELSE cafe_leaderboard.metric END,
          updated_at = CASE WHEN ${lowerIsBetter ? "excluded.score < cafe_leaderboard.score" : "excluded.score > cafe_leaderboard.score"}
            THEN excluded.updated_at ELSE cafe_leaderboard.updated_at END,
          score = ${lowerIsBetter ? "MIN(cafe_leaderboard.score, excluded.score)" : "MAX(cafe_leaderboard.score, excluded.score)"}`)
        .bind(crypto.randomUUID(), game, mode, memberId, nickname, score, metric, now));
    }

    ops.push(db.prepare(`SELECT nickname, score, metric, updated_at FROM cafe_leaderboard
      WHERE game = ? AND mode = ?
      ORDER BY score ${lowerIsBetter ? "ASC" : "DESC"}, updated_at ASC LIMIT 10`)
      .bind(game, mode));

    const results = await db.batch(ops);
    const entries = results.at(-1).results.map((row, index) => ({
      rank: index + 1,
      nickname: row.nickname,
      score: row.score,
      metric: row.metric,
      updatedAt: row.updated_at,
    }));
    return reply({ game, mode, lowerIsBetter, entries });
  } catch (error) {
    console.error("Leaderboard error", error instanceof Error ? error.message : "D1");
    return reply({ error: "unavailable" }, 503);
  }
}
