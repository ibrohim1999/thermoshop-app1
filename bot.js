// Thermoshop Telegram bot — buyurtmalarni qabul qilib, do'kon egasiga (OWNER_CHAT_ID) yuboradi.
// Buyurtma uch yo'l bilan keladi:
//   1) Telegram Mini App (klaviatura tugmasi)  -> web_app_data
//   2) Telegram Mini App ("Open" tugmasi)      -> POST /order      (Telegram initData tekshiriladi)
//   3) Oddiy brauzerdagi veb-sayt              -> POST /web-order  (spamdan himoya bilan)
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const MINI_APP_URL = process.env.MINI_APP_URL;
const PORT = process.env.PORT || 3000;
// Qo'shimcha ruxsat etilgan sayt manzillari (masalan o'z domeningiz): EXTRA_ORIGINS=https://thermoshop.uz,https://www.thermoshop.uz
const EXTRA_ORIGINS = (process.env.EXTRA_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);

if (!BOT_TOKEN || !OWNER_CHAT_ID || !MINI_APP_URL) {
  console.error("Xato: BOT_TOKEN, OWNER_CHAT_ID va MINI_APP_URL to'ldirilishi shart.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const ALLOWED_ORIGINS = [new URL(MINI_APP_URL).origin, ...EXTRA_ORIGINS];

// ---- Telegram orqali tasdiqlangan telefon raqamlar (Telegram ID -> raqam)
// Eslatma: fayl Railway qayta ishga tushganda o'chib ketishi mumkin; shunda mijoz raqamni qayta ulashadi.
const VERIFIED_FILE = (process.env.DATA_DIR || '.') + '/verified.json';
let verified = {};
try { verified = JSON.parse(fs.readFileSync(VERIFIED_FILE, 'utf8')); } catch (e) { verified = {}; }
function saveVerified() { try { fs.writeFileSync(VERIFIED_FILE, JSON.stringify(verified)); } catch (e) {} }
const verifiedPhone = (id) => (verified[String(id)] && verified[String(id)].phone) || null;

// ---- Telegram initData tekshiruvi
function verifyInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (calc !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (Date.now() / 1000 - authDate > 86400) return null;
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

function customerLine(u) {
  return `👤 Mijoz: ${u.first_name || ''} ${u.last_name || ''}` +
    (u.username ? ` (@${u.username})` : '') + `\nID: ${u.id}`;
}

// ---- Veb-buyurtmalar uchun spamdan himoya: bitta IP 10 daqiqada 5 tadan ko'p emas, jami soatiga 60 ta
const ipHits = new Map();
let globalHits = [];
function ipLimited(ip) {
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (arr.length >= 5) { ipHits.set(ip, arr); return true; }
  arr.push(now); ipHits.set(ip, arr); return false;
}
function globalLimited() {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < 60 * 60 * 1000);
  if (globalHits.length >= 60) return true;
  globalHits.push(now); return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of ipHits) {
    const f = arr.filter((t) => now - t < 10 * 60 * 1000);
    if (f.length) ipHits.set(ip, f); else ipHits.delete(ip);
  }
}, 10 * 60 * 1000);

