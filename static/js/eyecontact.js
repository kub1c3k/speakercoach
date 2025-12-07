const elements = {
    video: document.getElementById('inputVideo'),
    canvas: document.getElementById('outputCanvas'),
    testInfo: document.getElementById('test_info'),
    testStatus: document.getElementById('test_status'),
    progressBar: document.getElementById('progress_bar'),
    startButton: document.getElementById('start_button'),
    liveFeedback: document.getElementById('live_feedback')
};

const canvasCtx = elements.canvas.getContext('2d');

const MINUTE_CONVERTER = 60 * 1000;
const MAX_TIME = 25 * MINUTE_CONVERTER;
const MIN_TIME = 0.5 * MINUTE_CONVERTER;

let appState = {
    testStartTime: null,
    testDuration: null,
    testActive: false,
    testCompleted: false,
    totalFrames: 0,
    goodEyeContactFrames: 0,
    calibrationData: null,
    sessionHistory: []
};

function createDebouncedUpdate(interval = 100) {
    let lastUpdate = 0;
    let pendingUpdate = null;
    
    return function(data) {
        const now = Date.now();
        
        if (now - lastUpdate >= interval) {
            updateUI(data);
            lastUpdate = now;
        } else {
            if (pendingUpdate) {
                clearTimeout(pendingUpdate);
            }
            pendingUpdate = setTimeout(() => {
                updateUI(data);
                lastUpdate = Date.now();
                pendingUpdate = null;
            }, interval - (now - lastUpdate));
        }
    };
}

const debouncedUpdateUI = createDebouncedUpdate(150);

class CalibrationManager {
    constructor() {
        this.data = {
            leftEyeCenter: null,
            rightEyeCenter: null,
            headCenter: null,
            gazeThresholds: {
                leftMin: 0.25,
                leftMax: 0.55,
                rightMin: 0.25,
                rightMax: 0.55,
                headOffset: 0.2
            }
        };
        this.isCalibrating = false;
        this.calibrationSamples = [];
    }
    
    async startCalibration() {
        this.isCalibrating = true;
        this.calibrationSamples = [];
        
        const steps = [
            { instruction: "Pozrite sa PRIAMO do kamery", duration: 3000, action: 'center' },
            { instruction: "Pohľad doĽAVA", duration: 2000, action: 'left' },
            { instruction: "Pohľad DOPRAVA", duration: 2000, action: 'right' },
            { instruction: "Pohľad HORE", duration: 1500, action: 'up' },
            { instruction: "Pohľad DOLE", duration: 1500, action: 'down' }
        ];
        
        elements.testStatus.innerHTML = `<h3>Kalibrácia</h3>`;
        
        for (const step of steps) {
            if (!this.isCalibrating) break;
            
            elements.testStatus.innerHTML = `<h3>${step.instruction}</h3>`;
            await this.calibrateStep(step.duration, step.action);
        }
        
        if (this.isCalibrating) {
            this.calculateThresholds();
            this.saveToLocalStorage();
            elements.testStatus.innerHTML = `<h3>Kalibrácia dokončená!</h3>`;
        }
        
        this.isCalibrating = false;
    }
    
    async calibrateStep(duration, action) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const samples = [];
            
            const interval = setInterval(() => {
                if (Date.now() - startTime >= duration) {
                    clearInterval(interval);
                    this.calibrationSamples.push({
                        action,
                        samples: [...samples],
                        timestamp: Date.now()
                    });
                    resolve();
                }
                
                if (currentLandmarks) {
                    samples.push({
                        landmarks: currentLandmarks,
                        timestamp: Date.now()
                    });
                }
            }, 100);
        });
    }
    
    calculateThresholds() {
        const centerSamples = this.calibrationSamples
            .filter(s => s.action === 'center')
            .flatMap(s => s.samples);
        
        if (centerSamples.length > 0) {
            let leftGazeSum = 0, rightGazeSum = 0;
            let headCenterSum = 0;
            
            centerSamples.forEach(sample => {
                const gaze = this.calculateGazeRatios(sample.landmarks);
                leftGazeSum += gaze.left;
                rightGazeSum += gaze.right;
                headCenterSum += this.calculateHeadPosition(sample.landmarks);
            });
            
            const avgLeft = leftGazeSum / centerSamples.length;
            const avgRight = rightGazeSum / centerSamples.length;
            const avgHead = headCenterSum / centerSamples.length;
            
            this.data.gazeThresholds = {
                leftMin: avgLeft * 0.85,
                leftMax: avgLeft * 1.15,
                rightMin: avgRight * 0.85,
                rightMax: avgRight * 1.15,
                headOffset: 0.15 
            };
        }
    }
    
    calculateGazeRatios(landmarks) {
        return { left: 0.4, right: 0.4 }; 
    }
    
    calculateHeadPosition(landmarks) {
        return 0.5; 
    }
    
    saveToLocalStorage() {
        localStorage.setItem('eyeContactCalibration', JSON.stringify(this.data));
    }
    
    loadFromLocalStorage() {
        const saved = localStorage.getItem('eyeContactCalibration');
        if (saved) {
            this.data = JSON.parse(saved);
            return true;
        }
        return false;
    }
    
    cancelCalibration() {
        this.isCalibrating = false;
        this.calibrationSamples = [];
    }
}

