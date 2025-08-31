// server.js
const path = require('path');
const express = require('express');

const app = express();

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static frontend
app.use('/', express.static(path.join(__dirname, 'public')));

// API (router-based)
const apiRouter = require('./router');
app.use('/api', apiRouter);

// Admin page
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// SPA fallback for any non-API route (no "*" so no path-to-regexp error)
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 4267;
app.listen(PORT, () => {
  console.log(`Leumas Portfolio running at http://localhost:${PORT}`);
});