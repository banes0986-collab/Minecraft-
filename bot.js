/**
 * Basit Minecraft Join/Test Botu
 * --------------------------------
 * Belirtilen sunucuya bağlanır, katılır ve bağlantı sonucunu (başarılı/hatalı)
 * konsola loglar. Sunucunun ayakta olup olmadığını ve gerçek bir oyuncu
 * girişini kabul edip etmediğini test etmek için kullanılır.
 *
 * Kullanım:
 *   node bot.js <sunucu_ip> <port> <kullanici_adi> [versiyon]
 *
 * Örnek:
 *   node bot.js play.crafthosting.com.tr 25565 TestBot
 *   node bot.js play.crafthosting.com.tr 25565 TestBot 1.20.4
 */

const mineflayer = require('mineflayer');

// --- Ayarlar (komut satırından veya doğrudan burada değiştirilebilir) ---
const HOST = process.argv[2] || 'localhost';
const PORT = parseInt(process.argv[3], 10) || 25565;
const USERNAME = process.argv[4] || 'TestBot';
const VERSION = process.argv[5]; // belirtilmezse mineflayer otomatik algılar

console.log(`[TEST] Bağlanılıyor -> ${HOST}:${PORT} (kullanıcı: ${USERNAME})`);

const bot = mineflayer.createBot({
  host: HOST,
  port: PORT,
  username: USERNAME,   // offline-mode sunucularda herhangi bir isim yeterli
  version: VERSION,     // undefined ise otomatik algılanır
  auth: 'offline',      // sadece test/offline-mode sunucular için; online-mode
                         // (Mojang hesaplı) sunucular için 'microsoft' + gerçek
                         // hesap bilgisi gerekir
});

let joined = false;

bot.on('login', () => {
  console.log('[TEST] Login paketi alındı, sunucuya bağlanıldı.');
});

bot.on('spawn', () => {
  joined = true;
  console.log('[TEST] ✅ BAŞARILI: Bot dünyaya spawn oldu, sunucu çalışıyor.');
  console.log(`[TEST] Pozisyon: ${JSON.stringify(bot.entity.position)}`);

  // İsteğe bağlı: birkaç saniye bekleyip botu güvenli şekilde çıkar
  setTimeout(() => {
    console.log('[TEST] Test tamamlandı, bağlantı kapatılıyor.');
    bot.quit();
    process.exit(0);
  }, 5000);
});

bot.on('kicked', (reason) => {
  console.log('[TEST] ⚠️ Sunucu botu attı (kicked). Sebep:', reason);
});

bot.on('error', (err) => {
  console.log('[TEST] ❌ HATA: Bağlantı kurulamadı ->', err.message);
});

bot.on('end', () => {
  if (!joined) {
    console.log('[TEST] ❌ BAŞARISIZ: Bot spawn olamadan bağlantı sona erdi.');
  }
});

// Genel zaman aşımı: 20 saniyede hiçbir şey olmazsa çık
setTimeout(() => {
  if (!joined) {
    console.log('[TEST] ⏱️ Zaman aşımı: 20 saniyede spawn gerçekleşmedi.');
    process.exit(1);
  }
}, 20000);
