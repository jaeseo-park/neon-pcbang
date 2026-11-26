import { env } from "cloudflare:workers";
import { boardApi } from "../../../lib/cafe-board.mjs";
import { isAdminRequest } from "../../../lib/invite-gate";

export const dynamic = "force-dynamic";

// The admin flag comes from the server-side /admin session only, never from the request body.
export async function POST(request: Request) {
  return boardApi(request, env.DB, await isAdminRequest(request, env.DB));
}
