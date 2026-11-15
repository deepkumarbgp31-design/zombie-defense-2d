// ==========================================
// GAME CONFIGURATION (Tweak game rules here!)
// ==========================================
const CONFIG = {
    STARTING_HP: 100,
    WINNING_SCORE: 50,
    LANE_LENGTH: 12,
    MIN_SPAWN_POS: 9,
    MAX_SPAWN_POS: 14,
    DAMAGE_TAKEN: 25,
    SHOOT_DISTANCE: 8,
    ZOMBIE_SPEED_MS: 600,
    FIRE_COOLDOWN_MS: 220
};

function getRandomSpawnPos() {
    return Math.floor(Math.random() * (CONFIG.MAX_SPAWN_POS - CONFIG.MIN_SPAWN_POS + 1)) + CONFIG.MIN_SPAWN_POS;
}

// Game Logic State Variables
let playerRow = 1;
let hp = CONFIG.STARTING_HP;
let score = 0;
let zombiePos = [getRandomSpawnPos(), getRandomSpawnPos(), getRandomSpawnPos()];
let gameOver = false;
let isPaused = false;
let gameLoop = null;
let lastShotTime = 0;

// Visual Effect State Variables
let laserRow = -1;
let laserEndPos = 0;
let hitExplosion = { row: -1, pos: -1 };
let bitingRow = -1;
let effectTimer = null;
let shakeTimer = null;

// Safe Web Audio Context
let audioCtx = null;

function playSound(type) {
    try {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) audioCtx = new AudioContextClass();
        }
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const now = audioCtx.currentTime;

        if (type === 'shoot') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(650, now);
            osc.frequency.exponentialRampToValueAtTime(90, now + 0.12);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.12);
        } else if (type === 'hit') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);
            gain.gain.setValueAtTime(0.22, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.18);
        } else if (type === 'damage') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(140, now);
            osc.frequency.linearRampToValueAtTime(55, now + 0.25);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.25);
        }
    } catch (err) {
        // Ignore audio errors on restricted devices
    }
}

function triggerDamageShake() {
    const container = document.getElementById('game-container');
    if (!container) return;
    clearTimeout(shakeTimer);
    container.classList.remove('damage-shake');
    void container.offsetWidth;
    container.classList.add('damage-shake');

    shakeTimer = setTimeout(() => {
        container.classList.remove('damage-shake');
    }, 300);
}

// Updates both Top Pause/Resume and Bottom Play buttons
function syncPauseUI() {
    const topPauseBtn = document.getElementById('btn-pause-top');
    const bottomPlayBtn = document.getElementById('btn-play-bottom');
    const battlefield = document.getElementById('battlefield');

    if (isPaused) {
        if (topPauseBtn) {
            topPauseBtn.innerText = '▶ RESUME';
            topPauseBtn.classList.add('paused-active');
        }
        if (bottomPlayBtn) {
            bottomPlayBtn.innerText = '▶ PLAY';
            bottomPlayBtn.classList.add('paused-active');
        }
        if (battlefield) battlefield.classList.add('paused');
    } else {
        if (topPauseBtn) {
            topPauseBtn.innerText = '⏸ PAUSE';
            topPauseBtn.classList.remove('paused-active');
        }
        if (bottomPlayBtn) {
            bottomPlayBtn.innerText = '⏸ PAUSE';
            bottomPlayBtn.classList.remove('paused-active');
        }
        if (battlefield) battlefield.classList.remove('paused');
    }
}

