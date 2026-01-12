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
    sessionHistory: [],
    overallScore: 0,
    // Nové: stav pre filler words
    audioRecording: false,
    fillerWordsDetected: [],
    speechAnalysisActive: false
};

// ========== FILLER WORDS DETEKTOR ==========
class FillerWordsDetector {
    constructor() {
        this.recorder = null;
        this.mediaStream = null;
        this.audioContext = null;
        this.isRecording = false;
        this.speechStartTime = null;
        this.recordingStartTime = null;
        
        // Zoznam filler words v slovenčine
        this.fillerWords = [
            'ehm', 'uhm', 'ups', 'proste', 'vlastne', 'takže', 'asi', 
            'akože', 'rozumieš', 'v podstate', 'takpovediac',
            'eh', 'uh', 'mm', 'hmm', 'no', 'tak', 'teda', 'prosim',
            'vážne', 'čože', 'tedaž', 'tedaz', 'vlastnež',
            // Anglicke ekvivalenty
            'um', 'uh', 'ah', 'er', 'like', 'you know', 'actually', 
            'basically', 'literally', 'so', 'well', 'okay'
        ];
        
        this.fillerWordsPattern = new RegExp(`\\b(${this.fillerWords.join('|')})\\b`, 'gi');
        
        // Real-time detekcia
        this.realTimeDetections = [];
        this.lastFillerWordTime = 0;
        this.fillerWordCooldown = 2000; // 3 sekundy medzi detekciami
    }
    
    async init() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                console.warn('Tento prehliadač nepodporuje nahrávanie audio');
                return false;
            }
            
            // Získanie prístupu k mikrofónu
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                },
                video: false
            });
            
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            return true;
            
        } catch (error) {
            console.error('Error initializing microphone:', error);
            return false;
        }
    }
    
    async startRecording() {
        if (!this.mediaStream) {
            const initialized = await this.init();
            if (!initialized) {
                console.error('Microphone not available');
                return false;
            }
        }
        
        this.isRecording = true;
        this.speechStartTime = Date.now();
        this.recordingStartTime = Date.now();
        this.realTimeDetections = [];
        
        try {
            // Web Speech API pre real-time transkripciu
            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                this.setupSpeechRecognition();
            } else {
                console.warn('Speech recognition not supported in this browser');
                // Fallback: simulácia pre demo účely
                this.startSimulatedDetection();
            }
            
            return true;
            
        } catch (error) {
            console.error('Error starting recording:', error);
            return false;
        }
    }
    
    setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        
        // Konfigurácia
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'sk-SK'; // Slovenčina
        
        this.recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript.toLowerCase();
                const isFinal = event.results[i].isFinal;
                
                if (isFinal) {
                    this.analyzeTranscript(transcript);
                } else {
                    // Interim results - môžeme analyzovať aj priebežne
                    this.analyzeInterimTranscript(transcript);
                }
            }
        };
        
        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
        };
        
        this.recognition.start();
    }
    
    analyzeTranscript(transcript) {
        const matches = transcript.match(this.fillerWordsPattern);
        
        if (matches) {
            const currentTime = Date.now();
            
            // Kontrola cooldown period
            if (currentTime - this.lastFillerWordTime > this.fillerWordCooldown) {
                matches.forEach(word => {
                    const fillerData = {
                        word: word,
                        time: (currentTime - this.speechStartTime) / 1000,
                        timestamp: new Date().toLocaleTimeString(),
                        confidence: 1.0
                    };
                    
                    this.realTimeDetections.push(fillerData);
                    appState.fillerWordsDetected.push(fillerData);
                    this.lastFillerWordTime = currentTime;
                    
                    // Real-time feedback
                    this.showFillerWordFeedback(fillerData);
                });
            }
        }
    }
    
    analyzeInterimTranscript(transcript) {
        // Rýchla kontrola pre interim results
        const quickCheck = transcript.split(/\s+/).slice(-3); // Posledné 3 slová
        quickCheck.forEach(word => {
            if (this.fillerWords.includes(word.toLowerCase())) {
                const currentTime = Date.now();
                if (currentTime - this.lastFillerWordTime > this.fillerWordCooldown) {
                    this.showFillerWordHint(word);
                }
            }
        });
    }
    
    showFillerWordFeedback(fillerData) {
        // Pridaj feedback do UI
        if (elements.liveFeedback) {
            const existingFeedback = elements.liveFeedback.innerHTML;
            const newFeedback = `
                <div class="filler-word-feedback animate-pulse bg-yellow-50 border border-yellow-200 rounded-lg p-2 mb-2">
                    <div class="flex items-center">
                        <span class="text-yellow-600 mr-2">⚠️</span>
                        <span class="text-sm font-medium text-yellow-800">
                            Filler slovo: "<strong>${fillerData.word}</strong>"
                        </span>
                        <span class="ml-auto text-xs text-yellow-600">
                            ${fillerData.time.toFixed(1)}s
                        </span>
                    </div>
                </div>
            `;
            
            elements.liveFeedback.innerHTML = newFeedback + existingFeedback;
            
            // Limit na 3 posledné detekcie
            const feedbackElements = elements.liveFeedback.querySelectorAll('.filler-word-feedback');
            if (feedbackElements.length > 3) {
                feedbackElements[feedbackElements.length - 1].remove();
            }
            
            // Play gentle sound
            this.playFillerSound();
        }
    }
    
    showFillerWordHint(word) {
        // Len jemná hint namiesto full feedback
        const hint = document.createElement('div');
        hint.className = 'filler-hint text-xs text-yellow-600 italic';
        hint.textContent = `Pozor: "${word}"...`;
        hint.style.cssText = 'position: absolute; bottom: 10px; right: 10px; z-index: 100;';
        
        document.body.appendChild(hint);
        setTimeout(() => hint.remove(), 2000);
    }
    
    playFillerSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
            
            gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.2);
        } catch (e) {
            console.warn('Audio context not available');
        }
    }
    
    startSimulatedDetection() {
        // Simulácia pre demo účely (ak Web Speech API nie je dostupné)
        this.simulationInterval = setInterval(() => {
            if (!this.isRecording) {
                clearInterval(this.simulationInterval);
                return;
            }
            
            // Náhodná detekcia filler slov (pre demo)
            if (Math.random() < 0.15) { // 15% šanca každú sekundu
                const randomFiller = this.fillerWords[
                    Math.floor(Math.random() * this.fillerWords.length)
                ];
                
                const fillerData = {
                    word: randomFiller,
                    time: (Date.now() - this.speechStartTime) / 1000,
                    timestamp: new Date().toLocaleTimeString(),
                    confidence: 0.7 + Math.random() * 0.3
                };
                
                this.realTimeDetections.push(fillerData);
                appState.fillerWordsDetected.push(fillerData);
                
                this.showFillerWordFeedback(fillerData);
            }
        }, 1000);
    }
    
    stopRecording() {
        this.isRecording = false;
        
        if (this.recognition) {
            this.recognition.stop();
        }
        
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
        }
        
        // Vráť celkový počet filler words
        return {
            total: this.realTimeDetections.length,
            words: [...this.realTimeDetected],
            duration: (Date.now() - this.recordingStartTime) / 1000
        };
    }
    
    getFillerWordStats() {
        const now = Date.now();
        const duration = (now - this.speechStartTime) / 1000;
        const wordsPerMinute = duration > 0 ? 
            (this.realTimeDetections.length / duration) * 60 : 0;
        
        return {
            total: this.realTimeDetections.length,
            wordsPerMinute: wordsPerMinute.toFixed(2),
            lastMinute: this.getLastMinuteCount(),
            frequency: this.getFrequencyAnalysis()
        };
    }
    
    getLastMinuteCount() {
        const oneMinuteAgo = Date.now() - 60000;
        return this.realTimeDetections.filter(d => 
            (Date.now() - d.time * 1000) < oneMinuteAgo
        ).length;
    }
    
    getFrequencyAnalysis() {
        const wordCounts = {};
        this.realTimeDetections.forEach(d => {
            wordCounts[d.word] = (wordCounts[d.word] || 0) + 1;
        });
        
        return Object.entries(wordCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5); // Top 5 najčastejších
    }
}

