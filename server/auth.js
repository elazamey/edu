import crypto from 'node:crypto';

const SESSION_COOKIE_NAME = 'nexus_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getSigningSecret() {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET || 'nexus-local-dev-secret-change-in-production';
}

export function hashPassword(password, existingSalt = null) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, passwordHash: hash };
}

export function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const { passwordHash } = hashPassword(password, salt);
  const actualBuf = Buffer.from(passwordHash, 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function signToken(rawToken) {
  const hmac = crypto.createHmac('sha256', getSigningSecret()).update(rawToken).digest('hex');
  return `${rawToken}.${hmac}`;
}

function verifySignedToken(signedToken) {
  if (!signedToken || typeof signedToken !== 'string') return null;
  const parts = signedToken.split('.');
  if (parts.length !== 2) return null;
  const [rawToken, signature] = parts;
  if (!rawToken || !signature) return null;

  const expectedSignature = crypto.createHmac('sha256', getSigningSecret()).update(rawToken).digest('hex');
  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  return rawToken;
}

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    const val = pair.slice(index + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

export function issueSession(res, store, userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const signedToken = signToken(rawToken);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  store.createSession({ tokenHash, userId, expiresAt });

  const isProd = process.env.NODE_ENV === 'production';
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isProd) {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
  return { token: signedToken, expiresAt };
}

export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function extractRawTokenFromRequest(req) {
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    return verifySignedToken(bearer);
  }
  const cookies = parseCookies(req.headers?.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  return verifySignedToken(cookieToken);
}

export function createSessionMiddleware(store) {
  return (req, res, next) => {
    req.user = null;
    req.sessionTokenHash = null;

    const rawToken = extractRawTokenFromRequest(req);
    if (!rawToken) return next();

    const tokenHash = hashToken(rawToken);
    const session = store.findSessionByTokenHash(tokenHash);
    if (!session) return next();

    const user = store.findUserById(session.userId);
    if (!user) return next();

    req.user = store.sanitizeUser(user);
    req.sessionTokenHash = tokenHash;
    return next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required. Please sign in first.',
    });
  }
  return next();
}
