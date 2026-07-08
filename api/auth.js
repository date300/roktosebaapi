const crypto = require('crypto');

const jwtSecret = process.env.JWT_SECRET || 'roktoseba-secret';

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const p = value.length % 4;
  const n = p ? value + '='.repeat(4 - p) : value;
  return Buffer.from(n.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function createToken(payload) {
  const h = { alg: 'HS256', typ: 'JWT' };
  const hs = base64UrlEncode(JSON.stringify(h));
  const ps = base64UrlEncode(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const si = `${hs}.${ps}`;
  const sig = crypto.createHmac('sha256', jwtSecret).update(si).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${si}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [hs, ps, sig] = parts;
  const si = `${hs}.${ps}`;
  const es = crypto.createHmac('sha256', jwtSecret).update(si).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (es !== sig) return null;
  try { return JSON.parse(base64UrlDecode(ps)); } catch (e) { return null; }
}

// ⚠️ SHA256 – প্রোডাকশনে bcrypt ব্যবহার করুন
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function authenticate(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  if (!auth) {
    return { error: 'missing_header', message: 'No Authorization header' };
  }
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
  if (!token) {
    return { error: 'missing_token', message: 'Token empty' };
  }
  const payload = verifyToken(token);
  if (!payload || !payload.sub) {
    return { error: 'invalid_token', message: 'Token invalid' };
  }
  return { payload };
}

module.exports = {
  jwtSecret,
  createToken,
  verifyToken,
  hashPassword,
  authenticate
};