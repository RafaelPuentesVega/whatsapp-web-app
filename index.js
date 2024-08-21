const express = require('express');
require('dotenv').config();
const authMiddleware = require('./middleware/auth');
const { sendMessage } = require('./controllers/messageController');

const app = express();
const port = process.env.PORT || 3000;

// Middleware para analizar el cuerpo de las solicitudes JSON
app.use(express.json());

// Ruta para enviar mensajes con autenticación
app.post('/send-message', authMiddleware, sendMessage);

// Iniciar el servidor Express
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
