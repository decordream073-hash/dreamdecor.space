require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 5000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN ||
  'https://dreamdecor.space,https://www.dreamdecor.space,http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!process.env.DATABASE_URL) {
  console.error('Missing required environment variable: DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS enquiries (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(150) NOT NULL,
    service VARCHAR(120) NOT NULL,
    location VARCHAR(150) NOT NULL,
    message VARCHAR(3000) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

app.use(helmet());
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return callback(null, true);
  return callback(new Error('Origin not allowed by CORS'));
}}));
app.use(express.json({ limit: '20kb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'Dream Decor API', database: 'connected' });
  } catch (err) {
    console.error('Database health check failed:', err.message);
    res.status(503).json({ status: 'error', service: 'Dream Decor API', database: 'unavailable' });
  }
});

app.post('/api/enquiries', async (req, res) => {
  const fields = ['name', 'phone', 'email', 'service', 'location', 'message'];
  const data = {};
  for (const field of fields) {
    if (typeof (req.body || {})[field] !== 'string' || !req.body[field].trim()) {
      return res.status(400).json({ success: false, message: `The ${field} field is required.` });
    }
    data[field] = req.body[field].trim();
  }
  if (data.name.length > 100 || data.phone.length > 20 || data.email.length > 150 || data.service.length > 120 || data.location.length > 150 || data.message.length > 3000) {
    return res.status(400).json({ success: false, message: 'One or more fields exceed the allowed length.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
  if (!/^[0-9+()\s-]{8,20}$/.test(data.phone)) return res.status(400).json({ success: false, message: 'Please provide a valid phone number.' });
  try {
    const result = await pool.query(
      `INSERT INTO enquiries (name, phone, email, service, location, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, phone, email, service, location, message, created_at`,
      [data.name, data.phone, data.email, data.service, data.location, data.message]
    );
    return res.status(201).json({ success: true, message: 'Enquiry saved successfully.', enquiry: result.rows[0] });
  } catch (err) {
    console.error('Saving enquiry failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save enquiry.' });
  }
});

app.get('/api/enquiries', async (req, res) => {
  if (!process.env.ADMIN_API_KEY || req.get('x-admin-key') !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ success: false, message: 'Valid x-admin-key header required.' });
  }
  try {
    const result = await pool.query(
      'SELECT id, name, phone, email, service, location, message, created_at FROM enquiries ORDER BY id DESC LIMIT 500'
    );
    res.json({ success: true, count: result.rows.length, enquiries: result.rows });
  } catch (err) {
    console.error('Fetching enquiries failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not fetch enquiries.' });
  }
});

app.use((err, _req, res, _next) => {
  if (err.message === 'Origin not allowed by CORS') return res.status(403).json({ success: false, message: err.message });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ success: false, message: 'Invalid JSON body.' });
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

initDb()
  .then(() => app.listen(port, () => console.log(`Dream Decor API running on port ${port}; PostgreSQL connected.`)))
  .catch(err => {
    console.error('Could not initialize PostgreSQL:', err.message);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
