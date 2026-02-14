(function initAdminDashboardProfileEditor() {
  const dialog = document.getElementById('profilePhotoDialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  const titleNode = document.getElementById('profilePhotoDialogTitle');
  const closeBtn = document.getElementById('closeProfilePhotoDialogBtn');
  const fileInput = document.getElementById('profilePhotoFileInput');
  const canvas = document.getElementById('profilePhotoCropCanvas');
  const zoomRange = document.getElementById('profileZoomRange');
  const resetBtn = document.getElementById('resetProfileCropBtn');
  const saveBtn = document.getElementById('saveProfilePhotoBtn');

  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const PREVIEW_SIZE = 600;
  const OUTPUT_SIZE = 512;

  let activeProfileId = null;
  let activeProfileName = '';
  let sourceImage = null;
  let sourceObjectUrl = '';

  let offsetXRatio = 0;
  let offsetYRatio = 0;
  let isDragging = false;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartOffsetX = 0;
  let dragStartOffsetY = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function resetControls() {
    if (zoomRange) zoomRange.value = '1';
    offsetXRatio = 0;
    offsetYRatio = 0;
  }

  function getScaleInfo(targetSize) {
    if (!sourceImage) {
      return {
        drawWidth: targetSize,
        drawHeight: targetSize,
        maxShiftX: 0,
        maxShiftY: 0
      };
    }

    const zoom = Number(zoomRange ? zoomRange.value : 1);
    const baseScale = Math.max(targetSize / sourceImage.width, targetSize / sourceImage.height);
    const drawWidth = sourceImage.width * baseScale * zoom;
    const drawHeight = sourceImage.height * baseScale * zoom;

    return {
      drawWidth,
      drawHeight,
      maxShiftX: Math.max(0, (drawWidth - targetSize) / 2),
      maxShiftY: Math.max(0, (drawHeight - targetSize) / 2)
    };
  }

  function getCropRect(targetSize) {
    const { drawWidth, drawHeight, maxShiftX, maxShiftY } = getScaleInfo(targetSize);

    const shiftX = maxShiftX * offsetXRatio;
    const shiftY = maxShiftY * offsetYRatio;

    return {
      drawX: (targetSize - drawWidth) / 2 - shiftX,
      drawY: (targetSize - drawHeight) / 2 - shiftY,
      drawWidth,
      drawHeight
    };
  }

  function drawPreview() {
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    ctx.fillStyle = '#eaf4ff';
    ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    if (!sourceImage) {
      ctx.fillStyle = '#5b7ea9';
      ctx.font = '500 18px "SF Pro Text", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('이미지를 선택하세요', PREVIEW_SIZE / 2, PREVIEW_SIZE / 2);
      canvas.style.cursor = 'default';
      return;
    }

    const radius = PREVIEW_SIZE * 0.42;
    const center = PREVIEW_SIZE / 2;
    const rect = getCropRect(PREVIEW_SIZE);

    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(sourceImage, rect.drawX, rect.drawY, rect.drawWidth, rect.drawHeight);
    ctx.restore();

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(62, 125, 221, 0.86)';
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    canvas.style.cursor = isDragging ? 'grabbing' : 'grab';
  }

  function clearSourceObjectUrl() {
    if (sourceObjectUrl) {
      URL.revokeObjectURL(sourceObjectUrl);
      sourceObjectUrl = '';
    }
  }

  function endDrag() {
    isDragging = false;
    dragPointerId = null;
    drawPreview();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    clearSourceObjectUrl();
    sourceImage = null;
    activeProfileId = null;
    activeProfileName = '';
    if (fileInput) fileInput.value = '';
    resetControls();
    endDrag();
  }

  function openDialog(profileId, profileName) {
    activeProfileId = profileId;
    activeProfileName = profileName;
    if (titleNode) {
      titleNode.textContent = `${profileName} 개인사진 수정`;
    }
    resetControls();
    drawPreview();
    dialog.showModal();
  }

  async function uploadCroppedImage() {
    if (!activeProfileId || !sourceImage) return;

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = OUTPUT_SIZE;
    outputCanvas.height = OUTPUT_SIZE;
    const outputCtx = outputCanvas.getContext('2d');

    const rect = getCropRect(OUTPUT_SIZE);
    outputCtx.fillStyle = '#ffffff';
    outputCtx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    outputCtx.drawImage(sourceImage, rect.drawX, rect.drawY, rect.drawWidth, rect.drawHeight);

    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Image processing failed.');

    const file = new File([blob], `family-profile-${activeProfileId}-${Date.now()}.jpg`, { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('imageFile', file);

    const response = await fetch(`/admin/family-profiles/${activeProfileId}/photo`, {
      method: 'POST',
      body: formData
    });
    const json = await response.json();

    if (!json.ok) {
      throw new Error(json.error || 'Profile image upload failed.');
    }

    const item = document.querySelector(`[data-family-profile-id="${activeProfileId}"]`);
    if (item) {
      const existingImg = item.querySelector(`[data-family-profile-image="${activeProfileId}"]`);
      if (existingImg) {
        existingImg.src = `${json.imageUrl}?t=${Date.now()}`;
      } else {
        const placeholder = item.querySelector(`[data-family-profile-initial="${activeProfileId}"]`);
        if (placeholder && placeholder.parentElement) {
          const img = document.createElement('img');
          img.setAttribute('data-family-profile-image', String(activeProfileId));
          img.setAttribute('alt', `${activeProfileName} profile`);
          img.src = `${json.imageUrl}?t=${Date.now()}`;
          placeholder.parentElement.replaceChild(img, placeholder);
        }
      }
    }

    closeDialog();
  }

  document.querySelectorAll('[data-open-profile-photo-dialog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const profileId = Number(btn.getAttribute('data-profile-id') || 0);
      const profileName = String(btn.getAttribute('data-profile-name') || '').trim();
      if (!profileId || !profileName) return;
      openDialog(profileId, profileName);
    });
  });

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      clearSourceObjectUrl();
      sourceObjectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        sourceImage = image;
        resetControls();
        drawPreview();
      };
      image.src = sourceObjectUrl;
    });
  }

  if (zoomRange) {
    zoomRange.addEventListener('input', () => {
      offsetXRatio = clamp(offsetXRatio, -1, 1);
      offsetYRatio = clamp(offsetYRatio, -1, 1);
      drawPreview();
    });
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!sourceImage) return;

    isDragging = true;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartOffsetX = offsetXRatio;
    dragStartOffsetY = offsetYRatio;
    canvas.setPointerCapture(event.pointerId);
    drawPreview();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!isDragging || event.pointerId !== dragPointerId || !sourceImage) return;

    const { maxShiftX, maxShiftY } = getScaleInfo(PREVIEW_SIZE);
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;

    if (maxShiftX > 0) {
      offsetXRatio = clamp(dragStartOffsetX - dx / maxShiftX, -1, 1);
    }
    if (maxShiftY > 0) {
      offsetYRatio = clamp(dragStartOffsetY - dy / maxShiftY, -1, 1);
    }

    drawPreview();
  });

  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === dragPointerId) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (_) {
        // ignore
      }
      endDrag();
    }
  });

  canvas.addEventListener('pointercancel', () => endDrag());

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetControls();
      drawPreview();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        await uploadCroppedImage();
      } catch (error) {
        // eslint-disable-next-line no-alert
        alert(error.message || 'Upload failed');
      }
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', () => closeDialog());

  drawPreview();
})();

