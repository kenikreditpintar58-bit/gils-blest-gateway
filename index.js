const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// Izinkan CORS untuk akses dari Netlify
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

const sessions = {};
const qrCodes = {};
const GAS_URL = process.env.GAS_URL || '';

async function startWhatsAppSession(sessionName) {
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionName}`);
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sessions[sessionName] = sock;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodes[sessionName] = qr;
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) {
                startWhatsAppSession(sessionName);
            }
        } else if (connection === 'open') {
            qrCodes[sessionName] = 'CONNECTED';
            console.let?.(`Sesi ${sessionName} Berhasil Terhubung!`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        // Kirim log ke Google Apps Script (GAS)
        if (GAS_URL) {
            try {
                await fetch(GAS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'save_message',
                        sessionName: sessionName,
                        sender: sender,
                        message: messageText,
                        type: 'incoming'
                    })
                });
            } catch (err) {
                console.error("Gagal kirim ke GAS:", err.message);
            }
        }
    });
}

// Endpoint Scan / Generate QR
app.get('/scan', async (req, res) => {
    const sessionName = req.query.session || 'gils';
    if (!sessions[sessionName]) {
        startWhatsAppSession(sessionName);
        // Beri waktu sejenak untuk generate QR pertama kali
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const qr = qrCodes[sessionName];
    if (qr === 'CONNECTED') {
        return res.json({ status: 'connected', message: 'Sesi sudah terhubung.' });
    }
    if (qr) {
        return res.json({ qr: qr });
    }
    res.json({ status: 'loading', message: 'QR sedang disiapkan, coba refresh sebentar lagi.' });
});

app.get('/', (req, res) => {
    res.send('Gils Blest Multi-Device Railway Gateway is Running Online.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Gateway berjalan di port ${PORT}`);
});
