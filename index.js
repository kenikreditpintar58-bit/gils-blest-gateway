const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(express.json());

const qrCodes = {};
const connectionStatus = {};
let sock = null;

async function startWhatsAppSession() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' })
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCodes['gils-session'] = qr;
                connectionStatus['gils-session'] = 'qr_ready';
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                connectionStatus['gils-session'] = 'disconnected';
                if (shouldReconnect) {
                    startWhatsAppSession();
                }
            } else if (connection === 'open') {
                connectionStatus['gils-session'] = 'connected';
                qrCodes['gils-session'] = null;
                console.log('WhatsApp Berhasil Terhubung!');
            }
        });

        sock.ev.on('creds.update', saveCreds);
    } catch (err) {
        console.error('Error saat inisialisasi WhatsApp:', err);
    }
}

// Endpoint untuk mengambil QR code
app.get('/qr', (req, res) => {
    const qr = qrCodes['gils-session'];
    const status = connectionStatus['gils-session'] || 'loading';

    if (status === 'connected') {
        return res.json({ status: 'connected', message: 'WhatsApp sudah terhubung aktif.' });
    }
    
    if (qr) {
        return res.json({ status: 'qr_ready', qrString: qr });
    }

    res.json({ status: 'loading', message: 'QR sedang disiapkan oleh server, silakan coba sebentar lagi.' });
});

// Endpoint Utama
app.get('/', (req, res) => {
    res.send('Gils Blest Multi-Device Railway Gateway is Running Online.');
});

// Jalankan Server di Port Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server berjalan di port ${PORT}`);
    startWhatsAppSession();
});