const calibrationManager = new CalibrationManager();

class GazeAnalyzer {
    constructor() {
        this.gazeHistory = [];
        this.maxHistorySize = 100;
        this.gazeZones = {
            center: { min: 0.35, max: 0.65 },
            left: { min: 0.0, max: 0.35 },
            right: { min: 0.65, max: 1.0 },
            up: { min: 0.0, max: 0.4, vertical: true },
            down: { min: 0.6, max: 1.0, vertical: true }
        };
    }
    
    analyzeGazePattern(landmarks) {
        const currentGaze = this.getCurrentGazeZone(landmarks);
        this.addToHistory(currentGaze);
        
        return {
            currentZone: currentGaze.zone,
            confidence: currentGaze.confidence,
            variation: this.calculateGazeVariation(),
            durationInZone: this.getDurationInCurrentZone(),
            recommendation: this.generateRecommendation()
        };
    }
    
    getCurrentGazeZone(landmarks) {
        const leftEye = this.calculateEyeGaze(landmarks, 'left');
        const rightEye = this.calculateEyeGaze(landmarks, 'right');
        const verticalGaze = this.calculateVerticalGaze(landmarks);
        
        const horizontalAvg = (leftEye.horizontal + rightEye.horizontal) / 2;
        const verticalAvg = (leftEye.vertical + rightEye.vertical) / 2;
        
        let zone = 'center';
        let confidence = 1.0;
        
        if (horizontalAvg < this.gazeZones.left.max) {
            zone = 'left';
            confidence = Math.abs(horizontalAvg - 0.5);
        } else if (horizontalAvg > this.gazeZones.right.min) {
            zone = 'right';
            confidence = Math.abs(horizontalAvg - 0.5);
        }
        
        if (verticalAvg < this.gazeZones.up.max) {
            zone = verticalAvg < 0.2 ? 'up-left' : zone + '-up';
        } else if (verticalAvg > this.gazeZones.down.min) {
            zone = verticalAvg > 0.8 ? 'down-left' : zone + '-down';
        }
        
        return {
            zone,
            confidence: Math.max(0.1, 1 - confidence),
            horizontal: horizontalAvg,
            vertical: verticalAvg
        };
    }
    
    calculateEyeGaze(landmarks, side) {
        const eyePoints = side === 'left' 
            ? { inner: 33, outer: 133, top: 159, bottom: 145, pupil: 468 }
            : { inner: 263, outer: 362, top: 386, bottom: 374, pupil: 473 };
        
        const inner = landmarks[eyePoints.inner];
        const outer = landmarks[eyePoints.outer];
        const top = landmarks[eyePoints.top];
        const bottom = landmarks[eyePoints.bottom];
        const pupil = landmarks[eyePoints.pupil];
        
        if (!inner || !outer || !pupil) {
            return { horizontal: 0.5, vertical: 0.5 };
        }
        
        const eyeWidth = Math.abs(outer.x - inner.x);
        const eyeHeight = Math.abs(bottom.y - top.y);
        
        const horizontalRatio = Math.abs(pupil.x - inner.x) / eyeWidth;
        const verticalRatio = Math.abs(pupil.y - top.y) / eyeHeight;
        
        return {
            horizontal: Math.max(0, Math.min(1, horizontalRatio)),
            vertical: Math.max(0, Math.min(1, verticalRatio))
        };
    }
    
    calculateVerticalGaze(landmarks) {
        const leftEye = this.calculateEyeGaze(landmarks, 'left');
        const rightEye = this.calculateEyeGaze(landmarks, 'right');
        
        return (leftEye.vertical + rightEye.vertical) / 2;
    }
    
    addToHistory(gazeData) {
        this.gazeHistory.push({
            ...gazeData,
            timestamp: Date.now()
        });
        
        if (this.gazeHistory.length > this.maxHistorySize) {
            this.gazeHistory.shift();
        }
    }
    
