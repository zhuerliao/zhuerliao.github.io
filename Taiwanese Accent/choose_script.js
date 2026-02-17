const swiper = new Swiper(".mySwiper", {
centeredSlides: true,
slidesPerView: "auto",
/* 關閉 spaceBetween，改用 stretch 控制，對位會更精準 */
spaceBetween: 0,
// 關鍵：確保初始化時計算正確的偏移量
observer: true,
observeParents: true,
effect: "coverflow",
coverflowEffect: {
rotate: 0,
/* stretch 若為正數，圖片會重疊；若為負數，圖片會分開 */
/* 因為你的容器變窄了，這裡設定負值（例如 -50）可以讓圖片對齊得更好看 */
stretch: -20,
depth: 100,
modifier: 1,
slideShadows: false,
},

navigation: {
nextEl: ".swiper-button-next",
prevEl: ".swiper-button-prev",
},
pagination: {
el: ".swiper-pagination",
clickable: true,
},

on: {
init: function () {
setTimeout(() => {
this.update();
}, 200);
},
}
});

// --- 回首頁按鈕邏輯 ---
const backBtn = document.querySelector('.btn.go.back'); // 對應你 HTML 的 class
if (backBtn) {
backBtn.addEventListener('click', () => {
window.location.href = 'index.html';
});
}

// --- 首頁彈窗邏輯 (加上判斷避免在 choose.html 報錯) ---
const modal = document.getElementById('ruleModal');
const openBtn = document.querySelector('.btn.rule');
if (modal && openBtn) {
openBtn.addEventListener('click', () => modal.showModal());
// ...其餘彈窗邏輯
}