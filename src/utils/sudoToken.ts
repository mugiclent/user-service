import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';

export type SudoAction = 'change_password' | 'delete_account' | 'purchase_ticket';

export interface SudoTokenPayload {
  sub: string;
  type: 'sudo';
  action: SudoAction;
  jti: string;
  iat: number;
  exp: number;
}

const SUDO_TTL_SECONDS = 180;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _privateKey: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _publicKey: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPrivateKey = async (): Promise<any> => {
  if (!_privateKey) _privateKey = await importPKCS8(config.jwt.privateKey, 'EdDSA');
  return _privateKey;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPublicKey = async (): Promise<any> => {
  if (!_publicKey) _publicKey = await importSPKI(config.jwt.publicKey, 'EdDSA');
  return _publicKey;
};

export const issueSudoToken = async (
  userId: string,
  action: SudoAction,
): Promise<{ token: string; jti: string; expiresAt: string }> => {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + SUDO_TTL_SECONDS * 1000);
  const key = await getPrivateKey();
  const token = await new SignJWT({ type: 'sudo', action, jti } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(userId)
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime(expiresAt)
    .sign(key);
  return { token, jti, expiresAt: expiresAt.toISOString() };
};

export const verifySudoToken = async (token: string): Promise<SudoTokenPayload> => {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(token, key, { algorithms: ['EdDSA'] });
  return payload as unknown as SudoTokenPayload;
};
