import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Proposal tokens: the server's signed receipt that it handed a writer a
 * specific AI proposal. HMAC-SHA256 over the JSON payload, so the claim
 * (who, what section, what action, how many chars) cannot be edited by
 * the client. Format: `v1.<payload b64url>.<mac b64url>`.
 */
export type ProposalKind = 'replaced-own-prose' | 'generated-new';
export type ProposalPayload = {
  userId: string;
  manuscriptId: string;
  sectionId: string;
  action: string;
  kind: ProposalKind;
  provider: string;
  model: string;
  proposalChars: number;
  nonce: string;
  ts: number;
};

const VERSION = 'v1';
export const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const mac = (secret: string, payloadB64: string): Buffer =>
  createHmac('sha256', secret).update(`${VERSION}.${payloadB64}`).digest();

export function mintProposalToken(secret: string, p: ProposalPayload): string {
  const payload = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${VERSION}.${payload}.${mac(secret, payload).toString('base64url')}`;
}

/** The payload, or null on a bad shape, a bad MAC, or a token older than 24 h. */
export function verifyProposalToken(secret: string, token: string, now: number = Date.now()): ProposalPayload | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const given = Buffer.from(parts[2], 'base64url');
  const want = mac(secret, parts[1]);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let p: ProposalPayload;
  try {
    p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as ProposalPayload;
  } catch {
    return null;
  }
  if (typeof p !== 'object' || p === null || typeof p.ts !== 'number') return null;
  if (now - p.ts > TOKEN_MAX_AGE_MS) return null;
  return p;
}
