import type { Config } from '../config.js';

/**
 * Secret scrubbing (Housekeeping spec): every Housekeeping response,
 * stored params summary, and generated manifest passes through here.
 * The secret VALUES are collected from config — database URL (and its
 * password component), Stripe keys — and replaced wherever they appear.
 * Values shorter than 6 chars are ignored so ordinary words survive.
 */
export function collectSecrets(config: Config): string[] {
  const found = new Set<string>();
  const add = (value: string | null | undefined): void => {
    if (value && value.length >= 6) found.add(value);
  };
  add(config.stripeSecretKey);
  add(config.stripeWebhookSecret);
  // P0 #5: SMTP_URL carries the mail password.
  if (config.smtpUrl) {
    add(config.smtpUrl);
    try {
      const url = new URL(config.smtpUrl);
      if (url.password) add(decodeURIComponent(url.password));
    } catch {
      // Unparseable URL: the full string is already in the set.
    }
  }
  if (config.databaseUrl) {
    add(config.databaseUrl);
    try {
      const url = new URL(config.databaseUrl);
      if (url.password) add(decodeURIComponent(url.password));
    } catch {
      // Unparseable URL: the full string is already in the set.
    }
  }
  return [...found];
}

export function scrubText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out;
}

/** Deep-scrub any JSON-shaped value (strings anywhere inside it). */
export function scrubValue<T>(value: T, secrets: readonly string[]): T {
  if (!secrets.length) return value;
  if (typeof value === 'string') return scrubText(value, secrets) as T;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, secrets)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[scrubText(key, secrets)] = scrubValue(v, secrets);
    }
    return out as T;
  }
  return value;
}
