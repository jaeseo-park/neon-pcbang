// 케이크 정리 — 화면·입력 (규칙은 cake-sort-engine.mjs)
import {
  CAKE_CELLS,
  CAKE_FLAVORS,
  PLATE_SIZE,
  createCakeGame,
  findCakeHint,
  flavorsInPlay,
  placeCakePlate,
  plateSlices,
  sweepCakeCell,
} from "./cake-sort-engine.mjs";
import { mountLeaderboardBox, submitArcadeScore } from "./arcade-leaderboard.js";

const flavorById = new Map(CAKE_FLAVORS.map((flavor) => [flavor.id, flavor]));
const bestKey = "neon-pcbang-cake-best";

export function initCakeSort() {
  const dialog = document.getElementById("cake");
  const boardEl = document.getElementById("cake-board");
  const queueEl = document.getElementById("cake-queue");
  const scoreEl = document.getElementById("cake-score");
  const cakesEl = document.getElementById("cake-count");
  const bestEl = document.getElementById("cake-best");
  const legendEl = document.getElementById("cake-legend");
  const statusEl = document.getElementById("cake-status");
  const hintBtn = document.getElementById("cake-hint");
  const sweepBtn = document.getElementById("cake-sweep");
  const sweepCountEl = document.getElementById("cake-sweep-count");
  const newBtn = document.getElementById("cake-new");

  mountLeaderboardBox(dialog, "cake", () => "standard", (s, m) => `${s.toLocaleString()}점${m ? ` (${m})` : ""}`);

  let game = createCakeGame();
  let picked = 0;
  let sweeping = false;
  let hint = null;
  let flash = new Map(); // cell -> 방금 완성된 케이크 맛
  let reported = false;
  let best = 0;
  try { best = Number(localStorage.getItem(bestKey)) || 0; } catch {}

  function plateLabel(plate) {
    return Object.entries(plate).map(([id, count]) => `${flavorById.get(id).name} ${count}조각`).join(", ");
  }

  // 접시 = 2x3 픽셀 칸. 조각마다 색 + 기호를 함께 그린다.
  function plateNode(plate) {
    const wrap = document.createElement("span");
    wrap.className = "cake-plate";
    wrap.setAttribute("aria-hidden", "true");
    const slices = plate ? plateSlices(plate) : [];
    for (let i = 0; i < PLATE_SIZE; i++) {
      const slot = document.createElement("i");
      const flavor = flavorById.get(slices[i]);
      if (flavor) {
        slot.className = "cake-slice";
        slot.style.setProperty("--fill", flavor.fill);
        slot.style.setProperty("--hi", flavor.hi);
        slot.style.setProperty("--ink", flavor.ink);
        slot.textContent = flavor.mark;
      }
      wrap.append(slot);
    }
    return wrap;
  }

  function firstPlateIndex() {
    return game.queue.findIndex(Boolean);
  }

  function render() {
    scoreEl.textContent = game.score.toLocaleString();
    cakesEl.textContent = String(game.cakes);
    bestEl.textContent = Math.max(best, game.score).toLocaleString();
    sweepCountEl.textContent = String(game.sweeps);
    sweepBtn.disabled = game.sweeps <= 0 || !game.board.some(Boolean);
    sweepBtn.setAttribute("aria-pressed", String(sweeping));
    hintBtn.disabled = game.over;
    if (!game.queue[picked]) picked = Math.max(0, firstPlateIndex());

    legendEl.replaceChildren(...CAKE_FLAVORS.slice(0, flavorsInPlay(game.cakes)).map((flavor) => {
      const item = document.createElement("span");
      item.className = "cake-legend-item";
      const chip = document.createElement("i");
      chip.className = "cake-slice";
      chip.style.setProperty("--fill", flavor.fill);
      chip.style.setProperty("--hi", flavor.hi);
      chip.style.setProperty("--ink", flavor.ink);
      chip.textContent = flavor.mark;
      item.append(chip, flavor.name);
      return item;
    }));

    const cells = [];
    for (let cell = 0; cell < CAKE_CELLS; cell++) {
      const plate = game.board[cell];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cake-cell" + (plate ? " filled" : "");
      btn.dataset.hint = String(Boolean(hint && hint.cell === cell));
      if (flash.has(cell)) {
        btn.classList.add("is-done");
        btn.style.setProperty("--fill", flavorById.get(flash.get(cell)).fill);
      }
      btn.setAttribute("aria-label", `${Math.floor(cell / 4) + 1}행 ${cell % 4 + 1}열, ${plate ? plateLabel(plate) : "빈 자리"}`);
      btn.append(plateNode(plate));
      btn.disabled = game.over || (sweeping ? !plate : Boolean(plate));
      btn.addEventListener("click", () => onCell(cell));
      cells.push(btn);
    }
    boardEl.replaceChildren(...cells);

    queueEl.replaceChildren(...game.queue.map((plate, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cake-queue-plate";
      btn.disabled = !plate || game.over;
      btn.setAttribute("aria-pressed", String(Boolean(plate) && index === picked && !sweeping));
      btn.dataset.hint = String(Boolean(hint && hint.queueIndex === index));
      btn.setAttribute("aria-label", plate ? `대기 접시 ${index + 1}: ${plateLabel(plate)}` : `대기 접시 ${index + 1}: 비어 있음`);
      btn.append(plateNode(plate));
      btn.addEventListener("click", () => {
        picked = index;
        sweeping = false;
        hint = null;
        statusEl.textContent = "놓을 빈 자리를 눌러 주세요.";
        render();
      });
      return btn;
    }));
  }

  function finish() {
    if (reported) return;
    reported = true;
    if (game.score > best) {
      best = game.score;
      try { localStorage.setItem(bestKey, String(best)); } catch {}
    }
    window.recordCafeStamp?.("game");
    if (game.score >= 300) {
      window.cafeEarnPoints?.(Math.min(50, 10 + game.cakes * 4), "케이크 정리");
      submitArcadeScore("cake", game.score, { metric: `케이크 ${game.cakes}개` });
    }
  }

  function onCell(cell) {
    hint = null;
    if (sweeping) {
      if (sweepCakeCell(game, cell).ok) {
        sweeping = false;
        window.cafeAudioPlay?.("pop");
        statusEl.textContent = "접시 하나를 치웠어요.";
      }
      render();
      return;
    }
    const result = placeCakePlate(game, picked, cell);
    if (!result.ok) {
      statusEl.textContent = result.reason === "occupied" ? "이미 접시가 있는 자리예요." : "먼저 아래에서 접시를 골라 주세요.";
      return;
    }
    const made = result.events.filter((event) => event.type === "cake");
    flash = new Map(made.map((event) => [event.cell, event.flavor]));
    window.cafeAudioPlay?.(made.length ? "chime" : result.events.length ? "pop" : "tick");
    if (game.over) {
      if (game.sweeps > 0) {
        statusEl.textContent = "자리가 꽉 찼어요! '접시 치우기'로 한 자리를 비우거나 새 게임을 시작하세요.";
      } else {
        statusEl.textContent = `자리가 꽉 찼어요. 케이크 ${game.cakes}개 · ${game.score.toLocaleString()}점!`;
        finish();
      }
    } else if (made.length) {
      statusEl.textContent = `🎂 ${made.map((event) => flavorById.get(event.flavor).name).join("·")} 케이크 완성! +${result.gained}점`;
    } else if (result.events.length) {
      statusEl.textContent = `같은 맛 조각이 모였어요. +${result.gained}점`;
    } else {
      statusEl.textContent = "접시를 놓았어요. 같은 맛 접시 옆에 놓으면 조각이 모여요.";
    }
    render();
    flash = new Map();
  }

  function start() {
    if (game.moves > 0 && !reported) finish();
    game = createCakeGame();
    picked = 0;
    sweeping = false;
    hint = null;
    flash = new Map();
    reported = false;
    statusEl.textContent = "아래 접시를 고르고 빈 자리에 놓으세요. 같은 맛 6조각이 모이면 케이크 완성!";
    render();
  }

  hintBtn.addEventListener("click", () => {
    hint = findCakeHint(game);
    sweeping = false;
    if (hint) {
      picked = hint.queueIndex;
      statusEl.textContent = "💡 반짝이는 접시를 반짝이는 자리에 놓아 보세요.";
    } else {
      statusEl.textContent = "놓을 수 있는 자리가 없어요.";
    }
    render();
  });
  sweepBtn.addEventListener("click", () => {
    sweeping = !sweeping;
    hint = null;
    statusEl.textContent = sweeping ? "치울 접시를 눌러 주세요. (다시 누르면 취소)" : "접시 치우기를 취소했어요.";
    render();
  });
  newBtn.addEventListener("click", start);

  new MutationObserver(() => {
    window.cafeWorld?.setActivity(dialog.open ? "game:cake" : "");
  }).observe(dialog, { attributes: true, attributeFilter: ["open"] });

  window.cafeWorld?.setActivity("game:cake");
  start();
}
