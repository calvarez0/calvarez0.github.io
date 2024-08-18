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
    const typewriterElement = document.querySelector('.typewriter');
    const menu = document.getElementById('menu');
    const text = typewriterElement.getAttribute('data-text');
    let index = 0;
    const typingSpeed = 100;

    const type = () => {
        if (index < text.length) {
            typewriterElement.textContent += text.charAt(index);
            index++;
            setTimeout(type, typingSpeed);
        } else {
            // After typing is complete, show the profile
            showProfile();
    
            // Introduce a slight delay before showing the menu
            setTimeout(showMenu, 500); // Adjust the delay as needed
        }
    };

    type();
});

function showProfile() {
    const profileElement = document.getElementById('profile');
    profileElement.style.display = 'block'; // Or use your preferred display style
  }

// Make scrollToSection globally accessible
function scrollToSection(sectionId) {
    document.getElementById(sectionId).scrollIntoView({ behavior: 'smooth' });
}

function showMenu() {
    document.getElementById('menu').innerHTML = `
        <button onclick="scrollToSection('about')">About Me</button>
        <button onclick="scrollToSection('projects')">Projects</button>
        <button onclick="scrollToSection('research')">Research</button>
        <button onclick="scrollToSection('contact')">Contact</button>
    `;
}

// Initialize EmailJS with your user ID
(function() {
    emailjs.init("YOUR_USER_ID"); // Replace with your EmailJS user ID
})();

document.getElementById('contact-form').addEventListener('submit', function(event) {
    event.preventDefault();

    // Send the email
    emailjs.sendForm('YOUR_SERVICE_ID', 'YOUR_TEMPLATE_ID', this)
        .then(function() {
            alert('Thank you for your message!');
            document.getElementById('contact-form').reset();
        }, function(error) {
            alert('Failed to send your message. Please try again later.');
        });
});