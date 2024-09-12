document.addEventListener("DOMContentLoaded", () => {
    const body = document.body;
    const titleText = body.getAttribute("data-title"); // Changing dynamically from data-title attribute
    let index = 0;
    const typeSpeed = 100;

    function typeWriterEffect() {
        if (index < titleText.length) {
            document.getElementById("typewriter-text").innerHTML += titleText.charAt(index);
            index++;
            setTimeout(typeWriterEffect, typeSpeed);
        }
    }
    typeWriterEffect();

    const toggleButton = document.getElementById('theme-toggle');
    const themeStylesheet = document.getElementById('theme-stylesheet');

    if (localStorage.getItem('theme') === 'dark') {
        themeStylesheet.href = 'dark.css';
        toggleButton.textContent = 'Blue Pill'; 
    }

    toggleButton.addEventListener('click', () => {
        if (themeStylesheet.href.includes('styles.css')) {
            themeStylesheet.href = 'dark.css';
            toggleButton.textContent = 'Blue Pill'; 
            localStorage.setItem('theme', 'dark');
        } else {
            themeStylesheet.href = 'styles.css';
            toggleButton.textContent = 'Red Pill?';
            localStorage.setItem('theme', 'light');
        }
    });

    const aboutMeToggle = document.getElementById('about-me-toggle');
    const aboutMeContent = document.getElementById('about-me-content');

    aboutMeToggle.addEventListener('click', () => {
        aboutMeContent.classList.toggle('collapsed');
        aboutMeToggle.querySelector('i').classList.toggle('fa-chevron-down');
        aboutMeToggle.querySelector('i').classList.toggle('fa-chevron-up');
    });
});