    calculateGazeVariation() {
        if (this.gazeHistory.length < 10) return 0;
        
        const recentHistory = this.gazeHistory.slice(-20);
        const zones = recentHistory.map(h => h.zone);
        const uniqueZones = new Set(zones);
        
        const zoneVariation = uniqueZones.size / 5; // max 5 zón
        
        const timeVariation = this.calculateTimeVariation(recentHistory);
        
        return Math.min(1.0, (zoneVariation * 0.7 + timeVariation * 0.3));
    }
    
    calculateTimeVariation(history) {
        if (history.length < 2) return 0;
        
        let zoneChanges = 0;
        for (let i = 1; i < history.length; i++) {
            if (history[i].zone !== history[i-1].zone) {
                zoneChanges++;
            }
        }
        
        const optimalChanges = Math.floor(history.length / 15);
        const changeScore = Math.min(1.0, zoneChanges / optimalChanges);
        
        return changeScore;
    }
    
    getDurationInCurrentZone() {
        if (this.gazeHistory.length < 2) return 0;
        
        const currentZone = this.gazeHistory[this.gazeHistory.length - 1].zone;
        let duration = 0;
        
        for (let i = this.gazeHistory.length - 1; i >= 0; i--) {
            if (this.gazeHistory[i].zone === currentZone) {
                if (i > 0) {
                    duration += this.gazeHistory[i].timestamp - this.gazeHistory[i-1].timestamp;
                }
            } else {
                break;
            }
        }
        
        return duration;
    }
    
    generateRecommendation() {
        const variation = this.calculateGazeVariation();
        const duration = this.getDurationInCurrentZone();
        
        if (variation < 0.3) {
            return "Príliš statický pohľad. Skúste rozhliadnuť sa po miestnosti.";
        } else if (variation > 0.8) {
            return "Príliš časté zmeny pohľadu. Skúste udržať pohľad 3-5 sekúnd.";
        } else if (duration > 10000) {
            return "Pohľad príliš dlho v jednej zóne. Presuňte pohľad.";
        }
        
        return "Dobrý rytmus pohľadu. Pokračujte!";
    }
}

const gazeAnalyzer = new GazeAnalyzer();

class EmotionAnalyzer {
    constructor() {
        this.expressionHistory = [];
    }
    
    analyzeExpressions(landmarks) {
        const smileScore = this.analyzeSmile(landmarks);
        const eyebrowScore = this.analyzeEyebrows(landmarks);
        const eyeOpenness = this.analyzeEyeOpenness(landmarks);
        
        return {
            smileIntensity: smileScore,
            engagement: eyebrowScore,
            confidence: this.calculateConfidenceScore(smileScore, eyebrowScore, eyeOpenness),
            eyeOpenness: eyeOpenness,
            overallMood: this.determineMood(smileScore, eyebrowScore)
        };
    }
    
    analyzeSmile(landmarks) {
        const mouthLeft = landmarks[61];
        const mouthRight = landmarks[291];
        const mouthTop = landmarks[0];
        const mouthBottom = landmarks[17];
        
        if (!mouthLeft || !mouthRight || !mouthTop || !mouthBottom) {
            return 0;
        }
        
        const mouthWidth = Math.abs(mouthRight.x - mouthLeft.x);
        const mouthHeight = Math.abs(mouthBottom.y - mouthTop.y);
        
        const smileRatio = mouthWidth / (mouthHeight + 0.001);
        
        return Math.max(0, Math.min(1, (smileRatio - 1.5) * 2));
    }
    
    analyzeEyebrows(landmarks) {
        const leftEyebrow = landmarks[65];
        const rightEyebrow = landmarks[295];
        const leftEye = landmarks[33];
        const rightEye = landmarks[263];
        
        if (!leftEyebrow || !rightEyebrow || !leftEye || !rightEye) {
            return 0;
        }
        
        const leftDistance = Math.abs(leftEyebrow.y - leftEye.y);
        const rightDistance = Math.abs(rightEyebrow.y - rightEye.y);
        
        const avgDistance = (leftDistance + rightDistance) / 2;
        
        return Math.max(0, Math.min(1, avgDistance * 10));
    }
    
    analyzeEyeOpenness(landmarks) {
        const leftEyeTop = landmarks[159];
        const leftEyeBottom = landmarks[145];
        const rightEyeTop = landmarks[386];
        const rightEyeBottom = landmarks[374];
        
        if (!leftEyeTop || !leftEyeBottom || !rightEyeTop || !rightEyeBottom) {
            return 0.5;
        }
        
        const leftOpenness = Math.abs(leftEyeBottom.y - leftEyeTop.y);
        const rightOpenness = Math.abs(rightEyeBottom.y - rightEyeTop.y);
        
        return (leftOpenness + rightOpenness) / 2;
    }
    
