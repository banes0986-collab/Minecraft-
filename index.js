/**
 * Minecraft Server Load Test Tool
 * ---------------------------------
 * Özünüzün Minecraft hostinq serverlərini test etmək üçün nəzərdə tutulub.
 * Real protokol vasitəsilə "bot" oyunçular qoşulur (mineflayer), yüngül
 * hərəkət edir (real oyunçu davranışına bənzəsin deyə) və paralel olaraq
 * RCON üzərindən serverin TPS (tick per second) dəyərini izləyib CSV-yə yazır.
 *
 * DİQQƏT: Bu aləti YALNIZ sahibi olduğunuz və ya test etməyə icazəniz olan
 * serverlərdə istifadə edin. İcazəsiz serverlərə qarşı istifadə DDoS hesab
 * oluna bilər və qanunsuzdur.
 */

const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { Rcon } = require('rcon-client');

// ---- Konfiqurasiyanı yüklə ----
const configPath = process.argv[2] || path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(`Config tapılmadı: ${configPath}`);
  console.error(`Əvvəlcə config.example.json faylını config.json kimi kopyalayıb düzəldin.`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const logFile = path.join(__dirname, config.output.logFile || 'test.log');
const csvFile = path.join(__dirname, config.output.csvFile || 'results.csv');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

// CSV başlığı
if (!fs.existsSync(csvFile)) {
  fs.writeFileSync(csvFile, 'timestamp,elapsed_sec,connected_bots,tps,mspt\n');
}

// ---- Vəziyyət ----
const bots = [];
let connectedCount = 0;
let startTime = Date.now();
let stopping = false;

// ---- Bot yaratma funksiyası ----
function spawnBot(index) {
  const username = `${config.test.botNamePrefix || 'LT_'}${index}`;
  const bot = mineflayer.createBot({
    host: config.server.host,
    port: config.server.port || 25565,
    username,
    version: config.server.version || false, // false = avtomatik aşkarla
    auth: 'offline' // Əksər test/offline-mode serverlər üçün. Online-mode (Mojang auth)
                     // tələb edən serverlər üçün əlavə hesab konfiqurasiyası lazımdır.
  });

  bot.on('spawn', () => {
    connectedCount++;
    log(`✅ ${username} qoşuldu (${connectedCount}/${config.test.totalBots} aktiv)`);

    if (config.test.behavior === 'wander') {
      startWandering(bot);
    }
  });

  bot.on('kicked', (reason) => {
    log(`⚠️  ${username} kick edildi: ${JSON.stringify(reason)}`);
  });

  bot.on('error', (err) => {
    log(`❌ ${username} xəta: ${err.message}`);
  });

  bot.on('end', () => {
    connectedCount = Math.max(0, connectedCount - 1);
    if (!stopping) {
      log(`🔌 ${username} bağlantısı kəsildi (${connectedCount}/${config.test.totalBots} aktiv)`);
    }
  });

  bots.push(bot);
}

// Real oyunçu kimi yüngül hərəkət: təsadüfi istiqamətdə addımlama + baxış bucağı
function startWandering(bot) {
  const interval = setInterval(() => {
    if (!bot.entity) return;
    try {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * 0.5;
      bot.look(yaw, pitch, true);

      // Təsadüfi olaraq bir az irəli yeriş (server-ə chunk-loading/movement paketi göndərir)
      if (Math.random() > 0.5) {
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 800);
      }
      if (Math.random() > 0.85) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 300);
      }
    } catch (e) {
      // bot artıq disconnect olubsa sakitcə keç
    }
  }, 2000 + Math.random() * 1500);

  bot.once('end', () => clearInterval(interval));
}

// ---- Botları tədricən (staggered) qoşuruq ki, serveri anında yükləməsin ----
function spawnAllBots() {
  const total = config.test.totalBots;
  const gap = config.test.spawnIntervalMs || 1500;
  log(`🚀 Test başlayır: ${total} bot, hər ${gap}ms-də bir qoşulacaq -> ${config.server.host}:${config.server.port}`);

  for (let i = 1; i <= total; i++) {
    setTimeout(() => spawnBot(i), i * gap);
  }
}

// ---- RCON ilə TPS izləmə ----
async function monitorTPS() {
  if (!config.rcon || !config.rcon.enabled) {
    log('ℹ️  RCON söndürülüb, yalnız bağlantı sayı izlənəcək.');
    return;
  }

  let rcon;
  try {
    rcon = await Rcon.connect({
      host: config.rcon.host,
      port: config.rcon.port,
      password: config.rcon.password
    });
    log('🔗 RCON bağlantısı quruldu.');
  } catch (e) {
    log(`❌ RCON bağlana bilmədi: ${e.message}. TPS izlənməyəcək.`);
    return;
  }

  const pollMs = (config.test.tpsPollIntervalSec || 5) * 1000;
  const poller = setInterval(async () => {
    try {
      // Paper/Spigot: "tps" əmri. Fərqli serverlərdə format dəyişə bilər,
      // lazım gələrsə parse hissəsini öz serverinizin çıxışına uyğunlaşdırın.
      const response = await rcon.send('tps');
      const tps = parseTPS(response);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const row = `${new Date().toISOString()},${elapsed},${connectedCount},${tps ?? 'N/A'},\n`;
      fs.appendFileSync(csvFile, row);
      log(`📊 [${elapsed}s] Aktiv botlar: ${connectedCount} | TPS: ${tps ?? 'parse edilmədi (raw: ' + response.replace(/\n/g, ' ') + ')'}`);
    } catch (e) {
      log(`⚠️  RCON sorğusu uğursuz: ${e.message}`);
    }
  }, pollMs);

  process._rconPoller = poller;
  process._rconClient = rcon;
}

function parseTPS(raw) {
  // Paper formatı adətən: "TPS from last 1m, 5m, 15m: 20.0, 19.98, 19.9"
  const match = raw.match(/(\d+\.\d+)/);
  return match ? parseFloat(match[1]) : null;
}

// ---- Testi bitir və hesabatı çap et ----
async function stopTest() {
  stopping = true;
  log('🛑 Test bitir, botlar ayrılır...');

  bots.forEach((bot) => {
    try { bot.quit(); } catch (e) {}
  });

  if (process._rconPoller) clearInterval(process._rconPoller);
  if (process._rconClient) {
    try { await process._rconClient.end(); } catch (e) {}
  }

  log(`✅ Test tamamlandı. Nəticələr: ${csvFile}`);
  log(`   Log faylı: ${logFile}`);
  process.exit(0);
}

// ---- Başlat ----
(async () => {
  spawnAllBots();
  await monitorTPS();

  const duration = (config.test.runDurationSec || 300) * 1000;
  setTimeout(stopTest, duration);

  // Ctrl+C ilə əl ilə dayandırmaq üçün
  process.on('SIGINT', stopTest);
})();
