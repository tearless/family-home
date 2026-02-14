const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  },
  { threshold: 0.1 }
);

document.querySelectorAll('.reveal').forEach((node, index) => {
  node.style.transitionDelay = `${index * 70}ms`;
  observer.observe(node);
});
