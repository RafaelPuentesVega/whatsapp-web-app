const jwt = require('jsonwebtoken');
require('dotenv').config();

const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ status: 'error', message: 'No token provided' });
    }
    console.log(token);
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ status: 'error', message: 'Failed to authenticate token' });
        }
        req.userId = decoded.user;
        next();
    });
};

module.exports = authMiddleware;
