import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { stores } from './db.js';
import { generatePassword, hashPassword } from './auth.js';

const [cmd, username] = process.argv.slice(2);
if (cmd !== 'create-owner' || !username || !/^[\w.-]{3,32}$/.test(username)) {
  console.error('usage: node dist/cli.js create-owner <username>');
  process.exit(2);
}
const db = stores(loadConfig().dataDir);
const password = generatePassword();
await db.users.update(async (d) => {
  if (d.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new Error('user exists');
  d.users.push({ id: randomUUID(), username, role: 'owner', passwordHash: await hashPassword(password), createdAt: new Date().toISOString() });
});
console.log(`Owner "${username}" created.\nOne-time password: ${password}\nSign in at /admin and change it under Staff.`);
