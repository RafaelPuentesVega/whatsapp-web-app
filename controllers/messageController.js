const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const qrcode = require('qrcode');

let qrCodeData = '';
let sock;
let connectionStatus = 'disconnected';
let lastConnectionUpdate = null;

async function startWhatsApp() {
    console.log('Iniciando WhatsApp...');
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
        const { version, isLatest } = await fetchLatestBaileysVersion();
        
        console.log(`Usando versión de Baileys: ${version}, es la última: ${isLatest}`);
        console.log('Verificando archivos de autenticación...');
        
        // Verificar si hay archivos de autenticación
        const authFiles = fs.readdirSync('./auth_info');
        console.log(`Archivos de autenticación encontrados: ${authFiles.length > 0 ? authFiles.join(', ') : 'ninguno'}`);
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, 
            version,
            logger: {
                level: 'error' // Establecer solo errores para no sobrecargar los logs
            },
        });

        sock.ev.on('creds.update', (creds) => {
            console.log('Credenciales actualizadas');
            saveCreds();
        });

        sock.ev.on('connection.update', (update) => {
            console.log('Actualización de conexión:', JSON.stringify(update, null, 2));
            const { connection, qr, lastDisconnect } = update;
            lastConnectionUpdate = new Date().toISOString();
            
            if (connection) {
                connectionStatus = connection;
                console.log(`Estado de conexión: ${connection}`);
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.message || 'Unknown';
                console.log(`Conexión cerrada. Código: ${statusCode}, Razón: ${reason}`);
                
                if (statusCode === 401) {
                    console.log('Sesión expirada o inválida. Puedes tener que escanear el código QR nuevamente.');
                }
                
                if (statusCode !== 403) {
                    console.log('Intentando reconexión...');
                    startWhatsApp(); 
                }
            } else if (connection === 'open') {
                console.log('Cliente conectado y listo!');
            }

            if (qr) {
                console.log('Nuevo código QR generado');
                qrCodeData = qr;
            }
        });

        sock.ev.on('messages.upsert', async (message) => {
            console.log('Mensaje recibido:', JSON.stringify(message.messages[0]?.key || 'No key', null, 2));
        });
    } catch (error) {
        console.error('Error al iniciar WhatsApp:', error);
    }
}

startWhatsApp();

