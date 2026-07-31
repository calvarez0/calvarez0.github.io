(function () {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.classList.toggle('dark', savedTheme === 'dark');

    const buttons = document.querySelectorAll('[data-theme-toggle]');

    function syncButtons() {
        const isDark = document.body.classList.contains('dark');
        buttons.forEach((button) => {
            button.setAttribute('aria-pressed', String(isDark));
        });
    }

    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            document.body.classList.toggle('dark');
            localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
            syncButtons();
        });
    });

    syncButtons();

    const searchInput = document.querySelector('[data-search-input]');
    const searchForm = document.querySelector('[data-archive-search]');
    const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));
    const archiveItems = Array.from(document.querySelectorAll('[data-archive-item]'));
    const countEl = document.querySelector('[data-search-count]');
    const emptyEl = document.querySelector('[data-empty-state]');
    let activeFilter = 'all';

    function normalize(value) {
        return value.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function updateArchive() {
        if (!archiveItems.length) {
            return;
        }

        const query = normalize(searchInput ? searchInput.value : '');
        let visibleCount = 0;

        archiveItems.forEach((item) => {
            const categories = (item.dataset.category || '').split(/\s+/);
            const searchableText = normalize(`${item.dataset.search || ''} ${item.textContent || ''}`);
            const matchesFilter = activeFilter === 'all' || categories.includes(activeFilter);
            const matchesSearch = !query || searchableText.includes(query);
            const isVisible = matchesFilter && matchesSearch;

            item.hidden = !isVisible;
            if (isVisible) {
                visibleCount += 1;
            }
        });

        if (countEl) {
            countEl.textContent = `${visibleCount} ${visibleCount === 1 ? 'page' : 'pages'}`;
        }

        if (emptyEl) {
            emptyEl.hidden = visibleCount !== 0;
        }
    }

    filterButtons.forEach((button) => {
        button.addEventListener('click', () => {
            activeFilter = button.dataset.filter || 'all';
            filterButtons.forEach((candidate) => {
                const isActive = candidate === button;
                candidate.classList.toggle('is-active', isActive);
                candidate.setAttribute('aria-pressed', String(isActive));
            });
            updateArchive();
        });
    });

    if (searchInput) {
        searchInput.addEventListener('input', updateArchive);
    }

    if (searchForm) {
        searchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            updateArchive();
        });
    }

    updateArchive();
})();
