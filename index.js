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

// 1. خادم HTTP للحفاظ على الخدمة نشطة مع UptimeRobot
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Gemini Bot is fully active!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// 2. مفاتيح Gemini مع التدوير (Rotation)
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
    return limit.count > 15; // 15 رسالة في الدقيقة
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
            console.log('WhatsApp Bot is ONLINE and ready with Multimodal support!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const sender = m.key.remoteJid;
        const isGroup = sender.endsWith('@g.us');
        const botNumber = sock.user?.id ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : '';

        const msgType = Object.keys(m.message)[0];
        let textContent = m.message.conversation || 
                          m.message.extendedTextMessage?.text || 
                          m.message.imageMessage?.caption || 
                          m.message.documentMessage?.caption || '';

        // إدارة المجموعات (الرد عند المنشن أو !bot فقط)
        if (isGroup) {
            const mentions = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const isMentioned = botNumber && mentions.includes(botNumber);
            const hasPrefix = textContent.toLowerCase().startsWith('!bot');

            if (!isMentioned && !hasPrefix) return;
            textContent = textContent.replace('!bot', '').replace(new RegExp(`@${botNumber.split('@')[0]}`, 'g'), '').trim();
        }

        if (isRateLimited(sender)) {
            await sock.sendMessage(sender, { text: '⚠️ تجاوزت الحد المسموح. انتظر دقيقة واحدة من فضلك.' }, { quoted: m });
            return;
        }

        const cleanText = textContent.trim().toLowerCase();
        if (cleanText === 'clear' || cleanText === 'كلير') {
            userChats.delete(sender);
            await sock.sendMessage(sender, { text: '✅ تم مسح الذاكرة وسياق المحادثة بنجاح!' }, { quoted: m });
            return;
        }

        try {
            await sock.sendPresenceUpdate('composing', sender);

            const systemPrompt = `You are an intelligent, natural WhatsApp AI assistant.
1. Formatting: NEVER use '#' or '###' headers. Use emojis and bold text (e.g. 📌 **العنوان**) for clear sections.
2. Voice & Audio: Transcribe mentally, understand Moroccan Darija, Arabic, English, and French accurately, and reply with a direct, helpful solution.
3. Matching: Always answer in the exact same language/dialect used by the user.`;

            let contents = [];

            // 1. التعامل مع الفويس (Voice Notes)
            if (msgType === 'audioMessage') {
                const buffer = await downloadMediaMessage(m, 'buffer', {});
                contents.push({
                    inlineData: {
                        data: buffer.toString('base64'),
                        mimeType: 'audio/ogg; codecs=opus'
                    }
                });
                contents.push("استمع بدقة لهذا التسجيل الصوتي، وافهم ما قيل (سواء كان بالدارجة المغربية أو أي لغة أخرى) وأجب عليه مباشرة بحل أو توضيح مفيد.");
            }
            // 2. التعامل مع الصور
            else if (msgType === 'imageMessage') {
                const buffer = await downloadMediaMessage(m, 'buffer', {});
                contents.push({
                    inlineData: {
                        data: buffer.toString('base64'),
                        mimeType: m.message.imageMessage.mimetype || 'image/jpeg'
                    }
                });
                contents.push(textContent || "حلل الصورة بدقة واشرح ما فيها أو أجب عن السؤال المتعلق بها.");
            }
            // 3. التعامل مع ملفات الـ PDF
            else if (msgType === 'documentMessage') {
                const mime = m.message.documentMessage.mimetype || '';
                if (mime.includes('pdf')) {
                    const buffer = await downloadMediaMessage(m, 'buffer', {});
                    contents.push({
                        inlineData: {
                            data: buffer.toString('base64'),
                            mimeType: 'application/pdf'
                        }
                    });
                    contents.push(textContent || "لخص هذا الملف وأبرز أهم ما ورد فيه من نقاط.");
                } else {
                    await sock.sendPresenceUpdate('paused', sender);
                    await sock.sendMessage(sender, { text: '⚠️ حالياً ندعم مستندات الـ PDF فقط.' }, { quoted: m });
                    return;
                }
            }
            // 4. نصوص عادية
            else {
                if (!textContent) return;
                contents.push(textContent);
            }

            let responseText = null;
            let attempts = 0;

            while (!responseText && attempts < API_KEYS.length) {
                try {
                    const aiInstance = getNextGenAI();
                    const model = aiInstance.getGenerativeModel({
                        model: 'gemini-2.5-flash',
                        systemInstruction: systemPrompt
                    });

                    // الرسائل النصية تحتفظ بالذاكرة
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
                        // الصور والأوديو والـ PDF
                        const result = await model.generateContent(contents);
                        responseText = result.response.text();
                    }
                } catch (err) {
                    attempts++;
                    console.error(`Attempt with API key ${currentKeyIndex} failed:`, err.message);
                }
            }

            if (!responseText) {
                throw new Error("تعذر الحصول على رد من جميع المفاتيح المتاحة.");
            }

            await sock.sendPresenceUpdate('paused', sender);
            await sock.sendMessage(sender, { text: responseText }, { quoted: m });

        } catch (error) {
            console.error('Processing Error:', error);
            await sock.sendPresenceUpdate('paused', sender);
            await sock.sendMessage(sender, { 
                text: '⚠️ وقع مشكل بسيط فمعالجة الرسالة، عاود صيفطها وغادي نجاوبك دابا.' 
            }, { quoted: m });
        }
    });
}

startBot();
