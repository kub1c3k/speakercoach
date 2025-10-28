const videoElement = document.getElementById('inputVideo');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');

// Reference HTML elements for display
const resultDiv = document.getElementById('eye_contact_info');
const testInfo = document.getElementById('test_info');
const testStatus = document.getElementById('test_status');
const progressBar = document.getElementById('progress_bar');
const startButton = document.getElementById('start_button');

// Global variables
let minuteConverter = 60 * 1000;
let maxTime = 25 * minuteConverter;
let minTime = 0.5 * minuteConverter;
let testStartTime = null;
let testDuration;
let testActive = false;
let testCompleted = false;
let totalFrames = 0;
let goodEyeContactFrames = 0;

// ================== CAMERA & MEDIAPIPE SETUP ==================

const faceMesh = new FaceMesh({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

// Camera initialization
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await faceMesh.send({ image: videoElement });
  },
  width: 640,
  height: 480
});

// ================== HELPER FUNCTIONS ==================

function playBeep() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
  oscillator.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.1);
}

function getTestDuration() {
  let durationAnswer = prompt("Zadajte dĺžku prejavu v minútach:");
  let durationInMilliseconds = parseFloat(durationAnswer) * minuteConverter;

  while (
    durationInMilliseconds > maxTime ||
    durationInMilliseconds < minTime ||
    isNaN(durationInMilliseconds)
  ) {
    if (durationInMilliseconds > maxTime) {
      durationAnswer = prompt("Maximálna dĺžka je 25 minút, zadajte znovu:");
    } else if (durationInMilliseconds < minTime) {
      durationAnswer = prompt("Minimálna dĺžka je 0.5 minúty, zadajte znovu:");
    } else if (isNaN(durationInMilliseconds)) {
      durationAnswer = prompt("Neplatný vstup. Zadajte prosím číslo v minútach:");
    }
    durationInMilliseconds = parseFloat(durationAnswer) * minuteConverter;
  }

  return durationInMilliseconds;
}

// ================== TEST CONTROL ==================

function startCamera() {
  testStatus.textContent = "Spúšťam kameru...";
  startButton.style.display = "none";

  camera.start()
    .then(() => {
      console.log("Kamera spustená.");
      testDuration = getTestDuration();
      restartTest();
    })
    .catch((error) => {
      console.error("Kameru sa nepodarilo spustiť:", error);
      testStatus.textContent = "Chyba pri spustení kamery. Skontrolujte povolenia.";
      startButton.style.display = "inline-block";
      startButton.textContent = "Skúsiť znovu";
      startButton.onclick = startCamera;
    });
}