(function initLandingBackgroundEditor() {
  const dialog = document.getElementById('landingBgDialog');
  const openBtn = document.getElementById('openLandingBgDialogBtn');
  if (!dialog || !openBtn || typeof dialog.showModal !== 'function') return;

  const closeBtn = document.getElementById('closeLandingBgDialogBtn');
  const fileInput = document.getElementById('landingBgFileInput');
  const canvas = document.getElementById('landingBgCropCanvas');
  const zoomRange = document.getElementById('landingBgZoomRange');
  const resetBtn = document.getElementById('resetLandingBgCropBtn');
  const saveBtn = document.getElementById('saveLandingBgBtn');
  const previewImg = document.getElementById('landingBgPreviewImage');
  const previewEmpty = document.getElementById('landingBgPreviewEmpty');

  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const PREVIEW_WIDTH = 1600;
  const PREVIEW_HEIGHT = 900;
  const OUTPUT_WIDTH = 1600;
  const OUTPUT_HEIGHT = 900;

  let sourceImage = null;
  let sourceObjectUrl = '';
  let offsetXRatio = 0;
  let offsetYRatio = 0;
  let isDragging = false;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartOffsetX = 0;
  let dragStartOffsetY = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function resetControls() {
    if (zoomRange) zoomRange.value = '1';
    offsetXRatio = 0;
    offsetYRatio = 0;
  }

  function clearSourceObjectUrl() {
    if (sourceObjectUrl) {
      URL.revokeObjectURL(sourceObjectUrl);
      sourceObjectUrl = '';
    }
  }

  function getScaleInfo(targetWidth, targetHeight) {
    if (!sourceImage) {
      return {
        drawWidth: targetWidth,
        drawHeight: targetHeight,
        maxShiftX: 0,
        maxShiftY: 0
      };
    }

    const zoom = Number(zoomRange ? zoomRange.value : 1);
    const baseScale = Math.max(targetWidth / sourceImage.width, targetHeight / sourceImage.height);
    const drawWidth = sourceImage.width * baseScale * zoom;
    const drawHeight = sourceImage.height * baseScale * zoom;

    return {
      drawWidth,
      drawHeight,
      maxShiftX: Math.max(0, (drawWidth - targetWidth) / 2),
      maxShiftY: Math.max(0, (drawHeight - targetHeight) / 2)
    };
  }

  function getCropRect(targetWidth, targetHeight) {
    const { drawWidth, drawHeight, maxShiftX, maxShiftY } = getScaleInfo(targetWidth, targetHeight);
    const shiftX = maxShiftX * offsetXRatio;
    const shiftY = maxShiftY * offsetYRatio;

    return {
      drawX: (targetWidth - drawWidth) / 2 - shiftX,
      drawY: (targetHeight - drawHeight) / 2 - shiftY,
      drawWidth,
      drawHeight
    };
  }

  function drawPreview() {
    ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    ctx.fillStyle = '#eaf4ff';
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

    if (!sourceImage) {
      ctx.fillStyle = '#5b7ea9';
      ctx.font = '500 24px "SF Pro Text", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('이미지를 선택하세요', PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2);
      canvas.style.cursor = 'default';
      return;
    }

    const rect = getCropRect(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    ctx.drawImage(sourceImage, rect.drawX, rect.drawY, rect.drawWidth, rect.drawHeight);
    canvas.style.cursor = isDragging ? 'grabbing' : 'grab';
  }

  function endDrag() {
    isDragging = false;
    dragPointerId = null;
    drawPreview();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    clearSourceObjectUrl();
    sourceImage = null;
    if (fileInput) fileInput.value = '';
    resetControls();
    endDrag();
  }

  async function saveLandingBackground() {
    if (!sourceImage) return;

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = OUTPUT_WIDTH;
    outputCanvas.height = OUTPUT_HEIGHT;
    const outputCtx = outputCanvas.getContext('2d');
    const rect = getCropRect(OUTPUT_WIDTH, OUTPUT_HEIGHT);
    outputCtx.fillStyle = '#ffffff';
    outputCtx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    outputCtx.drawImage(sourceImage, rect.drawX, rect.drawY, rect.drawWidth, rect.drawHeight);

    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Image processing failed.');

    const file = new File([blob], `landing-bg-${Date.now()}.jpg`, { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('imageFile', file);

    const response = await fetch('/admin/landing-background/photo', {
      method: 'POST',
      body: formData
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Landing background upload failed.');

    if (previewImg) {
      previewImg.src = `${json.imageUrl}?t=${Date.now()}`;
      previewImg.classList.remove('hidden-block');
    }
    if (previewEmpty) {
      previewEmpty.classList.add('hidden-block');
    }

    closeDialog();
  }

  openBtn.addEventListener('click', () => {
    resetControls();
    drawPreview();
    dialog.showModal();
  });

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      clearSourceObjectUrl();
      sourceObjectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        sourceImage = image;
        resetControls();
        drawPreview();
      };
      image.src = sourceObjectUrl;
    });
  }

  if (zoomRange) {
    zoomRange.addEventListener('input', () => {
      offsetXRatio = clamp(offsetXRatio, -1, 1);
      offsetYRatio = clamp(offsetYRatio, -1, 1);
      drawPreview();
    });
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!sourceImage) return;
    isDragging = true;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartOffsetX = offsetXRatio;
    dragStartOffsetY = offsetYRatio;
    canvas.setPointerCapture(event.pointerId);
    drawPreview();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!isDragging || event.pointerId !== dragPointerId || !sourceImage) return;
    const { maxShiftX, maxShiftY } = getScaleInfo(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;

    if (maxShiftX > 0) offsetXRatio = clamp(dragStartOffsetX - dx / maxShiftX, -1, 1);
    if (maxShiftY > 0) offsetYRatio = clamp(dragStartOffsetY - dy / maxShiftY, -1, 1);
    drawPreview();
  });

  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === dragPointerId) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (_) {
        // ignore
      }
      endDrag();
    }
  });

  canvas.addEventListener('pointercancel', () => endDrag());

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetControls();
      drawPreview();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        await saveLandingBackground();
      } catch (error) {
        // eslint-disable-next-line no-alert
        alert(error.message || 'Upload failed');
      }
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', () => closeDialog());

  drawPreview();
})();
