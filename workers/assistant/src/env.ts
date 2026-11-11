export interface Env {
  STUDIO_API: Fetcher;
  ASSISTANT_MODEL: string;
  ASSISTANT_EFFORT: string;
  /** The vision model for the draft job (Site 3.0). */
  DRAFT_MODEL?: string;
  AI_GATEWAY_URL: string;
  ANTHROPIC_API_KEY?: string;
  ASSISTANT_KEY?: string;
  AI_GATEWAY_TOKEN?: string;
}
