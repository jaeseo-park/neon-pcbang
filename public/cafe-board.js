// 매장 게시판 창 (건의 · 오류 제보). 서버 규칙은 lib/cafe-board.mjs.
// 상태 변경·숨김·삭제 버튼은 서버가 admin: true 라고 답했을 때만 그리며, 서버도 요청마다 관리자 세션을 다시 확인한다.
const CATEGORY_LABELS = { suggestion: "건의", bug: "오류 제보" };
// 처리 상태 표시 이름. 색 + 기호를 함께 써서 색만으로 구분하지 않는다.
export const BOARD_STATUS_LABELS = Object.freeze({
  waiting: { label: "대기", mark: "…" },
  accepted: { label: "반영", mark: "✔" },
  rejected: { label: "꺼져", mark: "✖" },
  hold: { label: "보류", mark: "Ⅱ" },
});
const GAME_NAMES = {
  pvp: "모퉁이 대국장", tetris: "블록 드롭", bungeoppang: "붕어빵 포차", "snack-tycoon": "매점 러시",
  acidrain: "산성비", mines: "지뢰찾기", arcade: "벽돌깨기", merge: "2048", sudoku: "스도쿠",
  solitaire: "솔리테어", knit: "실풀기", cake: "케이크 정리",
};
const ERRORS = {
  limit: "오늘은 글을 충분히 남기셨어요. 내일 다시 남겨 주세요. (하루 5건)",
  body: "내용을 2자 이상 300자 이하로 적어 주세요.",
  forbidden: "관리자만 할 수 있어요. 관리자 로그인이 풀렸는지 확인해 주세요.",
  invitation_required: "입장 인증이 필요해요. 페이지를 새로고침해 주세요.",
};

function memberToken() {
  try {
    let token = localStorage.getItem("corner-cafe-member");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("corner-cafe-member", token);
    }
    return token;
  } catch {
    return crypto.randomUUID();
  }
}

function nickname() {
  try { return (localStorage.getItem("neon-cafe-nickname") || "").trim(); } catch { return ""; }
}

function browserName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "기타";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung" : /Whale/.test(ua) ? "Whale"
    : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "기타";
  return `${os} ${browser}`;
}

// 오류 제보에만 자동으로 붙는 디버깅 정보. 개인을 알아볼 수 있는 값은 넣지 않는다.
function bugContext() {
  const last = window.cafeLastGame ? (GAME_NAMES[window.cafeLastGame] || window.cafeLastGame) : "없음";
  return `${browserName()} · 화면 ${window.innerWidth}×${window.innerHeight} · 마지막 게임: ${last}`;
}

function formatTime(ms) {
  try {
    return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
  } catch {
    return "";
  }
}

