/* --- Configuration-free section theming & progress --- */
(() => {
  const sections = [...document.querySelectorAll('section')];
  const fill = document.getElementById('fill');
  const track = document.getElementById('track');
  const corner = document.getElementById('cornerLabel');
  const progressContainer = document.querySelector('.progress');

  // Create tick segments for each section (proportional to section height)
  const ticks = sections.map(() => {
    const el = document.createElement('div');
    el.className = 'tick';
    track.appendChild(el);
    return el;
  });

  // Position ticks based on actual section heights
  function positionTicks() {
    const trackRect = track.getBoundingClientRect();
    const trackHeight = trackRect.height;
    const docHeight = document.documentElement.scrollHeight;

    sections.forEach((sec, i) => {
      const sectionStart = sec.offsetTop;
      const sectionHeight = sec.offsetHeight;

      // Calculate position and height as percentage of track
      const startPercent = (sectionStart / docHeight) * 100;
      const heightPercent = (sectionHeight / docHeight) * 100;

      // Position the tick
      ticks[i].style.top = `${(startPercent / 100) * trackHeight}px`;
      ticks[i].style.height = `${(heightPercent / 100) * trackHeight}px`;
      ticks[i].style.width = '2px';
      ticks[i].style.right = '0';
      ticks[i].style.borderRadius = '0';
      ticks[i].style.transform = 'none';

      // Use each section's background color for its tick
      const bg = sec.dataset.bg || '#9aa0a6';
      ticks[i].style.background = bg;
      ticks[i].style.opacity = '0.5';
    });
  }

  addEventListener('resize', positionTicks);
  addEventListener('load', positionTicks);

  // Interactive drag functionality
  let isDragging = false;

  function scrollToPosition(clientY) {
    const trackRect = track.getBoundingClientRect();
    const trackTop = trackRect.top;
    const trackHeight = trackRect.height;
    const relativeY = clientY - trackTop;
    const percentage = Math.max(0, Math.min(1, relativeY / trackHeight));
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: percentage * docHeight, behavior: 'auto' });
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

  // Update fill height on scroll
  function updateFill() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const pct = Math.max(0, Math.min(1, window.scrollY / max));
    fill.style.height = (pct * 100) + '%';
  }
  addEventListener('scroll', updateFill, { passive: true });
  addEventListener('load', updateFill);

  // Apply background colors directly to sections
  sections.forEach(sec => {
    const bg = sec.dataset.bg;
    const fg = sec.dataset.fg;
    if (bg) sec.style.backgroundColor = bg;
    if (fg) sec.style.color = fg;
  });

  // Update corner label and nav colors based on current section
  const nav = document.querySelector('nav');
  const io = new IntersectionObserver((entries) => {
    const best = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!best) return;

    const sec = best.target;
    if (sec.dataset.title) corner.textContent = sec.dataset.title;

    // Update nav and corner colors to match section text color
    const fg = sec.dataset.fg;
    if (fg) {
      corner.style.color = fg;
      nav.style.color = fg;
    }
  }, { rootMargin: '-30% 0px -40% 0px', threshold: [0, .25, .5, .75, 1] });

  sections.forEach(s => io.observe(s));

  // Initial tick positions after fonts/layout settle
  window.setTimeout(positionTicks, 400);
})();
