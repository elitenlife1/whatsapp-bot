const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const http = require('http');
require('dotenv').config();

// 1. HTTP server dyal Render باش مايضربش Crash
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Gemini Bot is running 24/7!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`HTTP server is listening on port ${PORT}`);
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'fatal' }),
        printQRInTerminal: false // 7ydna QR Code l9dim
    });

    sock.ev.on('creds.update', saveCreds);

    // Bghiina nst3mlo nemra dyal tlifon bsh ntsblo b code (Bla QR Code)
    if (!sock.authState.creds.registered) {
        // Ktél nemra dyal tlifon dyalk hna b l-code d dawla (Mitalan: 2126xxxxxxxx)
        const phoneNumber = process.env.PHONE_NUMBER; 
        if (phoneNumber) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phoneNumber);
                    console.log(`========================================`);
                    console.log(`YOUR PAIRING CODE IS: ${code?.match(/.{1,4}/g)?.join('-')}`);
                    console.log(`========================================`);
                } catch (err) {
                    console.error('Error requesting pairing code:', err);
                }
            }, 3000);
        }
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
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
            await sock.sendMessage(sender, { text: '3doran, wa9a3 khata2 ta9ni.' }, { quoted: m });
        }
    });
}

startBot();
