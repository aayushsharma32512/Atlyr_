import crypto from 'crypto';

export function buildDedupeKey(domain: string, candidate: string) {
  return crypto.createHash('sha1').update(`${domain}|${candidate}`).digest('hex');
}

export function uuid() {
  return crypto.randomUUID();
}
