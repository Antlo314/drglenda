import './style.css'

// Add scroll event listener for navbar styling
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
  if (window.scrollY > 50) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
});

// Mobile Menu Toggle
const menuBtn = document.getElementById('mobile-menu-btn');
const navLinks = document.getElementById('nav-links');

menuBtn.addEventListener('click', () => {
  menuBtn.classList.toggle('active');
  navLinks.classList.toggle('active');
});

// Close mobile menu when a link is clicked
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    menuBtn.classList.remove('active');
    navLinks.classList.remove('active');
  });
});

// Intersection Observer for scroll animations
const observerOptions = {
  root: null,
  rootMargin: '0px',
  threshold: 0.1
};

const observer = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target); // Stop observing once it's visible
    }
  });
}, observerOptions);

// Observe all fade-up elements
document.addEventListener('DOMContentLoaded', () => {
  const fadeElements = document.querySelectorAll('.fade-up');
  fadeElements.forEach(el => observer.observe(el));
});