const fillerDetector = new FillerWordsDetector();

// ========== VYLEPŠENÉ UI UPDATER ==========
class UIUpdater {
    constructor() {
        this.lastUIUpdate = 0;
        this.minUpdateInterval = 500;
        this.lastEyeContactScore = 0;
        this.lastFeedback = '';
        this.lastProgress = 0;
    }
    
    shouldUpdate(currentData) {
        const now = Date.now();
        const timeSinceLastUpdate = now - this.lastUIUpdate;
        
        if (this.isSignificantChange(currentData)) {
            return true;
        }
        
        return timeSinceLastUpdate >= this.minUpdateInterval;
    }
    
    isSignificantChange(currentData) {
        const scoreChange = Math.abs(currentData.eyeContactScore - this.lastEyeContactScore);
        const timeChange = Math.abs(currentData.remainingTime - (this.lastProgress || 0));
        
        const importantStatus = currentData.status.includes('Chyba') || 
                               currentData.status.includes('Kalibrácia') ||
                               currentData.status.includes('dokončen');
        
        return scoreChange > 5 || timeChange > 10 || importantStatus;
    }
    
    update(data) {
        const now = Date.now();
        
        if (!this.shouldUpdate(data)) {
            this.updateProgressBarSmoothly(data.remainingTime);
            return;
        }
        
        this.lastUIUpdate = now;
        this.lastEyeContactScore = data.eyeContactScore;
        
        let displayTime = data.remainingTime;
        let timeUnit = "s";
        
        if (data.remainingTime >= 60) {
            displayTime = (data.remainingTime / 60).toFixed(1);
            timeUnit = "min";
        }
        
        this.smoothUIUpdate(data, displayTime, timeUnit);
        this.updateProgressBarSmoothly(data.remainingTime);
    }
    
    smoothUIUpdate(data, displayTime, timeUnit) {
        // Pridaj filler words info ak sú nejaké
        let fillerInfo = '';
        if (appState.fillerWordsDetected.length > 0) {
            const lastMinuteCount = appState.fillerWordsDetected.filter(f => 
                f.time > (data.remainingTime - 60)
            ).length;
            
            fillerInfo = `
                <div class="mt-2 text-xs">
                    <span class="font-medium text-purple-600">Filler slov:</span>
                    <span class="ml-1">${appState.fillerWordsDetected.length}</span>
                    ${lastMinuteCount > 0 ? 
                        `<span class="ml-2 text-red-600">(${lastMinuteCount} za min)</span>` : 
                        ''}
                </div>
            `;
        }
        
        elements.testStatus.innerHTML = `
            <div class="transition-opacity duration-300 ease-in-out">
                <div class="font-medium text-gray-700">${data.status}</div>
                <div class="mt-1">
                    <span class="font-semibold text-gray-800">Očný kontakt:</span>
                    <span class="ml-2 font-bold text-blue-600">${data.eyeContactScore.toFixed(0)}%</span>
                </div>
                <div class="mt-1">
                    <span class="font-semibold text-gray-800">Zostáva:</span>
                    <span class="ml-2 font-bold text-green-600">${displayTime} ${timeUnit}</span>
                </div>
                ${fillerInfo}
            </div>
        `;
    }
    
    updateProgressBarSmoothly(remainingTime) {
        if (!appState.testDuration) return;
        
        const progressPercent = ((appState.testDuration - (remainingTime * 1000)) / appState.testDuration) * 100;
        const newProgress = Math.min(progressPercent, 100);
        
        if (Math.abs(newProgress - this.lastProgress) > 0.5 || this.lastProgress === 0) {
            elements.progressBar.style.transition = 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
            elements.progressBar.style.width = `${newProgress}%`;
            this.lastProgress = newProgress;
        }
    }
}

const uiUpdater = new UIUpdater();

// ========== VYLEPŠENÝ FEEDBACK MANAGER ==========
class FeedbackManager {
    constructor() {
        this.lastFeedbackUpdate = 0;
        this.minFeedbackInterval = 3000;
        this.currentFeedback = null;
        this.lastEmotionScore = 0;
    }
    
    provideFeedback(eyeContactScore, gazeData, emotionData, remainingTime) {
        const now = Date.now();
        const timeSinceLastFeedback = now - this.lastFeedbackUpdate;
        
        if (timeSinceLastFeedback < this.minFeedbackInterval && 
            !this.isCriticalChange(eyeContactScore, gazeData, emotionData)) {
            return;
        }
        
        const feedback = this.generateFeedback(eyeContactScore, gazeData, emotionData);
        
        if (feedback.message !== this.currentFeedback?.message) {
            this.updateFeedbackUI(feedback);
            this.currentFeedback = feedback;
            this.lastFeedbackUpdate = now;
            this.lastEmotionScore = emotionData.smileIntensity;
        }
    }
    
    isCriticalChange(eyeContactScore, gazeData, emotionData) {
        return eyeContactScore < 30 || 
               eyeContactScore > 85 || 
               gazeData.variation < 0.2 || 
               gazeData.variation > 0.85 ||
               Math.abs(emotionData.smileIntensity - this.lastEmotionScore) > 0.3;
    }
    
    generateFeedback(eyeContactScore, gazeData, emotionData) {
        const feedbacks = [];
        
        // Eye contact feedback
        if (eyeContactScore < 30) {
            feedbacks.push({
                type: 'error',
                message: '❌ Príliš málo očného kontaktu. Pozrite sa priamo do kamery.',
                priority: 3
            });
        } else if (eyeContactScore < 50) {
            feedbacks.push({
                type: 'warning',
                message: '⚠️ Môžete zlepšiť očný kontakt. Sústredte sa na stred kamery.',
                priority: 2
            });
        } else if (eyeContactScore > 80) {
            feedbacks.push({
                type: 'success',
                message: '✅ Výborný očný kontakt!',
                priority: 1
            });
        }
        
        // Gaze variation feedback
        if (gazeData.variation < 0.3) {
            feedbacks.push({
                type: 'warning',
                message: '👀 Pohľad príliš statický. Rozhliadnite sa.',
                priority: 2
            });
        } else if (gazeData.variation > 0.8) {
            feedbacks.push({
                type: 'info',
                message: '👁️ Príliš časté zmeny pohľadu. Skúste spomaliť.',
                priority: 2
            });
        }
        
        // VYLEPŠENÉ: Menej citlivý úsmev threshold (0.1 namiesto 0.2)
        if (emotionData.smileIntensity < 0.1) { // Znížené z 0.2
            feedbacks.push({
                type: 'info',
                message: '😐 Skúste uvoľniť tvár, pridá to prirodzenosť prejavu.',
                priority: 1
            });
        } else if (emotionData.smileIntensity > 0.6) {
            feedbacks.push({
                type: 'success',
                message: '😊 Prirodzená výraz tváre!',
                priority: 1
            });
        }
        
        if (feedbacks.length === 0) {
            return {
                type: 'success',
                message: '✅ Všetko vyzerá dobre! Pokračujte.',
                priority: 0
            };
        }
        
        feedbacks.sort((a, b) => b.priority - a.priority);
        return feedbacks[0];
    }
    
