const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const qrcode = require('qrcode');

let qrCodeData = '';
let sock;

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, 
        version
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (connection === 'close') {
            startWhatsApp(); 
        } else if (connection === 'open') {
            console.log('Client is ready!');
        }

        if (qr) {
            qrCodeData = qr;
        }
    });

    sock.ev.on('messages.upsert', async (message) => {
        console.log('Received a message!', message);
    });
}

startWhatsApp();

// Formatea el ID de destinatario según sea usuario o grupo
const formatRecipientId = (id, isGroup = false) => {
    return `${id}@${isGroup ? 'g.us' : 's.whatsapp.net'}`;
};

// Función para generar QR
const generateQr = async (req, res) => {
    const providedToken = req.query.token;

    if (!providedToken || providedToken !== process.env.SECURITY_TOKEN) {
        return res.status(403).send('Unauthorized: Invalid token');
    }

    if (qrCodeData) {
        qrcode.toDataURL(qrCodeData, (err, src) => {
            if (err) return res.send('Error occurred');
            res.send(`<img src="${src}">`);
        });
    } else {
        res.send('QR Code is not available yet, please refresh.');
    }
};

// Descargar imagen desde URL
const downloadImage = async (url, filename) => {
    const response = await axios({
        url,
        responseType: 'arraybuffer'
    });
    fs.writeFileSync(filename, response.data);
};

// Función unificada para enviar mensajes de texto
const sendText = async (recipientId, message, isGroup = false) => {
    try {
        const formattedId = formatRecipientId(recipientId, isGroup);
        const response = await sock.sendMessage(formattedId, { text: message });
        return {
            status: 'success',
            message: `Message sent successfully to ${isGroup ? 'group' : 'user'}`,
            response: response
        };
    } catch (err) {
        throw new Error(`Failed to send message: ${err.message}`);
    }
};

// Función unificada para enviar medios (imágenes)
const sendMedia = async (recipientId, imageUrl, caption = '', isGroup = false) => {
    const imagePath = path.resolve(__dirname, '..', 'temp', 'uploads.jpg');

    try {
        // Descargar la imagen desde la URL
        await downloadImage(imageUrl, imagePath);

        // Leer la imagen desde el archivo
        const imageBuffer = fs.readFileSync(imagePath);
        
        // Enviar la imagen
        const formattedId = formatRecipientId(recipientId, isGroup);
        const response = await sock.sendMessage(formattedId, {
            image: imageBuffer,
            caption: caption
        });

        return {
            status: 'success',
            message: `Image sent successfully to ${isGroup ? 'group' : 'user'}`,
            response: response
        };
    } catch (error) {
        throw new Error(`Failed to send image: ${error.message}`);
    } finally {
        // Elimina la imagen temporal
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    }
};

// Función unificada para enviar PDF
const sendPDF = async (recipientId, pdfUrl, fileName, isGroup = false) => {
    const pdfPath = path.resolve(__dirname, '..', 'temp', 'uploads.pdf');

    try {
        // Descargar el PDF desde la URL
        await downloadImage(pdfUrl, pdfPath);

        // Leer el PDF
        const pdfBuffer = fs.readFileSync(pdfPath);
        
        // Enviar el PDF
        const formattedId = formatRecipientId(recipientId, isGroup);
        const response = await sock.sendMessage(formattedId, {
            document: pdfBuffer,
            mimetype: 'application/pdf',
            fileName: `${fileName}.pdf`
        });

        return {
            status: 'success',
            message: `PDF sent successfully to ${isGroup ? 'group' : 'user'}`,
            response: response
        };
    } catch (error) {
        throw new Error(`Failed to send PDF: ${error.message}`);
    } finally {
        // Elimina el PDF temporal
        if (fs.existsSync(pdfPath)) {
            fs.unlinkSync(pdfPath);
        }
    }
};

// Función para obtener todos los grupos
const getGroups = async (req, res) => {
    try {
        const providedToken = req.query.token;

        if (!providedToken || providedToken !== process.env.SECURITY_TOKEN) {
            return res.status(403).send('Unauthorized: Invalid token');
        }
        
        const groups = await sock.groupFetchAllParticipating();
        res.status(200).json({
            status: 'success',
            groups: groups
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch groups: ' + error.message
        });
    }
};

// Función para limpiar caché
const clearCache = async (req, res) => {
    const cacheAuthPath = path.resolve(__dirname, '../auth_info');
    const providedToken = req.query.token;

    if (!providedToken || providedToken !== process.env.SECURITY_TOKEN) {
        return res.status(403).send('Unauthorized: Invalid token');
    }

    fs.rm(cacheAuthPath, { recursive: true, force: true }, (err) => {
        if (err) {
            return res.status(500).send('Error deleting cache: ' + err.message);
        } else {
            return res.status(200).send('Cache deleted successfully.');
        }
    });
};

// Función unificada para enviar mensajes - API endpoint
const sendMessage = async (req, res) => {
    try {
        const { 
            recipientId, 
            message, 
            imageUrl, 
            pdfUrl, 
            type, 
            fileName,
            isGroup = false  // Valor por defecto: false (envío a usuario individual)
        } = req.body;

        if (!recipientId) {
            return res.status(400).json({
                status: 'error',
                message: 'Recipient ID is required'
            });
        }

        let response;
        switch (type) {
            case "texto":
                if (!message) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Message is required'
                    });
                }
                response = await sendText(recipientId, message, isGroup);
                break;

            case "imagen":
                if (!imageUrl) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Image URL is required'
                    });
                }
                response = await sendMedia(recipientId, imageUrl, message || '', isGroup);
                break;
                
            case "pdf":
                if (!pdfUrl) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'PDF URL is required'
                    });
                }
                response = await sendPDF(recipientId, pdfUrl, fileName || 'document', isGroup);
                break;
        
            default:
                return res.status(400).json({
                    status: 'error',
                    message: 'Undefined type'
                });
        }
        
        res.status(200).json(response);
        
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

module.exports = {
    sendMessage,
    generateQr,
    clearCache,
    getGroups
};