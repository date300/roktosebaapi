const { sendJson } = require('./utils');
const { authenticate } = require('./auth');
const { pool, baseUrl } = require('../db');

module.exports = async function dashboardRoutes(req, res, method, url) {
  if (method === 'GET' && url === '/dashboard') {
    try {
      const auth = authenticate(req);
      if (auth.error) { sendJson(res, 401, { message: 'Unauthorized', reason: auth.error }); return true; }

      const [[donorCount]] = await pool.query("SELECT COUNT(*) AS count FROM users WHERE account_type = 'donor'");
      const [[activeNeed]] = await pool.query("SELECT COUNT(*) AS count FROM blood_requests WHERE request_type = 'NEED' AND status = 'ACTIVE'");
      const [[activeDonate]] = await pool.query("SELECT COUNT(*) AS count FROM blood_requests WHERE request_type = 'DONATE' AND status = 'ACTIVE'");
      const [[fulfilled]] = await pool.query("SELECT COUNT(*) AS count FROM blood_requests WHERE status = 'FULFILLED'");

      const [urgentRows] = await pool.query(
        `SELECT br.*, u.first_name AS poster_first_name, u.last_name AS poster_last_name,
                u.profile_picture AS poster_profile_picture
         FROM blood_requests br JOIN users u ON u.id = br.user_id
         WHERE br.request_type = 'NEED' AND br.status = 'ACTIVE' AND br.urgency = 'NOW'
         ORDER BY br.created_at DESC LIMIT 5`
      );

      const [recentRows] = await pool.query(
        `SELECT br.*, u.first_name AS poster_first_name, u.last_name AS poster_last_name,
                u.profile_picture AS poster_profile_picture
         FROM blood_requests br JOIN users u ON u.id = br.user_id
         WHERE br.status = 'ACTIVE'
         ORDER BY br.created_at DESC LIMIT 10`
      );

      const formatRow = (r) => {
        const isAnon = !!r.is_anonymous;

        let profilePic = r.poster_profile_picture;
        if (profilePic && !profilePic.startsWith('http')) {
          profilePic = `${baseUrl}/uploads/${profilePic}`;
        }

        return {
          id: r.id,
          request_type: r.request_type,
          patient_name: r.patient_name,
          blood_group: r.blood_group,
          units: r.units,
          hospital_name: r.hospital_name,
          division: r.division,
          district: r.district,
          upazila: r.upazila,
          urgency: r.urgency,
          patient_type: r.patient_type,
          is_anonymous: isAnon,
          status: r.status,
          created_at: r.created_at,
          poster: isAnon ? null : {
            name: `${r.poster_first_name} ${r.poster_last_name}`.trim(),
            profile_picture: profilePic
          }
        };
      };

      sendJson(res, 200, {
        stats: {
          total_donors: donorCount.count,
          active_need_requests: activeNeed.count,
          active_donate_offers: activeDonate.count,
          fulfilled_requests: fulfilled.count
        },
        urgent_requests: urgentRows.map(formatRow),
        recent_requests: recentRows.map(formatRow)
      });
      return true;
    } catch (error) {
      console.error('Dashboard error:', error);
      sendJson(res, 400, { message: error.message || 'Failed' });
      return true;
    }
  }
  return false;
};