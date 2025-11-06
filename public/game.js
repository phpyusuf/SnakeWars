const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const scoreValueEl = document.getElementById('score-value');
const statusEl = document.getElementById('status');
const energyFillEl = document.getElementById('energy-fill');
const energyLabelEl = document.getElementById('energy-label');
const leaderboardListEl = document.getElementById('leaderboard-list');

const ws = new WebSocket(`ws://${window.location.host}`);

let myPlayerId = null;
let bounds = { width: 2000, height: 2000 };
let latestState = null;
let camera = { x: 0, y: 0 };
let hasInitialCamera = false;
let mousePos = { x: 0, y: 0 };
let hasMouse = false;
let boostActive = false;
let lastHudUpdate = 0;
let lastDirectionSent = 0;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

ws.addEventListener('open', () => {
    console.log('Connected to the server');
});

ws.addEventListener('close', () => {
    console.log('Disconnected from the server');
});

ws.addEventListener('message', (event) => {
    let message;
    try {
        message = JSON.parse(event.data);
    } catch (err) {
        return;
    }

    if (message.type === 'init') {
        myPlayerId = message.playerId;
        if (message.bounds) {
            bounds = message.bounds;
        }
    } else if (message.type === 'gameState') {
        latestState = message.gameState;
        if (latestState && latestState.bounds) {
            bounds = latestState.bounds;
        }
        updateHud(latestState);
    }
});

canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mousePos = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
    hasMouse = true;
    sendDirection(true);
});

window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !boostActive) {
        boostActive = true;
        sendBoostState(true);
    }
});

window.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && boostActive) {
        boostActive = false;
        sendBoostState(false);
    }
});

window.addEventListener('blur', () => {
    if (boostActive) {
        boostActive = false;
        sendBoostState(false);
    }
});

function sendBoostState(isBoosting) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: isBoosting ? 'startBoost' : 'stopBoost' }));
}

