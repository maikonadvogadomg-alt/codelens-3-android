// SK Database Manager - Servidor Local
// Rode: node server.js
// Depois abra: http://localhost:3456

const http = require('http');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
let pool = null;

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Servir o HTML principal
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // Conectar ao banco
  if (req.method === 'POST' && req.url === '/connect') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { connectionString } = JSON.parse(body);
        if (pool) { try { await pool.end(); } catch(e){} }
        pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, msg: 'Conectado com sucesso!' }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Executar query
  if (req.method === 'POST' && req.url === '/query') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      if (!pool) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Não conectado. Conecte ao banco primeiro.' }));
        return;
      }
      try {
        const { sql } = JSON.parse(body);
        const result = await pool.query(sql);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, rows: result.rows, rowCount: result.rowCount, fields: result.fields?.map(f => f.name) || [] }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║    SK Database Manager — Servidor Local  ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  ✅ Rodando em: http://localhost:${PORT}   ║`);
  console.log('║  📋 Abra esse endereço no Chrome         ║');
  console.log('║  🛑 Para parar: pressione Ctrl+C         ║');
  console.log('╚══════════════════════════════════════════╝\n');
});
