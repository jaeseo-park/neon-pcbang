// 매장 게시판 (건의 · 오류 제보)
// - 누구나(입장한 손님) 목록을 보고 글을 쓸 수 있다. 받는 정보는 닉네임과 내용뿐이다.
// - 처리 상태 변경·숨김·삭제는 관리자 세션(/admin 로그인)일 때만 서버가 허용한다.
//   관리자 여부는 route 에서 invite-gate 의 세션으로 확인해 isAdmin 으로 넘겨준다(클라이언트 값은 믿지 않는다).
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const initializedDbs = new WeakSet();

export const BOARD_CATEGORIES = Object.freeze({ suggestion: "건의", bug: "오류 제보" });
// 새 글은 waiting(대기). 나머지 셋은 관리자만 고를 수 있다. 표시 이름은 public/cafe-board.js 에 있다.
export const BOARD_STATUSES = Object.freeze(["waiting", "accepted", "rejected", "hold"]);
export const BOARD_LIMITS = Object.freeze({ bodyMin: 2, bodyMax: 300, contextMax: 160, perDay: 5, list: 100 });

function reply(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function fingerprint(token) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("board:" + token));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureTable(db) {
  if (initializedDbs.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS board_posts (
      id TEXT PRIMARY KEY NOT NULL,
      category TEXT NOT NULL,
      nickname TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      hidden INTEGER NOT NULL DEFAULT 0,
      author_id TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      status_updated_at INTEGER
    )`).bind(),
    db.prepare(`CREATE INDEX IF NOT EXISTS board_posts_recent ON board_posts(hidden, created_at DESC)`).bind(),
    db.prepare(`CREATE INDEX IF NOT EXISTS board_posts_author ON board_posts(author_id, created_at)`).bind(),
  ]);
  initializedDbs.add(db);
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

async function listPosts(db, isAdmin) {
  const { results } = await db.prepare(`SELECT id, category, nickname, body, status, hidden, context, created_at, status_updated_at
    FROM board_posts ${isAdmin ? "" : "WHERE hidden = 0"}
    ORDER BY created_at DESC LIMIT ?`).bind(BOARD_LIMITS.list).all();
  return results.map((row) => ({
    id: row.id,
    category: row.category,
    nickname: row.nickname,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    statusAt: row.status_updated_at ?? null,
    // 숨김 여부와 자동 첨부 정보(브라우저·화면 크기·마지막 미니게임)는 관리자에게만 보인다.
    ...(isAdmin ? { hidden: Boolean(row.hidden), context: row.context } : {}),
  }));
}

export async function boardApi(request, db, isAdmin = false, now = Date.now()) {
  if (!db) return reply({ error: "unavailable" }, 503);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") return reply({ error: "origin" }, 403);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return reply({ error: "size" }, 413);
    body = JSON.parse(raw);
  } catch {
    return reply({ error: "request" }, 400);
  }
  const action = typeof body?.action === "string" ? body.action : "list";
  const admin = isAdmin === true;

  try {
    await ensureTable(db);

    if (action === "list") {
      return reply({ admin, limits: BOARD_LIMITS, posts: await listPosts(db, admin) });
    }

    if (action === "create") {
      if (typeof body.member !== "string" || !uuid.test(body.member)) return reply({ error: "member" }, 400);
      if (!Object.hasOwn(BOARD_CATEGORIES, body.category)) return reply({ error: "category" }, 400);
      const text = cleanText(body.body, BOARD_LIMITS.bodyMax + 1);
      if (text.length < BOARD_LIMITS.bodyMin || text.length > BOARD_LIMITS.bodyMax) return reply({ error: "body" }, 400);
      const authorId = await fingerprint(body.member);
      const rawName = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 12) : "";
      const nickname = /^[\p{L}\p{N} _·-]{1,12}$/u.test(rawName) ? rawName : "손님 " + authorId.slice(0, 4).toUpperCase();
      const context = body.category === "bug" ? cleanText(body.context, BOARD_LIMITS.contextMax).replace(/\n/g, " ") : "";

      // 도배 방지: 같은 브라우저(멤버 토큰) 또는 같은 닉네임으로 24시간에 perDay 건까지
      const since = now - 86400_000;
      const recent = await db.prepare(`SELECT
          SUM(CASE WHEN author_id = ? THEN 1 ELSE 0 END) AS by_author,
          SUM(CASE WHEN nickname = ? THEN 1 ELSE 0 END) AS by_name
        FROM board_posts WHERE created_at > ?`).bind(authorId, nickname, since).first();
      if ((recent?.by_author ?? 0) >= BOARD_LIMITS.perDay || (recent?.by_name ?? 0) >= BOARD_LIMITS.perDay) {
        return reply({ error: "limit", perDay: BOARD_LIMITS.perDay }, 429);
      }

      await db.prepare(`INSERT INTO board_posts (id, category, nickname, body, status, hidden, author_id, context, created_at)
        VALUES (?, ?, ?, ?, 'waiting', 0, ?, ?, ?)`)
        .bind(crypto.randomUUID(), body.category, nickname, text, authorId, context, now).run();
      return reply({ admin, limits: BOARD_LIMITS, posts: await listPosts(db, admin) });
    }

    // ── 여기부터 관리자 전용 ──
    if (action === "status" || action === "hide" || action === "delete") {
      if (!admin) return reply({ error: "forbidden" }, 403);
      const id = typeof body.id === "string" && uuid.test(body.id) ? body.id : "";
      if (!id) return reply({ error: "id" }, 400);
      let changed;
      if (action === "status") {
        if (!BOARD_STATUSES.includes(body.status)) return reply({ error: "status" }, 400);
        changed = await db.prepare("UPDATE board_posts SET status = ?, status_updated_at = ? WHERE id = ?")
          .bind(body.status, now, id).run();
      } else if (action === "hide") {
        changed = await db.prepare("UPDATE board_posts SET hidden = ? WHERE id = ?")
          .bind(body.hidden ? 1 : 0, id).run();
      } else {
        changed = await db.prepare("DELETE FROM board_posts WHERE id = ?").bind(id).run();
      }
      if (!changed?.meta?.changes) return reply({ error: "not_found" }, 404);
      return reply({ admin, limits: BOARD_LIMITS, posts: await listPosts(db, admin) });
    }

    return reply({ error: "request" }, 400);
  } catch (error) {
    console.error("Board error", error instanceof Error ? error.message : "D1");
    return reply({ error: "unavailable" }, 503);
  }
}
