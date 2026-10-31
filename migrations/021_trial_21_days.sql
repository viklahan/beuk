-- Step 3 pricing (V, 2026-10-28/30): the free trial is 21 days, not 7.
--
-- Beuk has not launched, so every existing trial is a pre-launch trial
-- stamped at sign-up as created_at + 7 days (migration 016 and sign-up).
-- Re-date those to created_at + 21 days. This only ever lengthens: a trial
-- already ending later than created_at + 21 days (an operator extension)
-- is left alone, and an account with no stamp (null) keeps falling back to
-- created_at + TRIAL_DAYS in src/access.ts.
update users set trial_ends_at = created_at + interval '21 days'
where trial_ends_at is not null and trial_ends_at < created_at + interval '21 days';
