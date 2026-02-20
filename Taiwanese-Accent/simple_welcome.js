const videoPlayer = document.getElementById("videoPlayer");
const volumeBar = document.getElementById("volumeBar");
const cInfoText = document.getElementById("cInfoText");
const startOverlay = document.getElementById("startOverlay");
const volumeIndicator = document.getElementById("volumeIndicator");

let currentVideo = "A";
let audioContext, analyser, microphone;
let recognition, isRecognizing = false;

let volumeHistory = [];
const VOLUME_HISTORY_MAX = 20;
const DB_THRESHOLD = -45;

let bCountdownTimer = null;
let initialPromptTimer = null;
let errorResetTimer = null;
let errorCountdownTimer = null;

let isInitialPromptActive = false;
const INITIAL_PROMPT_DURATION = 3000;
const ERROR_PROMPT_DURATION = 5000;

const START_PROMPT_DELAY_MS = 2500;
const A_END_PROMPT_THRESHOLD_SEC = 5;

window.recognitionStartTime = 0;
window.isAEnding = false;
let isRecognitionWindowActive = false;

const DEBUG_VOLUME = false;
let latestDb = -100;
let rafStarted = false;
let floatBuf = null;

// ----------------------------------------------------
// 啟動流程與自動重置監聽
// ----------------------------------------------------
videoPlayer.pause();
videoPlayer.muted = true;
volumeIndicator.style.display = "none";

// 監聽影片 A 結束（有些瀏覽器 loop 模式也會觸發 onended）
videoPlayer.onended = () => {
  if (currentVideo === "A") {
    resetVideoA();
  } else if (currentVideo === "B") {
    // 影片 B 結束邏輯已移至 switchToVideoB 內部處理
  }
};

async function startSystem() {
  startOverlay.style.display = "none";
  videoPlayer.muted = false;
  try {
    await videoPlayer.play();
  } catch (err) {
    startOverlay.style.display = "flex";
    return; 
  }
  initRecognition();
}

window.addEventListener('load', startSystem);
startOverlay.addEventListener("click", startSystem);

// ----------------------------------------------------
// 音訊處理
// ----------------------------------------------------
async function initAudio() {
  try {
    if (audioContext && analyser) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.85;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    microphone = audioContext.createMediaStreamSource(stream);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 2;

    microphone.connect(gainNode);
    gainNode.connect(analyser);

    if (audioContext.state === "suspended") await audioContext.resume();
    if (!rafStarted) {
      rafStarted = true;
      requestAnimationFrame(updateVolumeIndicator);
    }
  } catch (error) {
    console.error("❌ 音訊初始化失敗：", error);
  }
}

function getVolumeDB() {
  if (!analyser) return -100;
  if (!floatBuf || floatBuf.length !== analyser.fftSize) floatBuf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(floatBuf);
  let sum = 0;
  for (let i = 0; i < floatBuf.length; i++) { sum += floatBuf[i] * floatBuf[i]; }
  const rms = Math.sqrt(sum / floatBuf.length);
  if (rms < 1e-8) return -100;
  const db = 20 * Math.log10(rms);
  volumeHistory.push(db);
  if (volumeHistory.length > VOLUME_HISTORY_MAX) volumeHistory.shift();
  return volumeHistory.reduce((a, b) => a + b) / volumeHistory.length;
}

// ----------------------------------------------------
// UI 更新、邏輯窗口與自動重置偵測
// ----------------------------------------------------
function updateVolumeIndicator() {
  if (currentVideo !== "A") {
    volumeBar.style.height = "0%";
    window.isAEnding = false;
    stopRecognition();
    return requestAnimationFrame(updateVolumeIndicator);
  }

  const START_WINDOW_SEC = START_PROMPT_DELAY_MS / 1000;
  volumeIndicator.style.display = (videoPlayer.currentTime >= START_WINDOW_SEC && errorResetTimer === null) ? "block" : "none";

  latestDb = getVolumeDB();
  const db = latestDb;

  const NOISE_GATE_DB = -42;
  const maxDb = -20;
  let percent = 0;
  if (db > NOISE_GATE_DB) {
    let ratio = Math.max(0, Math.min(1, (db - NOISE_GATE_DB) / (maxDb - NOISE_GATE_DB)));
    percent = Math.pow(ratio, 1.5) * 100; 
  }
  volumeBar.style.height = `${percent}%`;
  volumeBar.style.background = db >= DB_THRESHOLD 
    ? "linear-gradient(to top, #4CAF50, #8BC34A)" 
    : "linear-gradient(to top, #FF9800, #FFC107)";

  const videoDuration = videoPlayer.duration;
  let currentTime = videoPlayer.currentTime;
  let END_WINDOW_SEC = videoDuration - A_END_PROMPT_THRESHOLD_SEC;

  // 偵測是否在辨識窗口內
  const isInRecognitionWindow = !isNaN(videoDuration) && videoDuration > 0 && currentTime >= START_WINDOW_SEC && currentTime < END_WINDOW_SEC;
  isRecognitionWindowActive = isInRecognitionWindow;

  if (isInRecognitionWindow && errorResetTimer === null) {
    if (!isRecognizing) startRecognition();
    window.isAEnding = false;
  } else if (!isInRecognitionWindow || errorResetTimer !== null) {
    if (isRecognizing) stopRecognition();
    
    // 如果影片快結束了（進入最後 5 秒）
    const remainTime = videoDuration - currentTime;
    if (!isNaN(videoDuration) && remainTime <= A_END_PROMPT_THRESHOLD_SEC && remainTime > 0.1) {
      window.isAEnding = true;
    } else if (remainTime <= 0.1) {
      // 影片完全結束，執行自動重播
      resetVideoA();
    } else {
      window.isAEnding = false;
    }
  }

  // 提示文字顯示邏輯
  if (isRecognizing || window.isAEnding || isInitialPromptActive) {
    if (window.isAEnding) {
      cInfoText.classList.add("show");
      cInfoText.textContent = `未偵測到再嘗試一次吧`;
    } else if (isInitialPromptActive) {
      cInfoText.classList.add("show");
    } else {
      cInfoText.classList.add("show");
      cInfoText.textContent = db >= DB_THRESHOLD ? "音量足夠：請說出關鍵字「緩光臨」" : "音量太小：請提高音量說話";
    }
  } else if (errorResetTimer === null) {
    cInfoText.classList.remove("show");
  }

  requestAnimationFrame(updateVolumeIndicator);
}

