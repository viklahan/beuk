/**
 * Housekeeping admin, granted out-of-band (never over HTTP). On the server:
 *   docker compose exec app node dist/admin-cli.js grant you@example.com
 *   docker compose exec app node dist/admin-cli.js revoke you@example.com
 *   docker compose exec app node dist/admin-cli.js list
 *   docker compose exec app node dist/admin-cli.js two-step-off you@example.com
 * The account must already exist (register it in the app first).
 * two-step-off is support's way out for a writer who lost both the phone
 * and the recovery codes: check who is asking by hand first.
 */
import { loadConfig } from './config.js';
import { createPgDb } from './db.js';
import { listAdmins, setAdmin } from './housekeeping/admin.js';
import { turnTwoStepOff } from './twostep/store.js';

const USAGE = 'usage: admin-cli.js grant <email> | revoke <email> | list | two-step-off <email>';
const [command, email] = process.argv.slice(2);

const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const db = createPgDb(config.databaseUrl);
let code = 0;
try {
  if (command === 'list') {
    const admins = await listAdmins(db);
    console.log(admins.length ? admins.join('\n') : '(no admins)');
  } else if ((command === 'grant' || command === 'revoke') && email) {
    const change = await setAdmin(db, email, command === 'grant');
    console.log(`${email.trim().toLowerCase()}: ${change}`);
    if (change === 'no such user') {
      console.error('No account with that email — register it in the app first.');
      code = 1;
    }
  } else if (command === 'two-step-off' && email) {
    const change = await turnTwoStepOff(db, email);
    console.log(`${email.trim().toLowerCase()}: two-step sign-in ${change === 'no such user' ? '— no such user' : change}`);
    if (change === 'no such user') code = 1;
  } else {
    console.error(USAGE);
    code = 2;
  }
} finally {
  await db.end();
}
process.exit(code);
