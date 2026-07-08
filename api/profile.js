const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const { pool, uploadsDir, baseUrl, allowedImageTypes } = require('../db');
const { sendJson } = require('./utils');
const { authenticate } = require('./auth');

// ---------- Helper: ensure uploads folder exists ----------
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ---------- Function to handle multipart file upload using Busboy ----------
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const fields = {};
    const files = [];
    let fileCount = 0;

    busboy.on('field', (name, val) => {
      fields[name] = val;
    });

    busboy.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      // Only accept images
      const ext = path.extname(filename).slice(1).toLowerCase();
      if (!allowedImageTypes[ext]) {
        file.resume(); // ignore unsupported files
        return;
      }
      const newFilename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      const savePath = path.join(__dirname, '..', 'uploads', newFilename);
      const writeStream = fs.createWriteStream(savePath);
      file.pipe(writeStream);
      fileCount++;
      files.push({
        fieldname,
        originalFilename: filename,
        newFilename,
        savedPath: savePath,
        mimeType
      });
    });

    busboy.on('finish', () => {
      resolve({ fields, files });
    });

    busboy.on('error', (err) => {
      reject(err);
    });

    // Pipe the request into busboy
    req.pipe(busboy);
  });
}

// ---------- Profile Routes ----------
module.exports = async function handleProfileRoutes(req, res, method, url) {
  // All profile routes require authentication
  const auth = authenticate(req);
  if (auth.error) {
    sendJson(res, 401, { message: 'Unauthorized', reason: auth.error });
    return true;
  }
  const userId = auth.payload.sub;

  // ---------- GET /profile ----------
  if (method === 'GET' && url === '/profile') {
    try {
      const [rows] = await pool.query(
        'SELECT id, first_name, last_name, email, phone, account_type, gender, dob, blood_group, division, district, upazila, emergency_contact, last_donation_date, created_at, profile_picture FROM users WHERE id = ?',
        [userId]
      );
      if (rows.length === 0) {
        sendJson(res, 404, { message: 'User not found' });
        return true;
      }
      const user = rows[0];
      // Convert profile_picture to full URL if stored relative
      if (user.profile_picture && !user.profile_picture.startsWith('http')) {
        user.profile_picture = `${baseUrl}/uploads/${user.profile_picture}`;
      }
      sendJson(res, 200, { user });
      return true;
    } catch (error) {
      console.error('Profile get error:', error);
      sendJson(res, 400, { message: 'Failed to fetch profile' });
      return true;
    }
  }

  // ---------- PUT /profile (update profile fields) ----------
  if (method === 'PUT' && url === '/profile') {
    try {
      const body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => {
          try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); }
        });
      });

      // Fields allowed to update
      const allowedFields = [
        'first_name', 'last_name', 'phone', 'emergency_contact',
        'blood_group', 'division', 'district', 'upazila',
        'gender', 'dob', 'last_donation_date', 'account_type'
      ];
      const updates = [];
      const values = [];

      for (const key of allowedFields) {
        if (body[key] !== undefined) {
          updates.push(`${key} = ?`);
          values.push(body[key]);
        }
      }

      if (updates.length === 0) {
        sendJson(res, 400, { message: 'No valid fields to update' });
        return true;
      }

      values.push(userId);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

      // Return updated profile
      const [updated] = await pool.query(
        'SELECT id, first_name, last_name, email, phone, account_type, gender, dob, blood_group, division, district, upazila, emergency_contact, last_donation_date, created_at, profile_picture FROM users WHERE id = ?',
        [userId]
      );
      const user = updated[0];
      if (user.profile_picture && !user.profile_picture.startsWith('http')) {
        user.profile_picture = `${baseUrl}/uploads/${user.profile_picture}`;
      }
      sendJson(res, 200, { message: 'Profile updated', user });
      return true;
    } catch (error) {
      console.error('Profile update error:', error);
      sendJson(res, 400, { message: 'Update failed' });
      return true;
    }
  }

  // ---------- POST /profile/picture (upload new picture) ----------
  if (method === 'POST' && url === '/profile/picture') {
    try {
      const { files } = await parseMultipart(req);
      if (files.length === 0) {
        sendJson(res, 400, { message: 'No image file uploaded' });
        return true;
      }

      const newPic = files[0].newFilename;

      // Update user's profile_picture in DB (store relative path)
      await pool.query('UPDATE users SET profile_picture = ? WHERE id = ?', [newPic, userId]);

      sendJson(res, 200, {
        message: 'Profile picture uploaded',
        profile_picture: `${baseUrl}/uploads/${newPic}`
      });
      return true;
    } catch (error) {
      console.error('Profile picture upload error:', error);
      sendJson(res, 400, { message: 'Upload failed' });
      return true;
    }
  }

  // ---------- DELETE /profile/picture (remove picture) ----------
  if (method === 'DELETE' && url === '/profile/picture') {
    try {
      // Get current picture filename from DB
      const [rows] = await pool.query('SELECT profile_picture FROM users WHERE id = ?', [userId]);
      if (rows.length === 0) {
        sendJson(res, 404, { message: 'User not found' });
        return true;
      }
      const currentPic = rows[0].profile_picture;

      if (currentPic) {
        // Delete the file from disk
        const filePath = path.join(uploadsDir, currentPic);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        // Clear DB field
        await pool.query('UPDATE users SET profile_picture = NULL WHERE id = ?', [userId]);
      }

      sendJson(res, 200, { message: 'Profile picture removed' });
      return true;
    } catch (error) {
      console.error('Delete profile picture error:', error);
      sendJson(res, 400, { message: 'Delete failed' });
      return true;
    }
  }

  // If no matching route
  return false;
};