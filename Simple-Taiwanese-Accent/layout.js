// layout.js
function resizeScreen() {
    const container = document.querySelector('.main-container');
    if (!container) return;

    // 偵測目前是橫向還是直向
    const isPortrait = window.innerHeight > window.innerWidth;
    
    // 設定目標尺寸
    const targetWidth = isPortrait ? 1080 : 1920;
    const targetHeight = isPortrait ? 1920 : 1080;

    // 1. 計算縮放比例
    const scale = Math.min(window.innerWidth / targetWidth, window.innerHeight / targetHeight);

    // 2. 計算置中位移量
    const leftPx = (window.innerWidth - (targetWidth * scale)) / 2;
    const topPx = (window.innerHeight - (targetHeight * scale)) / 2;

    // 3. 套用縮放與位移
    container.style.width = `${targetWidth}px`;
    container.style.height = `${targetHeight}px`;
    container.style.transform = `translate(${leftPx}px, ${topPx}px) scale(${scale})`;
}

window.addEventListener('resize', resizeScreen);
window.addEventListener('load', resizeScreen);
document.addEventListener('DOMContentLoaded', resizeScreen);