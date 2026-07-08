const { parseQuery, sendJson } = require('./utils');
const { authenticate } = require('./auth');
const { pool } = require('../db');

const compatibleDonorGroups = {
  'A+': ['A+','A-','O+','O-'],
  'A-': ['A-','O-'],
  'B+': ['B+','B-','O+','O-'],
  'B-': ['B-','O-'],
  'AB+': ['A+','A-','B+','B-','AB+','AB-','O+','O-'],
  'AB-': ['A-','B-','AB-','O-'],
  'O+': ['O+','O-'],
  'O-': ['O-']
};

function computeDonorAvailability(lastDonationDate) {
  if (!lastDonationDate) return true;
  const last = new Date(lastDonationDate);
  const diffDays = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 90;
}

async function getUserLocation(userId) {
  const [rows] = await pool.query('SELECT division, district, upazila FROM users WHERE id = ?', [userId]);
  return rows[0] || { division: null, district: null, upazila: null };
}

function buildProximityOrder(loc, alias = '') {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  const fragment = `CASE
      WHEN ${col('upazila')} = ? AND ${col('district')} = ? AND ${col('division')} = ? THEN 0
      WHEN ${col('district')} = ? AND ${col('division')} = ? THEN 1
      WHEN ${col('division')} = ? THEN 2
      ELSE 3
    END`;
  const values = [loc.upazila, loc.district, loc.division, loc.district, loc.division, loc.division];
  return { fragment, values };
}

module.exports = async function donorRoutes(req, res, method, url) {
  if (method === 'GET' && (url === '/donors' || url.startsWith('/donors?'))) {
    try {
      const auth = authenticate(req);
      if (auth.error) { sendJson(res, 401, { message: 'Unauthorized', reason: auth.error }); return true; }

      const q = parseQuery(url);
      const conditions = ["account_type = 'donor'"];
      const values = [];

      const bloodGroup = q.get('blood_group');
      const compatible = q.get('compatible') === 'true';
      if (bloodGroup) {
        if (!compatibleDonorGroups[bloodGroup]) {
          sendJson(res, 400, { message: 'Invalid blood group' });
          return true;
        }
        if (compatible) {
          const groups = compatibleDonorGroups[bloodGroup];
          conditions.push(`blood_group IN (${groups.map(() => '?').join(',')})`);
          values.push(...groups);
        } else {
          conditions.push('blood_group = ?');
          values.push(bloodGroup);
        }
      }

      const division = q.get('division');
      if (division) { conditions.push('division = ?'); values.push(division); }
      const district = q.get('district');
      if (district) { conditions.push('district = ?'); values.push(district); }
      const upazila = q.get('upazila');
      if (upazila) { conditions.push('upazila = ?'); values.push(upazila); }

      const search = q.get('search');
      if (search) {
        conditions.push('(first_name LIKE ? OR last_name LIKE ?)');
        const like = `%${search}%`;
        values.push(like, like);
      }

      const availableOnly = q.get('available_only') === 'true';
      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const limit = Math.min(Number(q.get('limit')) || 20, 100);
      const offset = Math.max(Number(q.get('offset')) || 0, 0);

      const viewerLocation = await getUserLocation(auth.payload.sub);
      const proximity = buildProximityOrder(viewerLocation);

      const [rows] = await pool.query(
        `SELECT id, first_name, last_name, blood_group, division, district, upazila,
                last_donation_date, profile_picture, phone
         FROM users
         ${whereClause}
         ORDER BY ${proximity.fragment} ASC, last_donation_date IS NULL DESC, last_donation_date ASC
         LIMIT ? OFFSET ?`,
        [...values, ...proximity.values, limit, offset]
      );

      let donors = rows.map(u => ({
        id: u.id,
        name: `${u.first_name} ${u.last_name}`.trim(),
        blood_group: u.blood_group,
        division: u.division,
        district: u.district,
        upazila: u.upazila,
        profile_picture: u.profile_picture,
        contact_number: u.phone,
        last_donation_date: u.last_donation_date,
        is_available: computeDonorAvailability(u.last_donation_date)
      }));

      if (availableOnly) {
        donors = donors.filter(d => d.is_available);
      }

      sendJson(res, 200, { count: donors.length, donors });
      return true;
    } catch (error) {
      console.error('Donors error:', error);
      sendJson(res, 400, { message: error.message || 'Failed' });
      return true;
    }
  }
  return false;
};