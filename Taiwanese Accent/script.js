/**
 * 完整整合版 script.js
 * 解決方案：雙影片標籤 (Dual Layer) 無縫切換
 */

// --- 元素選取 ---
const videoA = document.getElementById("videoA");
const videoB = document.getElementById("videoB");
// 邏輯指標：指向目前正在作用的影片標籤
let videoPlayer = videoA; 

const volumeBar = document.getElementById("volumeBar");
const cInfoText = document.getElementById("cInfoText");
const startOverlay = document.getElementById("startOverlay");
const volumeIndicator = document.getElementById("volumeIndicator");

// --- 狀態變數 ---
let currentVideo = "A";
let audioContext, analyser, microphone;
let recognition, isRecognizing = false;

let volumeHistory = [];
const VOLUME_HISTORY_MAX = 20; 
const DB_THRESHOLD = -55; 

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

// --- 初始狀態 ---
videoA.pause();
videoB.pause();
videoA.muted = true;
videoB.muted = true;
volumeIndicator.style.display = "none";

// --- 啟動流程 ---
startOverlay.addEventListener("click", async () => {
  startOverlay.style.display = "none";

  // 同時解鎖兩個影片播放權限
  videoA.muted = false;
  videoB.muted = false;

  try {
    await videoA.play();
    console.log("▶ 影片 A 開始播放");
  } catch (err) {
    console.warn("播放失敗：", err);
  }

  initRecognition();
  initPoseNet();
});

