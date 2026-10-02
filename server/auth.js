import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parseCookie, stringifyCookie } from 'cookie';
import { config, isAuthConfigured } from './config.js';

const stateCookie = 'nexus_oauth_state';
const stateMaxAge = 10 * 60;

function cookiesFor(req) {
  return parseCookie(req.headers.cookie || '');
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

function supabase() {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function configuredOrFail(res) {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: 'Authentication is not configured' });
    return false;
  }
  return true;
}

export function registerAuthRoutes(router) {
  router.get('/github', (req, res) => {
    if (!configuredOrFail(res)) return;

    const state = crypto.randomBytes(32).toString('hex');
    res.setHeader('Set-Cookie', stringifyCookie(stateCookie, state, cookieOptions(stateMaxAge)));
    const params = new URLSearchParams({
      client_id: config.github.clientId,
      redirect_uri: config.github.callbackUrl,
      scope: 'read:user user:email',
      state,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  router.get('/github/callback', async (req, res, next) => {
    try {
      if (!configuredOrFail(res)) return;
      const { code, state } = req.query;
      const expectedState = cookiesFor(req)[stateCookie];
      if (!code || !state || !/^[a-f0-9]{64}$/.test(state) || !expectedState ||
          state.length !== expectedState.length ||
          !crypto.timingSafeEqual(Buffer.from(state, 'utf8'), Buffer.from(expectedState, 'utf8'))) {
        return res.status(400).json({ error: 'Invalid OAuth state' });
      }

      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code }),
      });
      if (!tokenResponse.ok) throw new Error(`GitHub token exchange failed: ${tokenResponse.status}`);
      const token = await tokenResponse.json();
      if (!token.access_token) return res.status(401).json({ error: 'GitHub authorization failed' });

      const githubResponse = await fetch('https://api.github.com/user', {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'nexus-agent' },
      });
      if (!githubResponse.ok) throw new Error(`GitHub user request failed: ${githubResponse.status}`);
      const githubUser = await githubResponse.json();

      const db = supabase();
      const { data: user, error: userError } = await db
        .from('users')
        .upsert({ github_id: String(githubUser.id), username: githubUser.login, display_name: githubUser.name, avatar_url: githubUser.avatar_url }, { onConflict: 'github_id' })
        .select('id')
        .single();
      if (userError) throw userError;

      const { error: providerError } = await db.from('oauth_accounts').upsert({
        user_id: user.id,
        provider: 'github',
        provider_user_id: String(githubUser.id),
      }, { onConflict: 'provider,provider_user_id' });
      if (providerError) throw providerError;

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
      const { error: sessionError } = await db.from('sessions').insert({ user_id: user.id, token_hash: tokenHash });
      if (sessionError) throw sessionError;

      res.setHeader('Set-Cookie', [
        stringifyCookie(stateCookie, '', cookieOptions(0)),
        stringifyCookie(config.sessionCookie, sessionToken, { ...cookieOptions(7 * 24 * 60 * 60), sameSite: 'lax' }),
      ]);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const session = cookiesFor(req)[config.sessionCookie];
      if (session && isAuthConfigured()) {
        const tokenHash = crypto.createHash('sha256').update(session).digest('hex');
        await supabase().from('sessions').delete().eq('token_hash', tokenHash);
      }
      res.setHeader('Set-Cookie', stringifyCookie(config.sessionCookie, '', cookieOptions(0)));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
}