// Renders the fluid CSS Grid cells across all screen sizes
function updateScreen() {
    if (gameOver) return;

    document.getElementById('hp-val').innerText = hp + "%";
    document.getElementById('score-val').innerText = score + " / " + CONFIG.WINNING_SCORE;

    for (let i = 0; i < 3; i++) {
        const pSpace = document.getElementById(`p-${i}`);
        if (i === playerRow) {
            let playerHTML = '<span class="player"></span><span>🔫</span>';
            if (i === bitingRow) {
                playerHTML += '<span class="zombie"></span><span>💢</span>';
            } else if (i === laserRow) {
                playerHTML += '<span class="muzzle-flash">💥</span>';
            }
            pSpace.innerHTML = playerHTML;
        } else if (i === bitingRow) {
            pSpace.innerHTML = '<span class="zombie"></span><span>💢</span>';
        } else {
            pSpace.innerHTML = '';
        }

        const tSpace = document.getElementById(`t-${i}`);
        let gridHTML = '<span>◀</span>';
        for (let x = 1; x <= CONFIG.LANE_LENGTH; x++) {
            if (i === hitExplosion.row && x === hitExplosion.pos) {
                gridHTML += '<span class="explosion">🔥</span>';
            } else if (x === zombiePos[i]) {
                gridHTML += '<span class="zombie"></span>';
            } else if (i === laserRow && x <= laserEndPos) {
                gridHTML += '<span class="bullet">═</span>';
            } else {
                gridHTML += '<span class="track-dot">·</span>';
            }
        }
        gridHTML += '<span>▶</span>';
        tSpace.innerHTML = gridHTML;
    }
}

// Unified Player Actions
function moveUp() {
    if (gameOver || isPaused) return;
    playerRow = Math.max(0, playerRow - 1);
    updateScreen();
}

function moveDown() {
    if (gameOver || isPaused) return;
    playerRow = Math.min(2, playerRow + 1);
    updateScreen();
}

function selectLane(row) {
    if (gameOver || isPaused) return;
    playerRow = Math.max(0, Math.min(2, row));
    updateScreen();
}

function fireGun() {
    if (gameOver || isPaused) return;

    const now = Date.now();
    if (now - lastShotTime < CONFIG.FIRE_COOLDOWN_MS) return;
    lastShotTime = now;

    clearTimeout(effectTimer);
    laserRow = playerRow;
    const targetPos = zombiePos[playerRow];

    if (targetPos <= CONFIG.SHOOT_DISTANCE) {
        laserEndPos = targetPos - 1;
        hitExplosion = { row: playerRow, pos: targetPos };
        zombiePos[playerRow] = getRandomSpawnPos();
        score++;
        playSound('hit');

        if (score >= CONFIG.WINNING_SCORE) {
            updateScreen();
            endGame();
            return;
        }
    } else {
        laserEndPos = CONFIG.SHOOT_DISTANCE;
        hitExplosion = { row: -1, pos: -1 };
        playSound('shoot');
    }

    updateScreen();

    effectTimer = setTimeout(() => {
        laserRow = -1;
        hitExplosion = { row: -1, pos: -1 };
        updateScreen();
    }, 160);
}

// Toggle Pause / Resume (used by Top-Left Pause/Resume)
function togglePause() {
    if (gameOver) return;
    isPaused = !isPaused;

    if (isPaused) {
        clearInterval(gameLoop);
    } else {
        startGameLoop();
    }
    syncPauseUI();
}

// Bottom-Right Play Button (Resumes if paused, or starts fresh if exited/ended)
function playGame() {
    if (gameOver) {
        resetGame();
        return;
    }
    if (isPaused) {
        isPaused = false;
        startGameLoop();
        syncPauseUI();
    } else {
        togglePause();
    }
}

// Top-Right Exit Game (X)
function exitGame() {
    gameOver = true;
    isPaused = false;
    clearInterval(gameLoop);
    clearTimeout(effectTimer);
    clearTimeout(shakeTimer);

    const container = document.getElementById('game-container');
    if (container) container.classList.remove('damage-shake');

    const gameScreen = document.getElementById('game-screen');
    const endScreen = document.getElementById('end-screen');
    const exitScreen = document.getElementById('exit-screen');

    if (gameScreen) gameScreen.classList.remove('active');
    if (endScreen) endScreen.classList.remove('active');
    if (exitScreen) exitScreen.classList.add('active');
}

