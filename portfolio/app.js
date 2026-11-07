const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.primary-nav');
const meter = document.querySelector('.scroll-meter span');

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!open));
  navigation?.classList.toggle('is-open', !open);
});

navigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton?.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
  });
});

const practiceItems = document.querySelectorAll('[data-practice]');

practiceItems.forEach((item) => {
  const button = item.querySelector('.practice-row');
  const panel = item.querySelector('.practice-panel');

  button?.addEventListener('click', () => {
    const willOpen = button.getAttribute('aria-expanded') !== 'true';

    practiceItems.forEach((otherItem) => {
      const otherButton = otherItem.querySelector('.practice-row');
      const otherPanel = otherItem.querySelector('.practice-panel');
      otherItem.classList.remove('is-open');
      otherButton?.setAttribute('aria-expanded', 'false');
      if (otherPanel) otherPanel.hidden = true;
    });

    item.classList.toggle('is-open', willOpen);
    button.setAttribute('aria-expanded', String(willOpen));
    if (panel) panel.hidden = !willOpen;
  });
});

const updateMeter = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const progress = max > 0 ? (window.scrollY / max) * 100 : 0;
  if (meter) meter.style.width = `${progress}%`;
};

window.addEventListener('scroll', updateMeter, { passive: true });
updateMeter();

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveals = document.querySelectorAll('.reveal');

if (reduceMotion || !('IntersectionObserver' in window)) {
  reveals.forEach((item) => item.classList.add('is-visible'));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });

  reveals.forEach((item) => observer.observe(item));
}

document.querySelector('[data-year]').textContent = new Date().getFullYear();
