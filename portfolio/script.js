/* --- Custom scrolling implementation --- */
(() => {
  const container = document.getElementById('scroll-container');
  const sections = [...document.querySelectorAll('section')];
  const fill = document.getElementById('fill');
  const track = document.getElementById('track');
  const corner = document.getElementById('cornerLabel');
  const progressContainer = document.querySelector('.progress');

  let scrollY = 0;
  let maxScroll = 0;
  let isScrolling = false;
  let scrollTimeout;

  // Calculate max scroll based on container height
  function updateMaxScroll() {
    maxScroll = container.scrollHeight - window.innerHeight;
  }

  // Update the visual position of the container
  function updateContainerPosition() {
    container.style.transform = `translateY(${-scrollY}px)`;
  }

  // Find the nearest section and snap only if between sections
  function snapToNearestSection() {
    const viewportTop = scrollY;
    const viewportBottom = scrollY + window.innerHeight;
    const viewportHeight = window.innerHeight;

    // Check if viewport is showing parts of multiple sections (between sections)
    let sectionsInView = [];

    sections.forEach((sec, index) => {
      const secTop = sec.offsetTop;
      const secBottom = secTop + sec.offsetHeight;

      // Check if any part of this section is visible
      if (viewportBottom > secTop && viewportTop < secBottom) {
        sectionsInView.push({
          section: sec,
          index,
          top: secTop,
          bottom: secBottom
        });
      }
    });

    // Only snap if we're showing parts of 2+ sections (between sections)
    if (sectionsInView.length > 1) {
      // We're between sections. Find the boundary between them.

      // Sort by index to get them in order
      sectionsInView.sort((a, b) => a.index - b.index);

      const firstSection = sectionsInView[0];
      const secondSection = sectionsInView[1];

      // The boundary is where first section ends and second begins
      const boundary = secondSection.top;

      // Calculate what % of each section is visible
      const firstVisibleHeight = Math.min(viewportBottom, firstSection.bottom) - Math.max(viewportTop, firstSection.top);
      const secondVisibleHeight = Math.min(viewportBottom, secondSection.bottom) - Math.max(viewportTop, secondSection.top);

      // Snap to whichever section has more visible content
      if (secondVisibleHeight > firstVisibleHeight) {
        // More of the second section is visible - snap forward to it
        animateScrollTo(secondSection.top);
      } else {
        // More of the first section is visible - stay in it
        // BUT: position so we can see the bottom of the first section (not the top)
        // Calculate scroll position that puts the bottom of first section at bottom of viewport
        const targetScroll = firstSection.bottom - viewportHeight;

        // Make sure we don't scroll past the top of the first section
        const minScroll = firstSection.top;
        const finalScroll = Math.max(minScroll, targetScroll);

        animateScrollTo(finalScroll);
      }
    }
    // If only one section is visible, don't snap - let them read freely
  }

  // Smooth animation to target scroll position
  function animateScrollTo(target) {
    const start = scrollY;
    const distance = target - start;
    const duration = 300; // ms
    const startTime = performance.now();

    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);

      scrollY = start + distance * ease;
      scrollY = Math.max(0, Math.min(scrollY, maxScroll));

      updateContainerPosition();
      updateFill();
      updateActiveSection();

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }

  // Handle wheel events for custom scrolling
  function handleWheel(e) {
    e.preventDefault();

    // Clear existing timeout
    clearTimeout(scrollTimeout);
    isScrolling = true;

    // Update scroll position (instant, no smoothing)
    scrollY += e.deltaY;
    scrollY = Math.max(0, Math.min(scrollY, maxScroll));

    updateContainerPosition();
    updateFill();
    updateActiveSection();

    // Set timeout to snap after scrolling stops
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
      snapToNearestSection();
    }, 150);
  }

  // Handle touch events for mobile
  let touchStartY = 0;
  let touchStartScrollY = 0;

  function handleTouchStart(e) {
    touchStartY = e.touches[0].clientY;
    touchStartScrollY = scrollY;
    clearTimeout(scrollTimeout);
  }

  function handleTouchMove(e) {
    e.preventDefault();
    const touchY = e.touches[0].clientY;
    const deltaY = touchStartY - touchY;

    scrollY = touchStartScrollY + deltaY;
    scrollY = Math.max(0, Math.min(scrollY, maxScroll));

    updateContainerPosition();
    updateFill();
    updateActiveSection();
  }

  function handleTouchEnd(e) {
    scrollTimeout = setTimeout(() => {
      snapToNearestSection();
    }, 150);
  }

  // Attach wheel and touch listeners
  window.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('touchstart', handleTouchStart, { passive: false });
  window.addEventListener('touchmove', handleTouchMove, { passive: false });
  window.addEventListener('touchend', handleTouchEnd, { passive: false });

  // Create tick segments for each section (proportional to section height)
  const ticks = sections.map(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'tick';
    wrapper.style.position = 'absolute';
    wrapper.style.right = '0';
    wrapper.style.overflow = 'hidden';

    const fill = document.createElement('div');
    fill.className = 'tick-fill';
    fill.style.position = 'absolute';
    fill.style.top = '0';
    fill.style.left = '0';
    fill.style.width = '100%';
    fill.style.height = '0%';

    wrapper.appendChild(fill);
    track.appendChild(wrapper);
    return { wrapper, fill };
  });

  // Position ticks based on actual section heights
  function positionTicks() {
    const trackRect = track.getBoundingClientRect();
    const trackHeight = trackRect.height;
    const docHeight = container.scrollHeight;

    sections.forEach((sec, i) => {
      const sectionStart = sec.offsetTop;
      const sectionHeight = sec.offsetHeight;

      // Calculate position and height as percentage of track
      const startPercent = (sectionStart / docHeight) * 100;
      const heightPercent = (sectionHeight / docHeight) * 100;

      // Position the tick wrapper
      const wrapper = ticks[i].wrapper;
      const fillEl = ticks[i].fill;

      wrapper.style.top = `${(startPercent / 100) * trackHeight}px`;
      wrapper.style.height = `${(heightPercent / 100) * trackHeight}px`;
      wrapper.style.width = '2px';
      wrapper.style.borderRadius = '0';

      // Use each section's background color for its tick
      const bg = sec.dataset.bg || '#9aa0a6';
      wrapper.style.background = 'rgba(128, 128, 128, 0.3)'; // Dim background
      fillEl.style.background = bg; // Bright fill color
    });
  }

  // Track the current centered section to preserve on resize/zoom
  let resizeTimeout;
  addEventListener('resize', () => {
    // Find which section is currently centered
    const viewportCenter = scrollY + window.innerHeight / 2;
    let centerSection = sections[0];
    let centerSectionProgress = 0;

    for (const sec of sections) {
      const secTop = sec.offsetTop;
      const secBottom = secTop + sec.offsetHeight;

      if (viewportCenter >= secTop && viewportCenter < secBottom) {
        centerSection = sec;
        // Calculate how far through this section we are (0 to 1)
        centerSectionProgress = (viewportCenter - secTop) / sec.offsetHeight;
        break;
      }
    }

    // Clear existing timeout
    clearTimeout(resizeTimeout);

    // Debounce the recalculation slightly
    resizeTimeout = setTimeout(() => {
      updateMaxScroll();
      positionTicks();

      // Recalculate scroll position to maintain the same section position
      const newSectionTop = centerSection.offsetTop;
      const newSectionHeight = centerSection.offsetHeight;
      const newViewportCenter = newSectionTop + (newSectionHeight * centerSectionProgress);

      scrollY = newViewportCenter - window.innerHeight / 2;
      scrollY = Math.max(0, Math.min(scrollY, maxScroll));

      updateContainerPosition();
      updateFill();
      updateActiveSection();
    }, 10);
  });
  addEventListener('load', () => {
    updateMaxScroll();
    positionTicks();
  });

  // Interactive drag functionality
  let isDragging = false;

  function scrollToPosition(clientY) {
    const trackRect = track.getBoundingClientRect();
    const trackTop = trackRect.top;
    const trackHeight = trackRect.height;
    const relativeY = clientY - trackTop;
    const percentage = Math.max(0, Math.min(1, relativeY / trackHeight));

    scrollY = percentage * maxScroll;
    updateContainerPosition();
    updateFill();
    updateActiveSection();
  }

  track.addEventListener('mousedown', (e) => {
    isDragging = true;
    progressContainer.classList.add('active');
    scrollToPosition(e.clientY);
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      scrollToPosition(e.clientY);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      progressContainer.classList.remove('active');
    }
  });

  track.addEventListener('click', (e) => {
    scrollToPosition(e.clientY);
  });

  // Update fill height based on scroll position
  function updateFill() {
    // Update each section's tick fill based on scroll progress through that section
    sections.forEach((sec, i) => {
      const sectionStart = sec.offsetTop;
      const sectionEnd = sectionStart + sec.offsetHeight;
      const viewportBottom = scrollY + window.innerHeight;

      let fillPercent = 0;

      if (scrollY >= sectionEnd) {
        // Completely scrolled past this section
        fillPercent = 100;
      } else if (viewportBottom <= sectionStart) {
        // Haven't reached this section yet
        fillPercent = 0;
      } else {
        // Currently in this section - calculate progress
        const visibleEnd = Math.min(viewportBottom, sectionEnd);
        const sectionHeight = sec.offsetHeight;

        // Calculate how much of the section has been scrolled through
        const scrolledThrough = visibleEnd - sectionStart;
        fillPercent = Math.max(0, Math.min(100, (scrolledThrough / sectionHeight) * 100));
      }

      ticks[i].fill.style.height = fillPercent + '%';
    });

    // Also update the main fill for backwards compatibility
    const pct = maxScroll > 0 ? Math.max(0, Math.min(1, scrollY / maxScroll)) : 0;
    fill.style.height = (pct * 100) + '%';
    fill.style.opacity = '0'; // Hide the main fill since we're using ticks now
  }

  // Apply background colors directly to sections
  sections.forEach(sec => {
    const bg = sec.dataset.bg;
    const fg = sec.dataset.fg;
    if (bg) sec.style.backgroundColor = bg;
    if (fg) sec.style.color = fg;
  });

  // Update corner label and nav colors based on current section
  const nav = document.querySelector('nav');

  function updateActiveSection() {
    const viewportCenter = scrollY + window.innerHeight / 2;

    let activeSection = sections[0];
    for (const sec of sections) {
      const secTop = sec.offsetTop;
      const secBottom = secTop + sec.offsetHeight;

      if (viewportCenter >= secTop && viewportCenter < secBottom) {
        activeSection = sec;
        break;
      }
    }

    if (activeSection && activeSection.dataset.title) {
      corner.textContent = activeSection.dataset.title;
    }

    // Update nav and corner colors to match section text color
    const fg = activeSection.dataset.fg;
    if (fg) {
      corner.style.color = fg;
      nav.style.color = fg;
    }
  }

  // Handle anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = anchor.getAttribute('href').substring(1);
      const targetSection = document.getElementById(targetId);

      if (targetSection) {
        scrollY = targetSection.offsetTop;
        scrollY = Math.max(0, Math.min(scrollY, maxScroll));
        updateContainerPosition();
        updateFill();
        updateActiveSection();
      }
    });
  });

  // Initial setup
  window.setTimeout(() => {
    updateMaxScroll();
    positionTicks();
    updateFill();
    updateActiveSection();
  }, 100);
})();

