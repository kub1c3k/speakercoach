console.log("jej ide to", Date.now());

/* ---------------- DOM elementy ---------------- */
const elements = {
    startButton: document.getElementById('startButton'),
    calibrateButton: document.getElementById('calibrateButton'),
    stopButton: document.getElementById('stopButton'),
    canvas: document.getElementById('canvas'),
    video: document.getElementById('camera'),
    modal: document.getElementById('modal'),
    noButton: document.getElementById('noBtn'),
    yesButton: document.getElementById('yesBtn'),
    timerDisplay: document.querySelector('.text-4xl')
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
        recognition: null,
        totalWords: 0,
        fillerCount: 0,
        transcript: [],
        startTime: null
    }
};

/* ---------------- Fillery ---------------- */
const FILLER_WORDS = [
    "ehm","eh","hm","hmm","no","akože","takže",
    "vlastne","proste","ako","um","uh","like","you know", "actually",
    "i mean","sort of","kind of","literally","basically","right","okay","ok", "well",    
];

/* ---------------- LANDMARKY ---------------- */
const LEFT_EYE_INDICES = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
const NOSE_INDICES = [1,168,197];

const canvasCtx = elements.canvas.getContext('2d');
let faceMesh, camera;

/* ---------------- kamera ---------------- */
async function getMedia() {
    if (appState.cameraLoaded) return;
    await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    appState.cameraLoaded = true;
}

/* ---------------- MEDIAPIPE ---------------- */
async function initializeMediaPipe(){
    if(appState.modelIsLoaded) return;

    faceMesh = new FaceMesh({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    faceMesh.setOptions({
        maxNumFaces:1,
        refineLandmarks:true,
        minDetectionConfidence:0.5,
        minTrackingConfidence:0.5
    });

    faceMesh.onResults(handleResults);

    camera = new Camera(elements.video, {
        onFrame: async()=>{ await faceMesh.send({image: elements.video}); },
        width:640,
        height:480
    });

    await camera.start();
    appState.modelIsLoaded = true;
    console.log("MediaPipe ready");
}

/* ---------------- helpers ---------------- */
function getPoint(indices, landmarks){
    let x=0,y=0,c=0;
    for(const i of indices){
        const p = landmarks[i];
        if(!p) continue;
        x+=p.x; y+=p.y; c++;
    }
    return c ? {x:x/c,y:y/c} : null;
}

function averagePoints(points){
    const sum = points.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0});
    return {x:sum.x/points.length,y:sum.y/points.length};
}

/* ---------------- kalibracia ---------------- */
async function calibrateUser(){
    if(!faceMesh) return alert("Model not ready");

    const dirs = [
        {key:"left",prompt:"Pozri ĽAVO"},
        {key:"right",prompt:"Pozri PRAVO"},
        {key:"center",prompt:"Pozri STRED"},
        {key:"up",prompt:"Pozri HORE"},
        {key:"down",prompt:"Pozri DOLE"},
    ];

    const calibration = {};

    for(const d of dirs){
        await showModal(d.prompt);
        const samples=[];
        while(samples.length<15){
            const lm=appState.latestLandmarks;
            if(lm){
                const eye=getPoint(LEFT_EYE_INDICES,lm);
                const head=getPoint(NOSE_INDICES,lm);
                if(eye&&head) samples.push({x:eye.x-head.x,y:eye.y-head.y});
            }
            await new Promise(r=>setTimeout(r,50));
        }
        calibration[d.key]=averagePoints(samples);
        console.log(d.key, calibration[d.key]);
    }

    appState.calibrationData=calibration;
    appState.isCalibrated=true;
    console.log("vykalibrovano",calibration);
}

/* ---------------- reč časť ---------------- */
function startSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        console.warn("SpeechRecognition not supported");
        return;
    }

    const rec = new SR();
    rec.lang = "sk-SK";
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = e => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
            if (!e.results[i].isFinal) continue;
            processFinalSpeech(e.results[i][0].transcript.trim());
        }
    };

    rec.onerror = e => console.error("Speech error", e);

    rec.onend = () => {
        if (appState.sessionActive) {
            console.log("rešstartovanie speach recognition");
            rec.start();
        }
    };

    rec.start();
    appState.speech.recognition = rec;
    appState.speech.startTime = Date.now();
    console.log("Speech recognition naštartované");
}

function stopSpeechRecognition() {
    if (appState.speech.recognition) {
        appState.speech.recognition.onend = null;
        appState.speech.recognition.stop();
        appState.speech.recognition = null;
    }
}

