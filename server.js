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
        console.error('Discord Logger Error:', err.message);
    }
}

io.on('connection', (socket) => {
    
    socket.on('auth', ({ username }) => {
        let finalName = username ? username.trim() : "";
        if (!finalName) {
            finalName = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
        }

        // Added 'ignoredUsers' array to keep track of skipped partner IDs
        activeUsers.set(socket.id, { username: finalName, partnerId: null, mode: null, ignoredUsers: [] });
        socket.emit('auth-response', { success: true, username: finalName });
        logToDiscord('🟢 User Joined', `**Username:** \`${finalName}\``, 3066993);
    });

    socket.on('find-match', ({ mode }) => {
        const user = activeUsers.get(socket.id);
        if (!user || user.partnerId) return;

        user.mode = mode;
        textQueue = textQueue.filter(id => id !== socket.id);
        videoQueue = videoQueue.filter(id => id !== socket.id);

        let targetQueue = (mode === 'video') ? videoQueue : textQueue;

        if (targetQueue.length > 0) {
            let partnerId = null;
            let partnerIndex = -1;

            // 1. Look for a partner who is NOT on the user's ignore list
            for (let i = 0; i < targetQueue.length; i++) {
                const potentialPartnerId = targetQueue[i];
                if (!user.ignoredUsers.includes(potentialPartnerId) && potentialPartnerId !== socket.id) {
                    partnerId = potentialPartnerId;
                    partnerIndex = i;
                    break;
                }
            }

            // 2. Fallback: If EVERYONE in queue is ignored, take the first available person so the user isn't stuck alone forever
            if (!partnerId && targetQueue[0] !== socket.id) {
                partnerId = targetQueue[0];
                partnerIndex = 0;
            }

            if (partnerId) {
                // Remove them from the queue array
                targetQueue.splice(partnerIndex, 1);
                
                const partner = activeUsers.get(partnerId);

                user.partnerId = partnerId;
                partner.partnerId = socket.id;

                socket.emit('match-found', { partnerName: partner.username, mode: mode, initiateCall: true });
                io.to(partnerId).emit('match-found', { partnerName: user.username, mode: mode, initiateCall: false });
                logToDiscord('⚡ Match Made', `\`${user.username}\` paired with \`${partner.username}\` [${mode.toUpperCase()}]`, 15105570);
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

    socket.on('skip-match', () => { handleDisconnect(socket, 'skipped'); });
    socket.on('disconnect', () => { handleDisconnect(socket, 'disconnected'); });
});

function handleDisconnect(socket, action) {
    const user = activeUsers.get(socket.id);
    textQueue = textQueue.filter(id => id !== socket.id);
    videoQueue = videoQueue.filter(id => id !== socket.id);

    if (user) {
        if (user.partnerId) {
            const partnerId = user.partnerId;
            const partner = activeUsers.get(partnerId);
            
            if (partner) {
                // Add each other to the ignore/block lists so they don't immediately rematch on a Skip
                user.ignoredUsers.push(partnerId);
                partner.ignoredUsers.push(socket.id);

                partner.partnerId = null;
                io.to(partnerId).emit('partner-disconnected');
            }
            user.partnerId = null;
        }
        if (action === 'disconnected') {
            logToDiscord('🔴 User Left', `**Username:** \`${user.username}\``, 15158332);
            
            // Clean up old references from other users' blocklists to save memory
            activeUsers.forEach(u => {
                u.ignoredUsers = u.ignoredUsers.filter(id => id !== socket.id);
            });
            activeUsers.delete(socket.id);
        }
    }
}

server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
