console.log("jej ide to", Date.now());

/* ---------------- DOM elementy ---------------- */
const elements = {
    startButton: document.getElementById("startButton"),
    calibrateButton: document.getElementById("calibrateButton"),
    stopButton: document.getElementById("stopButton"),
    canvas: document.getElementById("canvas"),
    video: document.getElementById("camera"),
    modal: document.getElementById("modal"),
    noButton: document.getElementById("noBtn"),
    yesButton: document.getElementById("yesBtn"),
    timerDisplay: document.querySelector(".text-4xl")
};

/* ---------------- stavy ---------------- */
const appState = {
    isCalibrated: false,
    modelIsLoaded: false,
    cameraLoaded: false,
    calibrationData: null,
    latestLandmarks: null,
    smoothedEye: null,
    sessionActive: false,
    sessionStart: null,
    gazeHistory: [],
    metrics: {},
    speech: {
        totalWords: 0,
        fillerCount: 0,
        pauseCount: 0,
        longPauses: [],
        wordsWithTiming: [],
        segments: [],
        transcript: [],
        startTime: null
    },
    audio: {
        mediaRecorder: null,
        stream: null,
        chunks: [],
        mimeType: null,
        finalTranscript: ""
    },
    analysis: null
};

const FILLER_WORDS = [
    "ehm", "em", "eh", "hm", "hmm", "mm", "mhm",
    "no", "nó", "akože", "akožeže",
    "vlastně", "vlastne", "vlastněže",
    "proste", "prosto", "prosteže"
];

/* ---------------- LANDMARKY ---------------- */
const LEFT_EYE_INDICES = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const NOSE_INDICES = [1, 168, 197];

const canvasCtx = elements.canvas.getContext("2d");
let faceMesh, camera;

/* ---------------- kamera ---------------- */
async function getMedia() {
    if (appState.cameraLoaded) return true;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        appState.cameraLoaded = true;
        return true;
    } catch (err) {
        console.error("Camera permission denied:", err);
        alert("Vyžaduje sa prístup ku kamere pre fungovanie aplikácie.");
        return false;
    }
}

/* ---------------- MEDIAPIPE ---------------- */
async function initializeMediaPipe() {
    if (appState.modelIsLoaded) return;

    faceMesh = new FaceMesh({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    faceMesh.onResults(handleResults);

    camera = new Camera(elements.video, {
        onFrame: async () => {
            await faceMesh.send({ image: elements.video });
        },
        width: 640,
        height: 480
    });

    await camera.start();
    appState.modelIsLoaded = true;
    console.log("MediaPipe ready");
}

/* ---------------- helpers ---------------- */
function getPoint(indices, landmarks) {
    let x = 0;
    let y = 0;
    let c = 0;

    for (const i of indices) {
        const p = landmarks[i];
        if (!p) continue;
        x += p.x;
        y += p.y;
        c++;
    }

    return c ? { x: x / c, y: y / c } : null;
}

function averagePoints(points) {
    const sum = points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
}

function getExtensionFromMimeType(mimeType = "") {
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg")) return "mp3";
    return "webm";
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCookie(name) {
    const cookies = document.cookie ? document.cookie.split(";") : [];
    for (let cookie of cookies) {
        cookie = cookie.trim();
        if (cookie.startsWith(name + "=")) {
            return decodeURIComponent(cookie.slice(name.length + 1));
        }
    }
    return null;
}

/* ---------------- kalibracia ---------------- */
async function calibrateUser() {
    if (!faceMesh) return alert("Model not ready");

    const dirs = [
        { key: "left", prompt: "Pozri VĽAVO" },
        { key: "right", prompt: "Pozri VPRAVO" },
        { key: "center", prompt: "Pozri STRED" },
        { key: "up", prompt: "Pozri HORE" },
        { key: "down", prompt: "Pozri DOLE" }
    ];

    const calibration = {};

    for (const d of dirs) {
        await showModal(d.prompt);
        const samples = [];

        while (samples.length < 15) {
            const lm = appState.latestLandmarks;
            if (lm) {
                const eye = getPoint(LEFT_EYE_INDICES, lm);
                const head = getPoint(NOSE_INDICES, lm);
                if (eye && head) {
                    samples.push({ x: eye.x - head.x, y: eye.y - head.y });
                }
            }
            await new Promise(r => setTimeout(r, 50));
        }

        calibration[d.key] = averagePoints(samples);
        console.log(d.key, calibration[d.key]);
    }

    appState.calibrationData = calibration;
    appState.isCalibrated = true;
    console.log("vykalibrovano", calibration);
}

/* ---------------- audio recording ---------------- */
async function startAudioRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        appState.audio.stream = stream;
        appState.audio.chunks = [];

        let mimeType = "";
        if (MediaRecorder.isTypeSupported("audio/webm")) {
            mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
            mimeType = "audio/mp4";
        } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
            mimeType = "audio/ogg";
        }

        const recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);

        appState.audio.mimeType = recorder.mimeType || mimeType || "audio/webm";
        appState.speech.startTime = Date.now();

        recorder.ondataavailable = event => {
            if (event.data && event.data.size > 0) {
                appState.audio.chunks.push(event.data);
            }
        };

        recorder.start();
        appState.audio.mediaRecorder = recorder;

        console.log("Audio recording started:", appState.audio.mimeType);
        return true;
    } catch (err) {
        console.error("Microphone permission denied:", err);
        alert("Vyžaduje sa prístup k mikrofónu pre fungovanie aplikácie.");
        return false;
    }
}

