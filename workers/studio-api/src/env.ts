import type { DrizzleD1Database } from "drizzle-orm/d1";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ENVIRONMENT: string;
  OWNER_EMAILS: string;
  STUDIO_NAME: string;
  MAIL_FROM: string;
  SIGNING_KEY: string;
  RESEND_API_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Shared with studio-assistant; a request carrying it acts as the assistant (D-046). */
  ASSISTANT_KEY?: string;
}

export type Role = "owner" | "staff" | "client";
export type Source = "app" | "assistant" | "job" | "api_key" | "sync" | "system";

/** Who is calling. studioId always comes from here, never from a request body. */
export interface Auth {
  userId: string;
  email: string;
  name: string | null;
  sessionId: string | null; // null when signed in through Cloudflare Access
  studioId: string | null;
  role: Role | null;
  clientId: string | null;
  /** The request came from studio-assistant on this person's behalf: its writes are the assistant's (D-046). */
  viaAssistant?: boolean;
  /** Set when this request renewed the session: the cookie to send back with a fresh Max-Age. */
  renewedCookie?: string;
}

/** A caller who has an active studio. */
export interface Actor extends Auth {
  studioId: string;
  role: Role;
}

export type Db = DrizzleD1Database;

export type AppEnv = { Bindings: Env; Variables: { auth: Auth | null } };
