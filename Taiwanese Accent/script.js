const videoPlayer = document.getElementById("videoPlayer");
const volumeBar = document.getElementById("volumeBar");
const cInfoText = document.getElementById("cInfoText");
const startOverlay = document.getElementById("startOverlay");
const volumeIndicator = document.getElementById("volumeIndicator");

let currentVideo = "A";
let audioContext, analyser, microphone;
let recognition,
  isRecognizing = false;

let volumeHistory = [];
const VOLUME_HISTORY_MAX = 20; // ✅ 拉長平均視窗，讓讀值更順
const DB_THRESHOLD = -20; // ✅ 先給比較合理的預設（之後可用 log 校正）

let bCountdownTimer = null;

let initialPromptTimer = null;
let errorResetTimer = null;
let errorCountdownTimer = null;

let isInitialPromptActive = false;
const INITIAL_PROMPT_DURATION = 3000;

const ERROR_PROMPT_DURATION = 5000;

// ✅ 改成 2.5 秒後才進入辨識視窗與提示
const START_PROMPT_DELAY_MS = 2500;
const A_END_PROMPT_THRESHOLD_SEC = 5;

window.recognitionStartTime = 0;
window.isAEnding = false;
let isRecognitionWindowActive = false;

// -----------------------
// ✅ 新增：debug 與取樣控制
// -----------------------
const DEBUG_VOLUME = false; // ✅ 要看音量 log 就改 true
let latestDb = -100; // ✅ updateVolumeIndicator 算好，onresult 直接讀
let rafStarted = false; // ✅ 避免 requestAnimationFrame 被重複啟動
let floatBuf = null; // ✅ 重用 buffer，避免每次 new

// ----------------------------------------------------
// 啟動流程
// ----------------------------------------------------
videoPlayer.pause();
videoPlayer.muted = true;

// 一開始先隱藏音量條，等 2.5 秒後再顯示
volumeIndicator.style.display = "none";

startOverlay.addEventListener("click", async () => {
  startOverlay.style.display = "none";

  videoPlayer.muted = false;
  try {
    await videoPlayer.play();
    console.log("▶ 影片 A 開始播放（有聲音）");
  } catch (err) {
    console.warn("播放失敗：", err);
  }

  initRecognition();
  initPoseNet();
});