// --- 音訊處理 ---
async function initAudio() {
  try {
    if (audioContext && analyser) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.85;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    microphone = audioContext.createMediaStreamSource(stream);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 4; 

    microphone.connect(gainNode);
    gainNode.connect(analyser);

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    console.log("🎤 音訊初始化成功");

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
  if (!floatBuf || floatBuf.length !== analyser.fftSize) {
    floatBuf = new Float32Array(analyser.fftSize);
  }
  analyser.getFloatTimeDomainData(floatBuf);
  let sum = 0;
  for (let v of floatBuf) sum += v * v;
  const rms = Math.sqrt(sum / floatBuf.length);
  if (rms < 1e-8) return -100;
  const db = 20 * Math.log10(rms);
  volumeHistory.push(db);
  if (volumeHistory.length > VOLUME_HISTORY_MAX) volumeHistory.shift();
  return volumeHistory.reduce((a, b) => a + b) / volumeHistory.length;
}

// --- 語音辨識控制 ---
function stopRecognition() {
  if (recognition && isRecognizing) {
    recognition.onend = () => {
      isRecognizing = false;
      console.log("🛑 語音辨識停止。");
      setRecognitionEndHandler();
    };
    recognition.stop();
    isRecognizing = false;
    if (errorResetTimer === null) {
      cInfoText.classList.remove("show");
      clearTimeout(initialPromptTimer);
      isInitialPromptActive = false;
    }
  }
}

function startRecognition() {
  if (!recognition || isRecognizing) return;
  try {
    recognition.start();
    isRecognizing = true;
    window.recognitionStartTime = performance.now();
    console.log("🟢 語音辨識啟動");

    clearTimeout(initialPromptTimer);
    clearTimeout(errorResetTimer);
    clearInterval(errorCountdownTimer);
    errorResetTimer = null;

    if (videoPlayer.currentTime < START_PROMPT_DELAY_MS / 1000 + 0.5) {
      isInitialPromptActive = true;
      cInfoText.textContent = "可以開始說話";
      initialPromptTimer = setTimeout(() => {
        isInitialPromptActive = false;
      }, INITIAL_PROMPT_DURATION);
    }
  } catch (err) {
    if (err.name === "InvalidStateError") {
      setTimeout(startRecognition, 500);
    } else {
      console.error("啟動辨識失敗:", err);
    }
  }
}

// --- 核心邏輯：即時監控 ---
function updateVolumeIndicator() {
  // 如果不是影片 A，就清空音量條並停止辨識
  if (currentVideo !== "A") {
    volumeBar.style.height = "0%";
    window.isAEnding = false;
    stopRecognition();
    return requestAnimationFrame(updateVolumeIndicator);
  }

  const START_WINDOW_SEC = START_PROMPT_DELAY_MS / 1000;
  if (videoPlayer.currentTime >= START_WINDOW_SEC) {
    volumeIndicator.style.display = "block";
  } else {
    volumeIndicator.style.display = "none";
  }

  latestDb = getVolumeDB();
  const db = latestDb;

  const minDb = -80;
  const maxDb = -20;
  let normalized = (db - minDb) / (maxDb - minDb);
  normalized = Math.min(Math.max(normalized, 0), 1);
  volumeBar.style.height = `${normalized * 100}%`;
  volumeBar.style.background = db >= DB_THRESHOLD
      ? "linear-gradient(to top, #4CAF50, #8BC34A)"
      : "linear-gradient(to top, #FF9800, #FFC107)";

  const videoDuration = videoPlayer.duration;
  let currentTime = videoPlayer.currentTime;
  let END_WINDOW_SEC = videoDuration - A_END_PROMPT_THRESHOLD_SEC;

  // 影片重放重設 UI
  if (currentTime < 0.1 && isInitialPromptActive) {
    isInitialPromptActive = false;
    cInfoText.classList.remove("show");
    clearTimeout(initialPromptTimer);
    clearInterval(errorCountdownTimer);
  }

  const isInRecognitionWindow = !isNaN(videoDuration) && videoDuration > 0 &&
                                currentTime >= START_WINDOW_SEC && 
                                currentTime < END_WINDOW_SEC;

  isRecognitionWindowActive = isInRecognitionWindow;

  if (isInRecognitionWindow && errorResetTimer === null) {
    if (!isRecognizing) startRecognition();
    window.isAEnding = false;
  } else if (!isInRecognitionWindow || errorResetTimer !== null) {
    if (isRecognizing) stopRecognition();
    const remainToEnd = videoDuration - currentTime;
    window.isAEnding = (remainToEnd <= A_END_PROMPT_THRESHOLD_SEC && remainToEnd > 0.1);
  }

  // 提示文字邏輯
  if (isRecognizing || window.isAEnding || isInitialPromptActive) {
    if (window.isAEnding) {
      cInfoText.classList.add("show");
      cInfoText.textContent = `未偵測到再嘗試一次吧`;
    } else if (isInitialPromptActive) {
      cInfoText.classList.add("show");
    } else if (currentTime >= START_WINDOW_SEC) {
      cInfoText.classList.add("show");
      cInfoText.textContent = db >= DB_THRESHOLD ? "音量足夠：請說出關鍵字「緩光臨」" : "音量太小：請提高音量說話";
    }
  } else {
    cInfoText.classList.remove("show");
  }

  requestAnimationFrame(updateVolumeIndicator);
}

// --- 核心邏輯：影片切換 ---
function switchToVideoB() {
  if (currentVideo === "B") return;

  currentVideo = "B";
  clearTimeout(initialPromptTimer);
  clearTimeout(errorResetTimer);
  clearInterval(errorCountdownTimer);
  errorResetTimer = null;
  isInitialPromptActive = false;
  cInfoText.classList.remove("show");
  
  volumeIndicator.style.display = "none";
  window.isAEnding = false;
  isRecognitionWindowActive = false;

  // 無縫切換執行
  videoB.currentTime = 0;
  videoB.classList.remove("hidden");
  
  videoB.play().then(() => {
    videoA.pause();
    videoA.classList.add("hidden");
    videoPlayer = videoB; // 更新邏輯指標為 B
    console.log("🎬 無縫切換至影片 B");
  }).catch(err => console.error("B 播放失敗", err));

  videoB.onended = () => resetToA();
}

function resetToA() {
  currentVideo = "A";
  clearTimeout(initialPromptTimer);
  clearTimeout(errorResetTimer);
  clearInterval(errorCountdownTimer);
  errorResetTimer = null;
  isInitialPromptActive = false;

  videoA.currentTime = 0;
  videoA.classList.remove("hidden");
  
  videoA.play().then(() => {
    videoB.pause();
    videoB.classList.add("hidden");
    videoPlayer = videoA; // 更新邏輯指標為 A
    console.log("🔄 重設回影片 A");
  });

  setTimeout(() => {
    setRecognitionEndHandler();
  }, 500);
}

// --- 語音辨識初始化與模糊比對 ---
function initRecognition() {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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
    console.log(`辨識：${transcript} | ${db.toFixed(1)} dB`);

    // 模糊比對邏輯 (與你原本的一致)
    const fuzzyChars = {
      緩: ["緩", "還", "換", "環", "歡", "莞", "宦", "喚", "萬", "呼", "乎", "忽", "灣", "彎", "碗", "晚", "婉", "鍰", "幻", "晃", "黃", "謊", "慌", "犯", "販", "範", "反", "返", "法", "發"],
      光: ["光", "廣", "逛", "洸", "胱", "觀", "關", "官", "剛", "鋼", "岡", "汪", "工", "公", "功", "港", "框", "曠", "狂", "礦", "況", "宏", "紅", "洪", "航", "行", "缸"],
      臨: ["臨", "林", "零", "玲", "麟", "淋", "霖", "寧", "齡", "領", "玲", "零", "鈴", "令", "鄰", "倫", "靈", "理", "立", "曆", "利", "裡", "里", "禮", "人", "認", "任", "忍", "刃", "能", "農"]
    };

    function fuzzyMatch(text) {
      let matchCount = 0;
      ["緩", "光", "臨"].forEach(key => {
        if (fuzzyChars[key].some(v => text.includes(v))) matchCount++;
      });
      return matchCount >= 2;
    }

    if (db >= DB_THRESHOLD && fuzzyMatch(transcript)) {
      switchToVideoB();
    } else {
      handleErrorFeedback(db < DB_THRESHOLD ? "你的音量不夠喔！" : "你的聲音不夠黏喔！");
    }
  };

  recognition.onerror = (e) => { console.error("辨識錯誤:", e.error); isRecognizing = false; };
  setRecognitionEndHandler();
}

function handleErrorFeedback(msg) {
  let countdown = ERROR_PROMPT_DURATION / 1000;
  cInfoText.textContent = `${msg} (${countdown})`;
  cInfoText.classList.add("show");
  isInitialPromptActive = true;

  errorCountdownTimer = setInterval(() => {
    countdown--;
    if (countdown > 0) cInfoText.textContent = `${msg} (${countdown})`;
    else clearInterval(errorCountdownTimer);
  }, 1000);

  errorResetTimer = setTimeout(() => {
    errorResetTimer = null;
    clearInterval(errorCountdownTimer);
    if (isRecognizing) recognition.stop();
    if (currentVideo === "A") videoPlayer.currentTime = 0;
  }, ERROR_PROMPT_DURATION);
}

function setRecognitionEndHandler() {
  recognition.onend = () => {
    isRecognizing = false;
    if (errorResetTimer === null) {
        cInfoText.classList.remove("show");
        isInitialPromptActive = false;
    }
  };
}

async function initPoseNet() {
  try {
    await posenet.load();
    console.log("✨ PoseNet 已載入");
  } catch (e) { console.error("PoseNet 失敗:", e); }
}