// ----------------------------------------------------
// 語音辨識
// ----------------------------------------------------
function initRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.lang = "zh-TW";
  recognition.continuous = true;
  recognition.interimResults = true;

  initAudio();

  recognition.onresult = (event) => {
    if (currentVideo !== "A" || errorResetTimer !== null) return;
    const last = event.results[event.results.length - 1];
    if (!last || !last.isFinal) return;

    const transcript = last[0].transcript.trim();
    const db = latestDb;

    const fuzzyChars = {
      緩: ["緩","還","換","環","歡","莞","宦","喚","萬","呼","乎","忽","灣","彎","碗","晚","婉","鍰","幻","晃","黃","謊","慌","犯","販","範","反","返","法","發"],
      光: ["光","廣","逛","洸","胱","觀","關","官","剛","鋼","岡","汪","工","公","功","港","框","曠","狂","礦","況","宏","紅","洪","航","行","缸"],
      臨: ["臨","林","零","玲","麟","淋","霖","寧","齡","領","玲","零","鈴","令","鄰","倫","靈","理","立","曆","利","裡","里","禮","人","認","任","忍","刃","能","農"]
    };

    function fuzzyMatch(text) {
      let matchCount = 0;
      ["緩", "光", "臨"].forEach((key) => {
        if (fuzzyChars[key].some(v => text.toLowerCase().includes(v))) matchCount++;
      });
      return matchCount >= 2;
    }

    const keywordMatched = fuzzyMatch(transcript);

    if (db >= DB_THRESHOLD && keywordMatched) {
      stopRecognition();
      switchToVideoB();
    } else {
      let errorMessage = (db < DB_THRESHOLD) ? "你的音量不夠喔！請提高音量再試一次。" : "你的聲音不夠黏喔！請說出關鍵字「緩光臨」。";
      showFailProcess(errorMessage);
    }
  };

  setRecognitionEndHandler();
}

// ----------------------------------------------------
// 失敗處理與彈窗
// ----------------------------------------------------
function showFailProcess(msg) {
  if (recognition && isRecognizing) recognition.stop();

  let countdown = ERROR_PROMPT_DURATION / 1000;
  cInfoText.textContent = `${msg} (${countdown})`;
  cInfoText.classList.add("show");
  
  errorResetTimer = true; 
  clearInterval(errorCountdownTimer);
  
  errorCountdownTimer = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      cInfoText.textContent = `${msg} (${countdown})`;
    } else {
      clearInterval(errorCountdownTimer);
    }
  }, 1000);

  setTimeout(() => {
    cInfoText.classList.remove("show");
    videoPlayer.pause(); 
    document.getElementById('failModal').classList.add('show');
    volumeIndicator.style.display = "none";
  }, ERROR_PROMPT_DURATION);
}

// ----------------------------------------------------
// 按鈕功能與重置函式
// ----------------------------------------------------

// 專用函式：重播影片 A 並清理提示
function resetVideoA() {
  window.isAEnding = false;
  isInitialPromptActive = false;
  cInfoText.classList.remove("show");
  videoPlayer.currentTime = 0;
  videoPlayer.play();
}

// 按鈕：繼續挑戰
function retryGame() {
  document.getElementById('failModal').classList.remove('show');
  errorResetTimer = null;
  currentVideo = "A";
  videoPlayer.src = "video/simple_welcome_videoA.mp4";
  videoPlayer.loop = true;
  resetVideoA();
}

// 按鈕：選擇其他組
function backToMenu() {
  window.location.href = 'simple_choose.html'; 
}

// 按鈕：前往下一組
function nextLevel() {
  window.location.href = 'simple_next_level.html'; 
}

// ----------------------------------------------------
// 輔助函式
// ----------------------------------------------------
function startRecognition() {
  if (!recognition || isRecognizing) return;
  try {
    recognition.start();
    isRecognizing = true;
    if (videoPlayer.currentTime < START_PROMPT_DELAY_MS / 1000 + 0.5) {
      isInitialPromptActive = true;
      cInfoText.textContent = "可以開始說話";
      initialPromptTimer = setTimeout(() => { isInitialPromptActive = false; }, INITIAL_PROMPT_DURATION);
    }
  } catch (err) { setTimeout(startRecognition, 500); }
}

function stopRecognition() {
  if (recognition && isRecognizing) {
    recognition.stop();
    isRecognizing = false;
  }
}

function setRecognitionEndHandler() {
  if (!recognition) return;
  recognition.onend = () => { isRecognizing = false; };
}

function switchToVideoB() {
  if (currentVideo === "B") return;
  currentVideo = "B";
  
  errorResetTimer = null;
  isInitialPromptActive = false;
  cInfoText.classList.remove("show");
  volumeIndicator.style.display = "none";
  
  videoPlayer.src = "video/simple_welcome_videoB.mp4";
  videoPlayer.loop = false;

  // 影片 B 結束後顯示成功選單
  videoPlayer.onended = () => {
    videoPlayer.pause();
    document.getElementById('successModal').classList.add('show');
  };
  
  videoPlayer.play();
}