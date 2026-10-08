const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

/** Constant-time compare for equal-length hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Uniform 6-digit code (rejection sampling, no modulo bias). */
export function sixDigitCode(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const n = buf[0]!;
    if (n < 4_294_000_000) return String(100000 + (n % 900000));
  }
}

// D-080: passwords are PBKDF2-SHA256, 100,000 rounds (the Workers runtime's cap),
// a 16-byte salt, stored as "pbkdf2$<rounds>$<salt hex>$<hash hex>".
const ROUNDS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ROUNDS}$${hex(salt.buffer)}$${await pbkdf2(password, salt, ROUNDS)}`;
}

/** Checks a password; with no stored hash it still does the work, so timing says nothing. */
export async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  const [kind, rounds, saltHex, want] = (stored ?? "").split("$");
  const ok = kind === "pbkdf2" && !!saltHex && !!want && Number(rounds) > 0 && Number(rounds) <= ROUNDS;
  const salt = ok ? new Uint8Array(saltHex!.match(/../g)!.map((h) => parseInt(h, 16))) : new Uint8Array(16);
  const got = await pbkdf2(password, salt, ok ? Number(rounds) : ROUNDS);
  return ok && safeEqual(got, want!);
}
