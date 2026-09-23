import crypto from 'crypto';
import { DbAdapter } from './db';

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = (hash || '').split(':');
    if (!salt || !key) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      try {
        const keyBuf = Buffer.from(key, 'hex');
        if (keyBuf.length !== derivedKey.length) return resolve(false);
        resolve(crypto.timingSafeEqual(keyBuf, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

// Seed the initial admin account from ADMIN_USERNAME/ADMIN_PASSWORD (already set in
// production) the first time the users table is empty. Deliberately NOT a hard-coded
// admin/admin default. If the env credentials are missing, no user is seeded and an
// admin must be created out-of-band, rather than exposing a weak default login.
export async function seedDefaultAdmin(db: DbAdapter): Promise<void> {
  try {
    const existingUsers = await db.queryAll<{ id: number }>(`SELECT id FROM users LIMIT 1`);
    if (existingUsers.length > 0) return;

    const username = (process.env.ADMIN_USERNAME || '').trim();
    const password = (process.env.ADMIN_PASSWORD || '').trim();
    if (!username || !password) {
      console.warn('[AUTH] users table is empty and ADMIN_USERNAME/ADMIN_PASSWORD are not set; no admin seeded. Set them and restart to create the initial admin.');
      return;
    }

    const passwordHash = await hashPassword(password);
    await db.execute(
      `INSERT INTO users (username, password_hash, display_name, active) VALUES (?, ?, ?, ?)`,
      [username, passwordHash, 'Administrator', true]
    );
    console.log(`[AUTH] Seeded initial admin user "${username}" from ADMIN_USERNAME/ADMIN_PASSWORD`);
  } catch (err) {
    console.error('[AUTH] Failed to check/seed initial admin user:', err);
  }
}
