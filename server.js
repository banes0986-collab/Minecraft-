/**
 * CraftHosting - Sunucu Test Paneli (backend)
 * ---------------------------------------------
 * Tarayıcıdan gelen host/port/kullanıcı adı bilgisiyle bot.js'i
 * bir alt işlem (child process) olarak çalıştırır ve çıktısını
 * Server-Sent Events (SSE) ile canlı olarak panele akıtır.
 *
 * Çalıştırma:
 *   npm install
 *   node server.js
 *   -> http://localhost:3000
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Aynı anda çok fazla test başlatılmasını önlemek için basit bir kilit
let running = false;

app.get('/api/test', (req, res) => {
  const host = (req.query.host || '').trim();
  const port = parseInt(req.query.port, 10) || 25565;
  const username = (req.query.username || 'TestBot').trim();

  if (!host) {
    res.status(400).json({ error: 'host parametresi zorunlu' });
    return;
  }
  if (running) {
    res.status(429).json({ error: 'Şu anda başka bir test çalışıyor, lütfen bekleyin.' });
    return;
  }

  // SSE başlıkları
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const send = (line) => res.write(`data: ${line}\n\n`);

  running = true;
  send(`Bağlanılıyor -> ${host}:${port} (kullanıcı: ${username})`);

  const child = spawn('node', ['bot.js', host, String(port), username], {
    cwd: __dirname,
  });

  child.stdout.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach(send);
  });

  child.stderr.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach((l) => send(`STDERR: ${l}`));
  });

  child.on('close', (code) => {
    send(`[SON] İşlem çıkış kodu: ${code}`);
    res.write('event: done\ndata: {}\n\n');
    res.end();
    running = false;
  });

  // İstemci bağlantıyı keserse alt işlemi de sonlandır
  req.on('close', () => {
    if (!child.killed) child.kill();
    running = false;
  });
});

app.listen(PORT, () => {
  console.log(`Panel çalışıyor: http://localhost:${PORT}`);
});
