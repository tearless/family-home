(function initDeleteConfirmDialog() {
  const deleteForms = Array.from(document.querySelectorAll('[data-delete-form]'));
  if (!deleteForms.length) return;

  const dialog = document.getElementById('deleteConfirmDialog');
  const message = document.getElementById('deleteConfirmMessage');
  const cancelBtn = document.getElementById('deleteCancelBtn');
  const confirmBtn = document.getElementById('deleteConfirmBtn');

  let pendingForm = null;

  function closeDialog() {
    pendingForm = null;
    if (dialog && dialog.open) dialog.close();
  }

  function buildPrompt(label) {
    return `${label || '이 항목'}을(를) 정말 삭제하시겠어요?`;
  }

  function openDialog(form) {
    pendingForm = form;
    const label = form.dataset.deleteLabel || '이 항목';
    const prompt = buildPrompt(label);

    if (message) {
      message.textContent = prompt;
    }

    if (!dialog || typeof dialog.showModal !== 'function') {
      if (window.confirm(prompt)) {
        form.submit();
      }
      pendingForm = null;
      return;
    }

    dialog.showModal();
  }

  deleteForms.forEach((form) => {
    const trigger = form.querySelector('[data-delete-trigger]');
    if (!trigger) return;
    trigger.addEventListener('click', () => openDialog(form));
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeDialog);
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (pendingForm) pendingForm.submit();
      closeDialog();
    });
  }

  if (dialog) {
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog();
    });

    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      const clickedOutside =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;

      if (clickedOutside) closeDialog();
    });
  }
})();
