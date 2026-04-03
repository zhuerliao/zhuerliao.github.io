const mainContainer = document.querySelector('.main-container');

function resizeScreen() {
    const container = document.querySelector('.main-container');
    if (!container) return;

    // 💡 判斷直橫向（確保跟你的設計稿比例一致）
    const isPortrait = window.innerHeight > window.innerWidth;
    
    // 設定目標畫布大小
    const targetWidth = isPortrait ? 1080 : 1920;
    const targetHeight = isPortrait ? 1920 : 1080;

    // 1. 計算縮放比例
    const scale = Math.min(window.innerWidth / targetWidth, window.innerHeight / targetHeight);

    // 2. 計算置中位移 (Precision Offset)
    const leftPx = (window.innerWidth - (targetWidth * scale)) / 2;
    const topPx = (window.innerHeight - (targetHeight * scale)) / 2;

    // 3. 套用樣式
    container.style.width = `${targetWidth}px`;
    container.style.height = `${targetHeight}px`;
    
    // 💡 使用 translate3d 解決 Safari 裁切問題
    container.style.transform = `translate3d(${leftPx}px, ${topPx}px, 0) scale(${scale})`;
}

// 💡 確保各種時機都會觸發
window.addEventListener('resize', resizeScreen);
window.addEventListener('orientationchange', resizeScreen); // 針對手機轉向
document.addEventListener('DOMContentLoaded', resizeScreen);
window.addEventListener('load', resizeScreen);

// 立即執行一次
resizeScreen();

function init() {
    const indexStartBtn = document.getElementById('indexStartBtn');
    if (indexStartBtn) {
        indexStartBtn.onclick = () => window.location.href = 'rules.html';
    }
}
init();