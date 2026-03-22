const videoPlayer = document.getElementById("videoPlayer");
const volumeBar = document.getElementById("volumeBar");
const cInfoText = document.getElementById("cInfoText");
const countdownOverlay = document.getElementById("countdownOverlay");
const volumeIndicator = document.getElementById("volumeIndicator");
const startOverlay = document.getElementById("startOverlay");
const gameModal = document.getElementById("gameModal");
const modalMessage = document.getElementById("modalMessage");
const countdownSound = new Audio('Audio/beep.mp3');

let currentVideo = "A";
let audioContext, analyser, microphone;
let recognition, isRecognizing = false;
let isCountdownActive = false;
let successTimer = null;
let isSuccessRedirecting = false;

let volumeHistory = [];
const VOLUME_HISTORY_MAX = 20;
const DB_THRESHOLD = -60;

let bCountdownTimer = null;
let initialPromptTimer = null;
let errorResetTimer = null;
let errorCountdownTimer = null;

let isInitialPromptActive = false;
const INITIAL_PROMPT_DURATION = 3000;
const ERROR_PROMPT_DURATION = 5000;

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

videoPlayer.onended = () => {
  if (currentVideo === "A") {
    resetVideoA();
  }
};

async function startSystem() {
  if (!startOverlay) return; 
  startOverlay.style.display = "none";
  
  try {
    await initAudio(); 
    initRecognition(); 
    
    if (audioContext && audioContext.state === "suspended") {
      await audioContext.resume();
    }

    videoPlayer.muted = false;
    await videoPlayer.play();
    
    runCountdown(() => {
      // --- 新增：倒數結束後的立即提示 ---
      isInitialPromptActive = true; // 設為 true 暫時阻斷 updateVolumeIndicator 的預設文字
      cInfoText.textContent = "10秒內說出關鍵字";
      cInfoText.classList.add("show");

      // 2秒後恢復正常音量偵測文字
      setTimeout(() => {
        isInitialPromptActive = false;
      }, 2000);

      if (!rafStarted) {
        rafStarted = true;
        requestAnimationFrame(updateVolumeIndicator);
      }
    }); 
  } catch (err) {
    console.error("啟動失敗:", err);
    startOverlay.style.display = "flex";
  }
}

window.addEventListener('load', startSystem);
startOverlay.addEventListener("click", startSystem);

// ----------------------------------------------------
// 音訊處理
// ----------------------------------------------------
async function initAudio() {
  try {
    // 如果已經啟動就跳過，避免 XAMPP 重複初始化報錯
    if (microphone && analyser) return;

    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);

    console.log("✅ 麥克風已就緒");
  } catch (error) {
    console.error("❌ 音訊初始化失敗：", error);
    // 拋出錯誤讓 startSystem 捕捉並提示用戶
    throw error; 
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
  const isModalOpen = gameModal.classList.contains("show");

  // 加上 !rafStarted 判斷，確保沒啟動時不跑邏輯
  if (currentVideo !== "A" || isModalOpen || isCountdownActive) {
    volumeBar.style.height = "0%";
    volumeIndicator.style.display = "none"; 
    cInfoText.classList.remove("show");
    stopRecognition();
    return requestAnimationFrame(updateVolumeIndicator);
  }

  // 原有的 UI 顯示判定條件 (倒數中或報錯中不顯示)
  const canShowUI = !isCountdownActive && errorResetTimer === null;
  volumeIndicator.style.display = "block";

  latestDb = getVolumeDB();
  const db = latestDb;

  // 音量條百分比計算
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

  const isInRecognitionWindow = !isCountdownActive && currentTime < END_WINDOW_SEC;

  if (isInRecognitionWindow && errorResetTimer === null) {
    if (!isRecognizing) startRecognition();
    window.isAEnding = false;
  } else {
    if (isRecognizing) stopRecognition();
    
    const remainTime = videoDuration - currentTime;
    if (!isNaN(videoDuration) && remainTime <= A_END_PROMPT_THRESHOLD_SEC && remainTime > 0.1) {
      window.isAEnding = true;
    } else if (remainTime <= 0.1) {
      resetVideoA();
    } else {
      window.isAEnding = false;
    }
  }

  // 提示文字顯示邏輯 (加上 !isModalOpen 確保雙重保險)
  if (!isCountdownActive && (isRecognizing || window.isAEnding)) {
    // 如果「10秒內說出關鍵字」正在顯示中，就不執行下面的文字替換
    if (isInitialPromptActive) {
      cInfoText.classList.add("show");
    } else {
      cInfoText.classList.add("show");
      if (window.isAEnding) {
        cInfoText.textContent = `未偵測到再嘗試一次吧`;
      } else {
        cInfoText.textContent = latestDb >= DB_THRESHOLD ? "音量足夠：請說出關鍵字「緩光臨」" : "音量太小：請提高音量說話";
      }
    }
  } else if (!isInitialPromptActive) {
    // 只有在不是初始提示時才移除 show
    cInfoText.classList.remove("show");
  }

  requestAnimationFrame(updateVolumeIndicator);
}

