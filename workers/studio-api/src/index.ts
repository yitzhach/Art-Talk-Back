// studio-api: the only thing that touches the database.
import { OpenAPIHono } from "@hono/zod-openapi";
import { apiError } from "@studio/core";
import "./actions/records";
import "./actions/undo";
import "./actions/files";
import "./actions/shows";
import "./actions/assistant";
import { loadAuth } from "./auth/session";
import type { AppEnv } from "./env";
import { safeEqual, sha256 } from "./lib/crypto";
import { HttpError } from "./lib/errors";
import { activityRoutes } from "./routes/activity";
import { assistantRoutes } from "./routes/assistant";
import { authRoutes } from "./routes/auth";
import { fileRoutes } from "./routes/files";
import { recordRoutes } from "./routes/records";
import { syncRoutes } from "./routes/sync";

const v1 = new OpenAPIHono<AppEnv>();

v1.use("*", async (c, next) => {
  const auth = await loadAuth(c.req.raw, c.env);
  // studio-assistant says so with its key (D-046). A wrong or unexpected key is refused
  // outright: running as the plain user instead would skip the assistant's limits.
  const assistantKey = c.req.header("X-Studio-Assistant");
  if (assistantKey !== undefined) {
    const ok = !!c.env.ASSISTANT_KEY && safeEqual(await sha256(assistantKey), await sha256(c.env.ASSISTANT_KEY));
    if (!ok) throw new HttpError("unauthenticated", "Unknown assistant key");
    if (auth) auth.viaAssistant = true;
  }
  c.set("auth", auth);
  await next();
  // A renewed session gets its cookie back, unless this response already sets one (sign-in, sign-out).
  if (auth?.renewedCookie && !c.res.headers.has("Set-Cookie")) c.res.headers.append("Set-Cookie", auth.renewedCookie);
});

v1.route("/", authRoutes);
v1.route("/", recordRoutes);
v1.route("/", activityRoutes);
v1.route("/", fileRoutes);
v1.route("/", syncRoutes);
v1.route("/", assistantRoutes);

const docConfig = {
  openapi: "3.1.0",
  info: {
    title: "Studio Platform API",
    version: "0.1.0",
    description: "Generated from studio-api's Zod schemas. Additive changes only.",
  },
  servers: [{ url: "/v1" }],
  security: [{ session: [] }],
};
v1.openAPIRegistry.registerComponent("securitySchemes", "session", {
  type: "apiKey", in: "cookie", name: "studio_session",
});
v1.doc31("/openapi.json", docConfig);

/** The OpenAPI document, built from the routes (scripts/openapi.ts writes it to docs/). */
export const openApiDocument = () => v1.getOpenAPI31Document(docConfig);

export const app = new OpenAPIHono<AppEnv>();
app.route("/v1", v1);

app.notFound((c) => c.json(apiError("not_found", "No such route"), 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return err.toResponse();
  console.error(err);
  return c.json(apiError("internal", "Something went wrong"), 500);
});

export default app;
