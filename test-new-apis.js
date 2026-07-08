const http = require('http');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('--- Testing New APIs ---');

  // 1. Login to get token
  console.log('Logging in...');
  const loginRes = await request('POST', '/login', {
    email: 'test@example.com', // Assuming this exists or using a dummy
    password: 'password'
  });

  let token = null;
  if (loginRes.status === 200) {
    token = loginRes.body.token;
    console.log('Login successful');
  } else {
    console.log('Login failed (might need to signup first or use existing user)');
  }

  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

  // 2. Test Blood Banks
  console.log('\nTesting GET /blood-banks...');
  const bbRes = await request('GET', '/blood-banks');
  console.log('Status:', bbRes.status);
  console.log('Count:', bbRes.body?.count);

  // 3. Test Donation History (needs auth)
  if (token) {
    console.log('\nTesting GET /donations...');
    const donRes = await request('GET', '/donations', null, authHeaders);
    console.log('Status:', donRes.status);
    console.log('Donations:', donRes.body?.donations?.length);

    console.log('\nTesting POST /donations...');
    const newDonRes = await request('POST', '/donations', {
      donation_date: '2023-10-01',
      location: 'Dhaka Medical College',
      notes: 'Test donation'
    }, authHeaders);
    console.log('Status:', newDonRes.status);
    console.log('Message:', newDonRes.body?.message);

    console.log('\nTesting Profile Update (account_type)...');
    const profRes = await request('PUT', '/profile', {
      account_type: 'donor'
    }, authHeaders);
    console.log('Status:', profRes.status);
    console.log('Account Type:', profRes.body?.user?.account_type);
  } else {
    console.log('\nSkipping Auth-required tests due to missing token');
  }

  console.log('\n--- Tests Completed ---');
}

runTests().catch(console.error);
