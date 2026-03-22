// 1. 初始化 Swiper
const swiper = new Swiper(".mySwiper", {
    grabCursor: true,
    effect: "coverflow",
    centeredSlides: true,
    slidesPerView: "auto",
    loop: false, // 只有一張卡片時，建議設為 false
    allowTouchMove: false, // 只有一張時不需滑動
    speed: 600,
    coverflowEffect: {
        rotate: 0,        /* 卡牌旋轉角度 */
        stretch: 80,      /* 💡 卡牌之間的間距 (正值會重疊，負值會拉開) */
        depth: 200,       /* 遠近深度感 */
        modifier: 1,
        slideShadows: false,
    },
    
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

// 💡 關鍵：當 layout.js 縮放畫面後，必須更新 Swiper
function updateSwiperAfterResize() {
    setTimeout(() => {
        if (typeof swiper !== 'undefined') {
            swiper.update(); // 重新計算寬度
            swiper.slideTo(swiper.activeIndex, 0); // 鎖定在目前的 slide
        }
    }, 150); // 給瀏覽器一點點時間完成 transform
}

window.addEventListener('resize', updateSwiperAfterResize);
window.addEventListener('load', updateSwiperAfterResize);

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