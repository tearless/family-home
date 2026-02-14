(function initPhotoManageModal() {
  const modal = document.getElementById('photoManageModal');
  const openBtn = document.querySelector('[data-open-photo-modal]');
  const closeBtn = document.querySelector('[data-close-photo-modal]');

  if (!modal || !openBtn || !closeBtn) return;

  const sourceTypeInput = document.getElementById('photoSourceType');
  const urlField = document.getElementById('photoUrlField');
  const uploadField = document.getElementById('photoUploadField');
  const tabButtons = Array.from(document.querySelectorAll('[data-source-tab]'));

  function setSource(type) {
    sourceTypeInput.value = type;
    const isUrl = type === 'url';
    urlField.classList.toggle('hidden-block', !isUrl);
    uploadField.classList.toggle('hidden-block', isUrl);
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.sourceTab === type);
    });
  }

  setSource('url');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => setSource(btn.dataset.sourceTab));
  });

  openBtn.addEventListener('click', () => modal.showModal());
  closeBtn.addEventListener('click', () => modal.close());

  modal.addEventListener('click', (event) => {
    const rect = modal.getBoundingClientRect();
    const clickedOutside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (clickedOutside) modal.close();
  });
})();
