const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const sessions = {}; // Menyimpan instance koneksi aktif
const qrStore = {};  // Menyimpan string QR per sesi
const GAS_WEBHOOK_URL = process.env.GAS_URL || "MASUKKAN_URL_WEB_APP_GAS_ANDA_DISINI";

// Fungsi untuk memulai sesi WhatsApp
async function startSession(sessionId, res = null) {
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${sessionId}`);
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true
    });

    sessions[sessionId] = sock;

    sock.udarstven = state;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrStore[sessionId] = qr;
            notifyGAS({ action: "update_session", sessionName: sessionId, status: "Waiting QR Scan" });
        }

        if (connection === 'open') {
            console.log(`Sesi terhubung: ${sessionId}`);
            qrStore[sessionId] = "CONNECTED";
            let phoneNumber = sock.user ? sock.user.id.split(':')[0] : '';
            notifyGAS({ action: "update_session", sessionName: sessionId, status: "Connected", phoneNumber: phoneNumber });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Koneksi terputus untuk ${sessionId}, reconnect: ${shouldReconnect}`);
            notifyGAS({ action: "update_session", sessionName: sessionId, status: "Disconnected" });
            if (shouldReconnect) {
                startSession(sessionId);
            }
        }
    });

    // Menangkap Pesan Masuk
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const sender = msg.key.remoteJid;
            const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "[Media/Other]";
            
            console.log(`[Pesan Masuk] Sesi: ${sessionId} | Dari: ${sender} | Pesan: ${messageText}`);
            
            // Kirim ke Google Apps Script agar masuk ke Database 1 Dashboard
            notifyGAS({
                action: "save_message",
                sessionName: sessionId,
                sender: sender,
                receiver: sessionId,
                message: messageText,
                type: "incoming"
            });
        }
    });

    if (res && qrStore[sessionId] && qrStore[sessionId] !== "CONNECTED") {
        let url = await qrcode.toDataURL(qrStore[sessionId]);
        return res.json({ status: "success", qr: url });
    }
}

function notifyGAS(data) {
    if (!GAS_WEBHOOK_URL.includes("script.google.com")) return;
    fetch(GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).catch(err => console.log("Gagal kirim ke GAS:", err));
}

// Route API untuk inisialisasi / scan QR sesi baru
app.get('/scan', async (req, res) => {
    const sessionId = req.query.session || 'gils-1';
    if (!sessions[sessionId]) {
        await startSession(sessionId, res);
    } else if (qrStore[sessionId] === "CONNECTED") {
        return res.json({ status: "connected", message: "Sesi sudah terhubung!" });
    } else if (qrStore[sessionId]) {
        let url = await qrcode.toDataURL(qrStore[sessionId]);
        return res.json({ status: "success", qr: url });
    } else {
        return res.json({ status: "loading", message: "Menghasilkan QR, silakan refresh beberapa saat lagi." });
    }
});

// Route API untuk mengirim pesan dari dashboard terpusat
app.post('/send-message', async (req, res) => {
    const { sessionName, receiver, message } = req.body;
    const sock = sessions[sessionName];

    if (!sock) {
        return res.status(400).json({ status: "error", message: "Sesi WhatsApp tidak aktif di server!" });
    }

    try {
        const jid = receiver.includes('@s.whatsapp.net') ? receiver : receiver + '@s.whatsapp.net';
        await sock.sendMessage(jid, { text: message });

        // Catat pesan keluar ke Google Sheets
        notifyGAS({
            action: "save_message",
            sessionName: sessionName,
            sender: sessionName,
            receiver: receiver,
            message: message,
            type: "outgoing"
        });

        res.json({ status: "success", message: "Pesan berhasil dikirim" });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.toString() });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Gils Blest Railway Gateway running on port ${PORT}`));