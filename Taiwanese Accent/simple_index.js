const modal = document.getElementById('ruleModal');
const openBtn = document.querySelector('.btn.rule'); // 互動規則按鈕
const closeBtn = document.getElementById('closeBtn'); // 彈窗 X 按鈕

// 抓取兩個跳轉按鈕
const indexStartBtn = document.getElementById('indexStartBtn'); // 首頁中間那個
const modalStartBtn = document.getElementById('modalStartBtn'); // 彈窗裡面那個

// 統一跳轉函式
function goToChoose() {
    console.log("導向至選擇頁面...");
    window.location.href = 'simple_choose.html';
}

// 1. 打開彈窗
openBtn.addEventListener('click', () => {
    modal.showModal();
});

// 2. 關閉彈窗 (X 按鈕)
closeBtn.addEventListener('click', () => {
    modal.close();
});

// 3. 點擊背景關閉
modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
});

// 4. 首頁「開始互動」按鈕點擊
indexStartBtn.addEventListener('click', goToChoose);

// 5. 彈窗內「開始互動」按鈕點擊
if (modalStartBtn) {
    modalStartBtn.addEventListener('click', () => {
        modal.close();
        goToChoose();
    });
}