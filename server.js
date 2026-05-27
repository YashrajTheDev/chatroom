const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
// We read this securely from Render's dashboard settings later
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

app.use(express.static(path.join(__dirname, 'public')));

const registeredUsers = new Map();
const activeUsers = new Map();
let waitingQueue = [];

async function logToDiscord(title, description, color = 3447003) {
    if (!DISCORD_WEBHOOK_URL) return;
    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: title,
                    description: description,
                    color: color,
                    timestamp: new Date().toISOString()
                }]
            })
        });
    } catch (err) {
        console.error('Discord Logger Error:', err.message);
    }
}

io.on('connection', (socket) => {
    socket.on('auth', ({ username, password, isRegistering }) => {
        if (!username || !password) {
            return socket.emit('auth-response', { success: false, message: 'Missing fields.' });
        }
        if (isRegistering) {
            if (registeredUsers.has(username)) {
                return socket.emit('auth-response', { success: false, message: 'Username already taken.' });
            }
            registeredUsers.set(username, password);
            logToDiscord('👤 New User Registered', `**Username:** \`${username}\``, 3066993);
        } else {
            if (!registeredUsers.has(username) || registeredUsers.get(username) !== password) {
                return socket.emit('auth-response', { success: false, message: 'Invalid username or password.' });
            }
        }
        activeUsers.set(socket.id, { username, partnerId: null });
        socket.emit('auth-response', { success: true, username });
        logToDiscord('🟢 User Logged In', `**Username:** \`${username}\` joined the platform.`, 3447003);
    });

    socket.on('find-match', () => {
        const user = activeUsers.get(socket.id);
        if (!user || user.partnerId) return;
        if (waitingQueue.includes(socket.id)) return;

        if (waitingQueue.length > 0) {
            const partnerId = waitingQueue.shift();
            const partner = activeUsers.get(partnerId);

            if (partner && partnerId !== socket.id) {
                user.partnerId = partnerId;
                partner.partnerId = socket.id;
                socket.emit('match-found', { partnerName: partner.username });
                io.to(partnerId).emit('match-found', { partnerName: user.username });
                logToDiscord('⚡ Match Made', `\`${user.username}\` paired with \`${partner.username}\``, 15105570);
            } else {
                waitingQueue.push(socket.id);
            }
        } else {
            waitingQueue.push(socket.id);
            socket.emit('waiting');
        }
    });

    socket.on('send-message', (message) => {
        const user = activeUsers.get(socket.id);
        if (user && user.partnerId) {
            io.to(user.partnerId).emit('receive-message', message);
        }
    });

    socket.on('skip-match', () => { handleDisconnectOrSkip(socket, 'skipped'); });
    socket.on('disconnect', () => { handleDisconnectOrSkip(socket, 'disconnected'); });
});

function handleDisconnectOrSkip(socket, action) {
    const user = activeUsers.get(socket.id);
    waitingQueue = waitingQueue.filter(id => id !== socket.id);

    if (user) {
        if (user.partnerId) {
            const partnerId = user.partnerId;
            const partner = activeUsers.get(partnerId);
            if (partner) {
                partner.partnerId = null;
                io.to(partnerId).emit('partner-disconnected');
                logToDiscord('💔 Match Broken', `\`${user.username}\` ${action}. \`${partner.username}\` is now alone.`, 15158332);
            }
            user.partnerId = null;
        }
        if (action === 'disconnected') {
            logToDiscord('🔴 User Left', `**Username:** \`${user.username}\` disconnected.`, 9807214);
            activeUsers.delete(socket.id);
        }
    }
}

server.listen(PORT, () => {
    console.log(`Server executing safely on port ${PORT}`);
});

