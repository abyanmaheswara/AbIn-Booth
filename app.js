import {
    FaceLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

// Constants & State
const video = document.getElementById('webcam-video');
const arCanvas = document.getElementById('ar-canvas');
const arCtx = arCanvas.getContext('2d');
const stripCanvas = document.getElementById('strip-canvas');
const stripCtx = stripCanvas.getContext('2d');

const startBtn = document.getElementById('start-btn');
const countdownText = document.getElementById('countdown-text');
const flashOverlay = document.getElementById('flash');
const shootStatus = document.getElementById('shoot-status');
const readyBadge = document.getElementById('ready-badge');
const downloadBtn = document.getElementById('download-btn');
const gifBtn = document.getElementById('gif-btn');
const retakeBtn = document.getElementById('retake-btn');
const downloadAllBtn = document.getElementById('download-all-btn');
const reviewControls = document.getElementById('review-controls');
const retakeShotBtn = document.getElementById('retake-shot-btn');
const nextShotBtn = document.getElementById('next-shot-btn');
const galleryContainer = document.getElementById('gallery-container');
const galleryGrid = document.getElementById('gallery-grid');

let faceLandmarker;
let lastVideoTime = -1;
let results = undefined;
let stream = null;

let config = {
    layout: 4,
    timer: 3,
    ratio: '4:3',
    filter: 'normal',
    frame: 'neon',
    stickers: {
        bunny: false,
        stars: false,
        hearts: false,
        crown: false,
        glasses: false
    }
};

const filterStyles = {
    normal: 'none',
    bw: 'grayscale(100%)',
    vintage: 'sepia(0.8) contrast(0.9)',
    soft: 'brightness(1.1) blur(1px)',
    vivid: 'saturate(1.5) contrast(1.1)',
    noir: 'grayscale(100%) contrast(150%)',
    neon: 'hue-rotate(300deg) saturate(200%)'
};

let capturedPhotos = [];
let isShooting = false;

// --- Audio Engine ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const playBeep = () => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
};

const playShutter = () => {
    const bufferSize = audioCtx.sampleRate * 0.1;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    noise.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start();
};

const playChime = () => {
    const notes = [440, 554.37, 659.25];
    notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + i * 0.15);
        gain.gain.setValueAtTime(0, audioCtx.currentTime + i * 0.15);
        gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + i * 0.15 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.15 + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + i * 0.15);
        osc.stop(audioCtx.currentTime + i * 0.15 + 0.3);
    });
};

const playClick = () => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
};

// --- Initialization ---
async function init() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        outputFaceBlendshapes: true,
        runningMode: "VIDEO",
        numFaces: 2
    });

    setupWebcam();
    setupControls();
}

async function setupWebcam() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720 },
            audio: false 
        });
        video.srcObject = stream;
        video.addEventListener('loadeddata', predictWebcam);
    } catch (err) {
        console.error("Webcam error:", err);
        alert("Please allow camera access to use AbIn Booth!");
    }
}