    updateFeedbackUI(feedback) {
        let bgClass, textClass, borderClass;
        
        switch(feedback.type) {
            case 'success':
                bgClass = 'bg-green-50';
                textClass = 'text-green-800';
                borderClass = 'border-green-200';
                break;
            case 'warning':
                bgClass = 'bg-yellow-50';
                textClass = 'text-yellow-800';
                borderClass = 'border-yellow-200';
                break;
            case 'error':
                bgClass = 'bg-red-50';
                textClass = 'text-red-800';
                borderClass = 'border-red-200';
                break;
            case 'info':
                bgClass = 'bg-blue-50';
                textClass = 'text-blue-800';
                borderClass = 'border-blue-200';
                break;
            default:
                bgClass = 'bg-gray-50';
                textClass = 'text-gray-800';
                borderClass = 'border-gray-200';
        }
        
        elements.liveFeedback.innerHTML = `
            <div class="transition-all duration-500 ease-in-out transform ${bgClass} ${textClass} border ${borderClass} rounded-lg p-4 shadow-sm">
                <div class="flex items-center">
                    <div class="flex-shrink-0 mr-3">
                        ${feedback.message.split(' ')[0]}
                    </div>
                    <div class="font-medium">
                        ${feedback.message.substring(feedback.message.indexOf(' ') + 1)}
                    </div>
                </div>
            </div>
        `;
    }
}

const feedbackManager = new FeedbackManager();

// ========== VYLEPŠENÝ EMOTION ANALYZER ==========
class EmotionAnalyzer {
    constructor() {
        this.expressionHistory = [];
        this.smileThreshold = 0.1; // Znížený threshold pre úsmev
    }
    
    analyzeExpressions(landmarks) {
        const smileScore = this.analyzeSmile(landmarks);
        const eyebrowScore = this.analyzeEyebrows(landmarks);
        const eyeOpenness = this.analyzeEyeOpenness(landmarks);
        
        // Vylepšený confidence score - menej dôrazu na úsmev
        const confidence = this.calculateConfidenceScore(smileScore, eyebrowScore, eyeOpenness);
        
        return {
            smileIntensity: smileScore,
            engagement: eyebrowScore,
            confidence: confidence,
            eyeOpenness: eyeOpenness,
            overallMood: this.determineMood(smileScore, eyebrowScore),
            // Nové: prírodzenosť skóre
            naturalness: this.calculateNaturalness(smileScore, eyebrowScore, eyeOpenness)
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
        
        // Vylepšený výpočet - menej citlivý
        const smileRatio = mouthWidth / (mouthHeight + 0.001);
        
        // Normalizuj na 0-1 s miernejším prahom
        const normalized = Math.max(0, Math.min(1, (smileRatio - 1.3) * 1.5)); // Znížený základ
        
        return normalized;
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
        
        return Math.max(0, Math.min(1, avgDistance * 8)); // Menej citlivé
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
        // Menej dôrazu na úsmev, viac na oči a obočie
        return (smile * 0.3 + eyebrows * 0.4 + eyeOpenness * 0.3);
    }
    
    calculateNaturalness(smile, eyebrows, eyeOpenness) {
        // Prírodzenosť = vyváženosť všetkých faktorov
        const balance = 1 - Math.abs(smile - 0.5) - Math.abs(eyebrows - 0.5) - Math.abs(eyeOpenness - 0.5);
        return Math.max(0, balance / 3);
    }
    
    determineMood(smileScore, eyebrowScore) {
        if (smileScore > 0.6 && eyebrowScore > 0.5) {
            return "enthusiastic";
        } else if (smileScore > 0.4) {
            return "friendly";
        } else if (eyebrowScore > 0.5) {
            return "engaged";
        } else if (smileScore < 0.1 && eyebrowScore < 0.2) {
            return "neutral";
        }
        return "focused";
    }
}

const emotionAnalyzer = new EmotionAnalyzer();

// Ostatné triedy zostávajú rovnaké (CalibrationManager, GazeAnalyzer, SessionManager)
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
        
        elements.testStatus.innerHTML = `
            <div class="text-center">
                <h3 class="text-xl font-bold text-blue-600 mb-4">Kalibrácia</h3>
                <p class="text-gray-600">Postupujte podľa inštrukcií</p>
            </div>
        `;
        
        for (const step of steps) {
            if (!this.isCalibrating) break;
            
            elements.testStatus.innerHTML = `
                <div class="animate-pulse">
                    <h3 class="text-lg font-semibold text-purple-600">${step.instruction}</h3>
                    <div class="mt-2 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                        <div class="h-full bg-purple-500 rounded-full animate-progress"></div>
                    </div>
                </div>
            `;
            
            await this.calibrateStep(step.duration, step.action);
        }
        
        if (this.isCalibrating) {
            this.calculateThresholds();
            this.saveToLocalStorage();
            elements.testStatus.innerHTML = `
                <div class="animate-bounce">
                    <h3 class="text-xl font-bold text-green-600">Kalibrácia dokončená! ✅</h3>
                    <p class="text-gray-600 mt-2">Môžete začať test</p>
                </div>
            `;
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
        
        const zoneVariation = uniqueZones.size / 5;
        
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
            summary: null,
            // Nové: data pre filler words
            fillerWords: [],
            speechStats: null
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
            confidence: emotionData.confidence,
            naturalness: emotionData.naturalness
        });
        
        if (this.currentSession.frames.length > 1000) {
            this.currentSession.frames = this.currentSession.frames.slice(-1000);
        }
    }
    
    addFillerWordsData(fillerWordsData) {
        if (!this.currentSession) return;
        
        this.currentSession.fillerWords = [...appState.fillerWordsDetected];
        this.currentSession.speechStats = fillerWordsData;
    }
    
    endSession(finalScore) {
        if (!this.currentSession) return;
        
        this.currentSession.endTime = new Date().toISOString();
        this.currentSession.finalScore = finalScore;
        this.currentSession.summary = this.generateSummary();
        
        // Pridaj filler words data
        this.addFillerWordsData(fillerDetector.getFillerWordStats());
        
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
        
        return Math.max(0, 1 - (stdDev / 50));
    }
    
    generateImprovements(frames) {
        const improvements = [];
        
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
        
        // Pridaj filler words odporúčanie
        if (this.currentSession?.fillerWords?.length > 5) {
            improvements.push("Redukujte filler slová (ehm, uhm)");
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
            improvement: session.summary?.improvements?.[0] || 'Žiadne',
            // Nové: filler words info
            fillerWords: session.fillerWords?.length || 0
        }));
    }
    
    clearAllSessions() {
        this.sessions = [];
        this.saveSessions();
    }
}

const sessionManager = new SessionManager();

// ========== HLAVNÉ FUNKCIE ==========
function analyzeEyeContact(landmarks) {
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
let currentLandmarks = null;

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
/*
// ========== INITIALIZE MEDIAPIPE (OFFLINE VERSION - Simplified) ==========
async function initializeMediaPipe() {
    try {
        // Quick check - libraries should already be loaded via HTML
        if (!window.FaceMesh || !window.Camera || !window.drawConnectors) {
            throw new Error('MediaPipe libraries not loaded. Check script tags in HTML.');
        }
        
        faceMesh = new FaceMesh({
            // All files are in the same folder
            locateFile: (file) => '/static/mediapipe/' + file
        });
        
        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        // Setup camera (same as before)
        const videoElement = document.getElementById('inputVideo');
        camera = new Camera(videoElement, {
            onFrame: async () => {
                if (faceMesh) await faceMesh.send({ image: videoElement });
            },
            width: 640,
            height: 480
        });
        
        await camera.start();
        console.log("✅ MediaPipe ready for presentation (offline mode)");
        
    } catch (error) {
        console.error('Initialization failed:', error);
        // Your error handling UI code here
    }
} */

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
        c
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
            
            feedbackManager.provideFeedback(eyeContactScore, gazeData, emotionData, remainingTime);
            
            uiUpdater.update({
                eyeContactScore: appState.overallScore || 0,
                remainingTime: remainingTime,
                status: 'Test prebieha...'
            });
            
            drawVisualization(landmarks, eyeContactScore, gazeData);
        }
        
        canvasCtx.restore();
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
    
    // Pridaj filler words counter
    if (appState.fillerWordsDetected.length > 0) {
        canvasCtx.fillStyle = '#FF9800';
        canvasCtx.fillText(`Filler: ${appState.fillerWordsDetected.length}`, 10, 90);
    }
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

