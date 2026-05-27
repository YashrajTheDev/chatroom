const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000 
});

const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

app.use(express.static(path.join(__dirname, 'public')));

const activeConnections = new Map();
let textQueue = [];
let videoQueue = [];

async function logToDiscord(title, description, color = 6584234) {
    if (!DISCORD_WEBHOOK_URL) return;
    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [{ title, description, color, timestamp: new Date().toISOString() }] })
        });
    } catch (err) {
        console.error('Discord Hook Error:', err.message);
    }
}

io.on('connection', (socket) => {
    
    socket.on('auth', ({ username }) => {
        let finalName = username ? username.trim() : "";
        if (!finalName) {
            finalName = `User_${Math.floor(1000 + Math.random() * 9000)}`;
        }

        activeConnections.set(socket.id, { 
            id: socket.id, 
            username: finalName, 
            partnerId: null, 
            mode: null 
        });

        socket.emit('auth-response', { success: true, username: finalName });
        logToDiscord('🛡️ Nexus Node Assigned', `**User:** \`${finalName}\` \n**Socket ID:** \`${socket.id}\``, 5793266);
    });

    socket.on('find-match', ({ mode }) => {
        const user = activeConnections.get(socket.id);
        if (!user || user.partnerId) return;

        user.mode = mode;
        
        // Clean old references
        textQueue = textQueue.filter(id => id !== socket.id);
        videoQueue = videoQueue.filter(id => id !== socket.id);

        let targetQueue = (mode === 'video') ? videoQueue : textQueue;

        if (targetQueue.length > 0) {
            const partnerId = targetQueue.shift();
            const partner = activeConnections.get(partnerId);

            if (partner && partnerId !== socket.id) {
                user.partnerId = partnerId;
                partner.partnerId = socket.id;

                socket.emit('match-found', { partnerName: partner.username, mode: mode, initiateCall: true });
                io.to(partnerId).emit('match-found', { partnerName: user.username, mode: mode, initiateCall: false });
                
                logToDiscord('⚡ Bridge Established', `🔄 Connected: \`${user.username}\` 🤝 \`${partner.username}\` \n**Profile Mode:** \`${mode.toUpperCase()}\``, 16750848);
            } else {
                targetQueue.push(socket.id);
                socket.emit('waiting');
            }
        } else {
            targetQueue.push(socket.id);
            socket.emit('waiting');
        }
    });

    socket.on('webrtc-signal', (data) => {
        const user = activeConnections.get(socket.id);
        if (user && user.partnerId) {
            io.to(user.partnerId).emit('webrtc-signal', data);
        }
    });

    socket.on('send-message', (message) => {
        const user = activeConnections.get(socket.id);
        if (user && user.partnerId) {
            io.to(user.partnerId).emit('receive-message', message);
        }
    });

    socket.on('skip-match', () => { handlePurge(socket, 'skipped'); });
    socket.on('disconnect', () => { handlePurge(socket, 'disconnected'); });
});

function handlePurge(socket, eventType) {
    const user = activeConnections.get(socket.id);
    textQueue = textQueue.filter(id => id !== socket.id);
    videoQueue = videoQueue.filter(id => id !== socket.id);

    if (user) {
        if (user.partnerId) {
            const partnerId = user.partnerId;
            const partner = activeConnections.get(partnerId);
            if (partner) {
                partner.partnerId = null;
                partner.mode = null;
                io.to(partnerId).emit('partner-disconnected');
            }
            user.partnerId = null;
        }
        if (eventType === 'disconnected') {
            logToDiscord('❌ Nexus Node Released', `**User Left:** \`${user.username}\``, 15548997);
            activeConnections.delete(socket.id);
        }
    }
}

server.listen(PORT, () => console.log(`Nexus Engine compiled safely on port ${PORT}`));
