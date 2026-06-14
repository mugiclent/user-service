import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';
import { packRules } from '@casl/ability/extra';
import type { PackRule } from '@casl/ability/extra';
import type { AppRule } from './ability.js';
import { config } from '../config/index.js';

export interface JwtPayload {
  sub: string;
  org_id: string | null;
  user_type: 'passenger' | 'staff';
  /** E.164 phone number — carried so booking flows can send SMS without a user-service round-trip. Null if the account has none. */
  phone_number: string | null;
  role_slugs: string[];
  rules: PackRule<AppRule>[];
  locale: string;
  /** RefreshToken.id minted alongside this access token — used to identify the current session. */
  session_id?: string;
}

// ---------------------------------------------------------------------------
// Key cache — imported once, reused across all requests
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _privateKey: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _publicKey: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPrivateKey = async (): Promise<any> => {
  if (!_privateKey) {
    _privateKey = await importPKCS8(config.jwt.privateKey, 'EdDSA');
  }
  return _privateKey;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPublicKey = async (): Promise<any> => {
  if (!_publicKey) {
    _publicKey = await importSPKI(config.jwt.publicKey, 'EdDSA');
  }
  return _publicKey;
};

/**
 * Sign a short-lived access token containing the user's identity and
 * packed CASL rules for zero-DB-hit authorization.
 */
export const signAccessToken = async (
  payload: Omit<JwtPayload, 'rules'> & { rules: AppRule[] },
): Promise<string> => {
  const { rules, session_id, ...rest } = payload;
  const tokenPayload: JwtPayload = { ...rest, rules: packRules(rules), ...(session_id ? { session_id } : {}) };
  const key = await getPrivateKey();
  return new SignJWT(tokenPayload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setExpirationTime(config.jwt.expiresIn)
    .sign(key);
};

/**
 * Verify and decode an access token.
 * Throws errors from jose on invalid/expired tokens.
 */
export const verifyAccessToken = async (token: string): Promise<JwtPayload> => {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(token, key, { algorithms: ['EdDSA'] });
  return payload as unknown as JwtPayload;
};