function startCountdown() {
  let count = 3;
  testStatus.innerHTML = `<h2 style="font-size:60px;">${count}</h2>`;
  playBeep();
  count--;

  const interval = setInterval(() => {
    if (count > 0) {
      testStatus.innerHTML = `<h2 style="font-size:60px;">${count}</h2>`;
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
  testStartTime = Date.now();
  testActive = true;
  testCompleted = false;
  totalFrames = 0;
  goodEyeContactFrames = 0;
  updateResultDisplay("Test prebieha...", 0, testDuration / minuteConverter);
}

function endTest() {
  testActive = false;
  testCompleted = true;
  playBeep();

  const finalEyeContactPercentage =
    totalFrames > 0 ? (goodEyeContactFrames / totalFrames) * 100 : 0;

  showFinalResults(finalEyeContactPercentage);
}

function restartTest() {
  testCompleted = false;
  startButton.style.display = "inline-block";
  startButton.textContent = "Spustiť test";
  startButton.onclick = startCountdown;

  testInfo.textContent = `Test očného kontaktu - ${testDuration / minuteConverter} min.`;
  testStatus.textContent = "Pripravený na spustenie.";
  progressBar.style.width = "0%";
}

// ================== DISPLAY UPDATES ==================

function updateResultDisplay(status, eyeContact, remainingTimeInSeconds) {
  let displayTime = remainingTimeInSeconds;
  let timeUnit = "s";

  if (remainingTimeInSeconds >= 60) {
    displayTime = (remainingTimeInSeconds / 60).toFixed(1);
    timeUnit = "min";
  }

  testStatus.innerHTML = `
    ${status}<br>
    Očný kontakt: ${eyeContact.toFixed(1)}%<br>
    Zostáva: ${displayTime} ${timeUnit}
  `;

  const progressPercent =
    ((testDuration - remainingTimeInSeconds * 1000) / testDuration) * 100;
  progressBar.style.width = `${Math.min(progressPercent, 100)}%`;
}

function showFinalResults(eyeContactPercentage) {
  const status =
    eyeContactPercentage >= 70
      ? "VÝBORNÉ!"
      : eyeContactPercentage >= 50
      ? "DOBRÉ"
      : "TREBA SA ZLEPŠIŤ";

  testInfo.textContent = `Výsledok: ${eyeContactPercentage.toFixed(1)}%`;
  testStatus.innerHTML = `
    ${status}<br>
    Celkom snímok: ${totalFrames}<br>
    Dobré snímky: ${goodEyeContactFrames}<br>
    Optimálne: 70%+
  `;

  startButton.style.display = "inline-block";
  startButton.textContent = "Spustiť znovu";
  startButton.onclick = restartTest;
}

// ================== FACEMESH PROCESSING ==================

faceMesh.onResults((results) => {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

  if (testActive && results.multiFaceLandmarks) {
    const currentTime = Date.now();
    const elapsed = currentTime - testStartTime;
    const remainingTime = Math.max(0, Math.ceil((testDuration - elapsed) / 1000));

    if (elapsed >= testDuration) {
      endTest();
      return;
    }

    for (const landmarks of results.multiFaceLandmarks) {
      const eyeContactScore = analyzeEyeContact(landmarks);
      const stats = updateEyeContactStats(eyeContactScore);

      updateResultDisplay("Test prebieha...", stats.overallScore, remainingTime);

      drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, { color: '#00C853', lineWidth: 1 });
      drawLandmarks(canvasCtx, landmarks, { color: '#FF1744', lineWidth: 1, radius: 1 });
    }
  }

  canvasCtx.restore();
});

// ================== ANALYSIS FUNCTIONS ==================

function analyzeEyeContact(landmarks) {
  const noseTip = landmarks[1];
  const leftEyePupil = landmarks[468];
  const rightEyePupil = landmarks[473];
  const chin = landmarks[152];
  const leftEyeOuterCorner = landmarks[133];
  const leftEyeInnerCorner = landmarks[33];
  const rightEyeOuterCorner = landmarks[362];
  const rightEyeInnerCorner = landmarks[263];

  if (
    !leftEyePupil || !rightEyePupil ||
    !noseTip || !chin ||
    !leftEyeOuterCorner || !rightEyeOuterCorner ||
    !leftEyeInnerCorner || !rightEyeInnerCorner
  ) return 0;

  const leftEyeWidth = Math.abs(leftEyeOuterCorner.x - leftEyeInnerCorner.x);
  const leftPupilPosition = Math.abs(leftEyePupil.x - leftEyeInnerCorner.x);
  const leftGazeRatio = leftPupilPosition / leftEyeWidth;

  const rightEyeWidth = Math.abs(rightEyeOuterCorner.x - rightEyeInnerCorner.x);
  const rightPupilPosition = Math.abs(rightEyePupil.x - rightEyeInnerCorner.x);
  const rightGazeRatio = rightPupilPosition / rightEyeWidth;

  const isLookingStraight =
    leftGazeRatio > 0.25 && leftGazeRatio < 0.55 &&
    rightGazeRatio > 0.25 && rightGazeRatio < 0.55;

  const headCenterX = (leftEyeOuterCorner.x + rightEyeOuterCorner.x) / 2;
  const isHeadCentered = Math.abs(headCenterX - 0.5) < 0.2;

  return isLookingStraight && isHeadCentered ? 100 : 0;
}

function updateEyeContactStats(eyeContactScore) {
  totalFrames++;
  if (eyeContactScore > 0) goodEyeContactFrames++;

  const overallEyeContact = (goodEyeContactFrames / totalFrames) * 100;
  return {
    currentScore: eyeContactScore,
    overallScore: overallEyeContact,
    isGood: eyeContactScore > 0
  };
}

// ================== START ==================
startCamera();
