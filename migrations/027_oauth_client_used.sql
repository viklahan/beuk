-- OAuth client housekeeping (review M4): registration is open, so a
-- registration that never connects anyone is forgotten after a day
-- (src/oauth/model.ts purgeIdleOAuthClients). A client that ever got
-- tokens is kept: the app holds on to its client_id and comes back with
-- it, and /authorize can't tell it to register again. This column is
-- how the two are told apart once the tokens themselves have expired.
alter table oauth_clients add column last_used_at timestamptz;