export function initCafeBoard() {
  const dialog = document.getElementById("board");
  const listEl = document.getElementById("board-list");
  const statusEl = document.getElementById("board-status");
  const form = document.getElementById("board-form");
  const openBtn = document.getElementById("board-write-open");
  const cancelBtn = document.getElementById("board-cancel");
  const categoryEl = document.getElementById("board-category");
  const bodyEl = document.getElementById("board-body");
  const countEl = document.getElementById("board-count");
  const contextNote = document.getElementById("board-context-note");
  const filterCategory = document.getElementById("board-filter-category");
  const filterStatus = document.getElementById("board-filter-status");

  let posts = [];
  let admin = false;
  let busy = false;

  async function call(action, extra = {}) {
    const res = await fetch("./api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error("board"), { code: data?.error || "" });
    return data;
  }

  function apply(data) {
    posts = Array.isArray(data?.posts) ? data.posts : [];
    admin = data?.admin === true;
    render();
  }

  function badge(status) {
    const info = BOARD_STATUS_LABELS[status] || BOARD_STATUS_LABELS.waiting;
    const el = document.createElement("span");
    el.className = "board-badge";
    el.dataset.status = status;
    el.textContent = `${info.mark} ${info.label}`;
    return el;
  }

  function adminTools(post) {
    const tools = document.createElement("div");
    tools.className = "board-admin";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "처리 상태 바꾸기");
    for (const [value, info] of Object.entries(BOARD_STATUS_LABELS)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = info.label;
      opt.selected = value === post.status;
      select.append(opt);
    }
    select.addEventListener("change", () => run("status", { id: post.id, status: select.value }, "처리 상태를 바꿨어요."));
    const hide = document.createElement("button");
    hide.type = "button";
    hide.className = "walk-button";
    hide.textContent = post.hidden ? "숨김 해제" : "숨기기";
    hide.addEventListener("click", () => run("hide", { id: post.id, hidden: !post.hidden }, post.hidden ? "다시 보이게 했어요." : "글을 숨겼어요."));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "walk-button board-danger";
    remove.textContent = "삭제";
    remove.addEventListener("click", () => {
      if (remove.dataset.armed !== "true") {
        remove.dataset.armed = "true";
        remove.textContent = "정말 삭제";
        return;
      }
      run("delete", { id: post.id }, "글을 삭제했어요.");
    });
    tools.append(select, hide, remove);
    return tools;
  }

  function render() {
    const shown = posts.filter((post) =>
      (!filterCategory.value || post.category === filterCategory.value) &&
      (!filterStatus.value || post.status === filterStatus.value));
    if (!shown.length) {
      const empty = document.createElement("li");
      empty.className = "board-empty";
      empty.textContent = posts.length ? "조건에 맞는 글이 없어요." : "아직 글이 없어요. 첫 글을 남겨 보세요!";
      listEl.replaceChildren(empty);
      return;
    }
    listEl.replaceChildren(...shown.map((post) => {
      const li = document.createElement("li");
      li.className = "board-post" + (post.hidden ? " is-hidden" : "");
      const head = document.createElement("div");
      head.className = "board-post-head";
      const tag = document.createElement("span");
      tag.className = "board-tag";
      tag.dataset.category = post.category;
      tag.textContent = CATEGORY_LABELS[post.category] || post.category;
      const name = document.createElement("strong");
      name.textContent = post.nickname;
      const time = document.createElement("time");
      time.className = "mono";
      time.textContent = formatTime(post.createdAt);
      head.append(tag, name, time, badge(post.status));
      const body = document.createElement("p");
      body.className = "board-body";
      body.textContent = post.body;
      li.append(head, body);
      if (admin) {
        if (post.context) {
          const context = document.createElement("p");
          context.className = "board-context mono";
          context.textContent = post.context;
          li.append(context);
        }
        if (post.hidden) {
          const hiddenNote = document.createElement("p");
          hiddenNote.className = "board-context";
          hiddenNote.textContent = "숨긴 글 (손님에게는 보이지 않아요)";
          li.append(hiddenNote);
        }
        li.append(adminTools(post));
      }
      return li;
    }));
  }

  async function run(action, extra, done) {
    if (busy) return;
    busy = true;
    try {
      apply(await call(action, extra));
      statusEl.textContent = done;
    } catch (error) {
      statusEl.textContent = ERRORS[error.code] || "처리하지 못했어요. 잠시 뒤 다시 해 주세요.";
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    if (!dialog.open) return;
    try {
      apply(await call("list"));
      statusEl.textContent = admin ? "관리자 모드: 글마다 처리 상태를 바꾸거나 숨김·삭제할 수 있어요." : "";
    } catch (error) {
      statusEl.textContent = ERRORS[error.code] || "게시판을 불러오지 못했어요.";
    }
  }

  function setFormOpen(open) {
    form.hidden = !open;
    openBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      syncContextNote();
      bodyEl.focus();
    }
  }

  function syncContextNote() {
    const isBug = categoryEl.value === "bug";
    contextNote.hidden = !isBug;
    if (isBug) contextNote.textContent = `자동으로 함께 보내요(관리자만 봄): ${bugContext()}`;
  }

  openBtn.addEventListener("click", () => setFormOpen(form.hidden));
  cancelBtn.addEventListener("click", () => setFormOpen(false));
  categoryEl.addEventListener("change", syncContextNote);
  bodyEl.addEventListener("input", () => { countEl.textContent = `${bodyEl.value.length} / 300`; });
  filterCategory.addEventListener("change", render);
  filterStatus.addEventListener("change", render);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = bodyEl.value.trim();
    if (text.length < 2) {
      statusEl.textContent = ERRORS.body;
      return;
    }
    if (busy) return;
    busy = true;
    try {
      apply(await call("create", {
        member: memberToken(),
        nickname: nickname(),
        category: categoryEl.value,
        body: text,
        context: categoryEl.value === "bug" ? bugContext() : "",
      }));
      bodyEl.value = "";
      countEl.textContent = "0 / 300";
      setFormOpen(false);
      statusEl.textContent = "글을 남겼어요. 고마워요!";
      window.cafeAudioPlay?.("pop");
    } catch (error) {
      statusEl.textContent = ERRORS[error.code] || "글을 남기지 못했어요. 잠시 뒤 다시 해 주세요.";
    } finally {
      busy = false;
    }
  });

  new MutationObserver(() => { if (dialog.open) refresh(); })
    .observe(dialog, { attributes: true, attributeFilter: ["open"] });
  refresh();
}