    calculateConfidenceScore(smile, eyebrows, eyeOpenness) {
        return (smile * 0.4 + eyebrows * 0.3 + eyeOpenness * 0.3);
    }
    
    determineMood(smileScore, eyebrowScore) {
        if (smileScore > 0.7 && eyebrowScore > 0.5) {
            return "enthusiastic";
        } else if (smileScore > 0.5) {
            return "friendly";
        } else if (eyebrowScore > 0.6) {
            return "engaged";
        } else if (smileScore < 0.2 && eyebrowScore < 0.2) {
            return "neutral";
        }
        return "focused";
    }
}

const emotionAnalyzer = new EmotionAnalyzer();

class SessionManager {
    constructor() {
        this.sessions = this.loadSessions();
        this.currentSession = null;
    }
    
    startNewSession(duration) {
        this.currentSession = {
            id: Date.now(),
            startTime: new Date().toISOString(),
            duration: duration,
            frames: [],
            summary: null
        };
    }
    
    addFrameData(eyeContactScore, gazeData, emotionData) {
        if (!this.currentSession) return;
        
        this.currentSession.frames.push({
            timestamp: Date.now(),
            eyeContactScore,
            gazeZone: gazeData.currentZone,
            gazeVariation: gazeData.variation,
            emotion: emotionData.overallMood,
            confidence: emotionData.confidence
        });
        
        if (this.currentSession.frames.length > 1000) {
            this.currentSession.frames = this.currentSession.frames.slice(-1000);
        }
    }
    
    endSession(finalScore) {
        if (!this.currentSession) return;
        
        this.currentSession.endTime = new Date().toISOString();
        this.currentSession.finalScore = finalScore;
        this.currentSession.summary = this.generateSummary();
        
        this.sessions.push(this.currentSession);
        this.saveSessions();
        
        return this.currentSession;
    }
    
    generateSummary() {
        const frames = this.currentSession.frames;
        if (frames.length === 0) return null;
        
        const eyeContactScores = frames.map(f => f.eyeContactScore);
        const gazeZones = frames.map(f => f.gazeZone);
        const emotions = frames.map(f => f.emotion);
        
        const zoneCounts = {};
        gazeZones.forEach(zone => {
            zoneCounts[zone] = (zoneCounts[zone] || 0) + 1;
        });
        
        const emotionCounts = {};
        emotions.forEach(emotion => {
            emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
        });
        
        return {
            avgEyeContact: eyeContactScores.reduce((a, b) => a + b, 0) / eyeContactScores.length,
            bestStreak: this.calculateBestStreak(frames),
            dominantGazeZone: Object.keys(zoneCounts).reduce((a, b) => zoneCounts[a] > zoneCounts[b] ? a : b),
            dominantEmotion: Object.keys(emotionCounts).reduce((a, b) => emotionCounts[a] > emotionCounts[b] ? a : b),
            consistency: this.calculateConsistency(frames),
            improvements: this.generateImprovements(frames)
        };
    }
    
