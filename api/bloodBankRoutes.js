const { parseQuery, sendJson } = require('./utils');
const { pool } = require('../db');

module.exports = async function bloodBankRoutes(req, res, method, url) {
  if (method === 'GET' && (url === '/blood-banks' || url.startsWith('/blood-banks?'))) {
    try {
      const q = parseQuery(url);
      const conditions = [];
      const values = [];

      const division = q.get('division');
      if (division) { conditions.push('division = ?'); values.push(division); }
      const district = q.get('district');
      if (district) { conditions.push('district = ?'); values.push(district); }
      const upazila = q.get('upazila');
      if (upazila) { conditions.push('upazila = ?'); values.push(upazila); }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const [rows] = await pool.query(
        `SELECT * FROM blood_banks ${whereClause} ORDER BY name ASC`,
        values
      );

      sendJson(res, 200, { count: rows.length, blood_banks: rows });
      return true;
    } catch (error) {
      console.error('Blood banks error:', error);
      sendJson(res, 500, { message: 'Internal server error' });
      return true;
    }
  }
  return false;
};
