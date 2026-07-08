const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'ltcmlgtn_mine_matrix',
  password: process.env.DB_PASSWORD || '123@456@789@0@',
  database: process.env.DB_NAME || 'ltcmlgtn_rokto_seba',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Public base URL of this API — used to build full links (e.g. profile picture URLs)
// that get saved in the database. Override with BASE_URL env var if the domain changes.
const baseUrl = process.env.BASE_URL || 'https://api.ltcminematrix.com/api';

// Where uploaded profile pictures are stored on disk
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Secondary uploads dir for legacy or subfolder compatibility
const apiUploadsDir = path.join(__dirname, 'api', 'uploads');
if (!fs.existsSync(apiUploadsDir)) fs.mkdirSync(apiUploadsDir, { recursive: true });

const allowedImageTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const maxImageBytes = 5 * 1024 * 1024; // 5MB

module.exports = { pool, baseUrl, uploadsDir, allowedImageTypes, maxImageBytes };