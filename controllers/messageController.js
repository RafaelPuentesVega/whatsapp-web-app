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


// Función para borrar la carpeta de caché
const clearCache1 = async (req, res) => {
    const cacheAuthPath = path.resolve(__dirname, '../.wwebjs_auth');
    const cachePath = path.resolve(__dirname, '../.wwebjs_cache');
    const providedToken = req.query.token; // Token pasado como parámetro en la URL

    // Validar el token
    if (!providedToken || providedToken !== securityToken) {
        return res.status(403).send('Unauthorized: Invalid token');
    }

    // Eliminar la carpeta de caché
    fs.rm(cachePath, { recursive: true, force: true }, (err) => {
        if (err) {
            return res.status(500).send('Error deleting cache: ' + err.message);
        } else {
            fs.rm(cacheAuthPath, { recursive: true, force: true }, (err) => {
                if (err) {
                    return res.status(500).send('Error deleting auth cache: ' + err.message);
                } else {
                    return res.status(200).send('Cache deleted successfully.');
                }
            });
        }
    });
};

const downloadImage = async (url, filename) => {
    const response = await axios({
        url,
        responseType: 'arraybuffer'
    });
    fs.writeFileSync(filename, response.data);
};

const messageText = async (number, message, res) => {
    try {
        const response = await sock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
        res.status(200).json({
            status: 'success',
            message: 'Message sent successfully',
            response: response
        });
    } catch (err) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to send message: ' + err.message
        });
    }
};

const messageMedia = async (number, imageUrl, message, res) => {
    const imagePath = path.resolve(__dirname, '..', 'temp', 'uploads.jpg');

    try {
        let text = '';
        if(message){
            text = message;
        }
        // Descargar la imagen desde la URL
        await downloadImage(imageUrl, imagePath);

        // Leer la imagen desde el archivo y convertirla a base64
        const imageBuffer = fs.readFileSync(imagePath);
        const imageBase64 = imageBuffer.toString('base64');

        // Enviar la imagen usando Baileys
        const response = await sock.sendMessage(`${number}@s.whatsapp.net`, {
            image: imageBuffer,
            caption: text // Texto opcional para acompañar la imagen
        });

        res.status(200).json({
            status: 'success',
            message: 'Image sent successfully',
            response: response
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to send image or download the image: ' + error.message
        });
    } finally {
        // Elimina la imagen temporal
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    }
};
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



const sendPDF = async (number, pdfBase64, nameFile, res) => {
    try {
        const imagePath = path.resolve(__dirname, '..', 'temp', 'uploads.pdf');

        // Convertir la cadena base64 de vuelta a un buffer
        //const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        // Descargar la imagen desde la URL
        await downloadImage(pdfBase64, imagePath);

        // Leer la imagen desde el archivo y convertirla a base64
        const imageBuffer = fs.readFileSync(imagePath);

        // Enviar el archivo PDF usando Baileys
        const response = await sock.sendMessage(`${number}@s.whatsapp.net`, {
            document: imageBuffer,
            mimetype: 'application/pdf',
            fileName: nameFile+'.pdf', // Nombre del archivo que el receptor verá
        });

        res.status(200).json({
            status: 'success',
            message: 'PDF sent successfully',
            response: response
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to send PDF: ' + error.message
        });
    }
};

const sendMessage = async (req, res) => {
    const { number, message, imageUrl, pdfBase64, type , nameFile } = req.body;

    if (!number) {
        return res.status(400).json({
            status: 'error',
            message: 'Number is required'
        });
    }

    switch (type) {
        case "texto":
            if (!message) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Message is required'
                });
            }
            await messageText(number, message, res);
            break;

        case "imagen":
            if (!imageUrl) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Image URL is required'
                });
            }
            await messageMedia(number, imageUrl,message, res);
            break;
        case "pdf":
            if (!pdfBase64) {
                return res.status(400).json({
                    status: 'error',
                    message: 'pdf base64 is required'
                });
            }
            await sendPDF(number, pdfBase64 ,nameFile, res);
            break;
    
        default:
            return res.status(400).json({
                status: 'error',
                message: 'Undefined type'
            });
    }
};

module.exports = {
    sendMessage,
    generateQr,
    clearCache
};
