// Shared Real-Time Hall Leaderboard Client Widget & Score Submitter
import { NYANGDABANG, fetchNyangdabangRank } from "./nyangdabang-link.js";

function getMemberToken() {
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

function getNickname() {
  try { return (localStorage.getItem("neon-cafe-nickname") || "").trim(); } catch { return ""; }
}

export async function fetchLeaderboard(game, mode = "standard") {
  const res = await fetch("./api/arcade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list", game, mode }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error("leaderboard");
  return res.json();
}

export async function submitArcadeScore(game, score, { mode = "standard", metric = "" } = {}) {
  if (!Number.isInteger(score) || score <= 0) return null;
  try {
    const res = await fetch("./api/arcade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        game,
        mode,
        member: getMemberToken(),
        nickname: getNickname(),
        score,
        metric,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    document.dispatchEvent(new CustomEvent("arcade-leaderboard-updated", { detail: { game, mode, data } }));
    return data;
  } catch {
    return null;
  }
}

export function mountLeaderboardBox(dialogEl, game, getMode = () => "standard", formatScore = (s, m) => m || `${s.toLocaleString()}점`) {
  if (!dialogEl || dialogEl.querySelector(".arcade-rank-box")) return { refresh: () => {} };
  const inner = dialogEl.querySelector(".dialog-inner") || dialogEl;
  const details = document.createElement("details");
  details.className = "arcade-rank-box";
  details.innerHTML = `
    <summary class="mono">🏆 매장 실시간 TOP 5 랭킹</summary>
    <div class="arcade-rank-tabs" role="tablist" aria-label="랭킹 종류">
      <button type="button" role="tab" class="arcade-rank-tab" data-rank-tab="pcbang" aria-selected="true">길모퉁이PC방</button>
      <button type="button" role="tab" class="arcade-rank-tab" data-rank-tab="nyang" aria-selected="false"></button>
    </div>
    <ol class="arcade-rank-list"><li class="empty">랭킹을 불러오는 중...</li></ol>
    <p class="arcade-rank-note" hidden></p>`;
  inner.append(details);
  const list = details.querySelector(".arcade-rank-list");
  const note = details.querySelector(".arcade-rank-note");
  const tabs = [...details.querySelectorAll(".arcade-rank-tab")];
  tabs[1].textContent = NYANGDABANG.name;
  let activeTab = "pcbang";

  function showMessage(text) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    list.replaceChildren(li);
  }

  // 이웃 게임(냥다방) 주간 랭킹: 읽기만 한다. 실패해도 게임은 그대로 계속된다.
  async function refreshNyang() {
    showMessage("랭킹을 불러오는 중...");
    note.hidden = true;
    try {
      const data = await fetchNyangdabangRank();
      if (activeTab !== "nyang") return;
      if (!data.ranks.length) showMessage("아직 기록이 없어요.");
      else renderEntries(data.ranks, (score) => `${score.toLocaleString()}점`);
      note.replaceChildren();
      const link = document.createElement("a");
      link.href = NYANGDABANG.home;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `${NYANGDABANG.name} 놀러 가기 ↗`;
      note.append(`${NYANGDABANG.name} 머지${data.week ? ` · ${data.week}` : ""} · `, link);
      note.hidden = false;
    } catch {
      if (activeTab === "nyang") showMessage("랭킹을 불러오지 못했어요");
    }
  }

  function selectTab(next) {
    activeTab = next;
    for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.rankTab === next));
    if (next === "nyang") refreshNyang();
    else {
      note.hidden = true;
      showMessage("랭킹을 불러오는 중...");
      refresh();
    }
  }
  for (const tab of tabs) tab.addEventListener("click", () => selectTab(tab.dataset.rankTab));

  function renderEntries(entries = [], format = formatScore) {
    if (!entries.length) {
      list.innerHTML = `<li class="empty">아직 첫 기록이 없어요. 1등에 도전하세요!</li>`;
      return;
    }
    list.replaceChildren(...entries.slice(0, 5).map((e) => {
      const li = document.createElement("li");
      const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : `#${e.rank}`;
      const rankSpan = document.createElement("span");
      rankSpan.className = "rk mono";
      rankSpan.textContent = medal;
      const nameStrong = document.createElement("strong");
      nameStrong.textContent = e.nickname;
      const valSpan = document.createElement("em");
      valSpan.className = "mono";
      valSpan.textContent = format(e.score, e.metric);
      li.append(rankSpan, nameStrong, valSpan);
      return li;
    }));
  }

  async function refresh() {
    if (!dialogEl.open || !details.open) return;
    if (activeTab === "nyang") return refreshNyang();
    try {
      const data = await fetchLeaderboard(game, getMode());
      if (activeTab === "pcbang") renderEntries(data.entries);
    } catch {
      if (activeTab === "pcbang") list.innerHTML = `<li class="empty">오프라인 상태예요.</li>`;
    }
  }

  details.addEventListener("toggle", () => { if (details.open) refresh(); });
  document.addEventListener("arcade-leaderboard-updated", ({ detail }) => {
    if (activeTab === "pcbang" && detail.game === game && detail.mode === getMode()) renderEntries(detail.data.entries);
  });
  // 게임 안에서 모드(규칙·난이도)를 바꾸면 해당 모드 랭킹으로 다시 읽는다.
  document.addEventListener("arcade-leaderboard-mode-changed", ({ detail }) => {
    if (detail?.game === game) refresh();
  });
  return { refresh };
}
