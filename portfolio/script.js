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

  addEventListener('resize', () => {
    updateMaxScroll();
    positionTicks();
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
