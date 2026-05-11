const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbyScn2vcaOb_YCiTIRw-I-NugkZ4Zbt0hY5LgrM5D-WroSy-iuNhb9ewxoGcyZW63fsBw/exec';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sheets', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const target = `${APPS_SCRIPT_URL}${qs ? `?${qs}` : ''}`;

    const upstream = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Accept': 'application/json' }
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.set('Cache-Control', 'no-store');
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.type(ct).send(text);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(502).json({ error: 'upstream_error', message: String(err && err.message || err) });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ezone-managers listening on port ${PORT}`);
});
