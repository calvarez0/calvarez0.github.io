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
  const ticks = sections.map((sec) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'tick';
    wrapper.style.position = 'absolute';
    wrapper.style.right = '0';
    wrapper.style.overflow = 'visible';

    const fill = document.createElement('div');
    fill.className = 'tick-fill';
    fill.style.position = 'absolute';
    fill.style.top = '0';
    fill.style.left = '0';
    fill.style.width = '100%';
    fill.style.height = '0%';
    fill.style.overflow = 'hidden';

    // Add section title label
    const label = document.createElement('div');
    label.className = 'tick-label';
    label.textContent = sec.dataset.title || '';

    wrapper.appendChild(fill);
    wrapper.appendChild(label);
    track.appendChild(wrapper);
    return { wrapper, fill, label };
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

  // Proximity hover detection (50px range)
  const HOVER_DISTANCE = 50;

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      scrollToPosition(e.clientY);
      return;
    }

    // Calculate distance from right edge of window to mouse
    const distanceFromRight = window.innerWidth - e.clientX;

    // If within 50px of the scrollbar area, add hover class
    if (distanceFromRight <= HOVER_DISTANCE + 60) { // 60 accounts for the scrollbar position
      progressContainer.classList.add('hover');
    } else {
      progressContainer.classList.remove('hover');
    }
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

      // Update all tick labels to match current section text color
      ticks.forEach(tick => {
        tick.label.style.color = fg;
      });
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
      { title: "Bob Dylan Live at the ABC Theatre", year: "1966", url: "https://youtu.be/63ucJmVonAc?si=2NNQEKBDAOrt6SuS" },
      { title: "RAYE Live at Montreux Jazz Festival", year: "2024", url: "https://youtu.be/4GRfxJiQeyM?si=cLsLMApjiEJeKvPx" },
      { title: "Bad Bunny: Tiny Desk Concert", year: "2025", url: "https://www.youtube.com/watch?v=ouuPSxE1hK4&t=285s" },
      { title: "Tracy Chapman Live at Oakland Coliseum Arena", year: "1988", url: "https://www.youtube.com/watch?v=kUXahDmsVdU" },
      { title: "Jeff Buckley Live in Chicago", year: "1995", url: "https://www.youtube.com/watch?v=H1d50u7wT5s" },
      { title: "Sam Cooke Live At The Harlem Square Club", year: "1963", url: "https://open.spotify.com/album/3nTXqOEHr6AfTb1WSaB4Pm?si=ntoQxv7rRxWJYXSfRnusjQ" }
    ],
    movies: [
      { title: "Gattaca", year: "1997", url: "https://letterboxd.com/film/gattaca/" },
      { title: "City of God", year: "2002", url: "https://letterboxd.com/film/city-of-god/" },
      { title: "Manic", year: "2001", url: "https://letterboxd.com/film/manic/" },
      { title: "Isle of Dogs", year: "2018", url: "https://letterboxd.com/film/isle-of-dogs-2018/" },
      { title: "Cinema Paradiso", year: "1988", url: "https://letterboxd.com/film/cinema-paradiso/" },
      { title: "Fight Club", year: "1999", url: "https://letterboxd.com/film/fight-club/" },
      { title: "Slumdog Millionaire", year: "2008", url: "https://letterboxd.com/film/slumdog-millionaire/" },
      { title: "Choke", year: "1999", url: "https://archive.org/details/bjjdocs/Choke+-+(A+Rickson+Gracie+Documentary).mp4" },
      { title: "Bowling For Columbine", year: "2002", url: "https://letterboxd.com/film/bowling-for-columbine/" }
      

    ],
    albums: [
      { title: "The Freewheelin' Bob Dylan", year: "1963", url: "https://open.spotify.com/album/0o1uFxZ1VTviqvNaYkTJek?si=SrExPixoQxCpeR7zmAWXbg"},
      { title: "REWORK", year: "2012", url: "https://open.spotify.com/album/4YSbn4LNDIKqRhAwKsvaAG?si=pk-ssnDQR9uLS2o_RU6CDQ" },
      { title: "Daisy", year: "2025", url: "https://open.spotify.com/album/0o1RGF3A02UN1aVAX1SLuQ?si=3CQvLYLwTh-cvETZkR8qgA" },
      { title: "Dummy", year: "1994", url: "https://open.spotify.com/album/3539EbNgIdEDGBKkUf4wno?si=CcUKgfulQwSVHo_e4jA47w" },
      { title: "Selected Ambient Works 85-92", year: "1992", url: "https://open.spotify.com/album/7aNclGRxTysfh6z0d8671k?si=0P062UOURs6fp8pjCKQ18g" },
      { title: "The Deep End", year: "2018", url: "https://open.spotify.com/album/3Fwmzb3B5GXy6aUWfFEFXm?si=3rQ1eEXHR-af_J-5ybWBmw" },
      { title: "Le Tigre", year: "1999", url: "https://open.spotify.com/album/0dSSZGzoukzrFBnG07J45i?si=lCbC7yLvRU6Iy9zxolFcfA" },
      { title: "Mezzanine", year: "1998", url: "https://open.spotify.com/album/49MNmJhZQewjt06rpwp6QR?si=Ge6dNyJERxKhu2OeLSu7Aw" },
      { title: "Sings Again", year: "1986", url: "https://open.spotify.com/album/1WUlOWwCmLevOi6QSkDkOV?si=LGgK2dQkQwecBAczMuSYHw" },
      { title: "Either/Or", year: "1997", url: "https://open.spotify.com/album/5bmpvyP7UGqB4VuXmrJUMy?si=LE3i75l1SdGaOVGCwgXrkw" },
      { title: "Breath From Another", year: "1998", url: "https://open.spotify.com/album/5IjiTlH5NjwgFjfCxXlY0S?si=NH7F52ejRcSODVDVIiTAYw" }
    ],
    books: [
      { title: "Man's Search For Meaning", year: "1946", url: "https://www.goodreads.com/book/show/4069.Man_s_Search_for_Meaning" },
      { title: "Kitchen Confidential", year: "2000", url: "https://www.goodreads.com/book/show/33313.Kitchen_Confidential" },
      { title: "Badawi", year: "1994", url: "https://www.goodreads.com/book/show/7789365-badawi" },
      { title: "The Almanack of Naval Ravikant", year: "2020", url: "https://www.goodreads.com/book/show/54898389-the-almanack-of-naval-ravikant" },
      { title: "You Get So Alone at Times That it Just Makes Sense", year: "1986", url: "https://www.goodreads.com/book/show/38504.You_Get_So_Alone_at_Times_That_it_Just_Makes_Sense" },
      { title: "Bound for Glory", year: "1943", url: "https://www.goodreads.com/book/show/761256.Bound_for_Glory" },
      { title: "Meditations", year: "180", url: "https://www.goodreads.com/book/show/30659.Meditations" },
      { title: "History Will Absolve Me", year: "1958", url: "https://www.goodreads.com/book/show/723914.History_Will_Absolve_Me" }
    ],
    videos: [
      { title: "Miracle on Six Train", year: "", url: "https://youtu.be/yVzAC7mLxJw?si=_pqiclsiOgdhSnL9" },
      { title: "Virgil Abloh, \“Insert Complicated Title Here\”", year: "", url: "https://youtu.be/qie5VITX6eQ?si=w1G1EF2UeVHCxwCT" },
      { title: "Noam Chomsky: The five filters of the mass media machine", year: "", url: "https://youtu.be/34LGPIXvU5M?si=4aGhMx49hwoOJXGS" },
      { title: "Norman McLaren - Dots", year: "", url: "https://youtu.be/E3-vsKwQ0Cg?si=j1mHBZrXGHVR4uHM" },
      { title: "Here's To The Crazy Ones", year: "", url: "https://youtu.be/-z4NS2zdrZc?si=9Ox49sAE7o28ufDp" },
      { title: "Fighting in the Age of Loneliness", year: "", url: "https://youtu.be/-DoaUyMGPWI?si=H-BkHi1FQaYt5YX2" }
      
    ],
    history: [
      { title: "Santiago Ramón y Cajal", year: "", url: "https://en.wikipedia.org/wiki/Santiago_Ram%C3%B3n_y_Cajal" },
      { title: "Lucius Quinctius Cincinnatus", year: "", url: "https://en.wikipedia.org/wiki/Lucius_Quinctius_Cincinnatus" },
      { title: "Lee Kuan Yew", year: "", url: "https://en.wikipedia.org/wiki/Lee_Kuan_Yew" },
      { title: "Alexander The Great", year: "", url: "https://en.wikipedia.org/wiki/Alexander_the_Great" },
      { title: "Carlos Manuel de Céspedes", year: "", url: "https://en.wikipedia.org/wiki/Carlos_Manuel_de_C%C3%A9spedes" }
    ],
    wikipedia: [
      { title: "Anaïs Nin", year: "", url: "https://en.wikipedia.org/wiki/Ana%C3%AFs_Nin" },
      { title: "Prophetic Perfect Tense", year: "", url: "https://en.wikipedia.org/wiki/Prophetic_perfect_tense" },
      { title: "Josep de la Trinxeria", year: "", url: "https://fr.wikipedia.org/wiki/Josep_de_la_Trinxeria" },
      { title: "Chet Baker", year: "", url: "https://en.wikipedia.org/wiki/Chet_Baker" }
    ],
    musicians: [
      { title: "Bob Dylan", year: "", url: "https://en.wikipedia.org/wiki/Bob_Dylan" },
      { title: "Sam Cooke", year: "", url: "https://en.wikipedia.org/wiki/Sam_Cooke" },
      { title: "Jai Paul", year: "", url: "https://en.wikipedia.org/wiki/Jai_Paul" },
      { title: "Arca", year: "", url: "https://en.wikipedia.org/wiki/Arca_(musician)" },
      { title: "Elliott Smith", year: "", url: "https://en.wikipedia.org/wiki/Elliott_Smith" },
      { title: "Amy Winehouse", year: "", url: "https://en.wikipedia.org/wiki/Amy_Winehouse" }
    ],
    researchers: [
      { title: "Sam Gershman", year: "", url: "https://psychology.fas.harvard.edu/people/samuel-j-gershman" },
      { title: "Alan Kay", year: "", url: "https://en.wikipedia.org/wiki/Alan_Kay" },
      { title: "Max Tegmark", year: "", url: "https://physics.mit.edu/faculty/max-tegmark/" },
      { title: "Kenneth Stanley", year: "", url: "https://www.kenstanley.net/" },
      { title: "Mark Weiser", year: "", url: "https://en.wikipedia.org/wiki/Mark_Weiser" },
      { title: "Jeff Clune", year: "", url: "http://jeffclune.com/" },
      { title: "Sebastian Seung", year: "", url: "https://pni.princeton.edu/people/h-sebastian-seung" }
    ],
    artists: [
      { title: "Leonardo DaVinci", year: "", url: "https://en.wikipedia.org/wiki/Leonardo_da_Vinci" },
      { title: "Basquiat", year: "", url: "https://en.wikipedia.org/wiki/Jean-Michel_Basquiat" },
      { title: "Caravaggio", year: "", url: "https://en.wikipedia.org/wiki/Caravaggio" },
      { title: "Banksy", year: "", url: "https://en.wikipedia.org/wiki/Banksy" },
      { title: "Rita Longa", year: "", url: "https://en.wikipedia.org/wiki/Rita_Longa" }

    ],
    papers: [
      { title: "Platonic Representation Hypothesis", year: "2024", url: "https://arxiv.org/abs/2405.07987" },
      { title: "Questioning Representational Optimism in Deep Learning", year: "2025", url: "https://arxiv.org/abs/2505.11581" },
      { title: "A contextualized reinforcer pathology approach to addiction", year: "2023", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10028332/pdf/44159_2023_Article_167.pdf"},
      { title: "Cognitive computational neuroscience", year: "2018", url: "https://www.nature.com/articles/s41593-018-0210-5" }
    ],
    designers: [
      { title: "Steve Jobs", year: "", url: "https://en.wikipedia.org/wiki/Steve_Jobs" },
      { title: "Leonardo da Vinci", year: "", url: "https://en.wikipedia.org/wiki/Leonardo_da_Vinci" },
      { title: "Virgil Abloh", year: "", url: "https://en.wikipedia.org/wiki/Virgil_Abloh" },
      { title: "Bret Victor", year: "", url: "https://en.wikipedia.org/wiki/Bret_Victor" }
    ],
    philosophers: [
      { title: "Marcus Aurelius", year: "", url: "https://en.wikipedia.org/wiki/Marcus_Aurelius" },
      { title: "James Baldwin", year: "", url: "https://en.wikipedia.org/wiki/James_Baldwin" },
      { title: "Socrates", year: "", url: "https://en.wikipedia.org/wiki/Socrates" },
      { title: "Carl Jung", year: "", url: "https://en.wikipedia.org/wiki/Carl_Jung" },
      { title: "Viktor Frankl", year: "", url: "https://en.wikipedia.org/wiki/Viktor_Frankl" }
    ],
    fighters: [
      { title: "Rickson Gracie", year: "", url: "https://en.wikipedia.org/wiki/Rickson_Gracie" },
      { title: "Mike Tyson", year: "", url: "https://en.wikipedia.org/wiki/Mike_Tyson" },
      { title: "Achilles", year: "", url: "https://en.wikipedia.org/wiki/Achilles" },
      { title: "Jack Dempsey", year: "", url: "https://en.wikipedia.org/wiki/Jack_Dempsey" },
      { title: "Sonny Liston", year: "", url: "https://en.wikipedia.org/wiki/Sonny_Liston" },
      { title: "Muhammad Ali", year: "", url: "https://en.wikipedia.org/wiki/Muhammad_Ali" }
    ],
    dj: [
      { title: "Arca Boiler Room", year: "", url: "https://youtu.be/UWkANbUYWLI?si=WKRZKsYtujQ9ulBS" },
      { title: "¥ØU$UK€ ¥UK1MAT$U Midnight Shift - ", year: "", url: "https://www.youtube.com/watch?v=WvyvwlowHWM&t=2067s" },
      { title: "Kaytranada Boiler Room", year: "", url: "https://youtu.be/-5EQIiabJvk?si=QJykJBFF8exw2nqS" },
      { title: "The Dare Boiler Room", year: "", url: "https://www.youtube.com/watch?v=6EBK3qbGhE0" }
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