async function stopAudioRecordingAndUpload() {
    return new Promise((resolve, reject) => {
        const recorder = appState.audio.mediaRecorder;

        if (!recorder) {
            resolve(null);
            return;
        }

        recorder.onstop = async () => {
            try {
                const fullBlob = new Blob(appState.audio.chunks, {
                    type: appState.audio.mimeType || "audio/webm"
                });

                console.log("Final audio blob size:", fullBlob.size);

                if (fullBlob.size === 0) {
                    resolve("");
                    return;
                }

                const extension = getExtensionFromMimeType(fullBlob.type);
                const filename = `session_audio.${extension}`;

                const formData = new FormData();
                formData.append("file", fullBlob, filename);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000);

                const response = await fetch("/api/transcribe/", {
                    method: "POST",
                    body: formData,
                    headers: {
                        "X-CSRFToken": getCookie("csrftoken")
                    },
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                const data = await response.json();

                if (!response.ok) {
                    console.error("Transcription error:", data);
                    reject(data);
                    return;
                }

                const transcript = data.text || "";
                appState.audio.finalTranscript = transcript;

                appState.speech.pauseCount = data.pause_count || 0;
                appState.speech.longPauses = data.long_pauses || [];
                appState.speech.wordsWithTiming = data.words || [];
                appState.speech.segments = data.segments || [];

                console.log("Transcript:", transcript);
                console.log("Long pauses:", appState.speech.longPauses);

                resolve(transcript);
            } catch (err) {
                if (err.name === 'AbortError') {
                    console.error("Upload timed out");
                }
                reject(err);
            } finally {
                if (appState.audio.stream) {
                    appState.audio.stream.getTracks().forEach(track => track.stop());
                    appState.audio.stream = null;
                }
                appState.audio.mediaRecorder = null;
                appState.audio.chunks = [];
            }
        };

        recorder.stop();
    });
}

/* ---------------- transcript metrics ---------------- */
function processTranscriptForMetrics(text) {
    const cleanedText = text.toLowerCase().trim();

    const normalized = cleanedText
        .replace(/([a-záäčďéíĺľňóôŕšťúýž])\1{2,}/giu, "$1$1");

    const normalizedForPhraseMatch = normalized
        .replace(/[.,!?;:()"„“]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const words = normalizedForPhraseMatch
        .split(" ")
        .filter(Boolean)
        .map(w => w.replace(/[^\p{L}\p{N}]/gu, ""));

    appState.speech.totalWords = words.length;
    appState.speech.fillerCount = 0;
    appState.speech.transcript = [{ time: Date.now(), text }];

    words.forEach(w => {
        if (FILLER_WORDS.includes(w)) {
            appState.speech.fillerCount++;
        }
    });

    FILLER_WORDS
        .filter(f => f.includes(" "))
        .forEach(phrase => {
            const regex = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "giu");
            const matches = normalizedForPhraseMatch.match(regex) || [];
            appState.speech.fillerCount += matches.length;
        });
}

/* ---------------- voliteľná AI analyza ---------------- */
async function analyzeFullTranscript(transcript) {
    if (!transcript || !transcript.trim()) {
        appState.analysis = null;
        return null;
    }

    try {
        const response = await fetch("/api/analyze-transcript/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCookie("csrftoken")
            },
            body: JSON.stringify({
                transcript,
                context: {
                    language: "sk",
                    app: "speakercoach",
                    durationMs: Date.now() - appState.sessionStart,
                    gazeMetrics: appState.metrics?.percentages || null,
                    pauseCount: appState.speech.pauseCount || 0,
                    longPauses: appState.speech.longPauses || []
                }
            })
        });

        if (!response.ok) {
            console.warn("Analyze endpoint not ready or failed");
            appState.analysis = null;
            return null;
        }

        const data = await response.json();
        appState.analysis = data.analysis || null;
        return appState.analysis;
    } catch (err) {
        console.warn("Analyze transcript skipped:", err);
        appState.analysis = null;
        return null;
    }
}