    calculateBestStreak(frames) {
        let currentStreak = 0;
        let bestStreak = 0;
        
        frames.forEach(frame => {
            if (frame.eyeContactScore > 70) {
                currentStreak++;
                bestStreak = Math.max(bestStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        });
        
        return bestStreak;
    }
    
    calculateConsistency(frames) {
        if (frames.length < 2) return 0;
        
        const scores = frames.map(f => f.eyeContactScore);
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / scores.length;
        const stdDev = Math.sqrt(variance);
        
        // Konzistentné = nízka smerodajná odchýlka
        return Math.max(0, 1 - (stdDev / 50));
    }
    
    generateImprovements(frames) {
        const improvements = [];
        
        // Analýza slabých miest
        const lowContactFrames = frames.filter(f => f.eyeContactScore < 50);
        const gazeAnalysis = this.analyzeGazePatterns(frames);
        
        if (lowContactFrames.length / frames.length > 0.3) {
            improvements.push("Zvýšte frekvenciu očného kontaktu");
        }
        
        if (gazeAnalysis.staticTime > 10000) {
            improvements.push("Pohybujte pohľadom častejšie");
        }
        
        if (gazeAnalysis.leftBias > 0.6) {
            improvements.push("Vyvážte pohľad aj na pravú stranu");
        }
        
        return improvements;
    }
    
    analyzeGazePatterns(frames) {
        let leftCount = 0, rightCount = 0, centerCount = 0;
        let lastZone = null;
        let staticTime = 0;
        
        frames.forEach((frame, i) => {
            if (frame.gazeZone.includes('left')) leftCount++;
            if (frame.gazeZone.includes('right')) rightCount++;
            if (frame.gazeZone.includes('center')) centerCount++;
            
            if (i > 0 && frame.gazeZone === lastZone) {
                staticTime += frames[i].timestamp - frames[i-1].timestamp;
            }
            lastZone = frame.gazeZone;
        });
        
        return {
            leftBias: leftCount / frames.length,
            rightBias: rightCount / frames.length,
            centerBias: centerCount / frames.length,
            staticTime: staticTime
        };
    }
    
    loadSessions() {
        try {
            const saved = localStorage.getItem('speechCoachSessions');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error('Error loading sessions:', e);
            return [];
        }
    }
    
    saveSessions() {
        try {
            localStorage.setItem('speechCoachSessions', JSON.stringify(this.sessions));
        } catch (e) {
            console.error('Error saving sessions:', e);
        }
    }
    
    getProgressReport(limit = 5) {
        return this.sessions.slice(-limit).map(session => ({
            date: new Date(session.startTime).toLocaleDateString(),
            duration: (session.duration / 60000).toFixed(1) + ' min',
            score: session.finalScore.toFixed(1) + '%',
            improvement: session.summary?.improvements?.[0] || 'Žiadne'
        }));
    }
    
    clearAllSessions() {
        this.sessions = [];
        this.saveSessions();
    }
}

const sessionManager = new SessionManager();

// === VYLEPŠENÁ ANALÝZA OČNÉHO KONTAKTU ===
function analyzeEyeContact(landmarks) {
    // Vylepšená verzia s gradientným hodnotením
    const gazeAnalysis = gazeAnalyzer.getCurrentGazeZone(landmarks);
    const headPosition = analyzeHeadPosition(landmarks);
    const eyeAlignment = analyzeEyeAlignment(landmarks);
    
    const gazeScore = calculateGazeScore(gazeAnalysis);
    const headScore = calculateHeadPositionScore(headPosition);
    const alignmentScore = calculateAlignmentScore(eyeAlignment);
    
    const totalScore = (
        gazeScore * 0.5 +      
        headScore * 0.3 +      
        alignmentScore * 0.2    
    );
    
    const calibratedScore = applyCalibration(totalScore, gazeAnalysis);
    
    return Math.max(0, Math.min(100, calibratedScore));
}

function calculateGazeScore(gazeAnalysis) {
    if (gazeAnalysis.zone === 'center') {
        return 100;
    } else if (gazeAnalysis.zone.includes('center')) {
        return 80;
    } else if (gazeAnalysis.confidence > 0.7) {
        return 60;
    } else {
        return Math.max(20, gazeAnalysis.confidence * 100);
    }
}

function analyzeHeadPosition(landmarks) {
    const leftEyeOuter = landmarks[133];
    const rightEyeOuter = landmarks[362];
    const noseTip = landmarks[1];
    
    if (!leftEyeOuter || !rightEyeOuter || !noseTip) {
        return { centered: false, tilt: 0, rotation: 0 };
    }
    
    const headCenterX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
    const headCenterY = (leftEyeOuter.y + rightEyeOuter.y) / 2;
    
    const eyeDeltaY = Math.abs(leftEyeOuter.y - rightEyeOuter.y);
    const eyeDeltaX = Math.abs(leftEyeOuter.x - rightEyeOuter.x);
    const tilt = Math.atan2(eyeDeltaY, eyeDeltaX) * (180 / Math.PI);
    
    return {
        centered: Math.abs(headCenterX - 0.5) < 0.15 && Math.abs(headCenterY - 0.5) < 0.2,
        tilt: tilt,
        rotation: headCenterX - 0.5,
        x: headCenterX,
        y: headCenterY
    };
}

function calculateHeadPositionScore(headPosition) {
    let score = 100;
    
    if (!headPosition.centered) {
        score -= 40;
    }
    
    if (Math.abs(headPosition.tilt) > 10) {
        score -= 20;
    }
    
    if (Math.abs(headPosition.rotation) > 0.1) {
        score -= Math.abs(headPosition.rotation) * 100;
    }
    
    return Math.max(0, score);
}

function analyzeEyeAlignment(landmarks) {
    const leftPupil = landmarks[468];
    const rightPupil = landmarks[473];
    const leftEyeInner = landmarks[133];
    const rightEyeInner = landmarks[362];
    
    if (!leftPupil || !rightPupil || !leftEyeInner || !rightEyeInner) {
        return { aligned: false, disparity: 1 };
    }
    
    const leftPosition = Math.abs(leftPupil.x - leftEyeInner.x);
    const rightPosition = Math.abs(rightPupil.x - rightEyeInner.x);
    const disparity = Math.abs(leftPosition - rightPosition);
    
    return {
        aligned: disparity < 0.05,
        disparity: disparity,
        leftPosition: leftPosition,
        rightPosition: rightPosition
    };
}

function calculateAlignmentScore(alignment) {
    if (alignment.aligned) {
        return 100;
    } else {
        return Math.max(0, 100 - (alignment.disparity * 500));
    }
}

function applyCalibration(score, gazeAnalysis) {
    if (!calibrationManager.data.gazeThresholds) {
        return score;
    }
    
    const thresholds = calibrationManager.data.gazeThresholds;
    
    if (gazeAnalysis.horizontal < thresholds.leftMin || 
        gazeAnalysis.horizontal > thresholds.leftMax) {
        score *= 0.8;
    }
    
    return score;
}

let faceMesh;
let camera;

async function initializeMediaPipe() {
    try {
        if (!window.FaceMesh) {
            await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js');
        }
        if (!window.Camera) {
            await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
        }
        if (!window.drawingUtils) {
            await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js');
        }
        
        faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        
        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        camera = new Camera(elements.video, {
            onFrame: async () => {
                if (faceMesh) {
                    await faceMesh.send({ image: elements.video });
                }
            },
            width: 640,
            height: 480
        });
        
        setupFaceMeshResults();
        return true;
    } catch (error) {
        console.error('Failed to initialize MediaPipe:', error);
        return false;
    }
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function setupFaceMeshResults() {
    faceMesh.onResults((results) => {
        if (!shouldRenderFrame()) return;
        
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
        
        if (results.image) {
            canvasCtx.drawImage(results.image, 0, 0, elements.canvas.width, elements.canvas.height);
        }
        
        if (appState.testActive && results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const currentTime = Date.now();
            const elapsed = currentTime - appState.testStartTime;
            const remainingTime = Math.max(0, Math.ceil((appState.testDuration - elapsed) / 1000));
            
            if (elapsed >= appState.testDuration) {
                endTest();
                return;
            }
            
            const landmarks = results.multiFaceLandmarks[0];
            currentLandmarks = landmarks; 
            
            const eyeContactScore = analyzeEyeContact(landmarks);
            const gazeData = gazeAnalyzer.analyzeGazePattern(landmarks);
            const emotionData = emotionAnalyzer.analyzeExpressions(landmarks);
            
            updateEyeContactStats(eyeContactScore);
            
            sessionManager.addFrameData(eyeContactScore, gazeData, emotionData);
            
            provideLiveFeedback(eyeContactScore, gazeData, emotionData, remainingTime);
            
            drawVisualization(landmarks, eyeContactScore, gazeData);
        }
        
        canvasCtx.restore();
    });
}

function provideLiveFeedback(eyeContactScore, gazeData, emotionData, remainingTime) {
    const feedbackMessages = [];
    
    if (eyeContactScore < 30) {
        feedbackMessages.push({
            type: 'warning',
            message: '❌ Príliš málo očného kontaktu. Pozrite sa priamo do kamery.',
            priority: 3
        });
    } else if (eyeContactScore < 50) {
        feedbackMessages.push({
            type: 'info',
            message: '⚠️ Môžete zlepšiť očný kontakt. Sústredte sa na stred kamery.',
            priority: 2
        });
    } else if (eyeContactScore > 80) {
        feedbackMessages.push({
            type: 'success',
            message: '✅ Výborný očný kontakt!',
            priority: 1
        });
    }
    
    if (gazeData.variation < 0.3) {
        feedbackMessages.push({
            type: 'warning',
            message: '👀 Pohľad príliš statický. Rozhliadnite sa.',
            priority: 2
        });
    } else if (gazeData.variation > 0.8) {
        feedbackMessages.push({
            type: 'info',
            message: '👁️ Príliš časté zmeny pohľadu. Skúste spomaliť.',
            priority: 2
        });
    }
    
    if (emotionData.smileIntensity < 0.2) {
        feedbackMessages.push({
            type: 'info',
            message: '😐 Skúste sa usmiať, pridá to energii prejavu.',
            priority: 1
        });
    }
    
    if (feedbackMessages.length > 0) {
        feedbackMessages.sort((a, b) => b.priority - a.priority);
        const topMessage = feedbackMessages[0];
        
        elements.liveFeedback.innerHTML = `
            <div class="feedback ${topMessage.type}">
                ${topMessage.message}
            </div>
        `;
    } else {
        elements.liveFeedback.innerHTML = `
            <div class="feedback success">
                ✅ Všetko vyzerá dobre! Pokračujte.
            </div>
        `;
    }
    
    debouncedUpdateUI({
        eyeContactScore: appState.overallScore || 0,
        remainingTime: remainingTime,
        status: 'Test prebieha...'
    });
}

function drawVisualization(landmarks, eyeContactScore, gazeData) {
    const color = getScoreColor(eyeContactScore);
    
    if (window.drawConnectors && window.drawLandmarks) {
        drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {
            color: color,
            lineWidth: 1
        });
        
        drawLandmarks(canvasCtx, landmarks, {
            color: color,
            lineWidth: 1,
            radius: 2
        });
    }
    
    canvasCtx.fillStyle = color;
    canvasCtx.font = 'bold 20px Arial';
    canvasCtx.fillText(`Kontakt: ${Math.round(eyeContactScore)}%`, 10, 30);
    canvasCtx.fillText(`Zóna: ${gazeData.currentZone}`, 10, 60);
}

function getScoreColor(score) {
    if (score >= 80) return '#00C853'; 
    if (score >= 60) return '#FFD600'; 
    if (score >= 40) return '#FF9100'; 
    return '#FF1744'; 
}

function updateEyeContactStats(score) {
    appState.totalFrames++;
    if (score > 70) appState.goodEyeContactFrames++;
    
    appState.overallScore = (appState.goodEyeContactFrames / appState.totalFrames) * 100;
    
    return {
        currentScore: score,
        overallScore: appState.overallScore,
        isGood: score > 70
    };
}

function updateUI(data) {
    let displayTime = data.remainingTime;
    let timeUnit = "s";
    
    if (data.remainingTime >= 60) {
        displayTime = (data.remainingTime / 60).toFixed(1);
        timeUnit = "min";
    }
    
    elements.testStatus.innerHTML = `
        ${data.status}<br>
        Očný kontakt: ${data.eyeContactScore.toFixed(1)}%<br>
        Zostáva: ${displayTime} ${timeUnit}
    `;
    
    const progressPercent = ((appState.testDuration - data.remainingTime * 1000) / appState.testDuration) * 100;
    elements.progressBar.style.width = `${Math.min(progressPercent, 100)}%`;
}

function startCamera() {
    elements.testStatus.textContent = "Spúšťam kameru...";
    elements.startButton.style.display = "none";
    
    initializeMediaPipe().then((success) => {
        if (success) {
            camera.start().then(() => {
                console.log("Kamera spustená.");
                
                setTimeout(() => {
                    if (confirm("Chcete vykonať kalibráciu pre presnejšie výsledky?")) {
                        calibrationManager.startCalibration().then(() => {
                            getTestDuration();
                        });
                    } else {
                        getTestDuration();
                    }
                }, 1000);
            }).catch((error) => {
                console.error("Kameru sa nepodarilo spustiť:", error);
                handleCameraError();
            });
        } else {
            handleCameraError();
        }
    });
}

function getTestDuration() {
    let durationAnswer = prompt("Zadajte dĺžku prejavu v minútach (0.5 - 25):");
    let durationInMilliseconds = parseFloat(durationAnswer) * MINUTE_CONVERTER;
    
    while (
        durationInMilliseconds > MAX_TIME ||
        durationInMilliseconds < MIN_TIME ||
        isNaN(durationInMilliseconds)
    ) {
        if (durationInMilliseconds > MAX_TIME) {
            durationAnswer = prompt("Maximálna dĺžka je 25 minút, zadajte znovu:");
        } else if (durationInMilliseconds < MIN_TIME) {
            durationAnswer = prompt("Minimálna dĺžka je 0.5 minúty, zadajte znovu:");
        } else if (isNaN(durationInMilliseconds)) {
            durationAnswer = prompt("Neplatný vstup. Zadajte prosím číslo v minútach:");
        }
        durationInMilliseconds = parseFloat(durationAnswer) * MINUTE_CONVERTER;
    }
    
    appState.testDuration = durationInMilliseconds;
    restartTest();
}

function startCountdown() {
    let count = 3;
    elements.testStatus.innerHTML = `<h2 style="font-size:60px; color:#1E88E5;">${count}</h2>`;
    playBeep();
    count--;
    
    const interval = setInterval(() => {
        if (count > 0) {
            elements.testStatus.innerHTML = `<h2 style="font-size:60px; color:#1E88E5;">${count}</h2>`;
            playBeep();
            count--;
        } else {
            clearInterval(interval);
            playBeep();
            startTest();
        }
    }, 1000);
}

function startTest() {
    appState.testStartTime = Date.now();
    appState.testActive = true;
    appState.testCompleted = false;
    appState.totalFrames = 0;
    appState.goodEyeContactFrames = 0;
    
    sessionManager.startNewSession(appState.testDuration);
    
    updateUI({
        eyeContactScore: 0,
        remainingTime: appState.testDuration / 1000,
        status: 'Test prebieha...'
    });
}

function endTest() {
    appState.testActive = false;
    appState.testCompleted = true;
    playBeep();
    
    const finalEyeContactPercentage = appState.totalFrames > 0 
        ? (appState.goodEyeContactFrames / appState.totalFrames) * 100 
        : 0;
    
    const sessionResults = sessionManager.endSession(finalEyeContactPercentage);
    
    showFinalResults(finalEyeContactPercentage, sessionResults);
}

function restartTest() {
    appState.testCompleted = false;
    elements.startButton.style.display = "inline-block";
    elements.startButton.textContent = "Spustiť test";
    elements.startButton.onclick = startCountdown;
    
    elements.testInfo.textContent = `Test očného kontaktu - ${appState.testDuration / MINUTE_CONVERTER} min.`;
    elements.testStatus.textContent = "Pripravený na spustenie.";
    elements.progressBar.style.width = "0%";
    elements.liveFeedback.innerHTML = "";
}

function showFinalResults(eyeContactPercentage, sessionResults) {
    const status = 
        eyeContactPercentage >= 70 ? "VÝBORNÉ!" :
        eyeContactPercentage >= 50 ? "DOBRÉ" :
        "TREBA SA ZLEPŠIŤ";
    
    let details = `
        ${status}<br>
        Celkom snímok: ${appState.totalFrames}<br>
        Dobré snímky: ${appState.goodEyeContactFrames}<br>
        Optimálne: 70%+
    `;
    
    if (sessionResults && sessionResults.summary) {
        details += `
            <br><br>
            <strong>Detailná analýza:</strong><br>
            • Konzistentnosť: ${(sessionResults.summary.consistency * 100).toFixed(1)}%<br>
            • Najdlhšia séria: ${sessionResults.summary.bestStreak} snímok<br>
            • Dominantný pohľad: ${sessionResults.summary.dominantGazeZone}<br>
            • Nálada: ${sessionResults.summary.dominantEmotion}
        `;
        
        if (sessionResults.summary.improvements.length > 0) {
            details += `<br><br><strong>Odporúčania:</strong><br>`;
            sessionResults.summary.improvements.forEach(imp => {
                details += `• ${imp}<br>`;
            });
        }
    }
    
    const history = sessionManager.getProgressReport(3);
    if (history.length > 0) {
        details += `<br><br><strong>Posledné pokusy:</strong><br>`;
        history.forEach(h => {
            details += `• ${h.date}: ${h.score} - ${h.improvement}<br>`;
        });
    }
    
    elements.testInfo.textContent = `Výsledok: ${eyeContactPercentage.toFixed(1)}%`;
    elements.testStatus.innerHTML = details;
    elements.liveFeedback.innerHTML = "";
    
    elements.startButton.style.display = "inline-block";
    elements.startButton.textContent = "Spustiť znovu";
    elements.startButton.onclick = restartTest;
}

function playBeep() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
        console.warn('Audio context not available');
    }
}

function handleCameraError() {
    elements.testStatus.textContent = "Chyba pri spustení kamery. Skontrolujte povolenia.";
    elements.startButton.style.display = "inline-block";
    elements.startButton.textContent = "Skúsiť znovu";
    elements.startButton.onclick = startCamera;
}

function shouldRenderFrame() {
    const now = Date.now();
    if (!window.lastRenderTime) {
        window.lastRenderTime = now;
        return true;
    }
    
    const fps = 30;
    const minRenderInterval = 1000 / fps;
    
    if (now - window.lastRenderTime >= minRenderInterval) {
        window.lastRenderTime = now;
        return true;
    }
    
    return false;
}

document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        elements.testStatus.textContent = "Váš prehliadač nepodporuje kameru.";
        return;
    }
    
    elements.startButton.onclick = startCamera;
    
    calibrationManager.loadFromLocalStorage();
    
    const history = sessionManager.getProgressReport(1);
    if (history.length > 0) {
        elements.testInfo.textContent += ` (Posledný pokus: ${history[0].score})`;
    }
});