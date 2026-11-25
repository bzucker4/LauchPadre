export type Mail = { to: string; subject: string; text: string };
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
}>;

/** Sends transactional email through the Resend HTTP API (no SDK dependency). */
export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
    private request: FetchLike = fetch as unknown as FetchLike
  ) {}

  async send(mail: Mail) {
    const response = await this.request('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [mail.to], subject: mail.subject, text: mail.text }),
    });
    if (!response.ok) throw new Error(`Email provider rejected the message (HTTP ${response.status})`);
  }
}

/** Development fallback: prints the message (including links) to the server console. */
export class ConsoleMailer implements Mailer {
  async send(mail: Mail) {
    console.log(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
  }
}

export function mailerFromEnv(production: boolean): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (apiKey && from) return new ResendMailer(apiKey, from);
  if (production) throw new Error('Production requires RESEND_API_KEY and MAIL_FROM for account emails');
  return new ConsoleMailer();
}