/* ---------------- výpočet a uloženie session ---------------- */
function saveSessionMetrics() {
    const total = appState.gazeHistory.length;
    const counts = { LEFT: 0, RIGHT: 0, CENTER: 0, UP: 0, DOWN: 0 };

    appState.gazeHistory.forEach(g => {
        if (counts[g.gaze] !== undefined) counts[g.gaze]++;
    });

    const durationMs = Date.now() - appState.sessionStart;
    const minutes = durationMs / 60000;

    appState.metrics = {
        percentages: {
            LEFT: total ? counts.LEFT / total : 0,
            RIGHT: total ? counts.RIGHT / total : 0,
            CENTER: total ? counts.CENTER / total : 0,
            UP: total ? counts.UP / total : 0,
            DOWN: total ? counts.DOWN / total : 0
        },
        speech: {
            totalWords: appState.speech.totalWords,
            fillerWords: appState.speech.fillerCount,
            pauseCount: appState.speech.pauseCount,
            tempoWPM: minutes > 0
                ? Math.round(appState.speech.totalWords / minutes)
                : 0,
            fillerRatio: appState.speech.totalWords > 0
                ? appState.speech.fillerCount / appState.speech.totalWords
                : 0
        }
    };

    console.log("Stats:", appState.metrics);
}

