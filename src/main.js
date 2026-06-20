import './style.css';

/* -------------------------------------------------------------------------
   Sticky header shadow on scroll
   ------------------------------------------------------------------------- */
const header = document.getElementById('header');
const onScroll = () => {
  header.classList.toggle('scrolled', window.scrollY > 12);
};
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* -------------------------------------------------------------------------
   Mobile menu toggle
   ------------------------------------------------------------------------- */
const menuBtn = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');

const setMenu = (open) => {
  mobileNav.classList.toggle('active', open);
  menuBtn.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
};

menuBtn.addEventListener('click', () => {
  setMenu(!mobileNav.classList.contains('active'));
});

mobileNav.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => setMenu(false));
});

/* -------------------------------------------------------------------------
   Scroll reveal animations
   ------------------------------------------------------------------------- */
const revealObserver = new IntersectionObserver(
  (entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
);

document.querySelectorAll('.fade-up').forEach((el) => revealObserver.observe(el));

/* -------------------------------------------------------------------------
   Active nav link highlighting
   ------------------------------------------------------------------------- */
const sections = ['masterclass', 'about', 'impact', 'programs', 'contact']
  .map((id) => document.getElementById(id))
  .filter(Boolean);
const navLinks = document.querySelectorAll('.nav-desktop .nav-link');

const navObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navLinks.forEach((link) =>
          link.classList.toggle('active', link.getAttribute('href') === `#${id}`)
        );
      }
    });
  },
  { rootMargin: '-45% 0px -50% 0px' }
);

sections.forEach((section) => navObserver.observe(section));

/* -------------------------------------------------------------------------
   Countdown to the July 2nd sign-up deadline
   ------------------------------------------------------------------------- */
const DEADLINE = new Date('2026-07-02T23:59:59').getTime();
const cd = {
  days: document.querySelector('[data-cd="days"]'),
  hours: document.querySelector('[data-cd="hours"]'),
  minutes: document.querySelector('[data-cd="minutes"]'),
  seconds: document.querySelector('[data-cd="seconds"]'),
};
const countdownEl = document.getElementById('countdown');

const pad = (n) => String(n).padStart(2, '0');

function tickCountdown() {
  if (!countdownEl) return;
  const diff = DEADLINE - Date.now();

  if (diff <= 0) {
    countdownEl.innerHTML =
      '<span class="countdown-label">Enrollment deadline (July 2nd) has passed — join the waiting list</span>';
    clearInterval(timer);
    return;
  }

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  cd.days.textContent = days;
  cd.hours.textContent = pad(hours);
  cd.minutes.textContent = pad(minutes);
  cd.seconds.textContent = pad(seconds);
}

tickCountdown();
const timer = setInterval(tickCountdown, 1000);

/* -------------------------------------------------------------------------
   Newsletter form (client-side validation)
   ------------------------------------------------------------------------- */
const form = document.getElementById('newsletterForm');
const formMsg = document.getElementById('formMsg');

if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!valid) {
      formMsg.textContent = 'Please enter a valid email address.';
      formMsg.className = 'form-msg err';
      form.email.focus();
      return;
    }

    formMsg.textContent = 'Thank you! You’re on the list — watch your inbox for updates.';
    formMsg.className = 'form-msg ok';
    form.reset();
  });
}

/* -------------------------------------------------------------------------
   Footer year
   ------------------------------------------------------------------------- */
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());
