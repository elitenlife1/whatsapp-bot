const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const http = require('http');
require('dotenv').config();

// 1. Server HTTP bash Render yb9a dima 7ay
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Gemini Bot is alive 24/7!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// 2. Gemini Multi-Keys Rotation
const apiKeysEnv = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
const API_KEYS = apiKeysEnv.split(',').map(key => key.trim()).filter(Boolean);
let currentKeyIndex = 0;

function getNextGenAI() {
    if (API_KEYS.length === 0) return null;
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return new GoogleGenerativeAI(key);
}

const userChats = new Map();
const rateLimits = new Map();

function isRateLimited(sender) {
    const now = Date.now();
    const limit = rateLimits.get(sender) || { count: 0, firstMsg: now };

    if (now - limit.firstMsg > 60000) {
        rateLimits.set(sender, { count: 1, firstMsg: now });
        return false;
    }

    limit.count++;
    rateLimits.set(sender, limit);
    return limit.count > 15;
}

// Function dial Image Generation b FLUX.1-schnell (Hugging Face)
async function generateFluxImage(prompt) {
    const hfToken = process.env.HF_TOKEN;
    const endpoint = "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell";

    const headers = { "Content-Type": "application/json" };
    if (hfToken) {
        headers["Authorization"] = `Bearer ${hfToken}`;
    }

    const response = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ inputs: prompt })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HF Error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

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

    if (!sock.authState.creds.registered && process.env.PHONE_NUMBER) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(process.env.PHONE_NUMBER);
                console.log(`\n========================================`);
                console.log(`PAIRING CODE: ${code?.match(/.{1,4}/g)?.join('-')}`);
                console.log(`========================================\n`);
            } catch (err) {
                console.error('Pairing Code error:', err);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 3000);
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Bot is ONLINE and ready with FLUX.1!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m || !m.message || m.key.fromMe) return;

        const sender = m.key.remoteJid;
        const isGroup = sender.endsWith('@g.us');
        const botNumber = sock.user?.id ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : '';

        const rawMessage = m.message.ephemeralMessage?.message || 
                           m.message.viewOnceMessage?.message || 
                           m.message;

        const msgType = Object.keys(rawMessage)[0];

        let textContent = rawMessage.conversation || 
                          rawMessage.extendedTextMessage?.text || 
                          rawMessage.imageMessage?.caption || 
                          rawMessage.documentMessage?.caption || 
                          rawMessage.videoMessage?.caption || '';

        // Gestion dial les groupes
        if (isGroup) {
            const mentions = rawMessage.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const isMentioned = botNumber && mentions.includes(botNumber);
            const hasPrefix = textContent.toLowerCase().startsWith('!bot');

            if (!isMentioned && !hasPrefix) return;
            textContent = textContent.replace('!bot', '').replace(new RegExp(`@${botNumber.split('@')[0]}`, 'g'), '').trim();
        }

        // Anti-spam
        if (isRateLimited(sender)) {
            await sock.sendMessage(sender, { text: '⚠️ Sifti bzaf d les messages. Sber d9i9a 3afak.' }, { quoted: m });
            return;
        }

        const cleanText = textContent.trim().toLowerCase();

        // Commande Clear
        if (cleanText === 'clear' || cleanText === 'كلير') {
            userChats.delete(sender);
            await sock.sendMessage(sender, { text: '✅ Safi, ms7t l-hadra li dazt kamla!' }, { quoted: m });
            return;
        }

        // ==========================================
        // 1. Generation d t-Tsawer b FLUX.1 (/image)
        // ==========================================
        if (textContent.startsWith('/image') || textContent.startsWith('!image') || textContent.startsWith('/صورة')) {
            const imagePrompt = textContent.replace(/^(\/image|!image|\/صورة)/, '').trim();

            if (!imagePrompt) {
                await sock.sendMessage(sender, { 
                    text: '⚠️ Kteb l-wasf dial tswira, mital:\n`/image hyper-realistic luxury sports car in desert 8k`' 
                }, { quoted: m });
                return;
            }

            try {
                await sock.sendPresenceUpdate('composing', sender);
                await sock.sendMessage(sender, { text: '🎨 Blati d9i9a, kan-generi lik tswira b model FLUX.1 HD...' }, { quoted: m });

                const imageBuffer = await generateFluxImage(imagePrompt);

                await sock.sendPresenceUpdate('paused', sender);
                await sock.sendMessage(sender, { 
                    image: imageBuffer, 
                    caption: `✨ *${imagePrompt}*\n*(FLUX.1 HD)*` 
                }, { quoted: m });
                return;

            } catch (err) {
                console.error('FLUX Generation Error:', err);
                await sock.sendPresenceUpdate('paused', sender);
                await sock.sendMessage(sender, { 
                    text: '⚠️ Tra mochkil f generation dial FLUX. Ila kant l-API fiha z7am, 3awd jereb mn hna d9i9a.' 
                }, { quoted: m });
                return;
            }
        }

        // ==========================================
        // 2. Gemini Multimodal (Texte, Audio, Image, PDF)
        // ==========================================
        try {
            await sock.sendPresenceUpdate('composing', sender);

            const systemPrompt = `You are a helpful, intelligent WhatsApp AI assistant.
1. Formatting: NEVER use '#' or '###' headers. Use emojis and bold text (e.g. 📌 **العنوان**) for sections.
2. Voice & Audio: Mentally transcribe and understand Moroccan Darija, Arabic, French, and English fluently. Answer directly and naturally.
3. Language: Dynamically match the user's language (especially Moroccan Darija).`;

            let contents = [];

            // A. Audio / Vocaux
            if (msgType === 'audioMessage') {
                const buffer = await downloadMediaMessage(m, 'buffer', {});
                contents.push({
                    inlineData: {
                        data: buffer.toString('base64'),
                        mimeType: 'audio/ogg; codecs=opus'
                    }
                });
                contents.push("Sme3 mzian l had l-vocal (fih darija awla lougha khora) w jaweb 3la dakshi li t-gal fih b tari9a direct w mofida.");
            }
            // B. Images envoyées au bot (Vision)
            else if (msgType === 'imageMessage') {
                const buffer = await downloadMediaMessage(m, 'buffer', {});
                contents.push({
                    inlineData: {
                        data: buffer.toString('base64'),
                        mimeType: rawMessage.imageMessage.mimetype || 'image/jpeg'
                    }
                });
                contents.push(textContent || "Chouf had t-tswira mzian w chre7 lia chno fiha awla jaweb 3la sou2al dyali.");
            }
            // C. Fichiers PDF
            else if (msgType === 'documentMessage') {
                const mime = rawMessage.documentMessage.mimetype || '';
                if (mime.includes('pdf')) {
                    const buffer = await downloadMediaMessage(m, 'buffer', {});
                    contents.push({
                        inlineData: {
                            data: buffer.toString('base64'),
                            mimeType: 'application/pdf'
                        }
                    });
                    contents.push(textContent || "Lakhkhess lia had l-fichier PDF w 3tini l-moufid fih.");
                } else {
                    await sock.sendPresenceUpdate('paused', sender);
                    await sock.sendMessage(sender, { text: '⚠️ Had l-weqt kan-9blou ghir les fichiers PDF.' }, { quoted: m });
                    return;
                }
            }
            // D. Texte normal
            else {
                if (!textContent) {
                    await sock.sendPresenceUpdate('paused', sender);
                    return;
                }
                contents.push(textContent);
            }

            let responseText = null;
            let attempts = 0;

            while (!responseText && attempts < API_KEYS.length) {
                try {
                    const aiInstance = getNextGenAI();
                    const model = aiInstance.getGenerativeModel({
                        model: 'gemini-3.5-flash',
                        systemInstruction: systemPrompt
                    });

                    if (msgType !== 'imageMessage' && msgType !== 'audioMessage' && msgType !== 'documentMessage') {
                        if (!userChats.has(sender)) userChats.set(sender, []);
                        const history = userChats.get(sender);

                        const chat = model.startChat({ history });
                        const result = await chat.sendMessage(textContent);
                        responseText = result.response.text();

                        history.push(
                            { role: 'user', parts: [{ text: textContent }] },
                            { role: 'model', parts: [{ text: responseText }] }
                        );
                        if (history.length > 16) history.splice(0, history.length - 16);
                    } else {
                        const result = await model.generateContent(contents);
                        responseText = result.response.text();
                    }
                } catch (err) {
                    attempts++;
                    console.error(`Attempt with key ${currentKeyIndex} failed:`, err.message);
                }
            }

            if (!responseText) {
                throw new Error("Ga3 les clés API fihom mochkil.");
            }

            await sock.sendPresenceUpdate('paused', sender);
            await sock.sendMessage(sender, { text: responseText }, { quoted: m });

        } catch (error) {
            console.error('Processing Error:', error);
            await sock.sendPresenceUpdate('paused', sender);
            await sock.sendMessage(sender, { 
                text: '⚠️ Tra mochkil sghir f l-khedma dial l-message, 3awd sifto daba.' 
            }, { quoted: m });
        }
    });
}

startBot();
