require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Database = require('better-sqlite3');

const app = express();
const port = Number(process.env.PORT || 5000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000').split(',').map(s => s.trim());
const db = new Database('dream-decor.db');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  service TEXT NOT NULL,
  location TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
const insertEnquiry = db.prepare(`INSERT INTO enquiries (name, phone, email, service, location, message) VALUES (@name, @phone, @email, @service, @location, @message)`);

app.use(helmet());
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return callback(null, true);
  return callback(new Error('Origin not allowed by CORS'));
}}));
app.use(express.json({ limit: '20kb' }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'Dream Decor API' }));

app.post('/api/enquiries', (req, res) => {
  const fields = ['name', 'phone', 'email', 'service', 'location', 'message'];
  const data = {};
  for (const field of fields) {
    if (typeof req.body[field] !== 'string' || !req.body[field].trim()) {
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
    const result = insertEnquiry.run(data);
    const saved = db.prepare('SELECT id, name, phone, email, service, location, message, created_at FROM enquiries WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({ success: true, message: 'Enquiry saved successfully.', enquiry: saved });
  } catch (err) {
    console.error('Saving enquiry failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save enquiry.' });
  }
});

// Protect this endpoint with authentication before exposing it publicly.
app.get('/api/enquiries', (req, res) => {
  if (process.env.ADMIN_API_KEY && req.get('x-admin-key') !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ success: false, message: 'Valid x-admin-key header required.' });
  }
  const rows = db.prepare('SELECT id, name, phone, email, service, location, message, created_at FROM enquiries ORDER BY id DESC LIMIT 500').all();
  res.json({ success: true, count: rows.length, enquiries: rows });
});

app.use((err, _req, res, _next) => {
  if (err.message === 'Origin not allowed by CORS') return res.status(403).json({ success: false, message: err.message });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ success: false, message: 'Invalid JSON body.' });
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

app.listen(port, () => console.log(`Dream Decor API running at http://localhost:${port}`));