async function persistSession() {
    try {
        const response = await fetch("/api/save-session/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCookie("csrftoken")
            },
            body: JSON.stringify({
                duration_ms: Date.now() - appState.sessionStart,
                gaze: appState.metrics?.percentages || {},
                speech: {
                    totalWords: appState.metrics?.speech?.totalWords || 0,
                    tempoWPM: appState.metrics?.speech?.tempoWPM || 0,
                    fillerCount: appState.metrics?.speech?.fillerWords || 0,
                    pauseCount: appState.speech?.pauseCount || 0,
                    fillerRatio: appState.metrics?.speech?.fillerRatio || 0
                },
                transcript: appState.audio.finalTranscript || "",
                analysis: appState.analysis || "",
                longPauses: appState.speech?.longPauses || [],
                rawMetrics: appState.metrics || {}
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Save session error:", data);
            return;
        }

        console.log("Session saved:", data);
    } catch (err) {
        console.error("Persist session failed:", err);
    }
}

/* ---------------- relacia ---------------- */
async function startSession() {
    if (!appState.isCalibrated) return alert("Najprv kalibruj oči.");

    appState.sessionActive = true;
    appState.sessionStart = Date.now();
    appState.gazeHistory = [];
    appState.smoothedEye = null;
    appState.metrics = {};
    appState.analysis = null;

    appState.speech.totalWords = 0;
    appState.speech.fillerCount = 0;
    appState.speech.pauseCount = 0;
    appState.speech.longPauses = [];
    appState.speech.wordsWithTiming = [];
    appState.speech.segments = [];
    appState.speech.transcript = [];

    appState.audio.chunks = [];
    appState.audio.finalTranscript = "";

    const audioReady = await startAudioRecording();
    if (!audioReady) {
        appState.sessionActive = false;
        return;
    }

    updateTimer();
    elements.canvas.classList.remove("hidden");
}

async function stopSession() {
    appState.sessionActive = false;

    try {
        const transcript = await stopAudioRecordingAndUpload();

        if (transcript) {
            processTranscriptForMetrics(transcript);
        }

        saveSessionMetrics();

        if (transcript) {
            await analyzeFullTranscript(transcript);
        }

        await persistSession();
    } catch (err) {
        console.error("Stop session failed:", err);
        saveSessionMetrics();
    }

    elements.canvas.classList.add("hidden");
    showResultsPanel();
}

/* ---------------- casovanie ---------------- */
function updateTimer() {
    if (!appState.sessionActive) return;

    const s = Math.floor((Date.now() - appState.sessionStart) / 1000);
    elements.timerDisplay.textContent =
        `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

    requestAnimationFrame(updateTimer);
}

/* ---------------- pohľad ---------------- */
function detectGaze(c, cal) {
    if (!cal || !cal.center || !cal.left || !cal.right || !cal.up || !cal.down) {
        return "CENTER";
    }

    // Pomocou euklidovskej vzdialenosti k uloženým kalibračným bodom klasifikujeme pohľad.
    // Stred trochu zvýhodníme (koeficientom), aby nebol pohľad zbytočne prchký
    const dists = {
        CENTER: Math.hypot(c.x - cal.center.x, c.y - cal.center.y) * 0.85,
        LEFT: Math.hypot(c.x - cal.left.x, c.y - cal.left.y),
        RIGHT: Math.hypot(c.x - cal.right.x, c.y - cal.right.y),
        UP: Math.hypot(c.x - cal.up.x, c.y - cal.up.y),
        DOWN: Math.hypot(c.x - cal.down.x, c.y - cal.down.y)
    };

    let bestGaze = "CENTER";
    let minDist = Infinity;

    for (const [gaze, dist] of Object.entries(dists)) {
        if (!isNaN(dist) && dist < minDist) {
            minDist = dist;
            bestGaze = gaze;
        }
    }

    return bestGaze;
}

/* ---------------- ramce ---------------- */
function handleResults(res) {
    if (!res.multiFaceLandmarks?.length) return;

    const lm = res.multiFaceLandmarks[0];
    appState.latestLandmarks = lm;

    canvasCtx.clearRect(0, 0, 640, 480);
    canvasCtx.drawImage(res.image, 0, 0, 640, 480);
    drawConnectors(canvasCtx, lm, FACEMESH_TESSELATION, { color: "#C0C0C070", lineWidth: 1 });

    if (!appState.sessionActive) return;

    const eye = getPoint(LEFT_EYE_INDICES, lm);
    const head = getPoint(NOSE_INDICES, lm);
    if (!eye || !head) return;

    const c = { x: eye.x - head.x, y: eye.y - head.y };
    appState.smoothedEye = appState.smoothedEye
        ? {
            x: appState.smoothedEye.x * 0.85 + c.x * 0.15,
            y: appState.smoothedEye.y * 0.85 + c.y * 0.15
        }
        : c;

    const gaze = detectGaze(appState.smoothedEye, appState.calibrationData);
    appState.gazeHistory.push({ time: Date.now(), gaze });
}

/* ---------------- vysledkovy panel ---------------- */
function showResultsPanel() {
    if (!appState.metrics.speech || !appState.metrics.percentages) {
        console.warn("No metrics available");
        return;
    }

    document.getElementById("resultsPanel")?.classList.remove("hidden");

    const s = appState.metrics.speech;
    const p = appState.metrics.percentages;
    const fillerCount = appState.speech.fillerCount || 0;
    const pauseCount = appState.speech.pauseCount || 0;
    const totalWords = s.totalWords || 1;

    ["Center", "Left", "Right", "Up", "Down"].forEach(dir => {
        const value = (p[dir.toUpperCase()] || 0) * 100;
        const bar = document.getElementById(`bar${dir}`);
        const span = document.getElementById(`bar${dir}Value`);
        if (bar) bar.style.width = `${value}%`;
        if (span) span.textContent = `${Math.round(value)}%`;
    });

    document.getElementById("wordCount").textContent = s.totalWords;
    document.getElementById("tempoWPM").textContent = s.tempoWPM;
    document.getElementById("fillerCount").textContent = s.fillerWords;

    const hesitationEl = document.getElementById("hesitationCount");
    if (hesitationEl) {
        hesitationEl.textContent = pauseCount;
    }

    const durationMs = Date.now() - appState.sessionStart;
    const mins = Math.floor(durationMs / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    document.getElementById("sessionTime").textContent =
        `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    const ctx = document.getElementById("hesitationGraph")?.getContext("2d");
    if (ctx) {
        const labels = appState.speech.longPauses.map((p, idx) => `Pauza ${idx + 1}`);
        const pauseDurations = appState.speech.longPauses.map(p => p.duration);

        if (window.hesitationChart) window.hesitationChart.destroy();

        window.hesitationChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [{
                    label: "Dĺžka pauzy (s)",
                    data: pauseDurations,
                    borderColor: "rgba(255,99,132,1)",
                    backgroundColor: "rgba(255,99,132,0.2)",
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: { title: { display: true, text: "Detegované dlhé pauzy" } },
                    y: { title: { display: true, text: "Sekundy" }, beginAtZero: true }
                }
            }
        });
    }

    updateFeedback();
}