// ----------------------------------------------------
// 初始化音訊
// ----------------------------------------------------
async function initAudio() {
  try {
    if (audioContext && analyser) {
      // ✅ 已初始化過就不要重複 init
      return;
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();

    // ✅ 分析器設定：更穩
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.85;

    // ✅ 取音：關掉 AGC/降噪/回音消除（避免音量被壓小、起伏變小）
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    microphone = audioContext.createMediaStreamSource(stream);

    // ✅ 可選：GainNode 放大「偵測用」音量（不會影響影片音量）
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 2; // 2~8 都可試，太大會讓背景噪音也變高

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
    console.error("❌ 音訊初始化失敗（請檢查麥克風權限）：", error);
  }
}

// ✅ 用 Float 取樣：更穩、更細
function getVolumeDB() {
  if (!analyser) return -100;

  if (!floatBuf || floatBuf.length !== analyser.fftSize) {
    floatBuf = new Float32Array(analyser.fftSize);
  }

  analyser.getFloatTimeDomainData(floatBuf);

  let sum = 0;
  for (let i = 0; i < floatBuf.length; i++) {
    const v = floatBuf[i]; // -1 ~ 1
    sum += v * v;
  }
  const rms = Math.sqrt(sum / floatBuf.length);

  if (rms < 1e-8) return -100;

  const db = 20 * Math.log10(rms);

  volumeHistory.push(db);
  if (volumeHistory.length > VOLUME_HISTORY_MAX) volumeHistory.shift();

  const avgDb = volumeHistory.reduce((a, b) => a + b) / volumeHistory.length;

  if (DEBUG_VOLUME) {
    console.log(
      `[MIC] rms=${rms.toFixed(6)} db=${db.toFixed(1)} avg=${avgDb.toFixed(1)}`
    );
  }

  return avgDb;
}

function stopRecognition() {
  if (recognition && isRecognizing) {
    recognition.onend = () => {
      isRecognizing = false;
      console.log("🛑 語音辨識被邏輯窗口停止。");
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

function updateVolumeIndicator() {
  if (currentVideo !== "A") {
    volumeBar.style.height = "0%";
    window.isAEnding = false;
    stopRecognition();
    return requestAnimationFrame(updateVolumeIndicator);
  }

  // 依照時間顯示或隱藏音量條（2.5 秒後才出現）
  const START_WINDOW_SEC = START_PROMPT_DELAY_MS / 1000; // 2.5
  if (videoPlayer.currentTime >= START_WINDOW_SEC) {
    volumeIndicator.style.display = "block";
  } else {
    volumeIndicator.style.display = "none";
  }

  // ✅ 只在這裡取樣一次，存到 latestDb
  latestDb = getVolumeDB();
  const db = latestDb;

  // ✅ 音量條映射：加噪音門檻 + 對比增強
const NOISE_GATE_DB = -40;  // 低於此值 = 完全靜音 (0%)
const minDb = -30;          // 說話起點
const maxDb = -12;          // 大聲上限

let percent = 0;
if (db > NOISE_GATE_DB) {   // ✅ 噪音門檻：低於此值強制 0%
  let normalized = (db - minDb) / (maxDb - minDb);
  normalized = Math.min(Math.max(normalized, 0), 1);
  percent = normalized * 100;
}

volumeBar.style.height = `${percent}%`;
volumeBar.style.background = 
  db >= DB_THRESHOLD 
    ? "linear-gradient(to top, #4CAF50, #8BC34A)"
    : "linear-gradient(to top, #FF9800, #FFC107)";


  const videoDuration = videoPlayer.duration;
  let currentTime = videoPlayer.currentTime;
  let END_WINDOW_SEC = videoDuration - A_END_PROMPT_THRESHOLD_SEC;

  if (currentTime < 0.1) {
    if (isInitialPromptActive) {
      console.log("💡 影片重頭播放，強制清除 UI 狀態。");
      isInitialPromptActive = false;
      cInfoText.classList.remove("show");
      clearTimeout(initialPromptTimer);
      clearInterval(errorCountdownTimer);
    }
    currentTime = 0;
  }

  if (
    isNaN(videoDuration) ||
    videoDuration <= START_WINDOW_SEC + A_END_PROMPT_THRESHOLD_SEC
  ) {
    END_WINDOW_SEC = -1;
  }

  const isInRecognitionWindow =
    !isNaN(videoDuration) &&
    videoDuration > 0 &&
    currentTime >= START_WINDOW_SEC &&
    currentTime < END_WINDOW_SEC;

  isRecognitionWindowActive = isInRecognitionWindow;

  if (isInRecognitionWindow && errorResetTimer === null) {
    if (!isRecognizing) {
      startRecognition();
    }
    window.isAEnding = false;
  } else if (!isInRecognitionWindow || errorResetTimer !== null) {
    if (isRecognizing) {
      stopRecognition();
    }

    const remainToEnd = videoDuration - currentTime;
    if (
      remainToEnd <= A_END_PROMPT_THRESHOLD_SEC &&
      remainToEnd > 0.1 &&
      !isNaN(videoDuration)
    ) {
      window.isAEnding = true;
    } else {
      window.isAEnding = false;
    }
  }

  if (isRecognizing || window.isAEnding || isInitialPromptActive) {
    if (window.isAEnding) {
      cInfoText.classList.add("show");
      cInfoText.textContent = `未偵測到再嘗試一次吧`;
      clearTimeout(initialPromptTimer);
      clearTimeout(errorResetTimer);
      clearInterval(errorCountdownTimer);
      isInitialPromptActive = false;
    } else if (isInitialPromptActive) {
      cInfoText.classList.add("show");
    } else if (currentTime < START_WINDOW_SEC) {
      cInfoText.classList.remove("show");
    } else {
      cInfoText.classList.add("show");
      if (db >= DB_THRESHOLD) {
        cInfoText.textContent = "音量足夠：請說出關鍵字「緩光臨」";
      } else {
        cInfoText.textContent = "音量太小：請提高音量說話";
      }
    }
  } else {
    cInfoText.classList.remove("show");
  }

  requestAnimationFrame(updateVolumeIndicator);
}

function setRecognitionEndHandler() {
  recognition.onend = () => {
    isRecognizing = false;
    cInfoText.classList.remove("show");
    clearTimeout(initialPromptTimer);
    clearInterval(errorCountdownTimer);
    isInitialPromptActive = false;
  };
}

function initRecognition() {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    console.error("此瀏覽器不支援語音辨識");
    return;
  }

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
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

    // ✅ 不要再 getVolumeDB()！直接用最新值
    const db = latestDb;

    console.log(`辨識：${transcript} | ${db.toFixed(1)} dB`);

    const fuzzyChars = {
      緩: [
        "緩",
        "還",
        "換",
        "環",
        "歡",
        "莞",
        "宦",
        "喚",
        "萬",
        "呼",
        "乎",
        "忽",
        "灣",
        "彎",
        "碗",
        "晚",
        "婉",
        "鍰",
        "幻",
        "晃",
        "黃",
        "謊",
        "慌",
        "犯",
        "販",
        "範",
        "反",
        "返",
        "法",
        "發",
      ],
      光: [
        "光",
        "廣",
        "逛",
        "洸",
        "胱",
        "觀",
        "關",
        "官",
        "剛",
        "鋼",
        "岡",
        "汪",
        "工",
        "公",
        "功",
        "港",
        "框",
        "曠",
        "狂",
        "礦",
        "況",
        "宏",
        "紅",
        "洪",
        "航",
        "行",
        "缸",
      ],
      臨: [
        "臨",
        "林",
        "零",
        "玲",
        "麟",
        "淋",
        "霖",
        "寧",
        "齡",
        "領",
        "玲",
        "零",
        "鈴",
        "令",
        "鄰",
        "倫",
        "靈",
        "理",
        "立",
        "曆",
        "利",
        "裡",
        "里",
        "禮",
        "人",
        "認",
        "任",
        "忍",
        "刃",
        "能",
        "農",
      ],
    };

    function fuzzyMatch(text) {
      const targetWords = ["緩", "光", "臨"];
      let matchCount = 0;

      targetWords.forEach((key) => {
        const lowerCaseText = text.toLowerCase();
        const isMatched = fuzzyChars[key].some((variant) =>
          lowerCaseText.includes(variant)
        );
        if (isMatched) matchCount++;
      });
      return matchCount >= 2;
    }

    const keywordMatched = fuzzyMatch(transcript);

    if (DEBUG_VOLUME) {
      console.log(
        `[CHECK] volumeOK=${db >= DB_THRESHOLD} keywordOK=${keywordMatched}`
      );
    }

    if (db >= DB_THRESHOLD && keywordMatched) {
      stopRecognition();
      clearTimeout(errorResetTimer);
      clearInterval(errorCountdownTimer);
      errorResetTimer = null;
      switchToVideoB();
    } else {
      let errorMessage = "";
      if (db < DB_THRESHOLD) {
        errorMessage = "你的音量不夠喔！請提高音量再試一次。";
      } else if (!keywordMatched) {
        errorMessage = "你的聲音不夠黏喔！請說出關鍵字「緩光臨」。";
      }

      if (errorMessage) {
        let initialCountdown = ERROR_PROMPT_DURATION / 1000;
        cInfoText.textContent = `${errorMessage} (${initialCountdown})`;
        cInfoText.classList.add("show");
        isInitialPromptActive = true;

        clearTimeout(initialPromptTimer);
        clearTimeout(errorResetTimer);
        clearInterval(errorCountdownTimer);

        let countdown = initialCountdown;
        errorCountdownTimer = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            cInfoText.textContent = `${errorMessage} (${countdown})`;
          } else {
            clearInterval(errorCountdownTimer);
          }
        }, 1000);

        errorResetTimer = setTimeout(() => {
          console.log("錯誤提示 5 秒結束，強制重置影片 A。");
          errorResetTimer = null;
          clearInterval(errorCountdownTimer);

          if (recognition && isRecognizing) {
            recognition.stop();
          }

          if (currentVideo === "A") {
            videoPlayer.currentTime = 0;
          }
        }, ERROR_PROMPT_DURATION);
      }
    }
  };

  recognition.onerror = (event) => {
    console.error("語音辨識錯誤:", event.error);
    isRecognizing = false;
    if (recognition) recognition.stop();
  };

  setRecognitionEndHandler();
}

