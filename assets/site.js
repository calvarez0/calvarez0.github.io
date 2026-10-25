// Theme Toggle Logic
const toggle = document.getElementById('theme-toggle');
const body = document.body;

let savedTheme = 'dark';
try {
    savedTheme = localStorage.getItem('theme') || savedTheme;
} catch {}
body.classList.toggle('dark', savedTheme === 'dark');

function updateThemeLabel() {
    const label = body.classList.contains('dark') ? 'Switch to light mode' : 'Switch to dark mode';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
}

updateThemeLabel();
toggle.addEventListener('click', () => {
    body.classList.toggle('dark');
    updateThemeLabel();
    try {
        localStorage.setItem('theme', body.classList.contains('dark') ? 'dark' : 'light');
    } catch {}
});

// Clickable project cards with nested links support
function openCardLink(card) {
    const href = card.dataset.cardLink;
    if (!href) return;
    const target = card.dataset.cardTarget || '_self';

    if (target === '_blank') {
        window.open(href, '_blank', 'noopener,noreferrer');
        return;
    }
    window.location.href = href;
}

document.querySelectorAll('[data-card-link]').forEach(card => {
    card.addEventListener('click', (event) => {
        if (event.target.closest('a, button, input, select, textarea, label')) return;
        openCardLink(card);
    });

    card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openCardLink(card);
    });
});
