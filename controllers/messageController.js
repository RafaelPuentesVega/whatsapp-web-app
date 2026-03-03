const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const qrcode = require('qrcode');
const { pdfToPng } = require('pdf-to-png-converter');
require('dotenv').config();

let sock;
let qrCodeData = '';
let connectionStatus = 'disconnected';

async function startWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            auth: state,
            version,
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
            connectionStatus = connection;
            if (qr) qrCodeData = qr;

            if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 403) {
                console.log('Reconectando...');
                setTimeout(startWhatsApp, 3000);
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp conectado y listo.');
            }
        });
    } catch (error) {
        console.error('❌ Error al iniciar WhatsApp:', error);
    }
}

startWhatsApp();

const formatId = (id, isGroup = false) =>
    `${id.toString().replace(/^\+/, '')}@${isGroup ? 'g.us' : 's.whatsapp.net'}`;

const downloadFile = async (url, filename) => {
    const response = await axios({ url, responseType: 'arraybuffer' });
    fs.writeFileSync(filename, response.data);
};

// Enviar mensaje de texto
const sendText = async (req, res) => {
    try {
        const { number, message, isGroup = false } = req.body;
        if (!number || !message) return res.status(400).json({ error: 'Número y mensaje son obligatorios' });

        const jid = formatId(number, isGroup);
        const response = await sock.sendMessage(jid, { text: message });
        res.json({ status: 'success', response });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

// Enviar imagen
const sendImage = async (req, res) => {
    const { number, imageUrl, caption = '', isGroup = false } = req.body;
    const tempPath = path.join(__dirname, '..', 'temp', 'img.jpg');

    try {
        await downloadFile(imageUrl, tempPath);
        const buffer = fs.readFileSync(tempPath);
        const jid = formatId(number, isGroup);
        const response = await sock.sendMessage(jid, { image: buffer, caption });
        res.json({ status: 'success', response });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
};

// Enviar PDF
const sendPDF = async (req, res) => {
    const { number, pdfUrl, fileName = 'document', isGroup = false } = req.body;
    const tempPath = path.join(__dirname, '..', 'temp', 'doc.pdf');

    try {
        await downloadFile(pdfUrl, tempPath);
        const buffer = fs.readFileSync(tempPath);
        const jid = formatId(number, isGroup);
        const response = await sock.sendMessage(jid, {
            document: buffer,
            mimetype: 'application/pdf',
            fileName: `${fileName}.pdf`
        });
        res.json({ status: 'success', response });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
};

// Enviar PDF como imagen (convierte cada página a PNG)
const sendPDFAsImage = async (req, res) => {
    const { number, pdfUrl, fileName = 'document', isGroup = false } = req.body;
    const tempPdfPath = path.join(__dirname, '..', 'temp', `${Date.now()}_doc.pdf`);

    try {
        await downloadFile(pdfUrl, tempPdfPath);

        const pages = await pdfToPng(tempPdfPath, {
            disableFontFace: false,
            useSystemFonts: false,
            viewportScale: 2.0,
        });

        const jid = formatId(number, isGroup);

        for (let i = 0; i < pages.length; i++) {
            await sock.sendMessage(jid, {
                image: pages[i].content,
                caption: i === 0 ? (fileName || '') : ''
            });
        }

        res.json({ status: 'success', pages: pages.length });
    } catch (err) {
        console.error('Error en sendPDFAsImage:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
    }
};

// Función para generar QR
const generateQr = async (req, res) => {
    const providedToken = req.query.token;
    console.log('Solicitud de código QR recibida');

    if (!providedToken || providedToken !== process.env.SECURITY_TOKEN) {
        console.log('Intento de acceso no autorizado al QR');
        return res.status(403).send('Unauthorized: Invalid token');
    }

    if (qrCodeData) {
        console.log('Enviando código QR');
        qrcode.toDataURL(qrCodeData, (err, src) => {
            if (err) {
                console.error('Error al generar imagen QR:', err);
                return res.send('Error occurred');
            }
            res.send(`
                <html>
                <head>
                    <title>WhatsApp QR Code</title>
                    <meta http-equiv="refresh" content="30">
                </head>
                <body>
                    <h1>WhatsApp Web QR Code</h1>
                    <p>Estado de conexión: ${connectionStatus}</p>
                    <img src="${src}">
                    <p>Esta página se actualizará automáticamente cada 30 segundos</p>
                </body>
                </html>
            `);
        });
    } else {
        console.log('QR no disponible todavía');
        res.send(`
            <html>
            <head>
                <title>WhatsApp QR Code</title>
                <meta http-equiv="refresh" content="5">
            </head>
            <body>
                <h1>WhatsApp Web QR Code</h1>
                <p>Estado de conexión: ${connectionStatus}</p>
                <p>El código QR no está disponible todavía, esta página se actualizará automáticamente...</p>
            </body>
            </html>
        `);
    }
};
// Estado de conexión
const getStatus = (req, res) => {
    if (req.query.token !== process.env.SECURITY_TOKEN) {
        return res.status(403).send('Token inválido');
    }

    res.json({
        status: connectionStatus,
        qrAvailable: !!qrCodeData
    });
};

// Limpiar caché
const clearCache = (req, res) => {
    if (req.query.token !== process.env.SECURITY_TOKEN) {
        return res.status(403).send('Token inválido');
    }

    const authPath = path.resolve(__dirname, '../auth_info');
    try {
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            qrCodeData = '';
            connectionStatus = 'disconnected';
            console.log('✅ Caché eliminado. Reiniciando...');
            setTimeout(startWhatsApp, 2000);
            return res.send('Caché eliminado. Reiniciando conexión...');
        } else {
            return res.send('No se encontró carpeta de autenticación.');
        }
    } catch (err) {
        return res.status(500).send('Error al eliminar la caché: ' + err.message);
    }
};

// Obtener todos los grupos
const getGroups = async (req, res) => {
    if (req.query.token !== process.env.SECURITY_TOKEN) {
        return res.status(403).send('Token inválido');
    }

    try {
        const groups = await sock.groupFetchAllParticipating();
        const result = Object.entries(groups).map(([id, group]) => ({
            id: id.split('@')[0],
            name: group.subject,
            participants: group.participants.length
        }));

        res.json({ count: result.length, groups: result });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener los grupos' });
    }
};

// Obtener lista simplificada de grupos
const getGroupsList = async (req, res) => {
    if (req.query.token !== process.env.SECURITY_TOKEN) {
        return res.status(403).send('Token inválido');
    }

    try {
        const groups = await sock.groupFetchAllParticipating();
        const list = Object.entries(groups).map(([id, group]) => ({
            id: id.split('@')[0],
            name: group.subject
        }));

        res.json(list);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener la lista de grupos' });
    }
};

// Router principal
const sendMessage = async (req, res) => {
    const { type, number, message, imageUrl, pdfUrl, fileName, isGroup = false } = req.body;

    if (!number) return res.status(400).json({ error: 'Número requerido' });

    switch (type) {
        case 'texto':
            return sendText(req, res);
        case 'imagen':
            return sendImage(req, res);
        case 'pdf':
            return sendPDF(req, res);
        case 'pdfAsImage':
            return sendPDFAsImage(req, res);
        default:
            return res.status(400).json({ error: 'Tipo de mensaje no válido' });
    }
};

module.exports = {
    sendMessage,
    generateQr,
    clearCache,
    getGroups,
    getGroupsList,
    getStatus
};
