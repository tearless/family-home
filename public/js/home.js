(function startHeroPhotoShuffle() {
  const stage = document.getElementById('hero-stage');
  const photos = Array.isArray(window.__heroPhotos) ? window.__heroPhotos : [];

  if (!stage || photos.length === 0) return;

  const maxCards = 8;

  function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }

  function spawnCard() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const photo = photos[Math.floor(Math.random() * photos.length)];
    const card = document.createElement('article');
    card.className = 'hero-photo';

    const width = Math.floor(randomBetween(120, 180));
    const x = randomBetween(0, Math.max(0, rect.width - width - 8));
    const y = randomBetween(0, Math.max(0, rect.height - width * 1.2 - 8));
    const r = randomBetween(-12, 12);

    card.style.width = `${width}px`;
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    card.style.setProperty('--r', `${r}deg`);

    const image = document.createElement('img');
    image.src = photo.imageUrl;
    image.alt = photo.title || 'family photo';
    image.loading = 'lazy';

    card.appendChild(image);
    stage.appendChild(card);

    while (stage.children.length > maxCards) {
      stage.removeChild(stage.firstElementChild);
    }

    window.setTimeout(() => {
      if (card.parentNode === stage) {
        stage.removeChild(card);
      }
    }, 5900);
  }

  for (let i = 0; i < Math.min(4, photos.length); i += 1) {
    window.setTimeout(spawnCard, i * 280);
  }

  window.setInterval(spawnCard, 850);
})();
