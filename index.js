const express = require('express');
require('dotenv').config();
const authMiddleware = require('./middleware/auth');
const { sendMessage , generateQr , clearCache} = require('./controllers/messageController');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para analizar el cuerpo de las solicitudes JSON
app.use(express.json());

// Ruta para enviar mensajes con autenticación
app.post('/send-message', authMiddleware, sendMessage);
app.get('/', generateQr);
app.get('/clear-cache', clearCache);
// Iniciar el servidor Express
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
