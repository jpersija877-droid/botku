import 'dotenv/config';
import TelegramBot from "node-telegram-bot-api";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import fs from "fs";
import { execSync } from "child_process";

const { Client, LocalAuth } = pkg;

// ambil dari environment variable (Replit Secret, .env, atau export)
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("❌ ERROR: BOT_TOKEN tidak ditemukan!");
  console.error("Set BOT_TOKEN di environment variable atau file .env");
  console.error("Contoh: export BOT_TOKEN='your_bot_token_here'");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let waClient;
let qrReady = false;
let qrImage = null;
let isReconnecting = false; // Flag untuk prevent multiple reconnect

// Cache untuk menyimpan hasil pengecekan nomor
const checkedNumbers = new Map();

// === Auto-detect Chromium path berdasarkan environment ===
function getChromiumPath() {
  // Cek environment variable terlebih dahulu
  if (process.env.CHROMIUM_PATH) {
    return process.env.CHROMIUM_PATH;
  }
  
  // Cek apakah di Replit - cari chromium secara dinamis
  if (process.env.REPL_ID || process.env.REPLIT_DB_URL) {
    try {
      const chromiumPath = execSync("which chromium", { encoding: "utf-8" }).trim();
      if (chromiumPath) {
        console.log(`✅ Chromium ditemukan di: ${chromiumPath}`);
        return chromiumPath;
      }
    } catch (e) {
      console.log("⚠️ Chromium tidak ditemukan di Replit");
    }
  }
  
  // Untuk VPS Ubuntu/Debian - cek berbagai lokasi umum
  const commonPaths = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable"
  ];
  
  for (const path of commonPaths) {
    if (fs.existsSync(path)) {
      console.log(`✅ Browser ditemukan di: ${path}`);
      return path;
    }
  }
  
  // Untuk Railway atau platform lain (auto-detect dengan which)
  try {
    const browserPath = execSync("which chromium-browser || which chromium || which google-chrome", { encoding: "utf-8" }).trim();
    if (browserPath) {
      console.log(`✅ Browser ditemukan di: ${browserPath}`);
      return browserPath;
    }
  } catch (e) {
    console.log("⚠️ Browser tidak ditemukan, gunakan default puppeteer");
  }
  
  return undefined;
}

// === Inisialisasi WhatsApp Web ===
async function startWhatsApp() {
  // Cleanup stale lock files and processes
  try {
    const lockFiles = [
      '.wwebjs_auth/session/SingletonLock',
      '.wwebjs_auth/session/SingletonSocket'
    ];
    
    for (const lockFile of lockFiles) {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        console.log(`🧹 Removed ${lockFile}`);
      }
    }
  } catch (e) {
    console.log('⚠️ Lock cleanup:', e.message);
  }
  
  const chromiumPath = getChromiumPath();
  
  const puppeteerConfig = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--disable-gpu",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding"
    ],
  };
  
  // Set executablePath hanya jika ada (untuk Replit)
  if (chromiumPath) {
    puppeteerConfig.executablePath = chromiumPath;
  }
  
  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: puppeteerConfig,
  });

  waClient.on("qr", async (qr) => {
    qrReady = true;
    qrImage = await qrcode.toBuffer(qr);
    console.log("✅ QR baru diterbitkan!");
  });

  waClient.on("ready", () => {
    qrReady = false;
    isReconnecting = false;
    console.log("✅ WhatsApp siap digunakan!");
  });

  waClient.on("disconnected", async (reason) => {
    console.log("⚠️ WhatsApp terputus:", reason);
    
    // Prevent multiple reconnect attempts
    if (isReconnecting) {
      console.log("⏳ Sudah ada proses reconnect, skip...");
      return;
    }
    
    isReconnecting = true;
    
    try {
      // Destroy client lama
      if (waClient) {
        console.log("🧹 Membersihkan client lama...");
        await waClient.destroy();
        waClient = null;
      }
      
      // Tunggu sebentar
      await delay(3000);
      
      // Reconnect
      console.log("🔄 Mencoba reconnect...");
      await startWhatsApp();
    } catch (e) {
      console.error("❌ Error saat reconnect:", e.message);
      isReconnecting = false;
    }
  });

  waClient.on("auth_failure", async (msg) => {
    console.log("❌ Autentikasi gagal:", msg);
    qrReady = true; // Minta QR baru
  });

  try {
    await waClient.initialize();
  } catch (error) {
    console.error("❌ Gagal inisialisasi WhatsApp:", error.message);
    
    // Cek apakah error terkait Chromium
    if (error.message.includes("Failed to launch") || error.message.includes("browser")) {
      console.error("\n📌 TROUBLESHOOTING:");
      console.error("1. Pastikan Chromium/Chrome terinstall di sistem Anda");
      console.error("2. Atau set environment variable CHROMIUM_PATH");
      console.error("   Contoh: export CHROMIUM_PATH='/usr/bin/chromium-browser'");
      console.error("\nInstalasi Chromium:");
      console.error("- Ubuntu/Debian: sudo apt install chromium-browser");
      console.error("- Replit: Chromium sudah terinstall otomatis\n");
    }
    
    // Retry setelah 10 detik
    console.log("🔄 Akan mencoba reconnect dalam 10 detik...");
    setTimeout(() => {
      console.log("🔄 Mencoba reconnect WhatsApp...");
      startWhatsApp().catch((err) => {
        console.error("⚠️ Retry gagal, akan coba lagi nanti");
      });
    }, 10000);
    
    throw error;
  }
}