/* --- Favorites Expansion --- */
(() => {
  // Rainbow colors that are visible against beige background
  const rainbowColors = [
    '#cc0000', // red
    '#d94d00', // red-orange
    '#cc6600', // orange
    '#b8860b', // dark goldenrod
    '#997a00', // dark yellow
    '#008000', // green
    '#006b6b', // teal
    '#0080cc', // blue
    '#0000cc', // dark blue
    '#4b0082', // indigo
    '#6a0dad', // purple
    '#8b008b', // dark magenta
    '#cc0066', // magenta-red
    '#b30047'  // deep pink
  ];

  // Shuffle array function
  function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Get all favorite items and assign random colors
  const favoriteItems = document.querySelectorAll('.favorite-item');
  const shuffledColors = shuffleArray(rainbowColors);

  favoriteItems.forEach((item, index) => {
    // Assign random color from shuffled array, cycling if needed
    const color = shuffledColors[index % shuffledColors.length];
    item.style.color = color;
    // Store original color for hover effect
    item.dataset.originalColor = color;
  });

  // Placeholder data for each category
  const favoritesData = {
    concerts: [
      { title: "Bob Dylan – The 30th Anniversary Concert", year: "1992", url: "#" },
      { title: "RAYE - Live at Montreux Jazz Festival", year: "2024", url: "#" },
      { title: "tracy chapman live?", year: "2020", url: "#" },
      { title: "Radiohead live", year: "2020", url: "#" },
      { title: "Bad bunny tiny desk", year: "2020", url: "#" }
    ],
    movies: [
      { title: "Gattaca", year: "2020", url: "#" },
      { title: "City of Gods", year: "2010", url: "#" },
      { title: "Fight Club", year: "2015", url: "#" }
    ],
    albums: [
      // find a way to dadd artist
      { title: "The Freewheelin' Bob Dylan", year: "2018", url: "#" },
      { title: "REWORK", year: "2012", url: "#" },
      { title: "Daisy", year: "2019", url: "#" },
      { title: "One Night Stand", year: "1963", url: "#" },
      { title: "Dummy", year: "1994", url: "#" },
      { title: "Drukqs", year: "2001", url: "#" },
      { title: "The Deep End", year: "2018", url: "#" },
      { title: "Le Tigre", year: "1999", url: "#" },
      { title: "Mezzanine", year: "1998", url: "#" },
      { title: "Sings Again", year: "1986", url: "#" },
      { title: "Breath From Another", year: "1998", url: "#" }

    ],
    books: [
      // add author
      { title: "Man's Search For Meaning", year: "2010", url: "#" },
      { title: "", year: "2012", url: "#" },
      { title: "Placeholder Book 3", year: "2016", url: "#" }
    ],
    videos: [
      { title: "Miracle on Six Train", year: "2020", url: "#" },
      { title: "Placeholder Video 2", year: "2021", url: "#" },
      { title: "Placeholder Video 3", year: "2022", url: "#" }
    ],
    history: [
      { title: "Lee Kuan Yew", year: "", url: "#" },
      { title: "Alexander The Great", year: "", url: "#" },
      { title: "", year: "", url: "#" }
    ],
    wikipedia: [
      { title: "Chet Baker", year: "", url: "#" },
      { title: "Nia (Cuban Lady)", year: "", url: "#" },
      { title: "Tracy Mcgrady", year: "", url: "#" }
    ],
    musicians: [
      { title: "Bob Dylan", year: "", url: "#" },
      { title: "Arca", year: "", url: "#" },
      { title: "Jai Paul", year: "", url: "#" }
    ],
    researchers: [
      { title: "Sam Gershman", year: "", url: "#" },
      { title: "Max Tegmark", year: "", url: "#" },
      { title: "Sebastian Seung", year: "", url: "#" }
    ],
    artists: [
      { title: "Leonardo DaVinci", year: "", url: "#" },
      { title: "Basquiat", year: "", url: "#" },
      { title: "Caravaggio", year: "", url: "#" },
      { title: "Banksy", year: "", url: "#" },
    ],
    papers: [
      { title: "Platonic Representation Hypothesis", year: "2020", url: "#" },
      { title: "Placeholder Paper 2", year: "2021", url: "#" },
      { title: "Placeholder Paper 3", year: "2022", url: "#" }
    ],
    designers: [
      { title: "Steve Jobs", year: "", url: "#" },
      { title: "Leonardo Davinci", year: "", url: "#" },
      { title: "Virgil Abloh", year: "", url: "#" }
    ],
    philosophers: [
      { title: "Marcus Aurelius", year: "", url: "#" },
      { title: "Placeholder Philosopher 2", year: "", url: "#" },
      { title: "Placeholder Philosopher 3", year: "", url: "#" }
    ],
    fighters: [
      { title: "Rickson Gracie", year: "", url: "#" },
      { title: "Mike Tyson", year: "", url: "#" },
      { title: "Achilles", year: "", url: "#" },
      { title: "Muhammad Ali", year: "", url: "#" }
    ],
    dj: [
      { title: "the one sent to julian", year: "", url: "#" },
      { title: "arca boiler room", year: "", url: "#" },
      { title: "japanese guy in bathroom", year: "", url: "#" },
      { title: "fabrica del arte?", year: "", url: "#" }
    ]
  };

  // Track which items are currently expanded
  const expandedItems = new Set();

  favoriteItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const category = item.dataset.category;

      // Check if this item is already expanded
      if (expandedItems.has(category)) {
        // Collapse it
        const expandedSpan = document.getElementById(`expanded-${category}`);
        if (expandedSpan) {
          expandedSpan.remove();
        }
        expandedItems.delete(category);
      } else {
        // Expand it
        const data = favoritesData[category] || [];
        const expandedSpan = document.createElement('span');
        expandedSpan.id = `expanded-${category}`;
        expandedSpan.style.color = '#1a1a1a';
        expandedSpan.style.fontWeight = 'normal';

        // Create the list
        const links = data.map(dataItem => {
          const yearText = dataItem.year ? ` (${dataItem.year})` : '';
          return `<a href="${dataItem.url}" style="color: inherit; text-decoration: underline;">${dataItem.title}${yearText}</a>`;
        }).join(', ');

        expandedSpan.innerHTML = `: ${links}`;

        // Insert after the clicked item
        item.after(expandedSpan);
        expandedItems.add(category);
      }
    });
  });
})();
