(() => {
  "use strict";

  // Single Source of Truth for Gilmotungi PC Bang World Layout, Seat Coordinates, and Landmarks
  // All coordinates below use canonical 1536x1024 space (converted cleanly to % and 1152x768 world pixels).
  const canonical = { width: 1536, height: 1024 };
  const world = { width: 1152, height: 768, legacyWidth: 768, legacyHeight: 512, scale: 1.5 };

  const hallBanks = [
    { letter: "A", x: [428, 491], spineX: 231 },
    { letter: "B", x: [651, 714], spineX: 343 },
    { letter: "C", x: [892, 955], spineX: 463 },
    { letter: "D", x: [1133, 1196], spineX: 584 },
  ];
  const hallRows = [196, 244, 291, 338, 386, 434, 481, 529, 577, 626, 675];
  const bankSize = hallRows.length * 2;

  const spaces = {
    hall: {
      label: "일반석",
      positions: hallBanks.flatMap(({ x }) => hallRows.flatMap((y) => x.map((column) => [column / 15.36, y / 10.24]))),
    },
    solo: {
      label: "1인석",
      alt: "따뜻한 회색 칸막이와 게이밍 PC 한 대가 있는 픽셀 아트 1인석",
      positions: [[53.1, 38.8]],
    },
    duo: {
      label: "2인석",
      alt: "옅은 세이지색 의자와 게이밍 PC 두 대가 나란히 놓인 픽셀 아트 2인석",
      positions: [[36.8, 40.5], [65.2, 40.5]],
    },
    team: {
      label: "5인룸",
      alt: "회보라색 의자와 게이밍 PC 다섯 대가 한 줄로 놓인 픽셀 아트 팀 룸",
      positions: [[22.1, 40.4], [37.8, 40.4], [53.3, 40.4], [69.1, 40.4], [84.6, 40.4]],
    },
    squad: {
      label: "6인룸",
      alt: "회색 의자와 게이밍 PC 여섯 대가 두 줄로 놓인 픽셀 아트 스쿼드 룸",
      positions: [[32.8, 22.7], [53.6, 22.7], [74.7, 22.7], [28.7, 49.4], [53.3, 49.4], [77.8, 49.4]],
    },
  };

  // Shared 768-space landmark anchors used identically by renderer (cafe-art.js) & seatmap UI (app.js)
  const landmarks = {
    booth: { label: "실내 흡연구역", x: 82, y: 56 },
    terrace: { label: "야외 흡연구역", x: 660, y: 52 },
    lounge: { label: "대기 라운지", x: 126, y: 159, w: 52, h: 95 },
    counter: { label: "오픈키친", x: 48, y: 295, w: 99, h: 93 },
    kiosk: { label: "키오스크", x: 186, y: 386, w: 28, h: 36 },
    // 매장 게시판(건의·오류 제보): 오른쪽 아래 구석, 통행 영역(x <= 85.4%) 바깥에 세워 둔다.
    // 상호작용 지점은 lib/cafe-world.mjs 의 noticeBoard, 버튼 위치는 cafe-board.css 의 .board-pin 과 맞춘다.
    board: { label: "게시판", x: 688, y: 408, w: 42, h: 50 },
    entrance: { label: "입구", x: 241, y: 457, w: 36, h: 30, rugX: 224, rugY: 432, rugW: 71, rugH: 29 },
    // 리뉴얼 시안 규격(벽 두께·문틀·문턱)으로 그리는 벽 있는 룸. 문은 동쪽 벽에 있고 doorY 가 문 중심이다.
    // doorY 는 lib/cafe-world.mjs 의 roomPortals[<key>].y (퍼센트 × 5.12) 와 맞춘다. 좌석 키는 건드리지 않는다.
    rooms: {
      solo: { label: "1인석", x: 35, y: 96, w: 85, h: 74, doorY: 129, pcs: 1 },
      duo: { label: "2인석", x: 35, y: 234, w: 85, h: 46, doorY: 270, pcs: 2 },
    },
    alcoves: [
      { x: 657, y: 165, w: 69, h: 53 },
      { x: 657, y: 307, w: 69, h: 47 },
    ],
    plants: [
      [170, 449], [327, 449], [651, 449], [99, 448], [145, 83], [62, 208], [98, 222],
      [267, 386], [382, 386], [500, 386], [623, 386], [664, 420],
    ],
  };

  function toPct(x, y) {
    return {
      xPct: (x / world.legacyWidth) * 100,
      yPct: (y / world.legacyHeight) * 100,
    };
  }

  window.cafeLayout = {
    canonical,
    world,
    hallBanks,
    hallRows,
    bankSize,
    spaces,
    landmarks,
    toPct,
  };
})();
