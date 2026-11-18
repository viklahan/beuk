import { activeEditor, caretOffset } from '../editor/active';
import { cloudFacts } from '../closure/index';
import { apiFetch } from './net';
import { arisStatus } from './state';

/* One proposal: POST /api/aris/draft for the section the open editor holds. The server reads the section's text
   itself (its stored copy); the studio sends which book (the shelf's manuscript id the book is linked to), which
   section (its 1.0 id), where the caret is (a UTF-16 offset in the section's text), and which provider and model.

   W1 has no model picker: the writer's first stored key names the provider, and the model is that provider's
   default below. */

export type ProposeAction = 'beat' | 'continue' | 'fill' | 'summarize';
export type ProposeArgs = { action: ProposeAction; instruction?: string; cursorOffset?: number; selectionText?: string };
export type Proposal = { text: string; token: string };

/** W1's per-provider default models (no picker yet). openai-compat's is a guess at a common name: such an endpoint
 *  serves whatever its operator installed, and a wrong name comes back as that endpoint's own refusal. */
export const DEFAULT_MODELS: Record<string, string> = {
  openrouter: 'anthropic/claude-sonnet-4.5',
  anthropic: 'claude-sonnet-4-5',
  'openai-compat': 'gpt-4o-mini',
};

export async function propose(o: ProposeArgs): Promise<Proposal | { error: string }> {
  const a = activeEditor();
  if (!a) return { error: 'open a chapter first' };
  const sectionId = a.sectionMap?.get('id');
  if (typeof sectionId !== 'string' || !sectionId) return { error: 'this section has no id yet — type a word and try again' };
  const manuscriptId = cloudFacts.linkedId;
  if (!manuscriptId) return { error: 'this book is not on your shelf yet — save it to the shelf first' };
  const key = arisStatus()?.keys[0] as { provider?: unknown } | undefined;
  const provider = typeof key?.provider === 'string' ? key.provider : '';
  if (!provider) return { error: 'add a provider key on your /aris page first' };
  const model = DEFAULT_MODELS[provider];
  if (!model) return { error: `no default model for ${provider}` };
  const cursorOffset = o.cursorOffset ?? caretOffset(a.section);
  const body: Record<string, unknown> = { manuscriptId, sectionId, action: o.action };
  if (o.instruction !== undefined) body.instruction = o.instruction;
  if (cursorOffset >= 0) body.cursorOffset = cursorOffset;
  if (o.selectionText !== undefined) body.selection = { text: o.selectionText };
  body.provider = provider;
  body.model = model;
  const r = await apiFetch('/api/aris/draft', { method: 'POST', body: JSON.stringify(body) });
  if (!r) return { error: 'Aris could not be reached — check your connection and retry' };
  if ('__error' in r) return { error: String(r.__error) };
  const p = r.proposal as { text?: unknown } | undefined;
  if (typeof p?.text !== 'string' || typeof r.token !== 'string') return { error: 'the proposal came back malformed — retry' };
  return { text: p.text, token: r.token };
}