// Formatea el ID de destinatario según sea usuario o grupo
const formatRecipientId = (id, isGroup = false) => {
    const formatted = `${id}@${isGroup ? 'g.us' : 's.whatsapp.net'}`;
    console.log(`ID formateado: ${id} -> ${formatted} (Es grupo: ${isGroup})`);
    return formatted;
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
                    <p>Última actualización: ${lastConnectionUpdate || 'N/A'}</p>
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
                <p>Última actualización: ${lastConnectionUpdate || 'N/A'}</p>
                <p>El código QR no está disponible todavía, esta página se actualizará automáticamente...</p>
            </body>
            </html>
        `);
    }
};

// Descargar imagen desde URL
const downloadImage = async (url, filename) => {
    console.log(`Descargando archivo desde: ${url} a ${filename}`);
    try {
        const response = await axios({
            url,
            responseType: 'arraybuffer'
        });
        fs.writeFileSync(filename, response.data);
        console.log('Archivo descargado correctamente');
        return true;
    } catch (error) {
        console.error(`Error al descargar archivo: ${error.message}`);
        throw error;
    }
};

// Función unificada para enviar mensajes de texto
const sendText = async (recipientId, message, isGroup = false) => {
    console.log(`Enviando mensaje de texto a ${recipientId}${isGroup ? ' (grupo)' : ''}: "${message.substring(0, 30)}${message.length > 30 ? '...' : ''}"`);
    console.log(`Estado actual de conexión: ${connectionStatus}`);
    
    try {
        if (connectionStatus !== 'open') {
            console.log('⚠️ Advertencia: Intentando enviar mensaje sin conexión activa');
        }
        
        const formattedId = formatRecipientId(recipientId, isGroup);
        console.log(`Enviando mensaje a: ${formattedId}`);
        
        const response = await sock.sendMessage(formattedId, { text: message });
        console.log('Mensaje enviado correctamente:', JSON.stringify(response, null, 2));
        
        return {
            status: 'success',
            message: `Message sent successfully to ${isGroup ? 'group' : 'user'}`,
            response: response
        };
    } catch (err) {
        console.error(`Error al enviar mensaje: ${err.message}`, err);
        throw new Error(`Failed to send message: ${err.message}`);
    }
};

// Función unificada para enviar medios (imágenes)
const sendMedia = async (recipientId, imageUrl, caption = '', isGroup = false) => {
    console.log(`Enviando imagen a ${recipientId}${isGroup ? ' (grupo)' : ''} desde URL: ${imageUrl}`);
    const imagePath = path.resolve(__dirname, '..', 'temp', 'uploads.jpg');

    try {
        // Descargar la imagen desde la URL
        await downloadImage(imageUrl, imagePath);

        // Leer la imagen desde el archivo
        const imageBuffer = fs.readFileSync(imagePath);
        console.log(`Imagen cargada, tamaño: ${imageBuffer.length} bytes`);
        
        // Enviar la imagen
        const formattedId = formatRecipientId(recipientId, isGroup);
        console.log(`Enviando imagen a: ${formattedId}`);
        
        const response = await sock.sendMessage(formattedId, {
            image: imageBuffer,
            caption: caption
        });
        
        console.log('Imagen enviada correctamente');

        return {
            status: 'success',
            message: `Image sent successfully to ${isGroup ? 'group' : 'user'}`,
            response: response
        };
    } catch (error) {
        console.error(`Error al enviar imagen: ${error.message}`, error);
        throw new Error(`Failed to send image: ${error.message}`);
    } finally {
        // Elimina la imagen temporal
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
            console.log('Archivo temporal de imagen eliminado');
        }
    }
};

// Función unificada para enviar PDF
const sendPDF = async (recipientId, pdfUrl, fileName, isGroup = false) => {
    console.log(`Enviando PDF a ${recipientId}${isGroup ? ' (grupo)' : ''} desde URL: ${pdfUrl}`);
    const pdfPath = path.resolve(__dirname, '..', 'temp', 'uploads.pdf');

    try {
        // Descargar el PDF desde la URL
        await downloadImage(pdfUrl, pdfPath);

        // Leer el PDF
        const pdfBuffer = fs.readFileSync(pdfPath);
        console.log(`PDF cargado, tamaño: ${pdfBuffer.length} bytes`);
        
        // Enviar el PDF
        const formattedId = formatRecipientId(recipientId, isGroup);
        console.log(`Enviando PDF a: ${formattedId}`);
        
        const response = await sock.sendMessage(formattedId, {
            document: pdfBuffer,
            mimetype: 'application/pdf',
            fileName: `${fileName}.pdf`
        });
        
        console.log('PDF enviado correctamente');

        return {
            status: 'success',
            message: `PDF sent successfully to ${isGroup ? 'group' : 'user'}`,
            response: response
        };
    } catch (error) {
        console.error(`Error al enviar PDF: ${error.message}`, error);
        throw new Error(`Failed to send PDF: ${error.message}`);
    } finally {
        // Elimina el PDF temporal
        if (fs.existsSync(pdfPath)) {
            fs.unlinkSync(pdfPath);
            console.log('Archivo temporal de PDF eliminado');
        }
    }
};

// Función para obtener todos los grupos
const getGroups = async (req, res) => {
    console.log('Solicitando lista de grupos');
    try {
        const providedToken = req.query.token;

        if (!providedToken || providedToken !== process.env.SECURITY_TOKEN) {
            console.log('Intento de acceso no autorizado a la lista de grupos');
            return res.status(403).send('Unauthorized: Invalid token');
        }
        
        if (connectionStatus !== 'open') {
            console.log('⚠️ Advertencia: Intentando obtener grupos sin conexión activa');
            return res.status(500).json({
                status: 'error',
                message: `Not connected. Current status: ${connectionStatus}`
            });
        }
        
        console.log('Obteniendo grupos...');
        const groups = await sock.groupFetchAllParticipating();
        console.log(`Se encontraron ${Object.keys(groups).length} grupos`);
        
        res.status(200).json({
            status: 'success',
            connection: connectionStatus,
            lastUpdate: lastConnectionUpdate,
            groups: groups
        });
    } catch (error) {
        console.error(`Error al obtener grupos: ${error.message}`, error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch groups: ' + error.message
        });
    }
};

// Función para obtener estado de conexión
const getStatus = async (req, res) => {
    console.log('Solicitando estado de conexión');
    try {
        const providedToken = req.query.token;

        if (!providedToken || providedToken !== process.env.SECURITY_TOKEN) {
            console.log('Intento de acceso no autorizado al estado');
            return res.status(403).send('Unauthorized: Invalid token');
        }
        
        // Comprobar si hay archivos de autenticación
        let authExists = false;
        try {
            const authFiles = fs.readdirSync('./auth_info');
            authExists = authFiles.length > 0;
        } catch (err) {
            authExists = false;
        }
        
        res.status(200).json({
            status: 'success',
            connection: connectionStatus,
            lastUpdate: lastConnectionUpdate,
            authenticationExists: authExists,
            qrAvailable: !!qrCodeData
        });
    } catch (error) {
        console.error(`Error al obtener estado: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get status: ' + error.message
        });
    }
};

