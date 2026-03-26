import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import type { StrategyOptionsWithoutRequest } from 'passport-jwt';
import { unpackRules } from '@casl/ability/extra';
import { prisma } from '../models/index.js';
import { config } from '../config/index.js';
import type { JwtPayload } from '../utils/tokens.js';

const options: StrategyOptionsWithoutRequest = {
  jwtFromRequest: ExtractJwt.fromExtractors([
    // Web: extract from HttpOnly cookie
    (req) => req?.cookies?.access_token ?? null,
    // Mobile: extract from Authorization: Bearer <token>
    ExtractJwt.fromAuthHeaderAsBearerToken(),
  ]),
  secretOrKey: config.jwt.secret,
};

export const initPassport = (): void => {
  passport.use(
    new JwtStrategy(options, async (payload: JwtPayload, done) => {
      try {
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          include: { user_roles: { include: { role: true } } },
        });
        if (!user || user.deleted_at) return done(null, false);
        if (user.status === 'suspended') return done(null, false);

        // Check Redis blacklist (soft-delete window, org suspension)
        const { getRedisClient } = await import('../loaders/redis.js');
        try {
          const redis = getRedisClient();
          const [userBlacklisted, orgBlacklisted] = await Promise.all([
            redis.get(`blacklist:user:${user.id}`),
            user.org_id ? redis.get(`blacklist:org:${user.org_id}`) : null,
          ]);
          if (userBlacklisted || orgBlacklisted) return done(null, false);
        } catch {
          // Redis unavailable — fail open (don't block auth)
        }

        return done(null, {
          ...user,
          rules: unpackRules(payload.rules),
        });
      } catch (err) {
        return done(err, false);
      }
    }),
  );
};
