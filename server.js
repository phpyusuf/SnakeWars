const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const gameState = {
    players: {},
    food: [],
    monsters: [],
    powerUps: []
};

// Game constants
const TICK_RATE = 60;
const GAME_WIDTH = 2000;
const GAME_HEIGHT = 2000;
const GAME_PADDING = 40;
const FOOD_COUNT = 80;
const MONSTER_COUNT = 6;
const POWER_UP_COUNT = 6;
const PLAYER_BASE_SPEED = 2.2;
const BOOST_SPEED = 4.2;
const PLAYER_RADIUS = 8;
const MAX_BODY_SEGMENTS = 220;
const BOOST_DRAIN = 0.6;
const ENERGY_REGEN = 0.35;
const FOOD_ENERGY_GAIN = 18;
const SHIELD_DURATION = 5000;
const BURST_DURATION = 2500;
const POWER_UP_RESPAWN_DELAY = 6000;

const POWER_UP_TYPES = ['shield', 'burst'];

function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
}

function randomPosition(padding = 0) {
    return {
        x: randomInRange(padding, GAME_WIDTH - padding),
        y: randomInRange(padding, GAME_HEIGHT - padding)
    };
}

function createFood() {
    return { ...randomPosition(GAME_PADDING), id: `f_${Math.random().toString(36).slice(2, 7)}` };
}

function spawnInitialFood() {
    while (gameState.food.length < FOOD_COUNT) {
        gameState.food.push(createFood());
    }
}

function createMonster() {
    const base = randomPosition(GAME_PADDING);
    return {
        id: `m_${Math.random().toString(36).slice(2, 7)}`,
        x: base.x,
        y: base.y,
        radius: randomInRange(18, 26),
        angle: randomInRange(0, Math.PI * 2),
        speed: randomInRange(1.2, 1.8)
    };
}

function spawnInitialMonsters() {
    while (gameState.monsters.length < MONSTER_COUNT) {
        gameState.monsters.push(createMonster());
    }
}

function createPowerUp(type) {
    const base = randomPosition(GAME_PADDING);
    return {
        id: `p_${Math.random().toString(36).slice(2, 7)}`,
        type,
        x: base.x,
        y: base.y,
        radius: 16,
        respawnAt: null
    };
}

function spawnInitialPowerUps() {
    while (gameState.powerUps.length < POWER_UP_COUNT) {
        const type = POWER_UP_TYPES[Math.floor(Math.random() * POWER_UP_TYPES.length)];
        gameState.powerUps.push(createPowerUp(type));
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function generatePlayerId() {
    return `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

spawnInitialFood();
spawnInitialMonsters();
spawnInitialPowerUps();

wss.on('connection', (ws) => {
    const playerId = generatePlayerId();
    console.log(`Client connected: ${playerId}`);

    const spawn = randomPosition(GAME_PADDING);
    gameState.players[playerId] = {
        id: playerId,
        name: `Worm ${playerId.slice(-4).toUpperCase()}`,
        x: spawn.x,
        y: spawn.y,
        body: [],
        length: 14,
        angle: 0,
        color: `hsl(${Math.random() * 360}, 70%, 55%)`,
        speed: PLAYER_BASE_SPEED,
        radius: PLAYER_RADIUS,
        boosting: false,
        energy: 100,
        maxEnergy: 100,
        shieldUntil: 0,
        burstUntil: 0,
        score: 0
    };

    ws.send(JSON.stringify({
        type: 'init',
        playerId,
        bounds: { width: GAME_WIDTH, height: GAME_HEIGHT }
    }));

    ws.on('message', (message) => {
        const player = gameState.players[playerId];
        if (!player) return;

        let data;
        try {
            data = JSON.parse(message);
        } catch (err) {
            return;
        }

        if (!data || typeof data.type !== 'string') return;

        switch (data.type) {
            case 'updateDirection':
                if (typeof data.angle === 'number') {
                    player.angle = data.angle;
                }
                break;
            case 'startBoost':
                player.boosting = true;
                break;
            case 'stopBoost':
                player.boosting = false;
                break;
            default:
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${playerId}`);
        delete gameState.players[playerId];
    });
});

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function respawnPowerUp(powerUp, now) {
    powerUp.respawnAt = now + POWER_UP_RESPAWN_DELAY;
}

function revivePowerUps(now) {
    for (const powerUp of gameState.powerUps) {
        if (powerUp.respawnAt && powerUp.respawnAt <= now) {
            const pos = randomPosition(GAME_PADDING);
            powerUp.x = pos.x;
            powerUp.y = pos.y;
            powerUp.respawnAt = null;
            powerUp.type = POWER_UP_TYPES[Math.floor(Math.random() * POWER_UP_TYPES.length)];
        }
    }
}

