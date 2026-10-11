// Thermoshop Telegram bot — buyurtmalarni Mini App'dan qabul qilib,
// do'kon egasiga (OWNER_CHAT_ID) yuboradi.
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const MINI_APP_URL = process.env.MINI_APP_URL;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !OWNER_CHAT_ID || !MINI_APP_URL) {
  console.error("Xato: BOT_TOKEN, OWNER_CHAT_ID va MINI_APP_URL to'ldirilishi shart.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const ALLOWED_ORIGIN = new URL(MINI_APP_URL).origin;

// ---- Telegram initData tekshiruvi (buyurtma haqiqatan Telegram'dan kelganini tasdiqlaydi)
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
  if (Date.now() / 1000 - authDate > 86400) return null; // 24 soatdan eski
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

function customerLine(u) {
  return `👤 Mijoz: ${u.first_name || ''} ${u.last_name || ''}` +
    (u.username ? ` (@${u.username})` : '') + `\nID: ${u.id}`;
}

// ---- HTTP endpoint: Mini App buyurtmani shu yerga yuboradi
const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'GET') { res.writeHead(200, cors); return res.end('Thermoshop bot ishlayapti'); }
  if (req.method !== 'POST' || req.url !== '/order') { res.writeHead(404, cors); return res.end(); }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const user = verifyInitData(data.initData || '');
      if (!user) { res.writeHead(401, cors); return res.end('unauthorized'); }
      const text = String(data.text || '').slice(0, 3500);
      await bot.sendMessage(OWNER_CHAT_ID, `🆕 Yangi buyurtma!\n\n${customerLine(user)}\n\n${text}`);
      await bot.sendMessage(user.id, "Buyurtmangiz qabul qilindi! Tez orada operator siz bilan bog'lanadi. ✅")
        .catch(() => {});
      res.writeHead(200, cors); res.end('ok');
    } catch (e) {
      console.error('Buyurtma xatosi:', e);
      res.writeHead(500, cors); res.end('error');
    }
  });
});
server.listen(PORT, () => console.log(`HTTP server ${PORT}-portda ishga tushdi`));

// ---- /start: klaviatura tugmasi orqali ochish (sendData bilan ham ishlaydi)
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Thermoshop katalogiga xush kelibsiz! Mahsulotlarni ko'rish uchun quyidagi tugmani bosing.", {
    reply_markup: {
      keyboard: [[{ text: '🏠 Thermoshop', web_app: { url: MINI_APP_URL } }]],
      resize_keyboard: true,
    },
  });
});

// Eski usul (klaviatura tugmasidan kelgan buyurtma)
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
