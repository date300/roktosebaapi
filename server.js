const http = require('http');
const fs = require('fs');
const path = require('path');
const { pool, baseUrl, uploadsDir, allowedImageTypes } = require('./db');
const { sendJson } = require('./api/utils');
const handleProfileRoutes = require('./api/profile');   // ✅ ঠিক করা ইম্পোর্ট
const authRoutes = require('./api/authRoutes');
const bloodRequestRoutes = require('./api/bloodRequestRoutes');
const donorRoutes = require('./api/donorRoutes');
const dashboardRoutes = require('./api/dashboardRoutes');

const port = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // /api prefix strip for Passenger
  if (req.url.startsWith('/api')) {
    req.url = req.url.replace('/api', '') || '/';
  }

  const { method, url } = req;

  // Health check
  if (method === 'GET' && url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  // Auth routes
  if (await authRoutes(req, res, method, url)) return;

  // Profile routes
  if (await handleProfileRoutes(req, res, method, url)) return;

  // Blood request routes
  if (await bloodRequestRoutes(req, res, method, url)) return;

  // Donor routes
  if (await donorRoutes(req, res, method, url)) return;

  // Dashboard routes
  if (await dashboardRoutes(req, res, method, url)) return;

  // Static file serving (uploads)
  if (method === 'GET' && url.startsWith('/uploads/')) {
    const filename = path.basename(url.slice('/uploads/'.length));
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