function processFinalSpeech(text) {
    const cleanedText = text.toLowerCase().trim();
    const normalized = cleanedText.replace(/([a-z])\1{1,}/g, '$1');
    const words = normalized.split(/\s+/).filter(Boolean);

    words.forEach(w => {
        appState.speech.totalWords++;

        if (FILLER_WORDS.includes(w)) {
            appState.speech.fillerCount++;
            appState.speech.hesitationCount = (appState.speech.hesitationCount || 0) + 1;
        }

        if (w.length <= 1 && !/\d/.test(w)) {
            appState.speech.hesitationCount = (appState.speech.hesitationCount || 0) + 1;
        }

        const miniSounds = w.match(/\b(um|ah|eh|uhm)\b/gi);
        if (miniSounds) {
            appState.speech.hesitationCount += miniSounds.length;
        }
    });

    FILLER_WORDS.filter(f => f.includes(' ')).forEach(phrase => {
        const matches = (normalized.match(new RegExp(`\\b${phrase}\\b`, 'gi')) || []).length;
        if (matches > 0) {
            appState.speech.fillerCount += matches;
            appState.speech.hesitationCount = (appState.speech.hesitationCount || 0) + matches;
        }
    });

    appState.speech.transcript.push({ time: Date.now(), text });
    console.log("Final:", text, "| Hezitacie zaťial:", appState.speech.hesitationCount);
}

/* ---------------- relacia ---------------- */
function startSession() {
    if (!appState.isCalibrated) return alert("Najprv kalibruj oči.");

    appState.sessionActive = true;
    appState.sessionStart = Date.now();
    appState.gazeHistory = [];
    appState.smoothedEye = null;

    appState.speech.totalWords = 0;
    appState.speech.fillerCount = 0;
    appState.speech.transcript = [];

    startSpeechRecognition();
    updateTimer();
    elements.canvas.classList.remove("hidden");
}

function stopSession() {
    appState.sessionActive = false;
    stopSpeechRecognition();
    saveSession();
    elements.canvas.classList.add("hidden");
    showResultsPanel();
}

/* ---------------- casovanie ---------------- */
function updateTimer(){
    if(!appState.sessionActive) return;
    const s=Math.floor((Date.now()-appState.sessionStart)/1000);
    elements.timerDisplay.textContent=
        `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    requestAnimationFrame(updateTimer);
}

/* ---------------- pohľad ---------------- */
function detectGaze(c, cal){
    const dx = c.x - cal.center.x;
    const dy = c.y - cal.center.y;
    const tx = Math.abs(cal.left.x - cal.right.x) * 0.35;
    const ty = Math.abs(cal.up.y - cal.down.y) * 0.35;

    if(dx > tx) return "RIGHT";
    if(dx < -tx) return "LEFT";
    if(dy > ty) return "DOWN";
    if(dy < -ty) return "UP";
    return "CENTER";
}

/* ---------------- ramce ---------------- */
function handleResults(res){
    if(!res.multiFaceLandmarks?.length) return;
    const lm=res.multiFaceLandmarks[0];
    appState.latestLandmarks=lm;

    canvasCtx.clearRect(0,0,640,480);
    canvasCtx.drawImage(res.image,0,0,640,480);
    drawConnectors(canvasCtx,lm,FACEMESH_TESSELATION,{color:"#C0C0C070",lineWidth:1});

    if(!appState.sessionActive) return;

    const eye=getPoint(LEFT_EYE_INDICES,lm);
    const head=getPoint(NOSE_INDICES,lm);
    if(!eye||!head) return;

    const c={x:eye.x-head.x,y:eye.y-head.y};
    appState.smoothedEye = appState.smoothedEye
        ? {x:appState.smoothedEye.x*0.85+c.x*0.15,y:appState.smoothedEye.y*0.85+c.y*0.15}
        : c;

    const gaze=detectGaze(appState.smoothedEye,appState.calibrationData);
    appState.gazeHistory.push({time:Date.now(),gaze});
}

/* ---------------- vyslekdy---------------- */
function saveSession() {
    if (!appState.gazeHistory.length) return;

    const total = appState.gazeHistory.length;
    const counts = { LEFT:0, RIGHT:0, CENTER:0, UP:0, DOWN:0 };

    appState.gazeHistory.forEach(g => {
        if (counts[g.gaze] !== undefined) counts[g.gaze]++;
    });

    const durationMs = Date.now() - appState.sessionStart;
    const minutes = durationMs / 60000;

    appState.metrics = {
        percentages: {
            LEFT: counts.LEFT / total,
            RIGHT: counts.RIGHT / total,
            CENTER: counts.CENTER / total,
            UP: counts.UP / total,
            DOWN: counts.DOWN / total
        },
        speech: {
            totalWords: appState.speech.totalWords,
            fillerWords: appState.speech.fillerCount,
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

/* ---------------- vylsekovy panel ---------------- */
function showResultsPanel() {
    document.getElementById('resultsPanel').classList.remove('hidden');
    const s = appState.metrics.speech;
    const p = appState.metrics.percentages;
    const hesitations = appState.speech.hesitationCount || 0;
    const totalWords = s.totalWords || 1;

    ['Center','Left','Right','Up','Down'].forEach(dir=>{
        const value = (p[dir.toUpperCase()] || 0) * 100;
        const bar = document.getElementById(`bar${dir}`);
        const span = document.getElementById(`bar${dir}Value`);
        if(bar) bar.style.width = `${value}%`;
        if(span) span.textContent = `${Math.round(value)}%`;
    });

    document.getElementById("wordCount").textContent = s.totalWords;
    document.getElementById("tempoWPM").textContent = s.tempoWPM;
    document.getElementById("fillerCount").textContent = s.fillerWords;
    document.getElementById("hesitationCount").textContent = hesitations;

    const durationMs = Date.now() - appState.sessionStart;
    const mins = Math.floor(durationMs / 60000);
    const secs = Math.floor((durationMs % 60000)/1000);
    document.getElementById("sessionTime").textContent =
        `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

    const ctx = document.getElementById('hesitationGraph').getContext('2d');
    const times = appState.speech.transcript.map(t => ((t.time - appState.sessionStart)/1000).toFixed(1));
    const hesData = [];
    let cumulative = 0;

    appState.speech.transcript.forEach(t=>{
        const text = t.text.toLowerCase();
        let count = 0;
        FILLER_WORDS.forEach(f=>{
            const regex = new RegExp(`\\b${f}\\b`, 'g');
            count += (text.match(regex) || []).length;
        });
        text.split(/\s+/).forEach(w=>{
            if(w.length <= 2) count++;
        });
        cumulative += count;
        hesData.push(cumulative);
    });

    if(window.hesitationChart) window.hesitationChart.destroy();

    window.hesitationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: times,
            datasets: [{
                label: 'Hesitations',
                data: hesData,
                borderColor: 'rgba(255,99,132,1)',
                backgroundColor: 'rgba(255,99,132,0.2)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: { title: { display: true, text: 'Time (s)' } },
                y: { title: { display: true, text: 'Kumulatívne hezitácie' }, beginAtZero:true }
            }
        }
    });
    updateFeedback();
}

