const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const qrcode = require('qrcode-terminal'); // تأكد باللي هادي كاينا ولا غنستعملو qrcode
const http = require('http');
require('dotenv').config();

// 1. فتح سيرفر HTTP بسيط جداً غير باش Render يبقى شاعل ومايعطيش "No open ports detected"
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Gemini Bot is running 24/7!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`HTTP server is listening on port ${PORT}`);
});

// 2. إعداد Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'fatal' }),
        // حيدنا printQRInTerminal باش نخدمو بالطريقة اليدوية المضمونة لتحت
    });

    sock.ev.on('creds.update', saveCreds);

    // الطريقة الحديثة والمضمونة لإظهار QR Code في الـ Logs
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('=== SCAN THIS QR CODE ===');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log('Connection closed, reconnecting...');
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 3000);
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Bot is ready and online successfully!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const messageBody = m.message.conversation || m.message.extendedTextMessage?.text;
        const sender = m.key.remoteJid;

        if (!messageBody) return;

        try {
            console.log(`Received message: ${messageBody}`);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const result = await model.generateContent(messageBody);
            const response = await result.response;
            const replyText = response.text();

            await sock.sendMessage(sender, { text: replyText }, { quoted: m });
        } catch (error) {
            console.error('Error generating AI response:', error);
            await sock.sendMessage(sender, { text: 'عذراً، وقع خطأ تقني، عاود محاولة لاحقاً.' }, { quoted: m });
        }
    });
}

startBot();
