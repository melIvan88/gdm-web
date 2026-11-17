// Good Day Mates: short-lived upload and view links for the media bucket (AWS Lambda, Sydney).
// 2026-11-17: callers are now checked against Cognito (auth moved off Supabase on 11-16), and
// photos can be uploaded too, not just videos and covers. No secrets live in this file.
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';

const BUCKET = process.env.BUCKET;
const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const POOL = process.env.COGNITO_POOL || '';
const CLIENT = process.env.COGNITO_CLIENT || '';
const POOL2 = process.env.COGNITO_POOL2 || '';
const CLIENT2 = process.env.COGNITO_CLIENT2 || '';
const ISS = POOL ? `https://cognito-idp.${REGION}.amazonaws.com/${POOL}` : '';
const ISS2 = POOL2 ? `https://cognito-idp.${REGION}.amazonaws.com/${POOL2}` : '';
const s3 = new S3Client({});

// folder, extension, content type
const KINDS = {
  video: ['videos', 'mp4', 'video/mp4'],
  cover: ['covers', 'jpg', 'image/jpeg'],
  photo: ['photos', 'jpg', 'image/jpeg'],
};

const out = (code, body) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' },
  body: JSON.stringify(body),
});

let keys = null;
function jwks() {
  if (keys) return keys;
  keys = {};
  const all = [
    ...(JSON.parse(process.env.JWKS_JSON || '{"keys":[]}').keys || []),
    ...(JSON.parse(process.env.JWKS_JSON2 || '{"keys":[]}').keys || []),
  ];
  for (const k of all) keys[k.kid] = crypto.createPublicKey({ key: k, format: 'jwk' });
  return keys;
}
const b64 = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function userOf(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const t = auth.slice(7).split('.');
  if (t.length !== 3) return null;
  try {
    const head = JSON.parse(b64(t[0]).toString());
    const body = JSON.parse(b64(t[1]).toString());
    if (head.alg !== 'RS256') return null;
    const key = jwks()[head.kid];
    if (!key) return null;
    if (!crypto.verify('RSA-SHA256', Buffer.from(t[0] + '.' + t[1]), key, b64(t[2]))) return null;
    const cid = ISS && body.iss === ISS ? CLIENT : (ISS2 && body.iss === ISS2 ? CLIENT2 : '');
    if (!cid) return null;
    if (body.token_use !== 'id' && body.token_use !== 'access') return null;
    if (body.token_use === 'id' && body.aud !== cid) return null;
    if (body.token_use === 'access' && body.client_id !== cid) return null;
    if (!body.exp || body.exp * 1000 < Date.now()) return null;
    return String(body.sub || '').replace(/[^A-Za-z0-9_-]/g, '');
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  try {
    const method = event.requestContext?.http?.method || 'POST';
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' }, body: '' };
    }
    if (method !== 'POST') return out(405, { error: 'POST only' });
    const uid = userOf(event);
    if (!uid) return out(401, { error: 'sign in first' });
    const q = JSON.parse(event.body || '{}');
    if (q.action === 'upload') {
      const k = KINDS[q.kind];
      if (!k) return out(400, { error: 'bad kind' });
      const d = new Date();
      const ym = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
      const key = `${k[0]}/${ym}/${uid}_${d.getTime()}_${Math.floor(Math.random() * 1e6)}.${k[1]}`;
      const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: k[2] }), { expiresIn: 300 });
      return out(200, { key, url, contentType: k[2] });
    }
    if (q.action === 'view') {
      const key = String(q.key || '');
      if (!/^(videos|covers|photos)\/\d{6}\/[A-Za-z0-9_-]+\.(mp4|jpg)$/.test(key)) return out(400, { error: 'bad key' });
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
      return out(200, { url });
    }
    return out(400, { error: 'bad action' });
  } catch {
    return out(500, { error: 'server error' });
  }
};
