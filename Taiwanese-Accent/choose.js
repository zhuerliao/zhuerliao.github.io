const swiper = new Swiper(".mySwiper", {
    centeredSlides: true,
    slidesPerView: "auto",
    preventClicks: true,
    preventClicksPropagation: true,
    touchStartPreventDefault: false,
    spaceBetween: 0,
    observer: true,
    observeParents: true,
    effect: "coverflow",
    coverflowEffect: {
        rotate: 0,
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
    }
});

// 處理點擊跳轉
// 使用最穩定的原生點擊監聽方式
document.querySelector('.mySwiper').addEventListener('click', function (e) {
    
    // 1. 檢查點擊的是否為箭頭（或是箭頭內的元素），如果是就完全跳過邏輯
    if (e.target.closest('.swiper-button-next') || e.target.closest('.swiper-button-prev')) {
        return; 
    }

    // 2. 找到點擊到的 slide
    const clickedSlide = e.target.closest('.swiper-slide');
    if (!clickedSlide) return;

    // 3. 判斷點擊的是否為中間那張
    if (clickedSlide.classList.contains('swiper-slide-active')) {
        // 執行跳轉
        const url = clickedSlide.getAttribute('data-url');
        if (url) {
            window.location.href = url;
        }
    } else {
        // 如果點擊的是旁邊的，則讓 Swiper 滑動過去
        // 取得該 slide 的索引
        const allSlides = Array.from(document.querySelectorAll('.swiper-slide'));
        const index = allSlides.indexOf(clickedSlide);
        swiper.slideTo(index);
    }
});

// 回首頁邏輯
const backBtn = document.querySelector('.btn.go.back');
if (backBtn) {
    backBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
}