// Función para limpiar caché
const clearCache = async (req, res) => {
    console.log('Solicitud para limpiar caché recibida');
    const cacheAuthPath = path.resolve(__dirname, '../auth_info');
    const providedToken = req.query.token;

    if (!providedToken || providedToken !== process.env.SECURITY_TOKEN) {
        console.log('Intento de acceso no autorizado para limpiar caché');
        return res.status(403).send('Unauthorized: Invalid token');
    }

    try {
        if (fs.existsSync(cacheAuthPath)) {
            console.log(`Eliminando directorio de caché: ${cacheAuthPath}`);
            fs.rmSync(cacheAuthPath, { recursive: true, force: true });
            console.log('Caché eliminado correctamente');
            
            // Reiniciar WhatsApp
            console.log('Reiniciando WhatsApp después de limpiar caché');
            qrCodeData = '';
            connectionStatus = 'disconnected';
            setTimeout(() => {
                startWhatsApp();
            }, 1000);
            
            return res.status(200).send('Cache deleted successfully. Restarting WhatsApp...');
        } else {
            console.log('El directorio de caché no existe');
            return res.status(200).send('Cache directory does not exist.');
        }
    } catch (err) {
        console.error(`Error al eliminar caché: ${err.message}`, err);
        return res.status(500).send('Error deleting cache: ' + err.message);
    }
};

// Función unificada para enviar mensajes - API endpoint
const sendMessage = async (req, res) => {
    console.log('Solicitud para enviar mensaje recibida:', JSON.stringify(req.body, null, 2));
    try {
        const { 
            recipientId, 
            number,
            message, 
            imageUrl, 
            pdfUrl, 
            type, 
            fileName,
            isGroup = false  // Valor por defecto: false (envío a usuario individual)
        } = req.body;

        // Usar number si está presente, de lo contrario usar recipientId
        const recipient = number || recipientId;

        if (!recipient) {
            console.log('Error: Falta el destinatario (recipientId o number)');
            return res.status(400).json({
                status: 'error',
                message: 'Recipient ID or number is required'
            });
        }

        // Verificar estado de conexión
        if (connectionStatus !== 'open') {
            console.log(`⚠️ Advertencia: Intentando enviar mensaje sin conexión activa. Estado actual: ${connectionStatus}`);
            return res.status(503).json({
                status: 'error',
                message: `WhatsApp not connected. Current status: ${connectionStatus}`,
                lastUpdate: lastConnectionUpdate
            });
        }

        let response;
        switch (type) {
            case "texto":
                if (!message) {
                    console.log('Error: Falta el mensaje');
                    return res.status(400).json({
                        status: 'error',
                        message: 'Message is required'
                    });
                }
                response = await sendText(recipient, message, isGroup);
                break;

            case "imagen":
                if (!imageUrl) {
                    console.log('Error: Falta la URL de la imagen');
                    return res.status(400).json({
                        status: 'error',
                        message: 'Image URL is required'
                    });
                }
                response = await sendMedia(recipient, imageUrl, message || '', isGroup);
                break;
                
            case "pdf":
                if (!pdfUrl) {
                    console.log('Error: Falta la URL del PDF');
                    return res.status(400).json({
                        status: 'error',
                        message: 'PDF URL is required'
                    });
                }
                response = await sendPDF(recipient, pdfUrl, fileName || 'document', isGroup);
                break;
        
            default:
                console.log(`Error: Tipo indefinido: ${type}`);
                return res.status(400).json({
                    status: 'error',
                    message: 'Undefined type'
                });
        }
        
        console.log('Mensaje enviado correctamente');
        res.status(200).json(response);
        
    } catch (error) {
        console.error(`Error al procesar solicitud de mensaje: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: error.message,
            connectionStatus: connectionStatus,
            lastUpdate: lastConnectionUpdate
        });
    }
};

module.exports = {
    sendMessage,
    generateQr,
    clearCache,
    getGroups,
    getStatus
};