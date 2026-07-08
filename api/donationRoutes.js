const { getBody, sendJson } = require('./utils');
const { authenticate } = require('./auth');
const { pool } = require('../db');

module.exports = async function donationRoutes(req, res, method, url) {
  const auth = authenticate(req);
  if (auth.error) {
    if (url.startsWith('/donations')) {
      sendJson(res, 401, { message: 'Unauthorized', reason: auth.error });
      return true;
    }
    return false;
  }
  const userId = auth.payload.sub;

  // GET /donations
  if (method === 'GET' && url === '/donations') {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM donations WHERE user_id = ? ORDER BY donation_date DESC',
        [userId]
      );
      sendJson(res, 200, { donations: rows });
      return true;
    } catch (error) {
      console.error('Donations GET error:', error);
      sendJson(res, 500, { message: 'Internal server error' });
      return true;
    }
  }

  // POST /donations
  if (method === 'POST' && url === '/donations') {
    try {
      const body = await getBody(req);
      const { donation_date, location, notes } = body;

      if (!donation_date || !location) {
        sendJson(res, 400, { message: 'donation_date and location are required' });
        return true;
      }

      const [result] = await pool.query(
        'INSERT INTO donations (user_id, donation_date, location, notes) VALUES (?, ?, ?, ?)',
        [userId, donation_date, location, notes || null]
      );

      // Also update last_donation_date in users table if this is the newest donation
      const [userRows] = await pool.query('SELECT last_donation_date FROM users WHERE id = ?', [userId]);
      const currentLast = userRows[0].last_donation_date;
      if (!currentLast || new Date(donation_date) > new Date(currentLast)) {
        await pool.query('UPDATE users SET last_donation_date = ? WHERE id = ?', [donation_date, userId]);
      }

      sendJson(res, 201, { message: 'Donation recorded', id: result.insertId });
      return true;
    } catch (error) {
      console.error('Donations POST error:', error);
      sendJson(res, 500, { message: 'Internal server error' });
      return true;
    }
  }

  return false;
};
