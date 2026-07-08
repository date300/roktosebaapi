const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '123@456@789@0@',
    database: 'ltcmlgtn_rokto_seba'
  });
  const [rows] = await pool.query('SELECT 1 + 1 AS solution');
  console.log('Database connected. Test result:', rows[0].solution);
  await pool.end();
})();
