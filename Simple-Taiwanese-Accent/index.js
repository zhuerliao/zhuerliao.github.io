const ruleBtn = document.querySelector('.btn.rule');
const indexStartBtn = document.getElementById('indexStartBtn');
const mainContainer = document.querySelector('.main-container');

// 💡 視窗自適應縮放邏輯
function resizeScreen() {
    const targetWidth = 1920;
    const targetHeight = 1080;
    
    // 取得目前瀏覽器視窗寬高
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // 計算縮放比例 (取最小的比例，確保完整塞進去)
    const scaleX = windowWidth / targetWidth;
    const scaleY = windowHeight / targetHeight;
    const scale = Math.min(scaleX, scaleY);
    
    // 套用 Transform Scale
    if (mainContainer) {
        mainContainer.style.transform = `scale(${scale})`;
    }
}

// 監聽視窗縮放與初次載入
window.addEventListener('resize', resizeScreen);
window.addEventListener('load', resizeScreen);
resizeScreen(); // 立即執行一次

// 原有導航邏輯
function goToRules() {
    window.location.href = 'rules.html';
}

function goToChoose() {
    window.location.href = 'selection.html';
}

ruleBtn.addEventListener('click', goToRules);
indexStartBtn.addEventListener('click', goToChoose);