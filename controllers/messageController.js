const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Client is ready!');
});

client.initialize();

const downloadImage = async (url, filename) => {
    const response = await axios({
        url,
        responseType: 'arraybuffer'
    });
    fs.writeFileSync(filename, response.data);
};

const messageText = async (number, message, res) => {
    try {
        const response = await client.sendMessage(`${number}@c.us`, message);
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

const messageMedia = async (number, imageUrl, res) => {
    const imagePath = path.resolve(__dirname, '..', 'temp', 'uploads.jpg');

    try {
        await downloadImage(imageUrl, imagePath);
        
        const media = new MessageMedia('image/jpeg', fs.readFileSync(imagePath).toString('base64'));
        const response = await client.sendMessage(`${number}@c.us`, media);
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

const sendMessage = async (req, res) => {
    const { number, message, imageUrl, type } = req.body;

    if (!number) {
        return res.status(400).json({
            status: 'error',
            message: 'Number is required'
        });
    }

    switch (type) {
        case "texto":
            // Enviar un mensaje de texto
            if (!message) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Message is required'
                });
            }
            await messageText(number, message, res);
            break;

        case "imagen":
            // Enviar una imagen desde una URL 
            if (!imageUrl) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Image URL is required'
                });
            }
            await messageMedia(number, imageUrl, res);
            break;

        default:
            return res.status(400).json({
                status: 'error',
                message: 'Undefined type'
            });
    }
};

module.exports = {
    sendMessage
};
