-- Aris W1: an optional per-key model override. A writer can point Aris at
-- any model their provider serves (e.g. a Gemini model through an
-- openai-compat base URL). Null means "use the model the Aris client sends as its fallback".
-- Not a secret; stored in the clear beside base_url.
alter table aris_keys add column model text;