// ---- HTTP server
const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const path = (req.url || '').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'GET') { res.writeHead(200, cors); return res.end('Thermoshop bot ishlayapti'); }
  if (req.method !== 'POST' || !['/order', '/web-order', '/phone'].includes(path)) { res.writeHead(404, cors); return res.end(); }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const text = String(data.text || '').slice(0, 3500);

      if (path === '/phone') {
        const user = verifyInitData(data.initData || '');
        if (!user) { res.writeHead(401, cors); return res.end('unauthorized'); }
        const ph = verifiedPhone(user.id);
        res.writeHead(ph ? 200 : 404, { ...cors, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(ph ? { ok: true, phone: ph } : { ok: false }));
      }

      if (path === '/order') {
        const user = verifyInitData(data.initData || '');
        if (!user) { res.writeHead(401, cors); return res.end('unauthorized'); }
        const given = String(data.phone || '').replace(/\D/g, '');
        const ok = verifiedPhone(user.id) && verifiedPhone(user.id) === given;
        const status = ok ? '✅ Raqam Telegram orqali tasdiqlangan' : '⚠️ Raqam tasdiqlanmagan';
        await bot.sendMessage(OWNER_CHAT_ID, `🆕 Yangi buyurtma!\n${status}\n\n${customerLine(user)}\n\n${text}`);
        await bot.sendMessage(user.id, "Buyurtmangiz qabul qilindi! Tez orada operator siz bilan bog'lanadi. ✅").catch(() => {});
        res.writeHead(200, cors); return res.end('ok');
      }

      // /web-order — oddiy brauzerdan
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const name = String(data.name || '').trim();
      const phone = String(data.phone || '').replace(/\D/g, '');
      const address = String(data.address || '').trim();
      if (data.website) { res.writeHead(400, cors); return res.end('bad'); } // honeypot
      if (name.length < 2 || name.length > 60 || phone.length !== 9 || address.length < 5 || address.length > 200 || text.length < 10) {
        res.writeHead(400, cors); return res.end('invalid');
      }
      if (ipLimited(ip) || globalLimited()) { res.writeHead(429, cors); return res.end('too many'); }
      await bot.sendMessage(OWNER_CHAT_ID, `🌐 Yangi buyurtma (veb-sayt orqali)!\n⚠️ Raqam tasdiqlanmagan\n\n${text}`);
      res.writeHead(200, cors); res.end('ok');
    } catch (e) {
      console.error('Buyurtma xatosi:', e);
      res.writeHead(500, cors); res.end('error');
    }
  });
});
server.listen(PORT, () => console.log(`HTTP server ${PORT}-portda ishga tushdi`));

// ---- /start: katalogni ochish tugmasi (xabar ostida). Inline tugma orqali ochilgan Mini App foydalanuvchini taniydi,
// shuning uchun telefon raqamni Telegram orqali tasdiqlash mumkin.
bot.onText(/\/start/, async (msg) => {
  // Eski pastki klaviatura tugmasini olib tashlash
  const tmp = await bot.sendMessage(msg.chat.id, '…', { reply_markup: { remove_keyboard: true } }).catch(() => null);
  if (tmp) bot.deleteMessage(msg.chat.id, tmp.message_id).catch(() => {});
  bot.sendMessage(msg.chat.id, "Thermoshop katalogiga xush kelibsiz! Mahsulotlarni ko'rish uchun quyidagi tugmani bosing.", {
    reply_markup: { inline_keyboard: [[{ text: '🏠 Thermoshop', web_app: { url: MINI_APP_URL } }]] },
  });
});

// Mijoz Telegram orqali telefon raqamini ulashganda (Mini App ichidagi "Raqamni tasdiqlash" tugmasi)
bot.on('contact', (msg) => {
  const c = msg.contact;
  if (!c || !msg.from || c.user_id !== msg.from.id) {
    bot.sendMessage(msg.chat.id, "Iltimos, faqat o'zingizning raqamingizni ulashing.");
    return;
  }
  const digits = String(c.phone_number).replace(/\D/g, '');
  if (!(digits.length === 12 && digits.startsWith('998'))) {
    bot.sendMessage(msg.chat.id, "Hozircha faqat O'zbekiston raqamlari (+998) qabul qilinadi.");
    return;
  }
  verified[String(msg.from.id)] = { phone: digits.slice(3), ts: Date.now() };
  saveVerified();
  bot.sendMessage(msg.chat.id, '✅ Raqamingiz tasdiqlandi. Ilovaga qaytib davom eting.');
});

// Klaviatura tugmasidan kelgan buyurtma
bot.on('web_app_data', (msg) => {
  try {
    const data = JSON.parse(msg.web_app_data.data);
    bot.sendMessage(OWNER_CHAT_ID, `🆕 Yangi buyurtma!\n\n${customerLine(msg.from)}\n\n${data.text}`);
    bot.sendMessage(msg.chat.id, "Buyurtmangiz qabul qilindi! Tez orada operator siz bilan bog'lanadi. ✅");
  } catch (e) {
    console.error('Xato:', e);
  }
});

console.log('Thermoshop bot ishga tushdi...');
