const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const port = process.env.PORT || 3000;
const jwtSecret = process.env.JWT_SECRET || 'roktoseba-secret';

// Public base URL of this API — used to build full links (e.g. profile picture URLs)
// that get saved in the database. Override with BASE_URL env var if the domain changes.
const baseUrl = process.env.BASE_URL || 'https://api.ltcminematrix.com/api';

// Where uploaded profile pictures are stored on disk
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const allowedImageTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const maxImageBytes = 5 * 1024 * 1024; // 5MB

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'ltcmlgtn_mine_matrix',
  password: process.env.DB_PASSWORD || '123@456@789@0@',
  database: process.env.DB_NAME || 'ltcmlgtn_rokto_seba',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

function base64UrlEncode(value) { return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function base64UrlDecode(value) { const p = value.length % 4; const n = p ? value + '='.repeat(4 - p) : value; return Buffer.from(n.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
function createToken(payload) { const h = { alg: 'HS256', typ: 'JWT' }; const hs = base64UrlEncode(JSON.stringify(h)); const ps = base64UrlEncode(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })); const si = `${hs}.${ps}`; const sig = crypto.createHmac('sha256', jwtSecret).update(si).digest('base64').replace(/\+/g, '-').replace(/\//g, 
'_').replace(/=+$/g, ''); return `${si}.${sig}`; }
function verifyToken(token) { if (!token) return null; const parts = token.split('.'); if (parts.length !== 3) return null; const [hs, ps, sig] = parts; const si = `${hs}.${ps}`; const es = crypto.createHmac('sha256', jwtSecret).update(si).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); if (es !== sig) return null; try { return 
JSON.parse(base64UrlDecode(ps)); } catch (e) { return null; } }
function hashPassword(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }
function getBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { if (!body) return resolve({}); try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function sendJson(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }

const server = http.createServer(async (req, res) => {
  // Remove /api prefix for Passenger compatibility
  if (req.url.startsWith('/api')) {
    req.url = req.url.replace('/api', '') || '/';
  }

  const { method, url } = req;

  if (method === 'GET' && url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (method === 'POST' && url === '/signup') {
    try {
      const body = await getBody(req);
      const fields = ['username','first_name','last_name','email','phone','password','confirm_password','account_type','gender','dob','blood_group','division','district','upazila','emergency_contact'];
      for (const f of fields) {
        if (!body[f]) { sendJson(res, 400, { message: `${f} is required` }); return; }
      }
      if (body.password !== body.confirm_password) { sendJson(res, 400, { message: 'Passwords do not match' }); return; }

      const [dup] = await pool.query('SELECT id FROM users WHERE username = ? OR email = ?', [body.username, body.email]);
      if (dup.length > 0) { sendJson(res, 409, { message: 'Username or email already exists' }); return; }

      const hp = hashPassword(body.password);
      const [result] = await pool.query(
        `INSERT INTO users (username,first_name,last_name,email,phone,password,account_type,gender,dob,blood_group,division,district,upazila,emergency_contact,last_donation_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [body.username,body.first_name,body.last_name,body.email,body.phone,hp,body.account_type,body.gender,body.dob,body.blood_group,body.division,body.district,body.upazila,body.emergency_contact,body.last_donation_date||null]
      );
      const uid = result.insertId;
      const token = createToken({ sub: uid, username: body.username });
      sendJson(res, 201, { message: 'Signup successful', token, user: { id: uid, ...body, password: undefined, confirm_password: undefined } });
    } catch (error) {
      console.error('Signup error:', error);
      sendJson(res, 400, { message: error.message || 'Signup failed' });
    }
    return;
  }

  if (method === 'POST' && url === '/login') {
    try {
      const body = await getBody(req);
      const { email, password } = body;
      if (!email || !password) { sendJson(res, 400, { message: 'Email and password are required' }); return; }

      const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      if (rows.length === 0 || rows[0].password !== hashPassword(password)) {
        sendJson(res, 401, { message: 'Invalid email or password' }); return;
      }
      const user = rows[0];
      const token = createToken({ sub: user.id, username: user.username });
      sendJson(res, 200, { message: 'Login successful', token, user: { id: user.id, username: user.username, first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone, account_type: user.account_type, gender: user.gender, dob: user.dob, blood_group: user.blood_group, division: user.division, district: user.district, upazila: 
user.upazila, emergency_contact: user.emergency_contact, last_donation_date: user.last_donation_date, profile_picture: user.profile_picture } });
    } catch (error) {
      console.error('Login error:', error);
      sendJson(res, 400, { message: error.message || 'Login failed' });
    }
    return;
  }

  if (method === 'GET' && url === '/profile') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload || !payload.sub) { sendJson(res, 401, { message: 'Unauthorized' }); return; }

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [payload.sub]);
    if (rows.length === 0) { sendJson(res, 404, { message: 'User not found' }); return; }
    const user = rows[0];
    sendJson(res, 200, { user: { id: user.id, username: user.username, first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone, account_type: user.account_type, gender: user.gender, dob: user.dob, blood_group: user.blood_group, division: user.division, district: user.district, upazila: user.upazila, emergency_contact: 
user.emergency_contact, last_donation_date: user.last_donation_date, profile_picture: user.profile_picture } });
    return;
  }

  if ((method === 'PUT' || method === 'PATCH') && url === '/profile') {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const payload = verifyToken(token);
      if (!payload || !payload.sub) { sendJson(res, 401, { message: 'Unauthorized' }); return; }

      const body = await getBody(req);

      // Fields the user is allowed to edit through this endpoint.
      // username, email and password are intentionally excluded here —
      // handle those with their own dedicated, more carefully-guarded endpoints.
      const editableFields = ['first_name','last_name','phone','gender','dob','blood_group','division','district','upazila','emergency_contact','last_donation_date'];

      const updates = {};
      for (const f of editableFields) {
        if (body[f] !== undefined) updates[f] = body[f];
      }

      if (Object.keys(updates).length === 0) {
        sendJson(res, 400, { message: 'No valid fields provided to update' });
        return;
      }

      const setClause = Object.keys(updates).map(f => `${f} = ?`).join(', ');
      const values = [...Object.values(updates), payload.sub];

      const [result] = await pool.query(`UPDATE users SET ${setClause} WHERE id = ?`, values);
      if (result.affectedRows === 0) { sendJson(res, 404, { message: 'User not found' }); return; }

      const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [payload.sub]);
      const user = rows[0];
      sendJson(res, 200, {
        message: 'Profile updated successfully',
        user: { id: user.id, username: user.username, first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone, account_type: user.account_type, gender: user.gender, dob: user.dob, blood_group: user.blood_group, division: user.division, district: user.district, upazila: user.upazila, emergency_contact: user.emergency_contact, 
last_donation_date: user.last_donation_date, profile_picture: user.profile_picture }
      });
    } catch (error) {
      console.error('Profile update error:', error);
      sendJson(res, 400, { message: error.message || 'Profile update failed' });
    }
    return;
  }

  // Upload / replace the logged-in user's profile picture.
  // Expects JSON body: { "image": "data:image/jpeg;base64,...." }
  if (method === 'POST' && url === '/profile/picture') {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const payload = verifyToken(token);
      if (!payload || !payload.sub) { sendJson(res, 401, { message: 'Unauthorized' }); return; }

      const body = await getBody(req);
      const { image } = body;
      if (!image) { sendJson(res, 400, { message: 'image is required (base64 data URL)' }); return; }

      const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(image);
      if (!match) { sendJson(res, 400, { message: 'image must be a base64 data URL (png, jpg, jpeg, or webp)' }); return; }

      const ext = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
      const extForFile = ext === 'jpeg' ? 'jpg' : ext;
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > maxImageBytes) { sendJson(res, 413, { message: 'Image too large (max 5MB)' }); return; }

      // Remove the user's previous picture file, if any, before saving the new one
      const [existingRows] = await pool.query('SELECT profile_picture FROM users WHERE id = ?', [payload.sub]);
      const previousUrl = existingRows[0] && existingRows[0].profile_picture;
      if (previousUrl && previousUrl.startsWith(`${baseUrl}/uploads/`)) {
        const previousFile = path.join(uploadsDir, path.basename(previousUrl));
        fs.unlink(previousFile, () => {}); // best-effort, ignore errors
      }

      const filename = `${payload.sub}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extForFile}`;
      fs.writeFileSync(path.join(uploadsDir, filename), buffer);

      const fullUrl = `${baseUrl}/uploads/${filename}`;
      await pool.query('UPDATE users SET profile_picture = ? WHERE id = ?', [fullUrl, payload.sub]);

      sendJson(res, 200, { message: 'Profile picture updated', profile_picture: fullUrl });
    } catch (error) {
      console.error('Profile picture upload error:', error);
      sendJson(res, 400, { message: error.message || 'Profile picture upload failed' });
    }
    return;
  }

  // Remove the logged-in user's profile picture
  if (method === 'DELETE' && url === '/profile/picture') {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const payload = verifyToken(token);
      if (!payload || !payload.sub) { sendJson(res, 401, { message: 'Unauthorized' }); return; }

      const [rows] = await pool.query('SELECT profile_picture FROM users WHERE id = ?', [payload.sub]);
      const currentUrl = rows[0] && rows[0].profile_picture;
      if (currentUrl && currentUrl.startsWith(`${baseUrl}/uploads/`)) {
        fs.unlink(path.join(uploadsDir, path.basename(currentUrl)), () => {});
      }
      await pool.query('UPDATE users SET profile_picture = NULL WHERE id = ?', [payload.sub]);
      sendJson(res, 200, { message: 'Profile picture removed' });
    } catch (error) {
      console.error('Profile picture delete error:', error);
      sendJson(res, 400, { message: error.message || 'Profile picture delete failed' });
    }
    return;
  }

  // Serve uploaded profile picture files
  if (method === 'GET' && url.startsWith('/uploads/')) {
    const filename = path.basename(url.slice('/uploads/'.length)); // strips any ../ traversal attempts
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeType = allowedImageTypes[ext];
    if (!mimeType) { sendJson(res, 404, { message: 'File not found' }); return; }

    fs.readFile(path.join(uploadsDir, filename), (err, data) => {
      if (err) { sendJson(res, 404, { message: 'File not found' }); return; }
      res.writeHead(200, { 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=31536000' });
      res.end(data);
    });
    return;
  }

  sendJson(res, 404, { message: 'Route not found' });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