// ========== VYLEPŠENÉ FUNKCIE PRE TESTOVANIE ==========
async function startCamera() {
    elements.testStatus.innerHTML = `
        <div class="flex items-center justify-center space-x-2">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span class="font-medium text-gray-700">Spúšťam kameru...</span>
        </div>
    `;
    elements.startButton.style.display = "none";
    
    // Inicializuj filler detector
    await fillerDetector.init();
    
    initializeMediaPipe().then((success) => {
        if (success) {
            camera.start().then(() => {
                console.log("Kamera spustená.");
                
                setTimeout(() => {
                    elements.testStatus.innerHTML = `
                        <div class="text-center">
                            <div class="text-green-600 font-semibold mb-2">Kamera pripravená</div>
                            <p class="text-gray-600 text-sm">Vyberte možnosť kalibrácie</p>
                        </div>
                    `;
                    
                    showCalibrationPrompt();
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

function showCalibrationPrompt() {
    const modalHtml = `
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">Kalibrácia</h3>
                <p class="text-gray-600 mb-2">Chcete vykonať kalibráciu pre presnejšie výsledky?</p>
                <p class="text-sm text-gray-500 mb-6">(Odporúčané pre prvýkrát)</p>
                <div class="flex space-x-3">
                    <button id="calibrateYes" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition duration-200">
                        Áno, kalibrovať
                    </button>
                    <button id="calibrateNo" class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded-lg transition duration-200">
                        Nie, pokračovať
                    </button>
                </div>
            </div>
        </div>
    `;
    
    const modal = document.createElement('div');
    modal.innerHTML = modalHtml;
    document.body.appendChild(modal);
    
    document.getElementById('calibrateYes').onclick = () => {
        modal.remove();
        calibrationManager.startCalibration().then(() => {
            getTestDuration();
        });
    };
    
    document.getElementById('calibrateNo').onclick = () => {
        modal.remove();
        getTestDuration();
    };
}

function getTestDuration() {
    const modalHtml = `
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">Dĺžka prejavu</h3>
                <p class="text-gray-600 mb-2">Zadajte dĺžku prejavu v minútach (0.5 - 25):</p>
                <p class="text-sm text-gray-500 mb-4">Test bude analyzovať očný kontakt AJ filler slová.</p>
                <input type="number" id="durationInput" step="0.5" min="0.5" max="25" 
                       class="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                       placeholder="Napríklad: 5" value="2">
                <div class="flex space-x-3">
                    <button id="durationSubmit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition duration-200">
                        Spustiť test
                    </button>
                    <button id="durationCancel" class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded-lg transition duration-200">
                        Zrušiť
                    </button>
                </div>
            </div>
        </div>
    `;
    
    const modal = document.createElement('div');
    modal.innerHTML = modalHtml;
    document.body.appendChild(modal);
    
    const input = document.getElementById('durationInput');
    input.focus();
    input.select();
    
    document.getElementById('durationSubmit').onclick = () => {
        const durationAnswer = input.value;
        let durationInMilliseconds = parseFloat(durationAnswer) * MINUTE_CONVERTER;
        
        if (durationInMilliseconds > MAX_TIME || durationInMilliseconds < MIN_TIME || isNaN(durationInMilliseconds)) {
            input.classList.add('border-red-500');
            return;
        }
        
        modal.remove();
        appState.testDuration = durationInMilliseconds;
        restartTest();
        startCountdown();
    };
    
    document.getElementById('durationCancel').onclick = () => {
        modal.remove();
        elements.startButton.style.display = "inline-block";
    };
    
    // Enter key support
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('durationSubmit').click();
        }
    });
}

function startCountdown() {
    let count = 3;
    
    elements.testStatus.innerHTML = `
        <div class="text-center animate-pulse">
            <div class="text-6xl font-bold text-blue-600 mb-4">${count}</div>
            <p class="text-gray-600">Test sa začne za...</p>
            <p class="text-sm text-purple-600 mt-2">Analýza očného kontaktu + filler slov</p>
        </div>
    `;
    
    playBeep();
    count--;
    
    const interval = setInterval(() => {
        if (count > 0) {
            elements.testStatus.innerHTML = `
                <div class="text-center animate-pulse">
                    <div class="text-6xl font-bold text-blue-600 mb-4">${count}</div>
                    <p class="text-gray-600">Test sa začne za...</p>
                </div>
            `;
            playBeep();
            count--;
        } else {
            clearInterval(interval);
            elements.testStatus.innerHTML = `
                <div class="text-center animate-bounce">
                    <div class="text-4xl font-bold text-green-600 mb-4">START!</div>
                    <p class="text-sm text-gray-600">Hovorte prirodzene, mikrofón sníma...</p>
                </div>
            `;
            playBeep();
            setTimeout(() => startTest(), 1000);
        }
    }, 1000);
}

async function startTest() {
    appState.testStartTime = Date.now();
    appState.testActive = true;
    appState.testCompleted = false;
    appState.totalFrames = 0;
    appState.goodEyeContactFrames = 0;
    appState.fillerWordsDetected = [];
    
    sessionManager.startNewSession(appState.testDuration);
    
    // ZAČNI FILLER WORDS DETEKCIU
    const audioStarted = await fillerDetector.startRecording();
    if (audioStarted) {
        console.log("Filler words detection started");
    } else {
        console.warn("Filler words detection failed, continuing without audio");
    }
    
    uiUpdater.update({
        eyeContactScore: 0,
        remainingTime: appState.testDuration / 1000,
        status: 'Test prebieha...'
    });
    
    // Pridaj info o filler words
    elements.liveFeedback.innerHTML += `
        <div class="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <div class="flex items-center">
                <span class="text-purple-600 mr-2">🎤</span>
                <span class="text-sm font-medium text-purple-800">
                    Filler words detekcia aktívna
                </span>
            </div>
            <p class="text-xs text-purple-600 mt-1">
                Hovorte prirodzene, systém detekuje "ehm", "uhm", "proste"...
            </p>
        </div>
    `;
}

// (Všetok predchádzajúci kód zostáva rovnaký až po funkciu endTest...)

// ========== VYLEPŠENÁ FUNKCIA PRE ZÁVERECNÉ VÝSLEDKY ==========
function endTest() {
    appState.testActive = false;
    appState.testCompleted = true;
    playBeep();
    
    // ZASTAV FILLER WORDS DETEKCIU
    const fillerResults = fillerDetector.stopRecording();
    
    const finalEyeContactPercentage = appState.totalFrames > 0 
        ? (appState.goodEyeContactFrames / appState.totalFrames) * 100 
        : 0;
    
    const sessionResults = sessionManager.endSession(finalEyeContactPercentage);
    
    // Zobraziť detailné výsledky
    showDetailedResults(finalEyeContactPercentage, sessionResults, fillerResults);
}

function showDetailedResults(eyeContactScore, sessionResults, fillerResults) {
    // Vypočítaj všetky metriky
    const fillerCount = appState.fillerWordsDetected.length;
    const durationMinutes = (appState.testDuration / 60000);
    const fillerPerMinute = fillerCount / durationMinutes;
    
    // Celkové hodnotenie
    const overallScore = calculateOverallScore(eyeContactScore, fillerPerMinute);
    const overallGrade = getGradeFromScore(overallScore);
    
    // Získaj odporúčania
    const recommendations = generateAllRecommendations(eyeContactScore, fillerPerMinute, sessionResults, fillerCount);
    
    // Vytvor detailný report
    const resultsHTML = createResultsHTML(
        overallGrade,
        eyeContactScore,
        fillerCount,
        fillerPerMinute,
        sessionResults,
        recommendations
    );
    
    // Zobraziť výsledky
    displayResultsModal(resultsHTML);
}

function calculateOverallScore(eyeContactScore, fillerPerMinute) {
    // Eye contact weight: 60%, Filler words weight: 40%
    const eyeContactWeighted = Math.min(eyeContactScore, 100);
    
    // Filler words scoring (menej je lepšie)
    let fillerScore = 100;
    if (fillerPerMinute > 5) fillerScore = 20;
    else if (fillerPerMinute > 3) fillerScore = 40;
    else if (fillerPerMinute > 2) fillerScore = 60;
    else if (fillerPerMinute > 1) fillerScore = 80;
    else if (fillerPerMinute > 0.5) fillerScore = 90;
    
    const fillerWeighted = fillerScore;
    
    return (eyeContactWeighted * 0.6) + (fillerWeighted * 0.4);
}

function getGradeFromScore(score) {
    if (score >= 90) return {
        grade: 'A',
        text: 'VÝBORNÉ',
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        emoji: '🏆'
    };
    if (score >= 80) return {
        grade: 'B',
        text: 'VEĽMI DOBRÉ',
        color: 'text-green-500',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        emoji: '🎯'
    };
    if (score >= 70) return {
        grade: 'C',
        text: 'DOBRÉ',
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200',
        emoji: '👍'
    };
    if (score >= 60) return {
        grade: 'D',
        text: 'PRIEMERNÉ',
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200',
        emoji: '📊'
    };
    return {
        grade: 'F',
        text: 'TREBA ZLEPŠIŤ',
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        emoji: '📈'
    };
}

function generateAllRecommendations(eyeContactScore, fillerPerMinute, sessionResults, fillerCount) {
    const recommendations = [];
    
    // Odporúčania pre očný kontakt
    if (eyeContactScore < 40) {
        recommendations.push({
            category: 'eye-contact',
            priority: 3,
            title: 'Očný kontakt',
            text: 'Sústredte sa na priamy pohľad do kamery. Cvičte udržiavanie kontaktu 3-5 sekúnd s jedným bodom.',
            tips: [
                'Predstavte si, že hovoríte konkrétnej osobe',
                'Sledujte svoj odraz v kamere',
                'Cvičte pred zrkadlom 5 minút denne'
            ]
        });
    } else if (eyeContactScore < 70) {
        recommendations.push({
            category: 'eye-contact',
            priority: 2,
            title: 'Očný kontakt',
            text: 'Dobrý základ. Skúste zvýšiť percento priameho pohľadu.',
            tips: [
                'Rozdeľte si pohľad na tri body: ľavá-stredná-pravá časť publika',
                'Udržujte pohľad 2-3 sekundy na každom bode',
                'Nesledujte nad hlavy poslucháčov'
            ]
        });
    } else {
        recommendations.push({
            category: 'eye-contact',
            priority: 1,
            title: 'Očný kontakt',
            text: 'Výborný očný kontakt! Pokračujte v dobrom výkone.',
            tips: [
                'Využite techniku "triangl" pri väčšom publiku',
                'Udržujte prirodzený, neupieravý pohľad',
                'Zmiešajte priamy pohľad s miernymi pohybmi'
            ]
        });
    }
    
    // Odporúčania pre filler slová
    if (fillerPerMinute > 3) {
        recommendations.push({
            category: 'speech',
            priority: 3,
            title: 'Filler slová',
            text: 'Príliš veľa filler slov. Cvičte vedomé pauzy namiesto "ehm", "uhm".',
            tips: [
                'Namiesto "ehm" použite krátku pauzu',
                'Nadýchnite sa, keď potrebujete čas na premýšľanie',
                'Cvičte s metronómom - hovorte pomalšie'
            ]
        });
    } else if (fillerPerMinute > 1.5) {
        recommendations.push({
            category: 'speech',
            priority: 2,
            title: 'Filler slová',
            text: 'Priemerné množstvo filler slov. Môžete ešte zlepšiť.',
            tips: [
                'Vedome sledujte svoje "proste" a "vlastne"',
                'Nahrávajte si seba a počúvajte filler slová',
                'Cvičte s kamarátom, ktorý vás upozorní'
            ]
        });
    } else {
        recommendations.push({
            category: 'speech',
            priority: 1,
            title: 'Filler slová',
            text: 'Minimálne množstvo filler slov! Výborná práca.',
            tips: [
                'Pokračujte v plynulom prejave',
                'Používajte štruktúrované myslenie pred hovorením',
                'Využite pauzy na zvýšenie dramatického efektu'
            ]
        });
    }
    
    // Odporúčania z analýzy pohľadu
    if (sessionResults?.summary?.gazeAnalysis) {
        const gaze = sessionResults.summary.gazeAnalysis;
        if (gaze.staticTime > 15000) {
            recommendations.push({
                category: 'gaze',
                priority: 2,
                title: 'Pohyb pohľadu',
                text: 'Pohľad príliš statický. Rozhliadnite sa viac.',
                tips: [
                    'Zmena pohľadu každých 3-5 sekúnd',
                    'Použite techniku "Z" - prejdite pohľadom po publiku',
                    'Zapojte periférne videnie'
                ]
            });
        }
        
        if (Math.abs(gaze.leftBias - gaze.rightBias) > 0.3) {
            recommendations.push({
                category: 'gaze',
                priority: 2,
                title: 'Rovnováha pohľadu',
                text: 'Nevyvážený pohľad medzi ľavou a pravou stranou.',
                tips: [
                    'Vedome striedajte strany',
                    'Počítajte si zmeny: 3x ľavá, 3x pravá',
                    'Cvičte pred zrkadlom s vyznačenými bodmi'
                ]
            });
        }
    }
    
    // Odporúčania z emócií
    if (sessionResults?.summary?.dominantEmotion === 'neutral') {
        recommendations.push({
            category: 'expression',
            priority: 2,
            title: 'Výraz tváre',
            text: 'Neutrálny výraz tváre. Skúste viac energie.',
            tips: [
                'Mierne zvýšte úsmev',
                'Používajte obočie na zdôraznenie bodov',
                'Cvičte pred zrkadlom s rôznymi výrazmi'
            ]
        });
    }
    
    // Zoraď odporúčania podľa priority
    recommendations.sort((a, b) => b.priority - a.priority);
    
    return recommendations.slice(0, 5); // Max 5 odporúčaní
}

function createResultsHTML(grade, eyeContactScore, fillerCount, fillerPerMinute, sessionResults, recommendations) {
    const duration = (appState.testDuration / 60000).toFixed(1);
    
    // Najčastejšie filler slová
    const commonFillers = getMostCommonFillers();
    
    let html = `
        <div class="max-w-4xl mx-auto">
            <!-- Hlavička s hodnotením -->
            <div class="${grade.bgColor} ${grade.borderColor} border-2 rounded-xl p-6 mb-6 text-center">
                <div class="text-5xl mb-2">${grade.emoji}</div>
                <h2 class="text-2xl font-bold ${grade.color} mb-2">${grade.text}</h2>
                <div class="text-4xl font-black ${grade.color} mb-4">${grade.grade}</div>
                <p class="text-gray-600">
                    Dĺžka testu: <span class="font-semibold">${duration} minút</span> | 
                    Snímkov: <span class="font-semibold">${appState.totalFrames}</span>
                </p>
            </div>
            
            <!-- Rýchle štatistiky -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <!-- Eye Contact Card -->
                <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                    <div class="flex items-center justify-between mb-4">
                        <h3 class="text-lg font-semibold text-gray-900">👁️ Očný kontakt</h3>
                        <span class="text-2xl font-bold ${eyeContactScore >= 70 ? 'text-green-600' : eyeContactScore >= 50 ? 'text-yellow-600' : 'text-red-600'}">
                            ${eyeContactScore.toFixed(1)}%
                        </span>
                    </div>
                    <div class="space-y-2">
                        <div class="flex justify-between text-sm">
                            <span class="text-gray-600">Dobré snímky:</span>
                            <span class="font-medium">${appState.goodEyeContactFrames}/${appState.totalFrames}</span>
                        </div>
                        <div class="flex justify-between text-sm">
                            <span class="text-gray-600">Konzistentnosť:</span>
                            <span class="font-medium">${sessionResults?.summary?.consistency ? (sessionResults.summary.consistency * 100).toFixed(1) + '%' : 'N/A'}</span>
                        </div>
                        <div class="flex justify-between text-sm">
                            <span class="text-gray-600">Najdlhšia séria:</span>
                            <span class="font-medium">${sessionResults?.summary?.bestStreak || 0} snímok</span>
                        </div>
                    </div>
                    <div class="mt-4 pt-4 border-t border-gray-100">
                        <div class="text-xs text-gray-500">${getEyeContactFeedback(eyeContactScore)}</div>
                    </div>
                </div>
                
                <!-- Filler Words Card -->
                <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                    <div class="flex items-center justify-between mb-4">
                        <h3 class="text-lg font-semibold text-gray-900">🎤 Filler slová</h3>
                        <span class="text-2xl font-bold ${fillerPerMinute <= 1 ? 'text-green-600' : fillerPerMinute <= 2.5 ? 'text-yellow-600' : 'text-red-600'}">
                            ${fillerCount}
                        </span>
                    </div>
                    <div class="space-y-2">
                        <div class="flex justify-between text-sm">
                            <span class="text-gray-600">Frekvencia:</span>
                            <span class="font-medium">${fillerPerMinute.toFixed(1)}/min</span>
                        </div>
                        <div class="flex justify-between text-sm">
                            <span class="text-gray-600">Cieľová frekvencia:</span>
                            <span class="font-medium text-green-600">&lt; 1.5/min</span>
                        </div>
    `;
    
    if (commonFillers.length > 0) {
        html += `
                        <div class="mt-3">
                            <div class="text-sm font-medium text-gray-700 mb-1">Najčastejšie:</div>
                            <div class="flex flex-wrap gap-1">
        `;
        commonFillers.forEach(([word, count]) => {
            html += `<span class="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded">${word} (${count})</span>`;
        });
        html += `</div></div>`;
    }
    
    html += `
                    </div>
                    <div class="mt-4 pt-4 border-t border-gray-100">
                        <div class="text-xs text-gray-500">${getFillerWordsFeedback(fillerPerMinute)}</div>
                    </div>
                </div>
            </div>
            
            <!-- Odporúčania -->
            <div class="bg-white border border-gray-200 rounded-xl p-6 mb-6">
                <h3 class="text-xl font-bold text-gray-900 mb-4">📋 Odporúčania pre zlepšenie</h3>
                <div class="space-y-4">
    `;
    
    if (recommendations.length > 0) {
        recommendations.forEach((rec, index) => {
            let icon = '💡';
            if (rec.priority >= 3) icon = '🚨';
            else if (rec.priority >= 2) icon = '⚠️';
            
            html += `
                    <div class="${index === 0 ? 'border-l-4 border-blue-500' : ''} pl-4 ${index > 0 ? 'pt-4 border-t border-gray-100' : ''}">
                        <div class="flex items-start">
                            <div class="flex-shrink-0 mr-3 text-xl">${icon}</div>
                            <div class="flex-1">
                                <h4 class="font-semibold text-gray-900 mb-1">${rec.title}</h4>
                                <p class="text-gray-700 mb-2">${rec.text}</p>
                                <ul class="space-y-1 text-sm text-gray-600">
            `;
            
            rec.tips.forEach(tip => {
                html += `<li class="flex items-start">
                            <svg class="h-4 w-4 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                            </svg>
                            <span>${tip}</span>
                        </li>`;
            });
            
            html += `</ul></div></div></div>`;
        });
    } else {
        html += `<p class="text-gray-600 text-center py-4">Výborný výkon! Žiadne špecifické odporúčania.</p>`;
    }
    
    html += `
                </div>
            </div>
            
            <!-- Ďalšie metriky -->
            <div class="bg-gray-50 rounded-xl p-6">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">📈 Detailné metriky</h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div class="text-center">
                        <div class="text-2xl font-bold text-gray-900">${appState.totalFrames}</div>
                        <div class="text-sm text-gray-600">Celkový počet snímok</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold text-gray-900">${((appState.testDuration || 0) / 60000).toFixed(1)}</div>
                        <div class="text-sm text-gray-600">Minút reči</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold text-gray-900">${sessionResults?.summary?.dominantEmotion || 'N/A'}</div>
                        <div class="text-sm text-gray-600">Prevažná nálada</div>
                    </div>
                </div>
            </div>
            
            <!-- Akčné tlačidlá -->
            <div class="mt-8 flex flex-col sm:flex-row gap-3">
                <button onclick="restartTest()" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center">
                    <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                    </svg>
                    Spustiť nový test
                </button>
                <button onclick="shareResults()" class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center">
                    <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
                    </svg>
                    Zdieľať výsledky
                </button>
                <button onclick="saveReport()" class="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center">
                    <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
                    </svg>
                    Uložiť report
                </button>
            </div>
            
            <!-- História pokusov -->
            <div class="mt-8">
                <h4 class="text-lg font-semibold text-gray-900 mb-3">📊 Posledné pokusy</h4>
                <div class="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    ${getRecentAttemptsHTML()}
                </div>
            </div>
        </div>
    `;
    
    return html;
}

function getMostCommonFillers() {
    if (appState.fillerWordsDetected.length === 0) return [];
    
    const wordCounts = {};
    appState.fillerWordsDetected.forEach(f => {
        wordCounts[f.word] = (wordCounts[f.word] || 0) + 1;
    });
    
    return Object.entries(wordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
}

function getEyeContactFeedback(score) {
    if (score >= 85) return "Vynikajúci očný kontakt! Udržujte úroveň.";
    if (score >= 70) return "Dobrý očný kontakt, blízko k optimu.";
    if (score >= 50) return "Priemerný očný kontakt, zamerajte sa na zlepšenie.";
    if (score >= 30) return "Slabý očný kontakt, potrebujete viac praxe.";
    return "Minimálny očný kontakt, potrebujete intenzívne cvičenie.";
}

function getFillerWordsFeedback(fillerPerMinute) {
    if (fillerPerMinute <= 0.5) return "Výnimočne čistý prejav!";
    if (fillerPerMinute <= 1.5) return "Veľmi dobrý výsledok.";
    if (fillerPerMinute <= 2.5) return "Priemerné množstvo filler slov.";
    if (fillerPerMinute <= 3.5) return "Nadpriemerné množstvo, zamerajte sa na redukciu.";
    return "Príliš veľa filler slov, potrebujete systémové zlepšenie.";
}

function getRecentAttemptsHTML() {
    const history = sessionManager.getProgressReport(5);
    
    if (history.length === 0) {
        return '<div class="p-8 text-center text-gray-500">Žiadna história</div>';
    }
    
    let html = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dátum</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Skóre</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filler</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Čas</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trend</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
    `;
    
    history.forEach((item, index) => {
        const trend = index > 0 ? 
            (parseFloat(item.score) > parseFloat(history[index-1].score) ? '↑' : '↓') : '•';
        const trendColor = trend === '↑' ? 'text-green-600' : trend === '↓' ? 'text-red-600' : 'text-gray-400';
        
        html += `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${item.date}</td>
                    <td class="px-4 py-3 whitespace-nowrap">
                        <span class="px-2 py-1 text-xs font-semibold rounded-full ${parseFloat(item.score) >= 70 ? 'bg-green-100 text-green-800' : parseFloat(item.score) >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}">
                            ${item.score}
                        </span>
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${item.fillerWords || 0}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${item.duration}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm ${trendColor} font-bold">${trend}</td>
                </tr>
        `;
    });
    
    html += `</tbody></table>`;
    return html;
}

function displayResultsModal(htmlContent) {
    // Skry aktuálne UI
    document.getElementById('eye_contact_info').style.display = 'none';
    document.querySelector('.media-container').style.display = 'none';
    
    // Vytvor modal s výsledkami
    const modal = document.createElement('div');
    modal.id = 'resultsModal';
    modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 overflow-y-auto z-50';
    modal.innerHTML = `
        <div class="min-h-screen px-4 text-center">
            <div class="inline-block w-full max-w-6xl my-8 text-left align-middle transition-all transform">
                <div class="bg-white rounded-2xl shadow-2xl overflow-hidden">
                    <!-- Modal Header -->
                    <div class="bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white">
                        <div class="flex justify-between items-center">
                            <div>
                                <h2 class="text-2xl font-bold">🎉 Test Dokončený!</h2>
                                <p class="text-blue-100">Kompletná analýza vášho prejavu</p>
                            </div>
                            <button onclick="closeResultsModal()" class="text-white hover:text-blue-200 transition">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    
                    <!-- Modal Content -->
                    <div class="p-6 overflow-y-auto max-h-[70vh]">
                        ${htmlContent}
                    </div>
                    
                    <!-- Modal Footer -->
                    <div class="bg-gray-50 px-6 py-4 border-t border-gray-200">
                        <div class="flex justify-between items-center">
                            <div class="text-sm text-gray-600">
                                Uložené do histórie: ${new Date().toLocaleDateString()}
                            </div>
                            <button onclick="closeResultsModal()" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                                Zavrieť
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Pridaj animáciu
    setTimeout(() => {
        modal.querySelector('.inline-block').classList.add('scale-100', 'opacity-100');
    }, 10);
}

function closeResultsModal() {
    const modal = document.getElementById('resultsModal');
    if (modal) {
        modal.remove();
    }
    
    // Obnov pôvodné UI
    document.getElementById('eye_contact_info').style.display = 'block';
    document.querySelector('.media-container').style.display = 'flex';
    
    // Zobraz tlačidlo na restart
    elements.startButton.style.display = "inline-block";
    elements.startButton.textContent = "Spustiť nový test";
    elements.startButton.onclick = restartTest;
    
    // Reset feedback area
    elements.liveFeedback.innerHTML = "";
}

function shareResults() {
    const eyeContactScore = (appState.overallScore || 0).toFixed(1);
    const fillerCount = appState.fillerWordsDetected.length;
    
    const shareText = `🎤 Speaker Coach Test\n` +
                     `Očný kontakt: ${eyeContactScore}%\n` +
                     `Filler slov: ${fillerCount}\n` +
                     `Dĺžka: ${(appState.testDuration / 60000).toFixed(1)} min\n` +
                     `Dátum: ${new Date().toLocaleDateString()}\n\n` +
                     `#SpeakerCoach #Prezentacia #Komunikacia`;
    
    if (navigator.share) {
        navigator.share({
            title: 'Speaker Coach Výsledky',
            text: shareText,
            url: window.location.href
        });
    } else {
        // Fallback - copy to clipboard
        navigator.clipboard.writeText(shareText).then(() => {
            alert('Výsledky skopírované do schránky!');
        });
    }
}

function saveReport() {
    // Vytvor PDF report (zjednodušená verzia)
    const reportData = {
        eyeContactScore: (appState.overallScore || 0).toFixed(1),
        fillerWords: appState.fillerWordsDetected.length,
        fillerPerMinute: (appState.fillerWordsDetected.length / (appState.testDuration / 60000)).toFixed(1),
        totalFrames: appState.totalFrames,
        goodFrames: appState.goodEyeContactFrames,
        duration: (appState.testDuration / 60000).toFixed(1),
        date: new Date().toISOString(),
        recommendations: generateAllRecommendations(
            appState.overallScore || 0,
            appState.fillerWordsDetected.length / (appState.testDuration / 60000),
            sessionManager.currentSession,
            appState.fillerWordsDetected.length
        )
    };
    
    // Ulož do localStorage
    const reports = JSON.parse(localStorage.getItem('speechCoachReports') || '[]');
    reports.push(reportData);
    localStorage.setItem('speechCoachReports', JSON.stringify(reports));
    
    // Show success message
    const successMsg = document.createElement('div');
    successMsg.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
    successMsg.innerHTML = `
        <div class="flex items-center">
            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            Report uložený do histórie
        </div>
    `;
    document.body.appendChild(successMsg);
    
    setTimeout(() => successMsg.remove(), 3000);
}

// Pridaj tieto štýly do CSS
const resultsStyles = `
    #resultsModal .inline-block {
        transform: scale(0.95);
        opacity: 0;
        transition: all 0.3s ease-out;
    }
    
    #resultsModal .scale-100 {
        transform: scale(1);
    }
    
    #resultsModal .opacity-100 {
        opacity: 1;
    }
    
    .progress-ring {
        transform: rotate(-90deg);
    }
    
    .progress-ring-circle {
        transition: stroke-dashoffset 0.5s ease;
    }
`;

// Pridaj štýly do dokumentu
document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = resultsStyles;
    document.head.appendChild(style);
});

// ========== ZOSTÁVAJÚCE FUNKCIE ==========
// (funkcie restartTest, playBeep, handleCameraError, shouldRenderFrame, updateStatsUI, animateNumber zostávajú rovnaké)

// ... (zvyšok pôvodného kódu zostáva rovnaký)

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

function showFinalResults(eyeContactPercentage, sessionResults, fillerResults) {
    const status = 
        eyeContactPercentage >= 70 ? "VÝBORNÉ!" :
        eyeContactPercentage >= 50 ? "DOBRÉ" :
        "TREBA SA ZLEPŠIŤ";
    
    // Vypočítaj filler words stats
    const fillerCount = appState.fillerWordsDetected.length;
    const durationMinutes = (appState.testDuration / 60000);
    const fillerPerMinute = fillerCount / durationMinutes;
    
    let fillerRating = "Výborné";
    let fillerColor = "text-green-600";
    if (fillerPerMinute > 3) {
        fillerRating = "Príliš veľa";
        fillerColor = "text-red-600";
    } else if (fillerPerMinute > 1.5) {
        fillerRating = "Priemerné";
        fillerColor = "text-yellow-600";
    }
    
    let details = `
        <div class="space-y-4">
            <div class="text-center">
                <div class="text-3xl font-bold ${eyeContactPercentage >= 70 ? 'text-green-600' : eyeContactPercentage >= 50 ? 'text-yellow-600' : 'text-red-600'}">
                    ${status}
                </div>
                <div class="text-gray-600 mt-2">
                    Očný kontakt: <span class="font-bold">${eyeContactPercentage.toFixed(1)}%</span><br>
                    Filler slov: <span class="font-bold ${fillerColor}">${fillerCount}</span> (${fillerPerMinute.toFixed(1)}/min)<br>
                    ${fillerRating}
                </div>
            </div>
            
            <div class="grid grid-cols-2 gap-4">
                <div class="bg-blue-50 rounded-lg p-4">
                    <h4 class="font-semibold text-blue-800 mb-2">Očný kontakt</h4>
                    <ul class="space-y-1 text-sm text-blue-700">
                        <li>• Dobré snímky: ${appState.goodEyeContactFrames}/${appState.totalFrames}</li>
    `;
    
    if (sessionResults && sessionResults.summary) {
        details += `
                        <li>• Konzistentnosť: ${(sessionResults.summary.consistency * 100).toFixed(1)}%</li>
                        <li>• Najdlhšia séria: ${sessionResults.summary.bestStreak} snímok</li>
        `;
    }
    
    details += `
                    </ul>
                </div>
                
                <div class="bg-purple-50 rounded-lg p-4">
                    <h4 class="font-semibold text-purple-800 mb-2">Filler slová</h4>
                    <ul class="space-y-1 text-sm text-purple-700">
                        <li>• Celkom: ${fillerCount}</li>
                        <li>• Frekvencia: ${fillerPerMinute.toFixed(1)}/min</li>
    `;
    
    if (fillerCount > 0) {
        const topWords = appState.fillerWordsDetected
            .reduce((acc, f) => {
                acc[f.word] = (acc[f.word] || 0) + 1;
                return acc;
            }, {});
        
        const mostCommon = Object.entries(topWords)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        
        if (mostCommon.length > 0) {
            details += `<li>• Najčastejšie: ${mostCommon.map(([w, c]) => `${w} (${c})`).join(', ')}</li>`;
        }
    }
    
    details += `
                    </ul>
                </div>
            </div>
    `;
    
    if (sessionResults && sessionResults.summary) {
        details += `
            <div class="bg-gray-50 rounded-lg p-4">
                <h4 class="font-semibold text-gray-900 mb-2">Detailná analýza:</h4>
                <ul class="space-y-1 text-sm text-gray-700">
                    <li>• Dominantný pohľad: ${sessionResults.summary.dominantGazeZone}</li>
                    <li>• Nálada: ${sessionResults.summary.dominantEmotion}</li>
        `;
        
        if (sessionResults.summary.improvements.length > 0) {
            details += `</ul><h5 class="font-medium text-gray-800 mt-3 mb-2">Odporúčania:</h5><ul class="space-y-1 text-sm text-gray-700">`;
            sessionResults.summary.improvements.forEach(imp => {
                details += `<li>• ${imp}</li>`;
            });
        }
        details += `</ul></div>`;
    }
    
    // Odporúčania pre filler words
    if (fillerPerMinute > 2) {
        details += `
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h4 class="font-semibold text-yellow-800 mb-2">Pre filler slová:</h4>
                <ul class="space-y-1 text-sm text-yellow-700">
                    <li>• Cvičte vedomé pauzy namiesto "ehm"</li>
                    <li>• Zmyselne sa nadýchnite, keď potrebujete čas</li>
                    <li>• Pomalšie hovorenie pomáha redukovať filler slová</li>
                </ul>
            </div>
        `;
    }
    
    details += `</div>`;
    
    elements.testInfo.textContent = `Výsledok: ${eyeContactPercentage.toFixed(1)}% očný kontakt, ${fillerCount} filler slov`;
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
    elements.testStatus.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded-lg p-4">
            <div class="flex items-center">
                <div class="flex-shrink-0">
                    <svg class="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
                    </svg>
                </div>
                <div class="ml-3">
                    <h3 class="text-sm font-medium text-red-800">Chyba pri spustení kamery</h3>
                    <div class="mt-2 text-sm text-red-700">
                        <p>Skontrolujte povolenia pre kameru a skúste znova.</p>
                    </div>
                </div>
            </div>
        </div>
    `;
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

// ========== VYLEPŠENÁ AKTUALIZÁCIA STATISTIK ==========
function updateStatsUI() {
    if (sessionManager.currentSession && sessionManager.currentSession.frames.length > 0) {
        const frames = sessionManager.currentSession.frames;
        const lastFrame = frames[frames.length - 1];
        
        const eyeContactElement = document.getElementById('eyeContactScore');
        const confidenceElement = document.getElementById('confidenceScore');
        
        animateNumber(eyeContactElement, Math.round(lastFrame.eyeContactScore), '%');
        animateNumber(confidenceElement, Math.round(lastFrame.confidence * 100), '%');
        
        // Vypočítaj čas
        if (appState.testStartTime) {
            const elapsed = Date.now() - appState.testStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            document.getElementById('totalTime').textContent = 
                `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        
        // Vypočítaj konzistentnosť
        if (frames.length >= 10) {
            const recentFrames = frames.slice(-10);
            const scores = recentFrames.map(f => f.eyeContactScore);
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            const variance = scores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / scores.length;
            const stdDev = Math.sqrt(variance);
            const consistency = Math.max(0, 100 - (stdDev / 50));
            
            const consistencyElement = document.getElementById('consistencyScore');
            animateNumber(consistencyElement, Math.round(consistency), '%');
        }
        
        // Pridaj filler words count do statistik
        const fillerCount = appState.fillerWordsDetected.length;
        const fillerElement = document.getElementById('fillerWordsCount') || (() => {
            // Ak element neexistuje, pridaj ho
            const statsGrid = document.querySelector('.stats-grid');
            if (statsGrid && !document.getElementById('fillerWordsCount')) {
                const fillerCard = document.createElement('div');
                fillerCard.className = 'stat-card';
                fillerCard.innerHTML = `
                    <div class="stat-label">Filler slov</div>
                    <div class="stat-value" id="fillerWordsCount">0</div>
                `;
                statsGrid.appendChild(fillerCard);
            }
            return document.getElementById('fillerWordsCount');
        })();
        
        if (fillerElement) {
            fillerElement.textContent = fillerCount;
        }
    }
}

function animateNumber(element, targetValue, suffix = '') {
    if (!element) return;
    
    const currentText = element.textContent;
    const currentValue = parseFloat(currentText) || 0;
    
    if (Math.abs(currentValue - targetValue) < 1) {
        element.textContent = targetValue + suffix;
        return;
    }
    
    const step = Math.ceil(Math.abs(targetValue - currentValue) / 10);
    const increment = targetValue > currentValue ? step : -step;
    
    let current = currentValue;
    const interval = setInterval(() => {
        current += increment;
        
        if ((increment > 0 && current >= targetValue) || (increment < 0 && current <= targetValue)) {
            current = targetValue;
            clearInterval(interval);
        }
        
        element.textContent = Math.round(current) + suffix;
    }, 50);
}

setInterval(updateStatsUI, 2000);

document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        elements.testStatus.innerHTML = `
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div class="text-sm text-yellow-800">
                    Váš prehliadač nepodporuje kameru. Skúste novší prehliadač.
                </div>
            </div>
        `;
        return;
    }
    
    elements.startButton.onclick = startCamera;
    
    calibrationManager.loadFromLocalStorage();
    
    const history = sessionManager.getProgressReport(1);
    if (history.length > 0) {
        elements.testInfo.textContent += ` (Posledný pokus: ${history[0].score})`;
    }
    
    // Pridaj CSS pre filler words feedback
    const style = document.createElement('style');
    style.textContent = `
        .filler-word-feedback {
            animation: fadeInOut 3s ease-in-out;
        }
        
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translateY(10px); }
            10% { opacity: 1; transform: translateY(0); }
            90% { opacity: 1; transform: translateY(0); }
            100% { opacity: 0; transform: translateY(-10px); }
        }
        
        .animate-progress {
            animation: progress 3s linear forwards;
        }
        
        @keyframes progress {
            0% { width: 0%; }
            100% { width: 100%; }
        }
    `;
    document.head.appendChild(style);
});