function setupControls() {
    document.querySelectorAll('#layout-controls button').forEach(btn => {
        btn.onclick = () => {
            playClick();
            document.querySelector('#layout-controls .active').classList.remove('active');
            btn.classList.add('active');
            config.layout = parseInt(btn.dataset.value);
        };
    });

    document.querySelectorAll('#timer-controls button').forEach(btn => {
        btn.onclick = () => {
            playClick();
            document.querySelector('#timer-controls .active').classList.remove('active');
            btn.classList.add('active');
            config.timer = parseInt(btn.dataset.value);
        };
    });

    document.querySelectorAll('.sticker-toggle').forEach(btn => {
        btn.onclick = () => {
            playClick();
            btn.classList.toggle('active');
            config.stickers[btn.dataset.sticker] = btn.classList.contains('active');
        };
    });

    document.querySelectorAll('#filter-controls button').forEach(btn => {
        btn.onclick = () => {
            playClick();
            document.querySelector('#filter-controls .active').classList.remove('active');
            btn.classList.add('active');
            config.filter = btn.dataset.filter;
            video.style.filter = filterStyles[config.filter];
        };
    });

    document.querySelectorAll('#ratio-controls button').forEach(btn => {
        btn.onclick = () => {
            playClick();
            document.querySelector('#ratio-controls .active').classList.remove('active');
            btn.classList.add('active');
            config.ratio = btn.dataset.value;
            updatePreviewRatio();
        };
    });

    document.querySelectorAll('.frame-item').forEach(btn => {
        btn.onclick = () => {
            playClick();
            document.querySelector('.frame-item.active').classList.remove('active');
            btn.classList.add('active');
            config.frame = btn.dataset.frame;
        };
    });

    startBtn.onclick = startShootSequence;
    downloadBtn.onclick = downloadStrip;
    gifBtn.onclick = downloadGIF;
    retakeBtn.onclick = resetBooth;
    
    downloadAllBtn.onclick = () => {
        capturedPhotos.forEach((canvas, i) => {
            const link = document.createElement('a');
            link.download = `abin-photo-individual-${i+1}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        });
    };
}

function updatePreviewRatio() {
    const [w, h] = config.ratio.split(':').map(Number);
    document.querySelector('.preview-container').style.setProperty('--preview-aspect', `${w}/${h}`);
    
    setTimeout(() => {
        arCanvas.width = video.clientWidth;
        arCanvas.height = video.clientHeight;
    }, 100);
}

// --- AR Logic ---
let frameCount = 0;
async function predictWebcam() {
    frameCount++;
    if (video.currentTime !== lastVideoTime && frameCount % 2 === 0) {
        lastVideoTime = video.currentTime;
        results = faceLandmarker.detectForVideo(video, performance.now());
    }

    drawAR();
    window.requestAnimationFrame(predictWebcam);
}

function drawAR() {
    arCtx.clearRect(0, 0, arCanvas.width, arCanvas.height);
    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) return;

    const w = arCanvas.width;
    const h = arCanvas.height;

    results.faceLandmarks.forEach(landmarks => {
        if (config.stickers.bunny) drawBunnyEars(landmarks, w, h, arCtx);
        if (config.stickers.stars) drawStars(landmarks, w, h, arCtx);
        if (config.stickers.hearts) drawHearts(landmarks, w, h, arCtx);
        if (config.stickers.crown) drawCrown(landmarks, w, h, arCtx);
        if (config.stickers.glasses) drawGlasses(landmarks, w, h, arCtx);
    });
}

// Drawing helpers
function drawBunnyEars(lm, w, h, ctx) {
    const top = lm[10];
    const headSize = Math.abs(lm[332].x - lm[103].x) * w;
    ctx.save();
    ctx.strokeStyle = '#FF2D78';
    ctx.lineWidth = headSize * 0.08;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#FF2D78';
    
    ctx.beginPath();
    ctx.moveTo((top.x - 0.05) * w, top.y * h);
    ctx.bezierCurveTo((top.x - 0.15) * w, (top.y - 0.3) * h, (top.x + 0.05) * w, (top.y - 0.3) * h, (top.x) * w, (top.y - 0.05) * h);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo((top.x + 0.05) * w, top.y * h);
    ctx.bezierCurveTo((top.x + 0.15) * w, (top.y - 0.3) * h, (top.x - 0.05) * w, (top.y - 0.3) * h, (top.x) * w, (top.y - 0.05) * h);
    ctx.stroke();
    ctx.restore();
}

function drawStars(lm, w, h, ctx) {
    const facePoints = [10, 338, 21, 152, 127, 234];
    ctx.save();
    ctx.fillStyle = '#FF6EA8';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#FF6EA8';
    facePoints.forEach((idx, i) => {
        const p = lm[idx];
        const time = performance.now() * 0.005;
        const offset = ctx.canvas.id === 'ar-canvas' ? Math.sin(time + i) * 10 : 0;
        drawStarShape(ctx, p.x * w + offset, p.y * h - 20 + offset, 5, 8, 4);
    });
    ctx.restore();
}

function drawStarShape(ctx, cx, cy, spikes, outerRadius, innerRadius) {
    let rot = Math.PI / 2 * 3, x = cx, y = cy, step = Math.PI / spikes;
    ctx.beginPath(); ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius; y = cy + Math.sin(rot) * outerRadius; ctx.lineTo(x, y); rot += step;
        x = cx + Math.cos(rot) * innerRadius; y = cy + Math.sin(rot) * innerRadius; ctx.lineTo(x, y); rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius); ctx.closePath(); ctx.fill();
}

function drawHearts(lm, w, h, ctx) {
    const leftEye = lm[468] || lm[159];
    const rightEye = lm[473] || lm[386];
    ctx.save();
    [leftEye, rightEye].forEach(eye => { if (eye) drawHeartShape(ctx, eye.x * w, eye.y * h, 15); });
    ctx.restore();
}

function drawHeartShape(ctx, x, y, size) {
    ctx.fillStyle = '#FF2D78'; ctx.shadowBlur = 10; ctx.shadowColor = '#FF2D78';
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.bezierCurveTo(x, y - size/2, x - size, y - size/2, x - size, y);
    ctx.bezierCurveTo(x - size, y + size/2, x, y + size, x, y + size);
    ctx.bezierCurveTo(x, y + size, x + size, y + size/2, x + size, y);
    ctx.bezierCurveTo(x, y + size, x + size, y + size/2, x + size, y);
    ctx.fill();
}

function drawCrown(lm, w, h, ctx) {
    const top = lm[10]; const size = 100;
    ctx.save();
    ctx.strokeStyle = '#FF2D78'; ctx.lineWidth = 4; ctx.shadowBlur = 15; ctx.shadowColor = '#FF2D78';
    const x = top.x * w - size/2, y = top.y * h - size * 0.8;
    ctx.beginPath(); ctx.moveTo(x, y + size/2); ctx.lineTo(x, y); ctx.lineTo(x + size*0.25, y + size*0.3);
    ctx.lineTo(x + size*0.5, y); ctx.lineTo(x + size*0.75, y + size*0.3); ctx.lineTo(x + size, y);
    ctx.lineTo(x + size, y + size/2); ctx.closePath(); ctx.stroke();
    
    if (ctx.canvas.id === 'ar-canvas' && Math.random() > 0.8) {
        ctx.strokeStyle = 'cyan';
        ctx.strokeRect(x - 5, y, size, size/2);
    }
    ctx.restore();
}

function drawGlasses(lm, w, h, ctx) {
    const leftEye = lm[33];
    const rightEye = lm[263];
    const eyeDist = Math.abs(rightEye.x - leftEye.x) * w;
    const centerX = ((leftEye.x + rightEye.x) / 2) * w;
    const centerY = ((leftEye.y + rightEye.y) / 2) * h;
    
    ctx.save();
    ctx.translate(centerX, centerY);
    const angle = Math.atan2((rightEye.y - leftEye.y) * h, (rightEye.x - leftEye.x) * w);
    ctx.rotate(angle);
    
    const gWidth = eyeDist * 2;
    const gHeight = eyeDist * 0.4;
    
    ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'cyan';
    ctx.fillRect(-gWidth/2, -gHeight/2, gWidth, gHeight);
    
    ctx.strokeStyle = '#FF2D78';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-gWidth/2, 0);
    ctx.lineTo(gWidth/2, 0);
    ctx.stroke();
    
    if (ctx.canvas.id === 'ar-canvas' && Math.random() > 0.9) {
        ctx.fillStyle = 'white';
        ctx.font = 'bold 8px Orbitron';
        ctx.fillText('SCANNING...', -gWidth/2 + 5, 0);
    }
    
    ctx.restore();
}

// --- Sequence Logic ---
async function startShootSequence() {
    if (isShooting) return;
    isShooting = true;
    capturedPhotos = [];
    startBtn.disabled = true;
    shootStatus.style.display = 'block';
    readyBadge.style.display = 'none';
    downloadBtn.style.display = 'none';
    retakeBtn.style.display = 'none';
    
    stripCtx.clearRect(0, 0, stripCanvas.width, stripCanvas.height);

    for (let i = 0; i < config.layout; i++) {
        let accepted = false;
        while (!accepted) {
            shootStatus.innerText = `Photo ${i + 1} of ${config.layout}`;
            await runCountdown();
            capturePhoto();
            playShutter();
            triggerFlash();
            
            // Wait for user to Keep or Retake
            const choice = await waitForReview();
            if (choice === 'next') {
                accepted = true;
            } else {
                // Remove the last photo and try again
                capturedPhotos.pop();
                updateStripPreview();
            }
        }
    }

    finalizeStrip();
    showGallery();
    isShooting = false;
    startBtn.disabled = false;
    startBtn.innerText = "Shoot Again";
    shootStatus.style.display = 'none';
    readyBadge.style.display = 'block';
    downloadBtn.style.display = 'flex';
    gifBtn.style.display = 'flex';
    retakeBtn.style.display = 'block';
    galleryContainer.style.display = 'block';
    downloadAllBtn.style.display = 'flex';
    playChime();
}

function runCountdown() {
    return new Promise(resolve => {
        let count = config.timer;
        countdownText.style.display = 'block';
        countdownText.innerText = count;
        playBeep();

        const timer = setInterval(() => {
            count--;
            if (count <= 0) {
                clearInterval(timer);
                countdownText.style.display = 'none';
                resolve();
            } else {
                countdownText.innerText = count;
                playBeep();
            }
        }, 1000);
    });
}

function waitForReview() {
    return new Promise(resolve => {
        reviewControls.style.display = 'flex';
        
        retakeShotBtn.onclick = () => {
            playClick();
            reviewControls.style.display = 'none';
            resolve('retake');
        };
        
        nextShotBtn.onclick = () => {
            playClick();
            reviewControls.style.display = 'none';
            resolve('next');
        };
    });
}

function triggerFlash() {
    flashOverlay.style.opacity = '1';
    setTimeout(() => {
        flashOverlay.style.opacity = '0';
    }, 100);
}

function capturePhoto() {
    const [ratioW, ratioH] = config.ratio.split(':').map(Number);
    const tempCanvas = document.createElement('canvas');
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    const videoRatio = videoW / videoH;
    const targetRatio = ratioW / ratioH;
    
    let drawW, drawH, offsetX, offsetY;
    
    if (videoRatio > targetRatio) {
        drawH = videoH;
        drawW = videoH * targetRatio;
        offsetX = (videoW - drawW) / 2;
        offsetY = 0;
    } else {
        drawW = videoW;
        drawH = videoW / targetRatio;
        offsetX = 0;
        offsetY = (videoH - drawH) / 2;
    }

    tempCanvas.width = drawW;
    tempCanvas.height = drawH;
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCtx.translate(tempCanvas.width, 0);
    tempCtx.scale(-1, 1);
    tempCtx.filter = filterStyles[config.filter];
    tempCtx.drawImage(video, offsetX, offsetY, drawW, drawH, 0, 0, drawW, drawH);
    
    if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
        results.faceLandmarks.forEach(landmarks => {
            const adjustedLandmarks = landmarks.map(p => ({
                x: (p.x * videoW - offsetX) / drawW,
                y: (p.y * videoH - offsetY) / drawH,
                z: p.z
            }));

            if (config.stickers.bunny) drawBunnyEars(adjustedLandmarks, tempCanvas.width, tempCanvas.height, tempCtx);
            if (config.stickers.stars) drawStars(adjustedLandmarks, tempCanvas.width, tempCanvas.height, tempCtx);
            if (config.stickers.hearts) drawHearts(adjustedLandmarks, tempCanvas.width, tempCanvas.height, tempCtx);
            if (config.stickers.crown) drawCrown(adjustedLandmarks, tempCanvas.width, tempCanvas.height, tempCtx);
            if (config.stickers.glasses) drawGlasses(adjustedLandmarks, tempCanvas.width, tempCanvas.height, tempCtx);
        });
    }
    
    capturedPhotos.push(tempCanvas);
    updateStripPreview();
}

function updateStripPreview() {
    const [ratioW, ratioH] = config.ratio.split(':').map(Number);
    const photoW = 400;
    const photoH = (photoW / ratioW) * ratioH;
    const margin = 20;
    const footerH = 60;
    
    stripCanvas.width = photoW + (margin * 2);
    stripCanvas.height = (photoH * capturedPhotos.length) + (margin * (capturedPhotos.length + 1)) + footerH;
    
    stripCtx.fillStyle = '#0D0B14';
    stripCtx.fillRect(0, 0, stripCanvas.width, stripCanvas.height);
    
    capturedPhotos.forEach((img, i) => {
        const x = margin;
        const y = margin + (i * (photoH + margin));
        stripCtx.drawImage(img, 0, 0, img.width, img.height, x, y, photoW, photoH);
        drawFrame(x, y, photoW, photoH, stripCtx);
    });
    
    if (capturedPhotos.length > 0) {
        drawFooter();
    } else {
        stripCanvas.height = 400;
        stripCtx.fillStyle = '#0D0B14';
        stripCtx.fillRect(0, 0, stripCanvas.width, stripCanvas.height);
    }
}

function finalizeStrip() {
    updateStripPreview();
}

function showGallery() {
    galleryGrid.innerHTML = '';
    capturedPhotos.forEach((canvas, i) => {
        const src = canvas.toDataURL('image/png');
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.innerHTML = `
            <img src="${src}" alt="Photo ${i+1}">
            <div class="download-overlay">
                <div class="dl-icon">Download</div>
            </div>
        `;
        item.onclick = () => {
            const link = document.createElement('a');
            link.download = `abin-photo-${i+1}.png`;
            link.href = src;
            link.click();
        };
        galleryGrid.appendChild(item);
    });
}

function drawFrame(x, y, w, h, ctx) {
    ctx.save();
    switch(config.frame) {
        case 'neon':
            ctx.strokeStyle = '#FF2D78';
            ctx.lineWidth = 4;
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#FF2D78';
            ctx.strokeRect(x, y, w, h);
            break;
        case 'grid':
            ctx.strokeStyle = 'rgba(255, 45, 120, 0.3)';
            ctx.lineWidth = 1;
            for (let i = 10; i < w; i += 20) {
                ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i, y + h); ctx.stroke();
            }
            for (let i = 10; i < h; i += 20) {
                ctx.beginPath(); ctx.moveTo(x, y + i); ctx.lineTo(x + w, y + i); ctx.stroke();
            }
            ctx.strokeStyle = '#333';
            ctx.strokeRect(x, y, w, h);
            break;
        case 'film':
            ctx.fillStyle = '#111';
            ctx.fillRect(x - 10, y, 10, h);
            ctx.fillRect(x + w, y, 10, h);
            ctx.fillStyle = '#333';
            for (let i = 5; i < h; i += 20) {
                ctx.fillRect(x - 8, y + i, 6, 10);
                ctx.fillRect(x + w + 2, y + i, 6, 10);
            }
            break;
        case 'polaroid':
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 15;
            ctx.strokeRect(x + 7.5, y + 7.5, w - 15, h - 15);
            break;
        case 'glitch':
            ctx.strokeStyle = '#FF2D78';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
            ctx.strokeStyle = 'cyan';
            ctx.strokeRect(x + 3, y + 3, w, h);
            break;
        case 'cyber':
            ctx.strokeStyle = 'cyan';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(x + 30, y); ctx.lineTo(x, y); ctx.lineTo(x, y + 30);
            ctx.moveTo(x + w - 30, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + 30);
            ctx.moveTo(x + 30, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - 30);
            ctx.moveTo(x + w - 30, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - 30);
            ctx.stroke();
            break;
        case 'retro':
            ctx.globalAlpha = 0.3;
            const sunGrad = ctx.createLinearGradient(x, y, x, y + h);
            sunGrad.addColorStop(0, '#ff0080');
            sunGrad.addColorStop(1, '#7928ca');
            ctx.fillStyle = sunGrad;
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            for (let i = 0; i < h; i += 6) {
                ctx.beginPath(); ctx.moveTo(x, y + i); ctx.lineTo(x + w, y + i); ctx.stroke();
            }
            ctx.strokeStyle = '#ff0080';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
            break;
        case 'sakura':
            ctx.strokeStyle = '#ffb7c5';
            ctx.lineWidth = 12;
            ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
            ctx.fillStyle = '#ffb7c5';
            for (let i = 0; i < 20; i++) {
                const px = x + (Math.sin(i) * 0.5 + 0.5) * w;
                const py = y + (Math.cos(i * 1.5) * 0.5 + 0.5) * h;
                ctx.beginPath();
                ctx.ellipse(px, py, 4, 7, i * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
        case 'minimal':
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
            break;
        case 'y2k':
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 10;
            ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.beginPath(); ctx.arc(x + 20, y + 20, 5, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(x + w - 20, y + h - 20, 5, 0, Math.PI*2); ctx.fill();
            break;
        case 'manga':
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 6;
            ctx.strokeRect(x, y, w, h);
            ctx.lineWidth = 1;
            for(let i=0; i<20; i++) {
                ctx.beginPath();
                ctx.moveTo(x, y + (i*h/20)); ctx.lineTo(x + 15, y + (i*h/20));
                ctx.moveTo(x + w, y + (i*h/20)); ctx.lineTo(x + w - 15, y + (i*h/20));
                ctx.stroke();
            }
            break;
        case 'vapor':
            const vGrad = ctx.createLinearGradient(x, y, x + w, y + h);
            vGrad.addColorStop(0, '#00d2ff'); vGrad.addColorStop(1, '#928dab');
            ctx.strokeStyle = vGrad;
            ctx.lineWidth = 8;
            ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
            break;
        case 'luxury':
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
            ctx.fillStyle = '#ffd700';
            [ [x+5,y+5], [x+w-5,y+5], [x+5,y+h-5], [x+w-5,y+h-5] ].forEach(p => {
                ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI*2); ctx.fill();
            });
            break;
        case 'comic':
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 8;
            ctx.strokeRect(x, y, w, h);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
            ctx.fillStyle = 'black';
            ctx.font = 'bold 12px "Comic Sans MS", sans-serif';
            ctx.fillText('WOW!', x + 15, y + h - 15);
            break;
        case 'holo':
            ctx.globalAlpha = 0.4;
            const hGrad = ctx.createConicGradient(0, x + w/2, y + h/2);
            hGrad.addColorStop(0, '#ff00ff'); hGrad.addColorStop(0.5, '#00ffff'); hGrad.addColorStop(1, '#ff00ff');
            ctx.fillStyle = hGrad;
            ctx.fillRect(x, y, w, h);
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
            break;
        case 'ticket':
            // Main Ticket Color
            ctx.strokeStyle = '#e94560';
            ctx.lineWidth = 15;
            ctx.strokeRect(x + 7.5, y + 7.5, w - 15, h - 15);
            
            // Perforated Edges (Holes)
            ctx.fillStyle = '#0D0B14'; // Background color to simulate holes
            for(let i = 20; i < h; i += 40) {
                ctx.beginPath(); ctx.arc(x, y + i, 8, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(x + w, y + i, 8, 0, Math.PI*2); ctx.fill();
            }
            
            // Text
            ctx.fillStyle = 'white';
            ctx.font = 'bold 10px Orbitron';
            ctx.save();
            ctx.translate(x + 10, y + h/2);
            ctx.rotate(-Math.PI/2);
            ctx.fillText('ADMIT ONE', 0, 0);
            ctx.restore();
            break;
        case 'denim':
            ctx.strokeStyle = '#2b4f81';
            ctx.lineWidth = 12;
            ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
            // Stitches
            ctx.strokeStyle = '#f0a500';
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
            ctx.setLineDash([]);
            // Small Stars in corners
            ctx.fillStyle = '#f0a500';
            [ [x+15,y+15], [x+w-15,y+15], [x+15,y+h-15], [x+w-15,y+h-15] ].forEach(p => {
                drawStarShape(ctx, p[0], p[1], 5, 6, 3);
            });
            break;
        case 'starry':
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
            // Procedural Stars
            ctx.fillStyle = '#ffd700';
            for(let i=0; i<15; i++) {
                const sx = x + Math.abs(Math.sin(i*123)) * w;
                const sy = y + Math.abs(Math.cos(i*456)) * h;
                const sSize = 2 + Math.abs(Math.sin(i)) * 3;
                drawStarShape(ctx, sx, sy, 4, sSize, sSize/2);
            }
            break;
        case 'cybercity':
            // Draw buildings as an overlay at the bottom only (no full fillRect)
            ctx.fillStyle = 'rgba(15, 52, 96, 0.8)';
            const bWidth = w / 5;
            [0.1, 0.4, 0.7, 0.9].forEach((pos, i) => {
                const bh = 20 + Math.abs(Math.sin(i * 10)) * 30;
                ctx.fillRect(x + (pos * w) - bWidth/2, y + h - bh, bWidth, bh);
                // Windows
                ctx.fillStyle = Math.random() > 0.5 ? 'cyan' : 'magenta';
                ctx.fillRect(x + (pos * w) - 2, y + h - bh + 5, 4, 4);
                ctx.fillStyle = 'rgba(15, 52, 96, 0.8)';
            });
            ctx.strokeStyle = 'magenta';
            ctx.lineWidth = 4;
            ctx.strokeRect(x, y, w, h);
            break;
        case 'graffiti':
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 10;
            ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
            // Drips
            ctx.fillStyle = '#00ff00';
            for(let i=0; i<10; i++) {
                const dx = x + (i * w/10);
                const dh = 10 + Math.random() * 20;
                ctx.beginPath();
                ctx.arc(dx, y + 5, 4, 0, Math.PI*2); ctx.fill();
                ctx.fillRect(dx - 2, y + 5, 4, dh);
            }
            // Tag
            ctx.fillStyle = 'white';
            ctx.font = 'bold 20px "Courier New"';
            ctx.fillText('ABIN', x + w/2 - 25, y + h - 15);
            break;
        case 'space':
            // Stars and planets as overlay (no full fillRect)
            ctx.fillStyle = 'white';
            for(let i=0; i<20; i++) {
                ctx.beginPath();
                ctx.arc(x + Math.abs(Math.sin(i*99))*w, y + Math.abs(Math.cos(i*99))*h, 1.5, 0, Math.PI*2);
                ctx.fill();
            }
            // Planet
            ctx.fillStyle = '#ff4d00';
            ctx.beginPath(); ctx.arc(x + w - 30, y + 30, 15, 0, Math.PI*2); ctx.fill();
            // Rocket
            ctx.font = '20px serif';
            ctx.fillText('🚀', x + 20, y + h - 20);
            // Border
            ctx.strokeStyle = '#1e212d';
            ctx.lineWidth = 4;
            ctx.strokeRect(x, y, w, h);
            break;
    }
    ctx.restore();
}

function drawFooter() {
    const footerY = stripCanvas.height - 30;
    const centerX = stripCanvas.width / 2;
    
    // Premium Gradient Watermark
    const gradient = stripCtx.createLinearGradient(centerX - 50, 0, centerX + 50, 0);
    gradient.addColorStop(0, '#00f2ff');
    gradient.addColorStop(1, '#ff0080');
    
    stripCtx.save();
    stripCtx.shadowBlur = 10;
    stripCtx.shadowColor = 'rgba(255, 0, 128, 0.5)';
    
    stripCtx.fillStyle = gradient;
    stripCtx.font = 'bold 20px Orbitron';
    stripCtx.textAlign = 'center';
    stripCtx.fillText('AbIn Booth', centerX, footerY);
    
    // Subtle decoration line
    stripCtx.lineWidth = 1;
    stripCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    stripCtx.beginPath();
    stripCtx.moveTo(centerX - 30, footerY + 10);
    stripCtx.lineTo(centerX + 30, footerY + 10);
    stripCtx.stroke();
    
    stripCtx.restore();
}

function downloadStrip() {
    const link = document.createElement('a');
    link.download = 'abin-booth-strip.png';
    link.href = stripCanvas.toDataURL('image/png');
    link.click();
}

async function downloadGIF() {
    if (capturedPhotos.length === 0) return;
    gifBtn.innerText = "⚡ Processing...";
    gifBtn.disabled = true;

    const resizedImages = capturedPhotos.map(img => {
        const canvas = document.createElement('canvas');
        canvas.width = 300; 
        canvas.height = Math.round(300 * (img.height / img.width));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.6); 
    });
    
    gifshot.createGIF({
        images: resizedImages,
        gifWidth: 300,
        gifHeight: Math.round(300 * (capturedPhotos.length > 0 ? (capturedPhotos[0].height / capturedPhotos[0].width) : 0.75)), 
        interval: 0.3,
        numFrames: resizedImages.length,
        frameDuration: 1,
        sampleInterval: 30,
        numWorkers: 4
    }, function (obj) {
        if (!obj.error) {
            const link = document.createElement('a');
            link.download = 'abin-booth-animation.gif';
            link.href = obj.image;
            link.click();
        }
        gifBtn.innerText = "GIF";
        gifBtn.disabled = false;
    });
}

function resetBooth() {
    capturedPhotos = [];
    stripCtx.clearRect(0, 0, stripCanvas.width, stripCanvas.height);
    readyBadge.style.display = 'none';
    downloadBtn.style.display = 'none';
    gifBtn.style.display = 'none';
    retakeBtn.style.display = 'none';
    downloadAllBtn.style.display = 'none';
    galleryContainer.style.display = 'none';
    galleryGrid.innerHTML = '';
    startBtn.innerText = "Start Shoot";
}

// Start the app
init();

window.addEventListener('resize', () => {
    arCanvas.width = video.clientWidth;
    arCanvas.height = video.clientHeight;
});

video.onloadedmetadata = () => {
    arCanvas.width = video.clientWidth;
    arCanvas.height = video.clientHeight;
};

setInterval(() => {
    if (Math.random() > 0.97) {
        document.body.classList.add('glitch-active');
        setTimeout(() => document.body.classList.remove('glitch-active'), 150);
    }
}, 5000);