// Start WhatsApp dengan error handling
startWhatsApp().catch((error) => {
  console.error("⚠️ WhatsApp belum siap, bot Telegram tetap berjalan");
  console.error("💡 Anda masih bisa kirim perintah ke bot, tapi fitur WhatsApp checker belum aktif");
});

// === Fungsi normalisasi nomor ===
function normalize(num) {
  num = num.replace(/\D/g, "");
  if (num.startsWith("0")) return "62" + num.slice(1);
  return num;
}

// === Fungsi delay ===
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Event saat user kirim pesan ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) return;

  // Jika user start bot
  if (text === "/start") {
    await bot.sendMessage(chatId, "Selamat Datang kaum Rebahan - Send Nomor Lu Bot Akan Memproses max50");
    return;
  }

  // Jika minta QR
  if (text.toLowerCase() === "qr") {
    if (qrReady && qrImage) {
      await bot.sendPhoto(chatId, qrImage, {
        caption: "📱 Scan QR untuk login WhatsApp.",
        filename: "qr-code.png",
        contentType: "image/png"
      });
    } else {
      await bot.sendMessage(chatId, "✅ WhatsApp sudah terhubung / QR belum tersedia.");
    }
    return;
  }

  // Pisahkan semua nomor (tiap baris)
  const numbers = text.split(/\r?\n/).map((n) => normalize(n)).filter((n) => n.length > 8);
  if (numbers.length === 0) {
    await bot.sendMessage(chatId, "⚠️ Kirim daftar nomor, satu per baris.");
    return;
  }

  // Batasi maksimal 50 nomor
  if (numbers.length > 50) {
    await bot.sendMessage(chatId, "⚠️ Maksimal 50 nomor per request! Anda mengirim " + numbers.length + " nomor.");
    return;
  }

  // Cek apakah WhatsApp sudah siap - jika belum, jangan reply
  if (!waClient || qrReady) {
    return;
  }

  const progressMsg = await bot.sendMessage(chatId, `🔍 Mengecek ${numbers.length} nomor...\nProgres: 0/${numbers.length}`);

  let registered = [];
  let unregistered = [];
  
  // Pisahkan nomor cached dan uncached
  const cachedNumbers = [];
  const uncachedNumbers = [];
  
  for (const num of numbers) {
    if (checkedNumbers.has(num)) {
      cachedNumbers.push(num);
    } else {
      uncachedNumbers.push(num);
    }
  }
  
  // Proses semua nomor cached (instant, no delay)
  for (const num of cachedNumbers) {
    const result = checkedNumbers.get(num);
    if (result) {
      registered.push(`+${num} --> ✅ TerHIT`);
    } else {
      unregistered.push(`+${num} --> ❌ TerHIT`);
    }
  }
  
  // Update progress untuk cached numbers
  if (cachedNumbers.length > 0) {
    await bot.editMessageText(
      `🔍 Mengecek ${numbers.length} nomor...\nProgres: ${cachedNumbers.length}/${numbers.length} (dari cache)`,
      {
        chat_id: chatId,
        message_id: progressMsg.message_id
      }
    );
  }
  
  // Proses nomor uncached dengan batch processing (lebih cepat)
  const batchSize = 5; // Check 5 nomor sekaligus
  let processedCount = cachedNumbers.length;
  
  for (let i = 0; i < uncachedNumbers.length; i += batchSize) {
    const batch = uncachedNumbers.slice(i, i + batchSize);
    
    // Proses batch secara parallel
    const results = await Promise.allSettled(
      batch.map(async (num) => {
        try {
          const result = await waClient.isRegisteredUser(`${num}@c.us`);
          checkedNumbers.set(num, result);
          console.log(`🔍 Checked ${num}: ${result}`);
          return { num, result, success: true };
        } catch (e) {
          console.error(`Error checking ${num}:`, e.message);
          return { num, result: null, success: false };
        }
      })
    );
    
    // Kumpulkan hasil
    for (const { value } of results) {
      if (value) {
        if (!value.success) {
          unregistered.push(`+${value.num} --> ⚠️ Error`);
        } else if (value.result) {
          registered.push(`+${value.num} --> ✅ Terdaftar`);
        } else {
          unregistered.push(`+${value.num} --> ❌ Tidak Terdaftar`);
        }
      }
      processedCount++;
    }
    
    // Update progress
    await bot.editMessageText(
      `🔍 Mengecek ${numbers.length} nomor...\nProgres: ${processedCount}/${numbers.length}`,
      {
        chat_id: chatId,
        message_id: progressMsg.message_id
      }
    );
    
    // Delay singkat antar batch (anti-spam WhatsApp)
    if (i + batchSize < uncachedNumbers.length) {
      await delay(800);
    }
  }

  let resultMsg = "";
  if (registered.length) {
    resultMsg += `✅ *Nomor Terdaftar:*\n${registered.join("\n")}\n\n`;
  }
  if (unregistered.length) {
    resultMsg += `❌ *Nomor Tidak Terdaftar:*\n${unregistered.join("\n")}\n\n`;
  }
  
  resultMsg += `_by drixalexa_`;

  await bot.sendMessage(chatId, resultMsg, { parse_mode: "Markdown" });
});