// Automatic Zombie March Loop
function moveZombies() {
    if (gameOver || isPaused) return;
    let tookDamage = false;
    bitingRow = -1;

    for (let i = 0; i < 3; i++) {
        zombiePos[i]--;

        if (zombiePos[i] <= 0) {
            hp = Math.max(0, hp - CONFIG.DAMAGE_TAKEN);
            bitingRow = i;
            zombiePos[i] = getRandomSpawnPos();
            tookDamage = true;
        }
    }

    if (tookDamage) {
        playSound('damage');
        triggerDamageShake();
    }

    if (hp <= 0) {
        updateScreen();
        endGame();
        return;
    }

    updateScreen();
}

function startGameLoop() {
    clearInterval(gameLoop);
    gameLoop = setInterval(moveZombies, CONFIG.ZOMBIE_SPEED_MS);
}

function endGame() {
    gameOver = true;
    isPaused = false;
    clearInterval(gameLoop);
    clearTimeout(effectTimer);
    clearTimeout(shakeTimer);

    const container = document.getElementById('game-container');
    if (container) container.classList.remove('damage-shake');

    const gameScreen = document.getElementById('game-screen');
    const exitScreen = document.getElementById('exit-screen');
    const endScreen = document.getElementById('end-screen');
    const endMsg = document.getElementById('end-message');

    if (gameScreen) gameScreen.classList.remove('active');
        if (gameScreen) gameScreen.classList.remove('active');
    if (exitScreen) exitScreen.classList.remove('active');
    if (endScreen) endScreen.classList.add('active');

    if (endMsg) {
        if (hp > 0) {
            endMsg.innerHTML = '<div class="win-msg">🎉 VICTORY! YOU WIN! 🎉</div><p>You held the line against the horde!</p>';
        } else {
            endMsg.innerHTML = '<div class="lose-msg">💀 GAME OVER! YOU DIED! 💀</div><p>A zombie reached you and killed you!</p>';
        }
    }
}

function resetGame() {
    playerRow = 1;
    hp = CONFIG.STARTING_HP;
    score = 0;
    zombiePos = [getRandomSpawnPos(), getRandomSpawnPos(), getRandomSpawnPos()];
    gameOver = false;
    isPaused = false;
    laserRow = -1;
    bitingRow = -1;
    hitExplosion = { row: -1, pos: -1 };
    clearTimeout(effectTimer);
    clearTimeout(shakeTimer);

    const container = document.getElementById('game-container');
    if (container) container.classList.remove('damage-shake');

    syncPauseUI();

    const endScreen = document.getElementById('end-screen');
    const exitScreen = document.getElementById('exit-screen');
    const gameScreen = document.getElementById('game-screen');

    if (endScreen) endScreen.classList.remove('active');
    if (exitScreen) exitScreen.classList.remove('active');
    if (gameScreen) gameScreen.classList.add('active');

    updateScreen();
    startGameLoop();
}

window.addEventListener('keydown', function(e) {
    const key = e.key.toLowerCase();

    if (key === 'p' || key === 'escape') {
        e.preventDefault();
        togglePause();
        return;
    }

    if (gameOver || isPaused) return;

    if (key === 'w' || key === 'arrowup') {
        e.preventDefault();
        moveUp();
    } else if (key === 's' || key === 'arrowdown') {
        e.preventDefault();
        moveDown();
    } else if (e.key === ' ') {
        e.preventDefault();
        fireGun();
    }
});

function bindTouchButton(id, action) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        action();
    }, { passive: false });
    btn.addEventListener('click', action);
}

bindTouchButton('btn-up', moveUp);
bindTouchButton('btn-down', moveDown);
bindTouchButton('btn-fire', fireGun);
bindTouchButton('btn-pause-top', togglePause);
bindTouchButton('btn-exit-top', exitGame);
bindTouchButton('btn-reset-bottom', resetGame);
bindTouchButton('btn-play-bottom', playGame);
bindTouchButton('btn-play-again', resetGame);
bindTouchButton('btn-relaunch', resetGame);

syncPauseUI();
updateScreen();
startGameLoop();