function startRecognition() {
  if (!recognition || isRecognizing) return;
  try {
    recognition.start();
    isRecognizing = true;
    window.recognitionStartTime = performance.now();
    console.log("🟢 語音辨識啟動 (由窗口邏輯控制)");

    clearTimeout(initialPromptTimer);
    clearTimeout(errorResetTimer);
    clearInterval(errorCountdownTimer);
    errorResetTimer = null;

    // ✅ 這裡會在 2.5 秒視窗啟動時顯示「可以開始說話」
    if (videoPlayer.currentTime < START_PROMPT_DELAY_MS / 1000 + 0.5) {
      isInitialPromptActive = true;
      cInfoText.textContent = "可以開始說話";
      initialPromptTimer = setTimeout(() => {
        isInitialPromptActive = false;
        console.log("初始提示時間結束，開始動態音量偵測。");
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

function switchToVideoB() {
  if (currentVideo === "B") return;

  currentVideo = "B";
  clearTimeout(initialPromptTimer);
  clearTimeout(errorResetTimer);
  clearInterval(errorCountdownTimer);
  errorResetTimer = null;
  isInitialPromptActive = false;
  cInfoText.classList.remove("show");
  clearInterval(bCountdownTimer);

  volumeBar.style.height = "0%";
  document.getElementById("volumeIndicator").style.display = "none";

  window.isAEnding = false;
  isRecognitionWindowActive = false;

  videoPlayer.src = "videoB.mp4";
  videoPlayer.loop = false;

  videoPlayer.onloadedmetadata = () => {
    if (!videoPlayer.duration || isNaN(videoPlayer.duration)) {
      console.error("❌ 影片 B 載入成功，但 duration 無效！請檢查影片檔案。");
      videoPlayer.onloadedmetadata = null;
      return;
    }
    console.log(
      `🎬 影片 B 載入完成，時長: ${videoPlayer.duration.toFixed(2)}s`
    );
    videoPlayer.onloadedmetadata = null;
  };

  videoPlayer.onended = () => resetToA();
  videoPlayer.play();
}

function startCountdownForB(duration) {
  clearInterval(bCountdownTimer);
}

function resetToA() {
  cInfoText.classList.remove("show");
  clearInterval(bCountdownTimer);

  clearTimeout(initialPromptTimer);
  clearTimeout(errorResetTimer);
  clearInterval(errorCountdownTimer);
  errorResetTimer = null;
  isInitialPromptActive = false;

  window.isAEnding = false;
  isRecognitionWindowActive = false;

  videoPlayer.onloadedmetadata = null;
  videoPlayer.onended = null;

  currentVideo = "A";
  videoPlayer.src = "videoA.mp4";
  videoPlayer.loop = true;

  videoPlayer.play();

  volumeBar.style.height = "0%";

  setTimeout(() => {
    setRecognitionEndHandler();
    console.log("🔄 系統已重設回影片 A，等待窗口邏輯重新控制辨識。");
  }, 500);
}

async function initPoseNet() {
  try {
    const net = await posenet.load();
    console.log("✨ PoseNet 已載入");
  } catch (error) {
    console.error("❌ PoseNet 載入失敗:", error);
  }
}
