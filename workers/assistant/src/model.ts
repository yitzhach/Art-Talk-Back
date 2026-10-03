// The model behind the assistant: Claude through Cloudflare AI Gateway (spec →
// Models). One function, so tests and the eval's replay mode can swap it.
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";

export type ModelRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
/** Sends one request, streams text through onText, resolves with the whole message. */
export type Model = (req: ModelRequest, onText: (delta: string) => void) => Promise<Anthropic.Beta.Messages.BetaMessage>;

/** Models that take the server-side refusal fallback in its "default" form. */
const FALLBACK_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"];

export function anthropicModel(env: Env): Model {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.AI_GATEWAY_URL ? { baseURL: env.AI_GATEWAY_URL } : {}),
    ...(env.AI_GATEWAY_TOKEN ? { defaultHeaders: { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` } } : {}),
  });
  return async (req, onText) => {
    const stream = client.beta.messages.stream(req);
    stream.on("text", onText);
    return stream.finalMessage();
  };
}

/** Per-model request settings (D-054). Haiku 4.5 takes no effort and no fallback. */
export function modelSettings(env: Env): Partial<ModelRequest> {
  const model = env.ASSISTANT_MODEL || "claude-sonnet-5-5";
  const out: Partial<ModelRequest> = { model };
  if (!model.startsWith("claude-haiku")) {
    out.output_config = { effort: (env.ASSISTANT_EFFORT || "low") as "low" };
  }
  if (FALLBACK_MODELS.includes(model)) {
    // If the model declines on safety grounds, the API reruns the request on a
    // fallback model chosen by refusal category, inside the same call.
    out.betas = ["server-side-fallback-2026-07-01"];
    out.fallbacks = "default";
  }
  return out;
}
