const { 
    makeWASocket, 
    DisconnectReason, 
    initAuthCreds, 
    BufferJSON, 
    proto 
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MongoClient } = require('mongodb');
const pino = require('pino');
const http = require('http');
require('dotenv').config();

// 1. Server HTTP bash Render yb9a dima khdam 24/7
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Gemini Bot is alive!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// 2. Configuration d MongoDB w Gemini
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://elitenlife1_db_user:Vx4qcoMjx5leWpL5@cluster0.41ntufo.mongodb.net/?retryWrites=true&w=majority";
const mongoClient = new MongoClient(MONGO_URI);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Stockage temporaire dyal les conversations (Memory)
const userChats = new Map();

// 3. Système d'authentification m3a MongoDB Atlas
async function useMongoDBAuthState(collection) {
    const writeData = async (data, id) => {
        const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        await collection.replaceOne({ _id: id }, { _id: id, value: serialized }, { upsert: true });
    };

    const readData = async (id) => {
        const doc = await collection.findOne({ _id: id });
        if (!doc) return null;
        return JSON.parse(JSON.stringify(doc.value), BufferJSON.reviver);
    };

    const removeData = async (id) => {
        await collection.deleteOne({ _id: id });
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const name = `${category}-${id}`;
                            tasks.push(value ? writeData(value, name) : removeData(name));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
}

async function startBot() {
    try {
        await mongoClient.connect();
        console.log("Connected to MongoDB Atlas successfully!");
    } catch (err) {
        console.error("MongoDB Connection Error:", err);
        setTimeout(startBot, 5000);
        return;
    }

    const db = mongoClient.db("whatsapp_bot");
    const authCollection = db.collection("auth_session");
    const { state, saveCreds } = await useMongoDBAuthState(authCollection);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'fatal' }),
        printQRInTerminal: false,
        browser: ["WhatsApp Gemini Bot", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    // Ghadi y-tleb pairing code ghir l-merra lwla safi
    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER;
        if (phoneNumber) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n========================================`);
                    console.log(`YOUR FINAL PAIRING CODE IS: ${code?.match(/.{1,4}/g)?.join('-')}`);
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
            console.log('WhatsApp Bot is online and saved in MongoDB!');
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

            // Commande dial Clear l-memory
            if (cleanText === 'clear' || cleanText === 'كلير') {
                userChats.delete(sender);
                await sock.sendPresenceUpdate('paused', sender);
                await sock.sendMessage(sender, { 
                    text: '✅ Safi, ms7t ga3 dakshi li fat! Yallah نبداو sujet jdid.' 
                }, { quoted: m });
                return;
            }

            // System instructions dyal Gemini
            const systemPrompt = `You are a helpful and smart WhatsApp AI assistant.
1. Language: Always match the user's language (fluent Moroccan Darija when spoken to in it).
2. WhatsApp Format: NEVER use markdown headers like '#', '##', or '###'. WhatsApp does not support them. Use emojis and bold text with double asterisks for section headers (e.g., 📌 **العنوان هنا**).
3. Length and Precision: Keep basic greetings and simple questions brief, clear, and direct. When asked for details, comprehensive guides, or long topics, provide full, deep, and structured answers.
4. Tone: Engaging, natural, and helpful without robotic filler phrases.`;

            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                systemInstruction: systemPrompt
            });

            // Initialiser chat mémoire ila ma kanesh déjà m7loul
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
                text: '⚠️ Smeh lia, t3telt shwiya f t-tfkir w tra crash sghir. 3awd sift lia l-sou2al dyalk dork w ghadi njawbk direct!' 
            }, { quoted: m });
        }
    });
}

startBot();