/* ---------------- feedback ---------------- */
function updateFeedback() {
    const s = appState.metrics.speech;
    const p = appState.metrics.percentages;
    const fillerCount = appState.speech.fillerCount || 0;
    const pauseCount = appState.speech.pauseCount || 0;
    const totalWords = s.totalWords || 1;

    const tempoEl = document.getElementById("feedbackTempo");
    if (tempoEl) {
        if (s.tempoWPM < 80) {
            tempoEl.innerHTML = `Tempo reči: ${s.tempoWPM} WPM – Hovoríte pomaly, možno až príliš opatrne. Skúste hovoriť plynulejšie.`;
        } else if (s.tempoWPM <= 140) {
            tempoEl.innerHTML = `Tempo reči: ${s.tempoWPM} WPM – Skvelé tempo, pôsobíte sebavedomo.`;
        } else {
            tempoEl.innerHTML = `Tempo reči: ${s.tempoWPM} WPM – Hovoríte rýchlo, môže byť náročné sledovať.`;
        }
    }

    const fillerEl = document.getElementById("feedbackHesitations");
    if (fillerEl) {
        const fillerPercent = (fillerCount / totalWords * 100).toFixed(1);

        if (fillerPercent < 5) {
            fillerEl.innerHTML = `Parazitné slová: ${fillerCount} (${fillerPercent}%) – Veľmi čistý prejav.`;
        } else if (fillerPercent <= 15) {
            fillerEl.innerHTML = `Parazitné slová: ${fillerCount} (${fillerPercent}%) – Objavuje sa pár slovných výplní.`;
        } else {
            fillerEl.innerHTML = `Parazitné slová: ${fillerCount} (${fillerPercent}%) – Výplňové slová sa objavujú často.`;
        }
    }

    const pauseEl = document.getElementById("feedbackPauses");
    if (pauseEl) {
        if (pauseCount === 0) {
            pauseEl.innerHTML = `Dlhé pauzy: 0 – Plynulosť reči je veľmi dobrá.`;
        } else if (pauseCount <= 2) {
            pauseEl.innerHTML = `Dlhé pauzy: ${pauseCount} – Objavilo sa pár dlhších prestávok, ale stále je to v norme.`;
        } else {
            pauseEl.innerHTML = `Dlhé pauzy: ${pauseCount} – V prejave bolo viacero dlhších prestávok.`;
        }
    }

    const gazeEl = document.getElementById("feedbackGaze");
    if (gazeEl) {
        const gazeCenter = (p.CENTER * 100).toFixed(0);
        if (gazeCenter >= 60) {
            gazeEl.innerHTML = `Eye contact: ${gazeCenter}% času – Výborne, udržiavate eye contact a pôsobíte sebavedomo.`;
        } else if (gazeCenter >= 40) {
            gazeEl.innerHTML = `Eye contact: ${gazeCenter}% času – Občas odvraciate pohľad. Skúste trénovať vedomý eye contact.`;
        } else {
            gazeEl.innerHTML = `Eye contact: ${gazeCenter}% času – Často odvraciate pohľad.`;
        }
    }

    if (appState.analysis) {
        const analysisEl = document.getElementById("feedbackAnalysis");
        if (analysisEl) {
            analysisEl.textContent = appState.analysis;
        }
    }

    document.getElementById("feedbackPanel")?.classList.remove("hidden");
}

/* ---------------- MODAL ---------------- */
function showModal(msg) {
    return new Promise(res => {
        elements.modal.querySelector("h2").textContent = msg;
        elements.modal.classList.remove("hidden");

        elements.yesButton.onclick = () => {
            elements.modal.classList.add("hidden");
            res();
        };

        elements.noButton.onclick = () => {
            elements.modal.classList.add("hidden");
            res();
        };
    });
}

window.addEventListener("beforeunload", () => {
    if (appState.audio.stream) {
        appState.audio.stream.getTracks().forEach(track => track.stop());
    }
    if (appState.cameraLoaded && elements.video && elements.video.srcObject) {
        elements.video.srcObject.getTracks().forEach(track => track.stop());
    }
});

/* ---------------- UI ---------------- */
elements.startButton.onclick = async () => {
    if (appState.sessionActive) return;
    elements.startButton.disabled = true;
    try {
        const hasCamera = await getMedia();
        if (!hasCamera) return;

        await initializeMediaPipe();
        await startSession();
    } catch (err) {
        console.error("Initialization failed:", err);
    } finally {
        elements.startButton.disabled = false;
    }
};

elements.stopButton.onclick = async () => {
    if (!appState.sessionActive) return;
    elements.stopButton.disabled = true;
    try {
        await stopSession();
    } finally {
        elements.stopButton.disabled = false;
    }
};

elements.calibrateButton.onclick = async () => {
    if (appState.sessionActive) {
        alert("Počas prebiehajúceho testu nie je možné znovu kalibrovať, najprv zastavte test.");
        return;
    }
    try {
        const hasCamera = await getMedia();
        if (!hasCamera) return;
        await initializeMediaPipe();
        await calibrateUser();
    } catch (err) {
        console.error("Calibration failed:", err);
    }
};