/* ---------------- FEEDBACK ---------------- */
function updateFeedback() {
    const s = appState.metrics.speech;
    const p = appState.metrics.percentages;
    const hesitations = appState.speech.hesitationCount || 0;
    const totalWords = s.totalWords || 1;
    const fillerRatio = s.fillerWords / totalWords;

    const tempoEl = document.getElementById('feedbackTempo');
    if(s.tempoWPM < 80) {
        tempoEl.innerHTML = `Tempo reči: ${s.tempoWPM} WPM – Hovoríte pomaly, možno viac istoty. Skúste hovoriť plynulejšie.`;
    } else if(s.tempoWPM <= 140) {
        tempoEl.innerHTML = `Tempo reči: ${s.tempoWPM} WPM – Skvelé tempo, pôsobíte sebavedomo.`;
    } else {
        tempoEl.innerHTML = `Tempo reči: ${s.tempoWPM} WPM – Hovoríte rýchlo, môže byť náročné sledovať. Skúste vedomé pauzy.`;
    }

    const hesEl = document.getElementById('feedbackHesitations');
    const hesitationPercent = (hesitations/totalWords*100).toFixed(1);
    if(hesitationPercent < 5) {
        hesEl.innerHTML = `Hesitácie: ${hesitations} (${hesitationPercent}%) – Vaša reč je veľmi plynulá. Pokračujte v udržiavaní prirodzených pauz.`;
    } else if(hesitationPercent <= 15) {
        hesEl.innerHTML = `Hesitácie: ${hesitations} (${hesitationPercent}%) – Vidieť pár hesitácií. Skúste pauzy namiesto filler slov.`;
    } else {
        hesEl.innerHTML = `Hesitácie: ${hesitations} (${hesitationPercent}%) – Často používate filler slová. Tip: vedomé pauzy a plánovanie viet znižujú hesitácie.`;
    }

    const gazeEl = document.getElementById('feedbackGaze');
    const gazeCenter = (p.CENTER*100).toFixed(0);
    if(gazeCenter >= 60) {
        gazeEl.innerHTML = `Eye contact: ${gazeCenter}% času – Výborne, udržiavate eye contact a pôsobíte sebavedomo.`;
    } else if(gazeCenter >= 40) {
        gazeEl.innerHTML = `Eye contact: ${gazeCenter}% času – Občas odvraciate pohľad. Skúste trénovať vedomý eye contact.`;
    } else {
        gazeEl.innerHTML = `Eye contact: ${gazeCenter}% času – Často odvraciate pohľad. Tip: krátke segmenty stabilného pohľadu pôsobia sebavedomo.`;
    }

    document.getElementById('feedbackPanel').classList.remove('hidden');
}

/* ---------------- MODAL ---------------- */
function showModal(msg){
    return new Promise(res=>{
        elements.modal.querySelector("h2").textContent=msg;
        elements.modal.classList.remove("hidden");
        elements.yesButton.onclick=()=>{elements.modal.classList.add("hidden");res();};
        elements.noButton.onclick=()=>{elements.modal.classList.add("hidden");res();};
    });
}

/* ---------------- UI ---------------- */
elements.startButton.onclick=async()=>{await getMedia();await initializeMediaPipe();startSession();};
elements.stopButton.onclick=()=>stopSession();
elements.calibrateButton.onclick=async()=>{await getMedia();await initializeMediaPipe();await calibrateUser();};
