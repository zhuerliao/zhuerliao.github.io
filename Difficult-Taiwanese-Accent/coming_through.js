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
// 辨識邏輯 
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

    recognition.onresult = (event) => {
      if (currentVideo !== "A" || errorResetTimer !== null) return;
      
      const lastIndex = event.results.length - 1;
      const last = event.results[lastIndex];
      if (!last) return;

      const transcript = last[0].transcript.trim().toLowerCase().replace(/[.,!?;: ]/g, "");
      const db = latestDb;
      let level = 0;

      if (!last.isFinal) {
        speechStartTime = Date.now();
        return; 
      }

      // ⏱️ 計算說話總長度 (當前時間 - 剛吐出字的時間)
      const speechDuration = (Date.now() - speechStartTime) / 1000; 

      if (transcript.length === 0) {
        showFailProcess("聽不清楚，請再大聲並黏一點！");
        return;
      }

      // 🎯 1. 移植網頁版強大的「借過」【字典庫】
      const fuzzyChars = {
        借: ["借", "就", "揪", "接", "解", "屆", "叫", "救", "久", "九", "走", "糾", "鳩", "啾", "酒", "街", "皆", "階", "姊", "姐", "解", "節", "結", "角", "傑", "捷", "截", "腳", "繳", "教", "交", "膠", "焦", "秋"],
        過: ["過", "果", "國", "個", "郭", "鍋", "我", "估", "姑", "孤", "股", "古", "谷", "骨", "鼓", "故", "顧", "固"],
        
        黏音: [
          "揪喔", "就喔", "肉喔", "走喔", "九五", "借喔", "接喔",
          "jo", "joe", "jou", "yo", "show", "jail", "joke", "josh", "judge",
          "yep", "yes", "yellow", "you", "your", "go", "goal", "glow"
        ],
        
        單字: ["揪", "就", "肉", "走", "歐", "喔", "哦", "傲", "奧", "拗", "腰", "咬", "個", "過", "國", "果", "郭", "鍋"]
      };

      const getGroup = (key) => {
        const set = [...new Set(fuzzyChars[key])];
        const chineseChars = set.filter(s => s.length === 1).join('');
        const words = set.filter(s => s.length > 1);
        return words.length > 0 ? `([${chineseChars}]|${words.join('|')})` : `[${chineseChars}]`;
      };

      const patternLV2_Wide = new RegExp(`^${getGroup("借")}${getGroup("過")}$`);
      
      // 如果過濾後的字數在 2 個字以內
      if (transcript.length <= 2) {
        // 🚀 情況 A：LV1 條件，必須「精確」命中「就過」
        if (transcript === "就過") {
          level = 1;
        }
        // 🚀 情況 B：判定 LV2
        else if (
          (transcript.length === 2 && patternLV2_Wide.test(transcript)) || 
          fuzzyChars["黏音"].includes(transcript)
        ) {
          level = 2;
        }
        // 🚀 情況 C：關鍵防線！長度等於 1 且符合單字庫
        else if (transcript.length === 1 && fuzzyChars["單字"].includes(transcript)) {
          level = 3;
        }
      }

      // 🚨 【解法 B：借過的時間防禦雷達】
      if (level === 1 && transcript === "就過") {
        if (speechDuration > 1.15) {
          level = 0; 
          console.log(`辨識字: "${transcript}" | 說話時間: ${speechDuration.toFixed(2)}秒 (唸太清楚太慢了)`);
        }
      }

      // --- 🎯 4. 最終處理 (依照評審版邏輯，成功便切換影片) ---
      if (level > 0 && db >= DB_THRESHOLD) {
        console.log(`等級: LV${level} | 辨識字: "${transcript}" | 說話時間: ${speechDuration.toFixed(2)}秒`);
        
        stopRecognition();    
        
        switchToVideoB(level);  
      } 
      else {
        if (level === 0) {
          console.log(`辨識字: "${transcript}" | 說話時間: ${speechDuration.toFixed(2)}秒 (未命中有效黏音)`);
        }
        
        let msg = (db < DB_THRESHOLD) ? "你的音量不夠喔！" : "不夠黏喔！<br>請再說得更黏一點。";
        showFailProcess(msg);
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
  modalMessage.innerHTML = msg; 
  
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
  
  // 🎯 1. 隱藏失敗文字，確保區塊乾淨
  modalMessage.style.display = "none";
  
  // 🎯 2. 顯示成功專用區塊 (就是你 HTML 裡的 comingSoonContainer)
  const comingSoon = document.getElementById("comingSoonContainer");
  if (comingSoon) comingSoon.style.display = "block";

  // 🎯 3. 不用 gameModal.classList.add("show")，改加 success-active
  gameModal.classList.add("success-active");

  // 🎯 4. 隱藏遊戲中的 UI
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
  const comingSoon = document.getElementById("comingSoonContainer");
  if (comingSoon) comingSoon.style.display = "none";
  modalMessage.style.display = "flex";

  // 🎯 清除成功狀態
  gameModal.classList.remove("show");
  gameModal.classList.remove("success-active");
  
  modalMessage.textContent = ""; 
  errorResetTimer = null; 
  currentVideo = "A";
  videoPlayer.src = "video/difficult_coming_through_videoA.mp4";
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

function switchToVideoB(level) {
  if (currentVideo === "B") return;
  currentVideo = "B";

  errorResetTimer = null;
  isInitialPromptActive = false;
  cInfoText.classList.remove("show");
  volumeIndicator.style.display = "none";
  
  // 🎯 1. 移植網頁版做法：根據辨識到的 level 決定播放哪支影片！
  // 🎯 2. 使用時間戳記防快取，確保評審每次測試都能精準抓到最新檔案
  videoPlayer.src = `video/difficult_coming_through_videoB_${level}.mp4?t=${new Date().getTime()}`;
  videoPlayer.loop = false;

  videoPlayer.onended = () => {
    videoPlayer.pause();
    showSuccessProcess(); // 呼叫你宣傳版專屬的成功彈窗
  };
  
  // 🎯 3. 確保聲音環境沒有被瀏覽器鎖住
  videoPlayer.muted = false;
  videoPlayer.volume = 1.0;
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume();
  }
  
  videoPlayer.play().catch(err => {
    console.error("Video B 播放失敗或被瀏覽器阻擋:", err);
  });
}