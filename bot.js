// Thermoshop Telegram bot — buyurtmalarni Mini App'dan qabul qilib,
// do'kon egasiga (OWNER_CHAT_ID) yuboradi.
//
// O'RNATISH:
//   1) npm install
//   2) .env faylida BOT_TOKEN va OWNER_CHAT_ID ni to'ldiring (README.md'ga qarang)
//   3) node bot.js

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const MINI_APP_URL = process.env.MINI_APP_URL; // index.html joylashgan havola

if (!BOT_TOKEN || !OWNER_CHAT_ID || !MINI_APP_URL) {
  console.error('Xato: .env faylida BOT_TOKEN, OWNER_CHAT_ID va MINI_APP_URL to\'ldirilishi shart.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// /start — mijozga do'konni ochish tugmasini ko'rsatadi
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Thermoshop katalogiga xush kelibsiz! Mahsulotlarni ko\'rish uchun quyidagi tugmani bosing.', {
    reply_markup: {
      keyboard: [[{ text: '🛒 Katalogni ochish', web_app: { url: MINI_APP_URL } }]],
      resize_keyboard: true,
    },
  });
});

// Mini App'dan kelgan buyurtmani qabul qilish
bot.on('web_app_data', (msg) => {
  try {
    const data = JSON.parse(msg.web_app_data.data);
    const customer = msg.from;
    const customerLine = `👤 Mijoz: ${customer.first_name || ''} ${customer.last_name || ''}` +
      (customer.username ? ` (@${customer.username})` : '') + `\nID: ${customer.id}`;

    const ownerMessage = `🆕 Yangi buyurtma!\n\n${customerLine}\n\n${data.text}`;
    bot.sendMessage(OWNER_CHAT_ID, ownerMessage);

    bot.sendMessage(msg.chat.id, 'Buyurtmangiz qabul qilindi! Tez orada operator siz bilan bog\'lanadi. ✅');
  } catch (e) {
    console.error('Buyurtmani qayta ishlashda xato:', e);
    bot.sendMessage(msg.chat.id, 'Kechirasiz, xatolik yuz berdi. Iltimos qayta urinib ko\'ring yoki telefon orqali bog\'laning.');
  }
});

console.log('Thermoshop bot ishga tushdi...');
