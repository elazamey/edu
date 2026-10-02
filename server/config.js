import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT || 3000),
  isProduction,
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackUrl: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3000/api/auth/github/callback',
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  sessionCookie: process.env.SESSION_COOKIE_NAME || 'nexus_session',
};

export function isAuthConfigured() {
  return Boolean(
    config.github.clientId &&
    config.github.clientSecret &&
    config.supabase.url &&
    config.supabase.serviceRoleKey,
  );
}
