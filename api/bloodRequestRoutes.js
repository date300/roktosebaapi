const { getBody, parseQuery, sendJson } = require('./utils');
const { authenticate } = require('./auth');
const { pool } = require('../db');

// ---------- helpers ----------
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
  const values = [
    loc.upazila, loc.district, loc.division,
    loc.district, loc.division,
    loc.division
  ];
  return { fragment, values };
}

function formatRequest(r, currentUserId) {
  const isOwner = r.user_id === currentUserId;
  const isAnon = !!r.is_anonymous;
  const hidePoster = isAnon && !isOwner;
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
    detailed_address: r.detailed_address,
    urgency: r.urgency,
    patient_type: r.patient_type,
    contact_number: r.contact_number,
    additional_notes: r.additional_notes,
    is_anonymous: isAnon,
    status: r.status,
    created_at: r.created_at,
    is_owner: isOwner,
    poster: hidePoster ? null : {
      name: `${r.poster_first_name} ${r.poster_last_name}`.trim(),
      profile_picture: r.poster_profile_picture
    }
  };
}

// ---------- routes ----------
module.exports = async function bloodRequestRoutes(req, res, method, url) {
  // POST /blood-requests
  if (method === 'POST' && url === '/blood-requests') {
    try {
      const auth = authenticate(req);
      if (auth.error) { sendJson(res, 401, { message: 'Unauthorized', reason: auth.error }); return true; }
      const payload = auth.payload;
      const body = await getBody(req);

      const requestType = (body.request_type || 'NEED').toUpperCase();
      if (!['NEED','DONATE'].includes(requestType)) {
        sendJson(res, 400, { message: "request_type must be 'NEED' or 'DONATE'" });
        return true;
      }

      const requiredFields = ['blood_group','units','division','district','upazila','contact_number'];
      if (requestType === 'NEED') {
        requiredFields.push('patient_name','hospital_name','urgency','patient_type');
      }
      for (const f of requiredFields) {
        if (body[f] === undefined || body[f] === null || body[f] === '') {
          sendJson(res, 400, { message: `${f} is required` });
          return true;
        }
      }

      const validBloodGroups = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
      if (!validBloodGroups.includes(body.blood_group)) {
        sendJson(res, 400, { message: 'Invalid blood group' });
        return true;
      }
      const units = Number(body.units);
      if (!Number.isInteger(units) || units <= 0) {
        sendJson(res, 400, { message: 'units must be positive integer' });
        return true;
      }

      if (requestType === 'NEED') {
        const validUrgency = ['NOW','TODAY','WITHIN_3_DAYS','WITHIN_WEEK'];
        if (!validUrgency.includes(body.urgency)) {
          sendJson(res, 400, { message: 'Invalid urgency' });
          return true;
        }
        const validPatientType = ['OPERATION','ACCIDENT','THALASSEMIA','DELIVERY','OTHER'];
        if (!validPatientType.includes(body.patient_type)) {
          sendJson(res, 400, { message: 'Invalid patient type' });
          return true;
        }
      }

      const isAnonymous = body.is_anonymous === true ? 1 : 0;
      const [result] = await pool.query(
        `INSERT INTO blood_requests 
         (user_id, request_type, patient_name, blood_group, units, hospital_name, division, district, upazila, detailed_address, urgency, patient_type, contact_number, additional_notes, is_anonymous, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [payload.sub, requestType, body.patient_name || null, body.blood_group, units,
         body.hospital_name || null, body.division, body.district, body.upazila,
         body.detailed_address || null, body.urgency || null, body.patient_type || null,
         body.contact_number, body.additional_notes || null, isAnonymous, 'ACTIVE']
      );

      const [rows] = await pool.query('SELECT * FROM blood_requests WHERE id = ?', [result.insertId]);
      sendJson(res, 201, {
        message: `Blood ${requestType === 'NEED' ? 'request' : 'donation offer'} created`,
        request: formatRequest(rows[0], payload.sub)
      });
      return true;
    } catch (error) {
      console.error('Create blood request error:', error);
      sendJson(res, 400, { message: error.message || 'Creation failed' });
      return true;
    }
  }

  // GET /blood-requests (list)
  if (method === 'GET' && (url === '/blood-requests' || url.startsWith('/blood-requests?'))) {
    try {
      const auth = authenticate(req);
      if (auth.error) { sendJson(res, 401, { message: 'Unauthorized', reason: auth.error }); return true; }
      const currentUserId = auth.payload.sub;
      const q = parseQuery(url);

      const conditions = [];
      const values = [];

      const requestType = q.get('request_type');
      if (requestType) {
        if (!['NEED','DONATE'].includes(requestType.toUpperCase())) {
          sendJson(res, 400, { message: "Invalid request_type" });
          return true;
        }
        conditions.push('br.request_type = ?');
        values.push(requestType.toUpperCase());
      }

      const bloodGroup = q.get('blood_group');
      if (bloodGroup) { conditions.push('br.blood_group = ?'); values.push(bloodGroup); }

      const division = q.get('division');
      if (division) { conditions.push('br.division = ?'); values.push(division); }
      const district = q.get('district');
      if (district) { conditions.push('br.district = ?'); values.push(district); }
      const upazila = q.get('upazila');
      if (upazila) { conditions.push('br.upazila = ?'); values.push(upazila); }

      const status = q.get('status') || 'ACTIVE';
      if (status !== 'ALL') { conditions.push('br.status = ?'); values.push(status); }

      if (q.get('my') === 'true') {
        conditions.push('br.user_id = ?');
        values.push(currentUserId);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.min(Number(q.get('limit')) || 20, 100);
      const offset = Math.max(Number(q.get('offset')) || 0, 0);

      const viewerLocation = await getUserLocation(currentUserId);
      const proximity = buildProximityOrder(viewerLocation, 'br');

      const [rows] = await pool.query(
        `SELECT br.*, u.first_name AS poster_first_name, u.last_name AS poster_last_name,
                u.profile_picture AS poster_profile_picture
         FROM blood_requests br
         JOIN users u ON u.id = br.user_id
         ${whereClause}
         ORDER BY ${proximity.fragment} ASC, br.created_at DESC
         LIMIT ? OFFSET ?`,
        [...values, ...proximity.values, limit, offset]
      );

      const requests = rows.map(r => formatRequest(r, currentUserId));
      sendJson(res, 200, { count: requests.length, requests });
      return true;
    } catch (error) {
      console.error('List blood requests error:', error);
      sendJson(res, 400, { message: error.message || 'Failed to fetch' });
      return true;
    }
  }

  // GET /blood-requests/:id
  if (method === 'GET' && /^\/blood-requests\/\d+$/.test(url)) {
    try {
      const auth = authenticate(req);
      if (auth.error) { sendJson(res, 401, { message: 'Unauthorized' }); return true; }
      const currentUserId = auth.payload.sub;
      const id = Number(url.split('/')[2]);

      const [rows] = await pool.query(
        `SELECT br.*, u.first_name AS poster_first_name, u.last_name AS poster_last_name,
                u.profile_picture AS poster_profile_picture
         FROM blood_requests br
         JOIN users u ON u.id = br.user_id
         WHERE br.id = ?`, [id]
      );

      if (rows.length === 0) { sendJson(res, 404, { message: 'Not found' }); return true; }
      sendJson(res, 200, { request: formatRequest(rows[0], currentUserId) });
      return true;
    } catch (error) {
      console.error(error);
      sendJson(res, 400, { message: 'Failed to fetch' });
      return true;
    }
  }

  // PUT /blood-requests/:id (update)
  if (method === 'PUT' && /^\/blood-requests\/\d+$/.test(url)) {
    try {
      const auth = authenticate(req);
      if (auth.error) { sendJson(res, 401, { message: 'Unauthorized' }); return true; }
      const currentUserId = auth.payload.sub;
      const id = Number(url.split('/')[2]);
      const [ownerCheck] = await pool.query('SELECT * FROM blood_requests WHERE id = ? AND user_id = ?', [id, currentUserId]);
      if (ownerCheck.length === 0) {
        sendJson(res, 404, { message: 'Not found or not owned' });
        return true;
      }

      const body = await getBody(req);
      const allowedUpdates = ['blood_group','units','division','district','upazila','detailed_address',
                              'contact_number','additional_notes','is_anonymous','status',
                              'patient_name','hospital_name','urgency','patient_type'];
      const updates = [];
      const updateValues = [];
      for (const key of allowedUpdates) {
        if (body[key] !== undefined) {
          updates.push(`${key} = ?`);
          updateValues.push(body[key]);
        }
      }
      if (updates.length === 0) {
        sendJson(res, 400, { message: 'No valid fields' });
        return true;
      }

      updateValues.push(id);
      await pool.query(`UPDATE blood_requests SET ${updates.join(', ')} WHERE id = ?`, updateValues);

      const [updated] = await pool.query(
        `SELECT br.*, u.first_name AS poster_first_name, u.last_name AS poster_last_name,
                u.profile_picture AS poster_profile_picture
         FROM blood_requests br JOIN users u ON u.id = br.user_id
         WHERE br.id = ?`, [id]
      );
      sendJson(res, 200, { message: 'Updated', request: formatRequest(updated[0], currentUserId) });
      return true;
    } catch (error) {
      console.error(error);
      sendJson(res, 400, { message: 'Update failed' });
      return true;
    }
  }

  // DELETE /blood-requests/:id
  if (method === 'DELETE' && /^\/blood-requests\/\d+$/.test(url)) {
    try {
      const auth = authenticate(req);
      if (auth.error) { sendJson(res, 401, { message: 'Unauthorized' }); return true; }
      const currentUserId = auth.payload.sub;
      const id = Number(url.split('/')[2]);

      const [result] = await pool.query('DELETE FROM blood_requests WHERE id = ? AND user_id = ?', [id, currentUserId]);
      if (result.affectedRows === 0) {
        sendJson(res, 404, { message: 'Not found or not owned' });
        return true;
      }
      sendJson(res, 200, { message: 'Deleted' });
      return true;
    } catch (error) {
      console.error(error);
      sendJson(res, 400, { message: 'Delete failed' });
      return true;
    }
  }

  return false;
};