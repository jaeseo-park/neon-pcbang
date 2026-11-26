import { env } from "cloudflare:workers";
import { publicRank } from "../../../../lib/cafe-arcade.mjs";

export const dynamic = "force-dynamic";

// Read-only public leaderboard for the neighbouring game (see lib/cafe-arcade.mjs).
export function GET(request: Request) {
  return publicRank(request, env.DB);
}