function sendDirection(force = false) {
    if (!hasMouse || ws.readyState !== WebSocket.OPEN || !latestState || !myPlayerId) {
        return;
    }
    const player = latestState.players?.[myPlayerId];
    if (!player) return;

    const worldX = camera.x + mousePos.x;
    const worldY = camera.y + mousePos.y;
    const angle = Math.atan2(worldY - player.y, worldX - player.x);

    const now = performance.now();
    if (!force && now - lastDirectionSent < 40) {
        return;
    }

    ws.send(JSON.stringify({ type: 'updateDirection', angle }));
    lastDirectionSent = now;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

function worldToScreen(x, y) {
    return { x: x - camera.x, y: y - camera.y };
}

function isVisible(x, y, radius = 0) {
    return x >= -radius && x <= canvas.width + radius &&
        y >= -radius && y <= canvas.height + radius;
}

function updateHud(state) {
    if (!state || !myPlayerId) return;
    const time = performance.now();
    if (time - lastHudUpdate < 100) {
        return;
    }
    lastHudUpdate = time;

    const player = state.players?.[myPlayerId];
    if (player) {
        scoreValueEl.textContent = Math.floor(player.length);

        const energyPercent = player.maxEnergy ? (player.energy / player.maxEnergy) : 0;
        energyFillEl.style.width = `${clamp(Math.round(energyPercent * 100), 0, 100)}%`;
        energyLabelEl.textContent = `Enerji: ${Math.round(player.energy)}`;

        const activeEffects = [];
        if (player.shieldUntil && player.shieldUntil > Date.now()) {
            activeEffects.push('Kalkan aktif');
        }
        if (player.burstUntil && player.burstUntil > Date.now()) {
            activeEffects.push('Turbo akışı');
        }
        statusEl.textContent = activeEffects.length ? activeEffects.join(' • ') : 'Güvende';
    } else {
        statusEl.textContent = 'Yeniden doğma bekleniyor...';
        energyFillEl.style.width = '0%';
    }

    while (leaderboardListEl.firstChild) {
        leaderboardListEl.removeChild(leaderboardListEl.firstChild);
    }
    (state.leaderboard || []).forEach((entry, index) => {
        const li = document.createElement('li');
        li.textContent = `${index + 1}. ${entry.name} — ${entry.length}`;
        if (entry.id === myPlayerId) {
            li.classList.add('me');
        }
        leaderboardListEl.appendChild(li);
    });
}

function drawBackground(time) {
    const gradient = ctx.createRadialGradient(
        canvas.width * 0.5,
        canvas.height * 0.4,
        canvas.width * 0.1,
        canvas.width * 0.5,
        canvas.height * 0.5,
        Math.max(canvas.width, canvas.height)
    );
    gradient.addColorStop(0, '#0a112e');
    gradient.addColorStop(0.5, '#060b1c');
    gradient.addColorStop(1, '#020308');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gridSpacing = 80;
    const offsetX = -(camera.x % gridSpacing);
    const offsetY = -(camera.y % gridSpacing);

    ctx.strokeStyle = 'rgba(82, 252, 211, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = offsetX; x < canvas.width; x += gridSpacing) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
    }
    for (let y = offsetY; y < canvas.height; y += gridSpacing) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();

    const shimmer = (Math.sin(time / 400) + 1) * 0.5;
    ctx.fillStyle = `rgba(82, 252, 211, ${0.05 + shimmer * 0.05})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawWorldBounds() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.strokeRect(-camera.x, -camera.y, bounds.width, bounds.height);
    ctx.restore();
}

function drawFood(food, time) {
    const screen = worldToScreen(food.x, food.y);
    if (!isVisible(screen.x, screen.y, 6)) return;

    const seed = food.id ? parseInt(food.id.slice(-2), 36) : 0;
    const pulse = 3 + Math.sin(time / 180 + seed) * 1.2;
    ctx.save();
    ctx.fillStyle = 'rgba(241, 255, 107, 0.9)';
    ctx.shadowColor = 'rgba(241, 255, 107, 0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawPowerUp(powerUp, time) {
    if (powerUp.respawnAt) return;
    const screen = worldToScreen(powerUp.x, powerUp.y);
    if (!isVisible(screen.x, screen.y, powerUp.radius + 6)) return;

    const color = powerUp.type === 'shield' ? '#52fcd3' : '#ff7b4a';
    const glow = powerUp.type === 'shield' ? 'rgba(82, 252, 211, 0.8)' : 'rgba(255, 123, 74, 0.8)';
    const pulse = Math.sin(time / 250) * 3;

    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, powerUp.radius + pulse * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, powerUp.radius + 6 + pulse * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawMonster(monster, time) {
    const screen = worldToScreen(monster.x, monster.y);
    if (!isVisible(screen.x, screen.y, monster.radius + 10)) return;

    ctx.save();
    const hue = 270 + Math.sin(time / 500 + monster.id.length) * 20;
    ctx.fillStyle = `hsla(${hue}, 70%, 55%, 0.85)`;
    ctx.shadowColor = `hsla(${hue}, 80%, 60%, 0.9)`;
    ctx.shadowBlur = 25;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, monster.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, monster.radius * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawSnake(player, isSelf, serverNow) {
    const head = worldToScreen(player.x, player.y);
    if (!isVisible(head.x, head.y, player.radius * 8)) return;

    ctx.save();
    ctx.lineWidth = isSelf ? player.radius * 2.6 : player.radius * 2.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = player.color;
    ctx.shadowBlur = isSelf ? 18 : 12;
    ctx.shadowColor = player.color;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);

    const segmentLimit = 140;
    if (player.body) {
        const count = Math.min(player.body.length, segmentLimit);
        for (let i = 0; i < count; i++) {
            const segment = player.body[i];
            const screen = worldToScreen(segment.x, segment.y);
            ctx.lineTo(screen.x, screen.y);
        }
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = isSelf ? '#ffffff' : player.color;
    ctx.shadowColor = player.color;
    ctx.shadowBlur = isSelf ? 24 : 14;
    ctx.beginPath();
    ctx.arc(head.x, head.y, player.radius + (isSelf ? 2 : 0), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (player.shieldUntil && player.shieldUntil > serverNow) {
        ctx.save();
        ctx.strokeStyle = 'rgba(82, 252, 211, 0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(head.x, head.y, player.radius + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function renderGame(state) {
    if (!state) return;

    const time = performance.now();
    const serverNow = Date.now();

    const myPlayer = state.players?.[myPlayerId];
    if (myPlayer) {
        const maxCameraX = Math.max(0, bounds.width - canvas.width);
        const maxCameraY = Math.max(0, bounds.height - canvas.height);
        const minCameraX = maxCameraX === 0 ? -(canvas.width - bounds.width) / 2 : 0;
        const minCameraY = maxCameraY === 0 ? -(canvas.height - bounds.height) / 2 : 0;
        const targetX = clamp(myPlayer.x - canvas.width / 2, minCameraX, minCameraX + maxCameraX);
        const targetY = clamp(myPlayer.y - canvas.height / 2, minCameraY, minCameraY + maxCameraY);
        if (!hasInitialCamera) {
            camera.x = targetX;
            camera.y = targetY;
            hasInitialCamera = true;
        } else {
            camera.x = lerp(camera.x, targetX, 0.12);
            camera.y = lerp(camera.y, targetY, 0.12);
        }
    }

    drawBackground(time);
    drawWorldBounds();

    (state.food || []).forEach((food) => drawFood(food, time));
    (state.powerUps || []).forEach((powerUp) => drawPowerUp(powerUp, time));
    (state.monsters || []).forEach((monster) => drawMonster(monster, time));

    const players = Object.values(state.players || {});
    players.sort((a, b) => a.length - b.length);
    for (const player of players) {
        drawSnake(player, player.id === myPlayerId, serverNow);
    }

    if (hasMouse) {
        sendDirection();
    }
}

function gameLoop() {
    renderGame(latestState);
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
