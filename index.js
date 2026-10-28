const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const http = require('http');
require('dotenv').config();

// 1. Server HTTP bash Render yb9a active
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Gemini Bot is active 24/7!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Memory dyal l-conversations
const userChats = new Map();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'fatal' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER;
        if (phoneNumber) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n========================================`);
                    console.log(`YOUR PAIRING CODE IS: ${code?.match(/.{1,4}/g)?.join('-')}`);
                    console.log(`========================================\n`);
                } catch (err) {
                    console.error('Error generating pairing code:', err);
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
            console.log('WhatsApp Bot is ONLINE and connected successfully!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const messageBody = m.message.conversation || m.message.extendedTextMessage?.text;
        const sender = m.key.remoteJid;

        if (!messageBody) return;

        try {
            await sock.sendPresenceUpdate('composing', sender);

            const cleanText = messageBody.trim().toLowerCase();

            // Commande dial Clear
            if (cleanText === 'clear' || cleanText === 'كلير') {
                userChats.delete(sender);
                await sock.sendPresenceUpdate('paused', sender);
                await sock.sendMessage(sender, { 
                    text: '✅ Safi, ms7t l-hadra li dazt! Yallah نبداو sujet jdid.' 
                }, { quoted: m });
                return;
            }

            // Instructions dial Gemini
            const systemPrompt = `You are a helpful and smart WhatsApp AI assistant.
1. Language: Always match the user's language (use Moroccan Darija dynamically when spoken to in it).
2. WhatsApp Format: NEVER use markdown headers like '#', '##', or '###'. WhatsApp does not support them. Use emojis and bold text with double asterisks for section headers (e.g., 📌 **العنوان هنا**).
3. Length and Precision: Keep basic greetings and simple questions brief, clear, and direct. When asked for details, comprehensive guides, or long topics, provide full, deep, and structured answers.
4. Tone: Engaging, natural, and helpful without robotic filler phrases.`;

            const model = genAI.getGenerativeModel({
                model: 'gemini-3.5-flash',
                systemInstruction: systemPrompt
            });

            if (!userChats.has(sender)) {
                userChats.set(sender, model.startChat({ history: [] }));
            }

            const chat = userChats.get(sender);
            const result = await chat.sendMessage(messageBody);
            const responseText = result.response.text();

            await sock.sendPresenceUpdate('paused', sender);
            await sock.sendMessage(sender, { text: responseText }, { quoted: m });

        } catch (error) {
            console.error('Gemini error:', error);
            await sock.sendPresenceUpdate('paused', sender);
            userChats.delete(sender);
            await sock.sendMessage(sender, { 
                text: '⚠️ Smeh lia, tra bloquage sghir. 3awd sift lia l-sou2al dyalk daba w ghadi njawbk direct!' 
            }, { quoted: m });
        }
    });
}

startBot();
