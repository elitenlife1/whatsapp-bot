const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'fatal' }),
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
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