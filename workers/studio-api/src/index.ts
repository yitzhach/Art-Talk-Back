// studio-api — Hono app arrives in Phase 1, step 3. Until then every request
// gets the spec's error shape.
import { apiError } from "@studio/core";

export default {
  async fetch(): Promise<Response> {
    return Response.json(apiError("not_found", "studio-api is not built yet"), { status: 404 });
  },
} satisfies ExportedHandler;
