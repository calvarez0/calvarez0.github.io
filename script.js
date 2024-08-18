// Initialize AOS (Animate On Scroll)
AOS.init({
    duration: 1200,
});

// Smooth scroll for navigation links
const scroll = new SmoothScroll('a[href*="#"]', {
    speed: 800,
    speedAsDuration: true
});

// Typewriter effect
document.addEventListener("DOMContentLoaded", () => {
    const typewriterElements = document.querySelectorAll('.typewriter');

    typewriterElements.forEach(element => {
        const text = element.getAttribute('data-text');
        element.textContent = '';
        let index = 0;
        const typingSpeed = 100;

        const type = () => {
            if (index < text.length) {
                element.textContent += text.charAt(index);
                index++;
                setTimeout(type, typingSpeed);
            }
        };

        type();
    });
});

// Contact form validation
const contactForm = document.getElementById('contact-form');
contactForm.addEventListener('submit', function(e) {
    e.preventDefault();
    alert('Thank you for your message!');
    contactForm.reset();
});
