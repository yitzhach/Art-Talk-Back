import type { Env } from "../env";

/** Emails the sign-in code. Without a Resend key, dev logs it; other environments refuse (D-010). */
export async function sendLoginCode(env: Env, email: string, code: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.ENVIRONMENT === "dev") console.log(`[dev] sign-in code for ${email}: ${code}`);
    else console.error("RESEND_API_KEY is not set; sign-in code not sent");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject: "Your sign-in code",
      text: `Your sign-in code is ${code}\n\nIt expires in 15 minutes. If you didn't ask for it, ignore this email.`,
    }),
  });
  if (!res.ok) console.error("Resend refused the sign-in email", res.status);
}
