// 1. 初始化 Swiper
const swiper = new Swiper(".mySwiper", {
    grabCursor: true,
    effect: "creative",
    centeredSlides: true,
    slidesPerView: "auto",
    loop: false, // 只有一張卡片時，建議設為 false
    allowTouchMove: false, // 只有一張時不需滑動
    speed: 600,
    creativeEffect: {
        limitProgress: 2,
        prev: {
            shadow: false,
            translate: ["-105%", 0, -400],
            rotate: [0, 0, -10],
            opacity: 0.5,
        },
        next: {
            shadow: false,
            translate: ["105%", 0, -400],
            rotate: [0, 0, 10],
            opacity: 0.5,
        },
    },
    // 只有一個 Slide 時，這些會自動失效
    navigation: { 
        nextEl: ".swiper-button-next", 
        prevEl: ".swiper-button-prev" 
    },
    pagination: { 
        el: ".swiper-pagination", 
        clickable: true
    }
});

// 2. 點擊卡牌邏輯
document.querySelector('.mySwiper').addEventListener('click', function (e) {
    const clickedSlide = e.target.closest('.swiper-slide');
    if (!clickedSlide) return;

    // 直接跳轉 URL
    const url = clickedSlide.getAttribute('data-url');
    if (url) window.location.href = url;
});

// 3. 回首頁按鈕
const backBtn = document.querySelector('.go-back');
if (backBtn) {
    backBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
}