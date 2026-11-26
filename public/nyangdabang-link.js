// 이웃 게임 "냥다방 머지" 연동 설정. 주소가 바뀌면 이 파일만 고치면 된다.
// (런처 바로가기의 href 는 app/cafe.html 의 .pc-app-link 에도 같은 주소가 적혀 있다.)
export const NYANGDABANG = Object.freeze({
  name: "냥다방",
  home: "https://nyangdabang.epsiloneri.com/",
  // 읽기 전용 공개 랭킹. 응답: { game, metric, week, ranks: [{ rank, nickname, score }] }
  rankApi: "https://nyangdabang.epsiloneri.com/api/public/rank?limit=10",
});

let cached = null;
let cachedAt = 0;

// 실패하면 예외를 던진다. 부르는 쪽에서 "랭킹을 불러오지 못했어요" 로 조용히 처리한다.
export async function fetchNyangdabangRank() {
  if (cached && Date.now() - cachedAt < 60_000) return cached;
  const res = await fetch(NYANGDABANG.rankApi, {
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error("nyangdabang-rank");
  const data = await res.json();
  if (!Array.isArray(data?.ranks)) throw new Error("nyangdabang-rank");
  cached = {
    week: typeof data.week === "string" || typeof data.week === "number" ? String(data.week).slice(0, 24) : "",
    ranks: data.ranks.slice(0, 10).map((row, index) => ({
      rank: Number.isInteger(row?.rank) ? row.rank : index + 1,
      nickname: String(row?.nickname ?? "").slice(0, 20) || "손님",
      score: Number.isFinite(Number(row?.score)) ? Number(row.score) : 0,
    })),
  };
  cachedAt = Date.now();
  return cached;
}
