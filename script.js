// Typewriter effect
document.addEventListener("DOMContentLoaded", () => {
    const typewriterElement = document.querySelector('.typewriter');
    const text = typewriterElement.getAttribute('data-text');
    typewriterElement.textContent = '';
    let index = 0;
    const typingSpeed = 100;

    const type = () => {
        if (index < text.length) {
            typewriterElement.textContent += text.charAt(index);
            index++;
            setTimeout(type, typingSpeed);
        } else {
            setTimeout(() => {
                document.getElementById('menu').classList.remove('hidden');
            }, 500);
        }
    };

    type();
});

function showContent(section) {
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
    document.getElementById(section).classList.remove('hidden');
}

function goBack() {
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => section.classList.add('hidden'));

    document.getElementById('content').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
}
