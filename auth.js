/**
 * Auth helpers — self-hosted email/password.
 *
 * Passwords are bcrypt-hashed. Sessions are a signed JWT stored in an
 * httpOnly, secure, SameSite=Lax cookie (so it's not readable by JS and rides
 * along on same-origin requests). JWT_SECRET comes from the server .env.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const SESSION_COOKIE = 'cp_session';
const TOKEN_TTL = '30d';

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  return s;
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signToken(userId) {
  return jwt.sign({ uid: userId }, secret(), { expiresIn: TOKEN_TTL });
}
export function verifyToken(token) {
  try {
    return jwt.verify(token, secret());
  } catch {
    return null;
  }
}

/** Cookie options for setting/clearing the session. secure since we're HTTPS. */
export function cookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validCredentials(email, password) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) return 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

/** Strip sensitive fields before sending a user to the client. */
export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    tier: row.tier,
    subscriptionStatus: row.subscription_status || null,
    trialEnd: row.trial_end || null,
  };
}
