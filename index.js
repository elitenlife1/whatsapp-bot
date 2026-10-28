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
const QRCode = require('qrcode');
require('dotenv').config();

let latestQR = null;
let isConnected = false;

// 1. Server HTTP m3a route /qr bash t-scanni direct mn browser
const server = http.createServer(async (req, res) => {
    if (req.url === '/qr') {
        if (isConnected) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end('<h2>✅ WhatsApp rah mconnecti deja!</h2>');
        }
        if (!latestQR) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end('<h2>⏳ Mazal kay-tchargé l-QR code... Dir Refresh (F5) mn hna 5 thwani.</h2>');
        }
        try {
            const qrImage = await QRCode.toDataURL(latestQR);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>WhatsApp Bot QR Login</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background: #111b21; color: white; margin: 0; }
                        img { border: 8px solid white; border-radius: 12px; margin-top: 15px; }
                    </style>
                </head>
                <body>
                    <h2>Scanni had l-QR code b WhatsApp:</h2>
                    <img src="${qrImage}" width="280" height="280" alt="QR Code" />
                    <p style="color: #8696a0; margin-top: 12px;">Ila fatet dqiqa w ma scannitish, dir Refresh (F5).</p>
                </body>
                </html>
            `);
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end('Mochkil f generation d QR');
        }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Gemini 3.1 Flash Lite Bot is running 24/7!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// 2. Multi-Keys Rotation
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

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_v2');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'fatal' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQR = qr;
            console.log('🔗 QR CODE WAJED! Dkhol l: /qr');
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 4000);
            } else {
                console.log('Session déconnectée.');
            }
        } else if (connection === 'open') {
            isConnected = true;
            latestQR = null;
            console.log('✅ WhatsApp Bot is ONLINE and ready with Gemini 3.1 Flash Lite!');
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

        if (isGroup) {
            const mentions = rawMessage.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const isMentioned = botNumber && mentions.includes(botNumber);
            const hasPrefix = textContent.toLowerCase().startsWith('!bot');

            if (!isMentioned && !hasPrefix) return;
            textContent = textContent.replace('!bot', '').replace(new RegExp(`@${botNumber.split('@')[0]}`, 'g'), '').trim();
        }

        if (isRateLimited(sender)) {
            await sock.sendMessage(sender, { text: '⚠️ Sifti bzaf d les messages. Sber d9i9a 3afak.' }, { quoted: m });
            return;
        }

        const cleanText = textContent.trim().toLowerCase();

        if (cleanText === 'clear' || cleanText === 'كلير') {
            userChats.delete(sender);
            await sock.sendMessage(sender, { text: '✅ Safi, ms7t l-hadra li dazt kamla!' }, { quoted: m });
            return;
        }

        // ==========================================
        // 1. Generation d t-Tsawer (/image)
        // ==========================================
        if (textContent.startsWith('/image') || textContent.startsWith('!image') || textContent.startsWith('/صورة')) {
            const userPrompt = textContent.replace(/^(\/image|!image|\/صورة)/, '').trim();

            if (!userPrompt) {
                await sock.sendMessage(sender, { 
                    text: '⚠️ Kteb l-wasf dial tswira, mital:\n`/image tomobil sport wa3ra f lil f casablanca`' 
                }, { quoted: m });
                return;
            }

            try {
                await sock.sendPresenceUpdate('composing', sender);
                await sock.sendMessage(sender, { text: '🎨 Blati d9i9a, kan-generi lik tswira HD...' }, { quoted: m });

                let optimizedPrompt = userPrompt;
                try {
                    const aiInstance = getNextGenAI();
                    if (aiInstance) {
                        const trModel = aiInstance.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
                        const trRes = await trModel.generateContent(
                            `Translate and optimize this prompt into an ultra-detailed, photorealistic English prompt for image generation: "${userPrompt}". Return ONLY the prompt.`
                        );
                        optimizedPrompt = trRes.response.text().trim() || userPrompt;
                    }
                } catch (e) {
                    console.log('Traduction skipped:', e.message);
                }

                const seed = Math.floor(Math.random() * 1000000);
                const encodedPrompt = encodeURIComponent(optimizedPrompt);
                const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux&width=1024&height=1024&seed=${seed}&nologo=true`;

                const res = await fetch(imageUrl);
                if (!res.ok) throw new Error('Échec génération image');

                const arrayBuffer = await res.arrayBuffer();
                const imageBuffer = Buffer.from(arrayBuffer);

                await sock.sendPresenceUpdate('paused', sender);
                await sock.sendMessage(sender, { 
                    image: imageBuffer, 
                    caption: `✨ *${userPrompt}*` 
                }, { quoted: m });
                return;

            } catch (err) {
                console.error('Image Error:', err);
                await sock.sendPresenceUpdate('paused', sender);
                await sock.sendMessage(sender, { 
                    text: '⚠️ Tra mochkil f generation dial t-tswira. 3awd jereb.' 
                }, { quoted: m });
                return;
            }
        }

        // ==========================================
        // 2. Gemini 3.1 Flash Lite Multimodal + Live Search
        // ==========================================
        try {
            await sock.sendPresenceUpdate('composing', sender);

            const isExplicitSearch = textContent.startsWith('/search') || textContent.startsWith('!search');
            let queryText = textContent;

            if (isExplicitSearch) {
                queryText = textContent.replace(/^(\/search|!search)/, '').trim();
                await sock.sendMessage(sender, { text: '🌐 Kan-9elleb f l-Web f wa9t l-fe3li...' }, { quoted: m });
            }

            const systemPrompt = `You are a smart, autonomous WhatsApp AI agent.
1. Formatting: NEVER use '#' or '###' headers. Use bold text and emojis (e.g. 📌 **العنوان**) for sections.
2. Web Search: You have real-time Google Search capability enabled. If the user asks about recent events, current news, sports, weather, live exchange rates, or explicit search queries, use Google Search to provide up-to-date and accurate facts.
3. Voice & Audio: Mentally transcribe and understand Moroccan Darija, Arabic, French, and English fluently. Answer directly and naturally.
4. Language: Dynamically match the user's language (especially Moroccan Darija).`;

            let contents = [];

            if (msgType === 'audioMessage') {
                const buffer = await downloadMediaMessage(m, 'buffer', {});
                contents.push({
                    inlineData: {
                        data: buffer.toString('base64'),
                        mimeType: 'audio/ogg; codecs=opus'
                    }
                });
                contents.push("Sme3 mzian l had l-vocal w jaweb 3la dakshi li fih b tari9a direct w mofida.");
            } else if (msgType === 'imageMessage') {
                const buffer = await downloadMediaMessage(m, 'buffer', {});
                contents.push({
                    inlineData: {
                        data: buffer.toString('base64'),
                        mimeType: rawMessage.imageMessage.mimetype || 'image/jpeg'
                    }
                });
                contents.push(queryText || "Chouf had t-tswira mzian w chre7 lia chno fiha.");
            } else if (msgType === 'documentMessage') {
                const mime = rawMessage.documentMessage.mimetype || '';
                if (mime.includes('pdf')) {
                    const buffer = await downloadMediaMessage(m, 'buffer', {});
                    contents.push({
                        inlineData: {
                            data: buffer.toString('base64'),
                            mimeType: 'application/pdf'
                        }
                    });
                    contents.push(queryText || "Lakhkhess lia had l-fichier PDF.");
                } else {
                    await sock.sendPresenceUpdate('paused', sender);
                    await sock.sendMessage(sender, { text: '⚠️ Kan-9blou ghir les fichiers PDF.' }, { quoted: m });
                    return;
                }
            } else {
                if (!queryText) {
                    await sock.sendPresenceUpdate('paused', sender);
                    return;
                }
                contents.push(queryText);
            }

            let responseText = null;
            let attempts = 0;
            const modelsToTry = [
                'gemini-3.1-flash-lite',
                'gemini-3.8-flash'
            ];

            while (!responseText && attempts < API_KEYS.length) {
                const aiInstance = getNextGenAI();
                if (!aiInstance) break;

                for (const currentModelName of modelsToTry) {
                    try {
                        const model = aiInstance.getGenerativeModel({
                            model: currentModelName,
                            systemInstruction: systemPrompt,
                            tools: [{ googleSearch: {} }]
                        });

                        if (msgType !== 'imageMessage' && msgType !== 'audioMessage' && msgType !== 'documentMessage') {
                            if (!userChats.has(sender)) userChats.set(sender, []);
                            const history = userChats.get(sender);

                            const chat = model.startChat({ history });
                            const result = await chat.sendMessage(queryText);
                            responseText = result.response.text();

                            history.push(
                                { role: 'user', parts: [{ text: queryText }] },
                                { role: 'model', parts: [{ text: responseText }] }
                            );
                            if (history.length > 16) history.splice(0, history.length - 16);
                        } else {
                            const result = await model.generateContent(contents);
                            responseText = result.response.text();
                        }

                        if (responseText) break;
                    } catch (err) {
                        console.warn(`Model ${currentModelName} failed:`, err.message);
                    }
                }
                attempts++;
            }

            if (!responseText) {
                throw new Error("Tous les modèles ou clés ont échoué.");
            }

            await sock.sendPresenceUpdate('paused', sender);
            await sock.sendMessage(sender, { text: responseText }, { quoted: m });

        } catch (error) {
            console.error('Erreur traitement :', error);
            await sock.sendPresenceUpdate('paused', sender);
            await sock.sendMessage(sender, { 
                text: '⚠️ Tra mochkil sghir f l-khedma dial l-message, 3awd sifto daba.' 
            }, { quoted: m });
        }
    });
}

startBot();
