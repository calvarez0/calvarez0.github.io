// Initialize AOS (Animate On Scroll)
AOS.init({
    duration: 1200,
});

// Smooth scroll for navigation links
const scroll = new SmoothScroll('a[href*="#"]', {
    speed: 800,
    speedAsDuration: true
});

// Contact form validation
const contactForm = document.getElementById('contact-form');
contactForm.addEventListener('submit', function(e) {
    e.preventDefault();
    alert('Thank you for your message!');
    contactForm.reset();
});
