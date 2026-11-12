import type { Env } from "../env";

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string | undefined;
  /** Base64 contents; Resend takes up to 40 MB in all. */
  attachments?: { filename: string; content: string }[] | undefined;
}

/** Sends one email through Resend. Without a key, dev logs it; other environments refuse (D-010). Never throws. */
export async function sendMail(env: Env, mail: Mail): Promise<boolean> {
  if (!mail.to.length) return false;
  if (!env.RESEND_API_KEY) {
    if (env.ENVIRONMENT === "dev") console.log(`[dev] email to ${mail.to.join(", ")}: ${mail.subject}\n${mail.text}`);
    else console.error("RESEND_API_KEY is not set; email not sent:", mail.subject);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
      }),
    });
    if (!res.ok) console.error("Resend refused an email", res.status, mail.subject);
    return res.ok;
  } catch (e) {
    console.error("Resend unreachable", e);
    return false;
  }
}

/** Emails the sign-in code. */
export async function sendLoginCode(env: Env, email: string, code: string, what = "sign-in code"): Promise<void> {
  if (!env.RESEND_API_KEY && env.ENVIRONMENT === "dev") {
    console.log(`[dev] ${what} for ${email}: ${code}`);
    return;
  }
  await sendMail(env, {
    to: [email],
    subject: `Your ${what}`,
    text: `Your ${what} is ${code}\n\nIt expires in 15 minutes. If you didn't ask for it, ignore this email.`,
  });
}