setInterval(() => {
    const now = Date.now();
    revivePowerUps(now);

    const removePlayers = new Set();

    Object.entries(gameState.players).forEach(([playerId, player]) => {
        const boostingActive = (player.boosting && player.energy > 0) || player.burstUntil > now;
        if (player.boosting && player.energy <= 0) {
            player.boosting = false;
        }

        if (player.boosting && player.energy > 0 && player.burstUntil <= now) {
            player.energy = Math.max(0, player.energy - BOOST_DRAIN);
        }
        if (!boostingActive) {
            player.energy = clamp(player.energy + ENERGY_REGEN, 0, player.maxEnergy);
        }
        if (player.burstUntil <= now) {
            player.burstUntil = 0;
        }

        player.speed = boostingActive ? BOOST_SPEED : PLAYER_BASE_SPEED;

        const newX = player.x + Math.cos(player.angle) * player.speed;
        const newY = player.y + Math.sin(player.angle) * player.speed;

        player.body.unshift({ x: player.x, y: player.y });
        if (player.body.length > MAX_BODY_SEGMENTS) {
            player.body.splice(MAX_BODY_SEGMENTS);
        }
        while (player.body.length > player.length) {
            player.body.pop();
        }

        player.x = clamp(newX, GAME_PADDING, GAME_WIDTH - GAME_PADDING);
        player.y = clamp(newY, GAME_PADDING, GAME_HEIGHT - GAME_PADDING);

        // Food collision detection
        for (let i = gameState.food.length - 1; i >= 0; i--) {
            const food = gameState.food[i];
            if (distance(player, food) <= PLAYER_RADIUS + 6) {
                player.length += 1.4;
                player.score += 10;
                player.energy = clamp(player.energy + FOOD_ENERGY_GAIN, 0, player.maxEnergy);
                gameState.food.splice(i, 1);
                gameState.food.push(createFood());
            }
        }

        // Power-up collision detection
        for (const powerUp of gameState.powerUps) {
            if (powerUp.respawnAt) continue;
            if (distance(player, powerUp) <= player.radius + powerUp.radius) {
                if (powerUp.type === 'shield') {
                    player.shieldUntil = now + SHIELD_DURATION;
                } else if (powerUp.type === 'burst') {
                    player.burstUntil = now + BURST_DURATION;
                    player.energy = clamp(player.energy + FOOD_ENERGY_GAIN, 0, player.maxEnergy);
                }
                respawnPowerUp(powerUp, now);
            }
        }
    });

    // Monster movement and collisions
    for (const monster of gameState.monsters) {
        monster.x += Math.cos(monster.angle) * monster.speed;
        monster.y += Math.sin(monster.angle) * monster.speed;

        if (monster.x < GAME_PADDING || monster.x > GAME_WIDTH - GAME_PADDING ||
            monster.y < GAME_PADDING || monster.y > GAME_HEIGHT - GAME_PADDING) {
            monster.angle += Math.PI + randomInRange(-0.5, 0.5);
            monster.x = clamp(monster.x, GAME_PADDING, GAME_WIDTH - GAME_PADDING);
            monster.y = clamp(monster.y, GAME_PADDING, GAME_HEIGHT - GAME_PADDING);
        }

        if (Math.random() < 0.03) {
            monster.angle += randomInRange(-0.6, 0.6);
        }
    }

    // Check collisions between players and monsters
    Object.entries(gameState.players).forEach(([playerId, player]) => {
        const hasShield = player.shieldUntil > now;
        for (const monster of gameState.monsters) {
            if (distance(player, monster) <= player.radius + monster.radius) {
                if (hasShield) {
                    player.angle += Math.PI * 0.5;
                    player.shieldUntil = now;
                } else {
                    removePlayers.add(playerId);
                }
                break;
            }
        }
    });

    // Player vs player collision (head to head/body)
    const playerEntries = Object.entries(gameState.players);
    for (let i = 0; i < playerEntries.length; i++) {
        const [playerId, player] = playerEntries[i];
        if (removePlayers.has(playerId)) continue;
        for (let j = 0; j < playerEntries.length; j++) {
            if (i === j) continue;
            const [otherId, other] = playerEntries[j];
            if (removePlayers.has(otherId)) continue;

            // Head to head collision
            if (distance(player, other) <= player.radius + other.radius) {
                if (player.length >= other.length) {
                    removePlayers.add(otherId);
                    player.score += 50;
                    player.length += 4;
                } else {
                    removePlayers.add(playerId);
                }
                continue;
            }

            // Head to body collision
            for (const segment of other.body) {
                if (distance(player, segment) <= player.radius + 4) {
                    removePlayers.add(playerId);
                    break;
                }
            }
        }
    }

    removePlayers.forEach((playerId) => {
        delete gameState.players[playerId];
    });

    spawnInitialFood();
    spawnInitialMonsters();
    spawnInitialPowerUps();

    const leaderboard = Object.values(gameState.players)
        .sort((a, b) => b.length - a.length)
        .slice(0, 5)
        .map(({ id, name, length }) => ({
            id,
            name,
            length: Math.floor(length)
        }));

    const message = JSON.stringify({
        type: 'gameState',
        gameState: {
            players: gameState.players,
            food: gameState.food,
            monsters: gameState.monsters,
            powerUps: gameState.powerUps,
            leaderboard,
            bounds: { width: GAME_WIDTH, height: GAME_HEIGHT }
        }
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}, 1000 / TICK_RATE);

server.listen(3000, () => {
    console.log('Server is listening on port 3000');
});
