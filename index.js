const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');

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
const connectionStatus = {};

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
            // Ubah teks QR mentah dari Baileys menjadi gambar DataURL Base64 agar langsung bisa dibaca tag <img> HTML
            try {
                qrCodes[sessionName] = await qrcode.toDataURL(qr);
                connectionStatus[sessionName] = 'qr_ready';
            } catch (err) {
                console.error("Gagal generate QR image:", err);
            }
        }
        
        if (connection === 'close') {
            connectionStatus[sessionName] = 'disconnected';
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) {
                startWhatsAppSession(sessionName);
            }
        } else if (connection === 'open') {
            connectionStatus[sessionName] = 'connected';
            qrCodes[sessionName] = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Endpoint untuk mengambil QR code atau Status Sesi
app.get('/qr', async (req, res) => {
    const sessionName = req.query.session || 'gils-session';
    
    // Jika sesi belum ada, buat baru
    if (!sessions[sessionName]) {
        startWhatsAppSession(sessionName);
        return res.json({ status: 'loading', message: 'Memulai sesi WhatsApp, silakan refresh sebentar lagi.' });
    }

    if (connectionStatus[sessionName] === 'connected') {
        return res.json({ status: 'connected', message: 'Sesi sudah terhubung aktif.' });
    }

    const qrImage = qrCodes[sessionName];
    if (qrImage) {
        return res.json({ qr: qrImage });
    }

    res.json({ status: 'loading', message: 'QR sedang disiapkan oleh server...' });
});

app.get('/', (req, res) => {
    res.send('Gils Blest Multi-Device Railway Gateway is Running Online.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server berjalan di port ${PORT}`);
});
