const { getBody, sendJson } = require('./utils');
const { createToken, hashPassword } = require('./auth');
const { pool } = require('../db');

async function handleSignup(req, res) {
  try {
    const body = await getBody(req);

    const fields = [
      'first_name','last_name','email','phone','password','confirm_password',
      'account_type','gender','dob','blood_group','division','district','upazila',
      'emergency_contact'
    ];
    for (const f of fields) {
      if (!body[f]) {
        sendJson(res, 400, { message: `${f} is required` });
        return;
      }
    }
    if (body.password !== body.confirm_password) {
      sendJson(res, 400, { message: 'Passwords do not match' });
      return;
    }

    const [dup] = await pool.query('SELECT id FROM users WHERE email = ?', [body.email]);
    if (dup.length > 0) {
      sendJson(res, 409, { message: 'Email already exists' });
      return;
    }

    const hp = hashPassword(body.password);
    const [result] = await pool.query(
      `INSERT INTO users 
       (first_name,last_name,email,phone,password,account_type,gender,dob,blood_group,division,district,upazila,emergency_contact,last_donation_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        body.first_name, body.last_name, body.email, body.phone,
        hp, body.account_type, body.gender, body.dob, body.blood_group,
        body.division, body.district, body.upazila, body.emergency_contact,
        body.last_donation_date || null
      ]
    );

    const uid = result.insertId;
    const token = createToken({ sub: uid });

    const { password, confirm_password, ...safeBody } = body;
    sendJson(res, 201, {
      message: 'Signup successful',
      token,
      user: { id: uid, ...safeBody }
    });
  } catch (error) {
    console.error('Signup error:', error);
    sendJson(res, 400, { message: error.message || 'Signup failed' });
  }
}

async function handleLogin(req, res) {
  try {
    const body = await getBody(req);
    const { email, password } = body;
    if (!email || !password) {
      sendJson(res, 400, { message: 'Email and password are required' });
      return;
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0 || rows[0].password !== hashPassword(password)) {
      sendJson(res, 401, { message: 'Invalid email or password' });
      return;
    }

    const user = rows[0];
    const token = createToken({ sub: user.id });

    const { password: _, ...userWithoutPassword } = user;
    sendJson(res, 200, {
      message: 'Login successful',
      token,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Login error:', error);
    sendJson(res, 400, { message: error.message || 'Login failed' });
  }
}

module.exports = async function authRoutes(req, res, method, url) {
  if (method === 'POST' && url === '/signup') {
    await handleSignup(req, res);
    return true;
  }
  if (method === 'POST' && url === '/login') {
    await handleLogin(req, res);
    return true;
  }
  return false;
};