// 倒數
function runCountdown(callback) {
  if (!countdownOverlay) return;
  
  isCountdownActive = true;
  countdownOverlay.style.display = "flex";
  
  let count = 3;
  
  const updateDisplay = (num) => {
    // 播放音效：每次更新數字時重置時間並播放
    countdownSound.currentTime = 0; 
    countdownSound.play().catch(err => console.log("音效播放被瀏覽器阻擋:", err));

    countdownOverlay.innerHTML = `
      <div class="countdown-circle">
        <div class="countdown-number">${num}</div>
      </div>
    `;
  };

  updateDisplay(count);

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      updateDisplay(count);
    } else {
      clearInterval(timer);
      countdownOverlay.style.display = "none";
      countdownOverlay.innerHTML = ""; 
      isCountdownActive = false;
      
      // 如果你想要倒數結束有一個特別的聲音 (可選)
      // const goSound = new Audio('assets/go.mp3');
      // goSound.play();

      if (callback) callback(); 
    }
  }, 1000);
}

// ----------------------------------------------------
// 語音辨識
// ----------------------------------------------------
function initRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("您的瀏覽器不支援語音辨識，請使用 Chrome。");
    return;
  }

  if (!recognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "zh-TW";
    recognition.continuous = true;
    recognition.interimResults = true;

    // 當辨識真正開始時
    recognition.onstart = () => {
      isRecognizing = true;
      console.log("Recognition started event");
    };

    // 當辨識發生錯誤時
    recognition.onerror = (event) => {
      console.error("Speech Recognition Error:", event.error);
      if (event.error === 'not-allowed') {
        alert("請允許麥克風權限以進行遊戲");
      }
      isRecognizing = false;
    };

    // 原有的結果處理邏輯
    recognition.onresult = (event) => {
        if (currentVideo !== "A" || errorResetTimer !== null) return;
        const last = event.results[event.results.length - 1];
        if (!last || !last.isFinal) return;

        const transcript = last[0].transcript.trim();
        const db = latestDb;

        console.log("辨識到文字:", transcript); // 除錯用

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

        if (db >= DB_THRESHOLD && fuzzyMatch(transcript)) {
          stopRecognition();
          switchToVideoB();
        } else {
          let errorMessage = (db < DB_THRESHOLD) ? "你的音量不夠喔！請提高音量再試一次。" : "你的聲音不夠黏喔！請說出關鍵字「緩光臨」。";
          showFailProcess(errorMessage);
        }
    };

    recognition.onend = () => {
      isRecognizing = false;
      console.log("Recognition ended event");
    };
  }

  initAudio();
}

// ----------------------------------------------------
// 失敗處理與彈窗
// ----------------------------------------------------
function showFailProcess(msg) {
  stopRecognition();
  videoPlayer.pause();
  
  // 顯示失敗原因，隱藏成功區塊
  modalMessage.style.display = "flex";
  modalMessage.textContent = msg; 
  
  const comingSoon = document.getElementById("comingSoonContainer");
  if (comingSoon) comingSoon.style.display = "none";

  gameModal.classList.add("show");
  cInfoText.classList.remove("show");
  volumeIndicator.style.display = "none";
  errorResetTimer = true; 
}

// --- 新增 成功處理邏輯 (含 3,2,1 倒數) ---
function showSuccessProcess() {
  if (successTimer) clearInterval(successTimer);
  
  gameModal.classList.add("show");
  
  // 1. 隱藏失敗時可能出現的 modalMessage (原因文字)
  modalMessage.style.display = "none";
  
  // 2. 顯示成功專用區塊
  const comingSoon = document.getElementById("comingSoonContainer");
  if (comingSoon) comingSoon.style.display = "block";

  // 3. 隱藏遊戲中的 UI
  cInfoText.classList.remove("show");
  volumeIndicator.style.display = "none";
  errorResetTimer = true; 
}

// 專用函式：重播影片 A 並清理提示
// 修正 resetVideoA
function resetVideoA() {
  stopRecognition(); // 重置前先停止
  window.isAEnding = false;
  isInitialPromptActive = false;
  cInfoText.classList.remove("show");
  videoPlayer.currentTime = 0;
  videoPlayer.play();
  runCountdown(); // 重新播放也重新倒數
}

// --- 重試邏輯 ---
function retryGame() {
  // 隱藏成功區塊並恢復原因文字顯示
  const comingSoon = document.getElementById("comingSoonContainer");
  if (comingSoon) comingSoon.style.display = "none";
  modalMessage.style.display = "flex";

  gameModal.classList.remove("show");
  modalMessage.textContent = ""; 
  errorResetTimer = null; 
  currentVideo = "A";
  videoPlayer.src = "video/simple_welcome_videoA.mp4";
  videoPlayer.loop = true;
  resetVideoA();
}

function backToHome() {
  // 由於這是宣傳頁面，根據你之前的需求導向 index.html
  window.location.href = 'index.html'; 
}

// ----------------------------------------------------
// 輔助函式
// ----------------------------------------------------
function startRecognition() {
  // 如果根本還沒 init，就先 init
  if (!recognition) {
    initRecognition();
    return;
  }
  if (isRecognizing) return;

  try {
    recognition.start();
    isRecognizing = true;
    console.log("🎤 辨識啟動成功");
  } catch (err) {
    // 如果是因為還在停止中導致啟動失敗，過一下再試
    console.warn("辨識啟動重試中...");
    setTimeout(startRecognition, 500);
  }
}

function stopRecognition() {
  if (recognition && isRecognizing) {
    recognition.stop();
    isRecognizing = false;
    console.log("🛑 語音辨識已停止");
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

  videoPlayer.onended = () => {
    videoPlayer.pause();
    showSuccessProcess(); // 這裡現在只會彈窗，不會自動跳轉
  };
  
  videoPlayer.play();
}