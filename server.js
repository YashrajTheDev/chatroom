const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

app.use(express.static(path.join(__dirname, 'public')));

// Active tracking maps
const registeredUsers = new Map();
const activeUsers = new Map();

let textQueue = [];
let videoQueue = [];

async function logToDiscord(title, description, color = 3447003) {
    if (!DISCORD_WEBHOOK_URL) return;
    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [{ title, description, color, timestamp: new Date().toISOString() }] })
        });
    } catch (err) {
        console.error('Discord Webhook Logger Error:', err.message);
    }
}

io.on('connection', (socket) => {
    
    // Casual immediate login: supports both manual accounts or automated guest bypass
    socket.on('auth', ({ username, password, isRegistering }) => {
        let finalUsername = username ? username.trim() : "";
        
        if (!finalUsername) {
            // Generate immediate random guest profiles like Omegle.fun
            finalUsername = `Stranger_${Math.floor(1000 + Math.random() * 9000)}`;
        }

        if (username && password) {
            if (isRegistering) {
                if (registeredUsers.has(finalUsername)) {
                    return socket.emit('auth-response', { success: false, message: 'Username taken.' });
                }
                registeredUsers.set(finalUsername, password);
                logToDiscord('👤 Registered User Member', `**Alias:** \`${finalUsername}\``, 3066993);
            } else {
                if (registeredUsers.has(finalUsername) && registeredUsers.get(finalUsername) !== password) {
                    return socket.emit('auth-response', { success: false, message: 'Invalid credentials.' });
                }
                if (!registeredUsers.has(finalUsername)) {
                    registeredUsers.set(finalUsername, password);
                }
            }
        }

        activeUsers.set(socket.id, { username: finalUsername, partnerId: null, currentMode: null });
        socket.emit('auth-response', { success: true, username: finalUsername });
        logToDiscord('🟢 Session Activated', `**User:** \`${finalUsername}\` (\`${socket.id}\`)`, 3447003);
    });

    socket.on('find-match', ({ mode }) => {
        const user = activeUsers.get(socket.id);
        if (!user || user.partnerId) return;

        user.currentMode = mode; // 'text' or 'video'
        let targetQueue = (mode === 'video') ? videoQueue : textQueue;

        // Clear any lingering instances of this socket from both queues
        textQueue = textQueue.filter(id => id !== socket.id);
        videoQueue = videoQueue.filter(id => id !== socket.id);

        if (targetQueue.length > 0) {
            const partnerId = targetQueue.shift();
            const partner = activeUsers.get(partnerId);

            if (partner && partnerId !== socket.id) {
                user.partnerId = partnerId;
                partner.partnerId = socket.id;

                // Establish bidirectional pairing data
                socket.emit('match-found', { partnerName: partner.username, mode: mode, initiateCall: true });
                io.to(partnerId).emit('match-found', { partnerName: user.username, mode: mode, initiateCall: false });
                
                logToDiscord('⚡ Match Connected', `\`${user.username}\` paired with \`${partner.username}\` [${mode.toUpperCase()}]`, 15105570);
            } else {
                targetQueue.push(socket.id);
            }
        } else {
            targetQueue.push(socket.id);
            socket.emit('waiting');
        }
    });

    // High-performance WebRTC negotiation signaling passthrough
    socket.on('webrtc-signal', (data) => {
        const user = activeUsers.get(socket.id);
        if (user && user.partnerId) {
            io.to(user.partnerId).emit('webrtc-signal', data);
        }
    });

    socket.on('send-message', (message) => {
        const user = activeUsers.get(socket.id);
        if (user && user.partnerId) {
            io.to(user.partnerId).emit('receive-message', message);
        }
    });

    socket.on('skip-match', () => { handleDisconnections(socket, 'skipped'); });
    socket.on('disconnect', () => { handleDisconnections(socket, 'disconnected'); });
});

function handleDisconnections(socket, action) {
    const user = activeUsers.get(socket.id);
    textQueue = textQueue.filter(id => id !== socket.id);
    videoQueue = videoQueue.filter(id => id !== socket.id);

    if (user) {
        if (user.partnerId) {
            const partnerId = user.partnerId;
            const partner = activeUsers.get(partnerId);
            if (partner) {
                partner.partnerId = null;
                io.to(partnerId).emit('partner-disconnected');
            }
            user.partnerId = null;
        }
        if (action === 'disconnected') activeUsers.delete(socket.id);
    }
}

server.listen(PORT, () => console.log(`Omegle Core Engine running smoothly on port ${PORT}`));
