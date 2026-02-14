(function initBlogEditorPage() {
  const form = document.getElementById('blogEditorForm');
  const promptInput = document.getElementById('aiPromptInput');
  const sendBtn = document.getElementById('aiSendBtn');
  const insertLatestBtn = document.getElementById('aiInsertLatestBtn');
  const chatBox = document.getElementById('aiChatBox');
  const contentField = document.getElementById('postContentField');

  const postTitle = document.getElementById('postTitle');
  const postSummary = document.getElementById('postSummary');
  const postCoverImage = document.getElementById('postCoverImage');
  const coverImageUpload = document.getElementById('coverImageUpload');
  const coverUploadBtn = document.getElementById('coverUploadBtn');
  const coverPreview = document.getElementById('coverPreview');
  const coverCropSection = document.getElementById('coverCropSection');
  const coverCropCanvas = document.getElementById('coverCropCanvas');
  const coverZoomRange = document.getElementById('coverZoomRange');
  const coverResetCropBtn = document.getElementById('coverResetCropBtn');
  const coverApplyCropBtn = document.getElementById('coverApplyCropBtn');
  const editorSubmitBtn = document.getElementById('editorSubmitBtn');

  const workspaceTabs = Array.from(document.querySelectorAll('[data-workspace-tab]'));
  const aiWorkspace = document.getElementById('aiWorkspace');
  const editorWorkspace = document.getElementById('editorWorkspace');

  const modeTabs = Array.from(document.querySelectorAll('[data-editor-mode]'));
  const quillWrap = document.getElementById('quillEditorWrap');
  const htmlWrap = document.getElementById('htmlEditorWrap');
  const htmlSourceEditor = document.getElementById('htmlSourceEditor');

  const editorImageUpload = document.getElementById('editorImageUpload');
  const editorUploadBtn = document.getElementById('editorUploadBtn');

  if (!form || typeof window.Quill === 'undefined') return;

  const initial = window.__blogEditorInitial || { post: {}, mode: 'create' };
  let currentMode = 'quill';
  let currentWorkspace = 'editor';
  let latestAIDraft = null;
  let coverSourceImage = null;
  let coverObjectUrl = '';
  let coverOffsetXRatio = 0;
  let coverOffsetYRatio = 0;
  let isCoverDragging = false;
  let coverDragPointerId = null;
  let coverDragStartX = 0;
  let coverDragStartY = 0;
  let coverDragStartOffsetX = 0;
  let coverDragStartOffsetY = 0;

  const COVER_WIDTH = 1200;
  const COVER_HEIGHT = 675;
  const coverCropCtx = coverCropCanvas ? coverCropCanvas.getContext('2d') : null;

  const quill = new Quill('#quillEditor', {
    theme: 'snow',
    modules: {
      toolbar: '#quillToolbar'
    },
    placeholder: 'Write your blog content here...'
  });

  function setWorkspace(tab) {
    currentWorkspace = tab;
    const isAI = tab === 'ai';
    aiWorkspace.classList.toggle('hidden-block', !isAI);
    editorWorkspace.classList.toggle('hidden-block', isAI);
    if (editorSubmitBtn) {
      editorSubmitBtn.disabled = isAI;
      editorSubmitBtn.title = isAI ? 'AI 탭에서는 제출할 수 없습니다. 에디터 탭에서 제출하세요.' : '';
    }

    workspaceTabs.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.workspaceTab === tab);
    });
  }

  function updateCoverPreview(url) {
    const imageUrl = String(url || '').trim();
    if (!coverPreview) return;
    if (!imageUrl) {
      coverPreview.classList.add('hidden-block');
      coverPreview.removeAttribute('src');
      return;
    }
    coverPreview.src = imageUrl;
    coverPreview.classList.remove('hidden-block');
  }

  function resetCoverCropControls() {
    if (coverZoomRange) coverZoomRange.value = '1';
    coverOffsetXRatio = 0;
    coverOffsetYRatio = 0;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getCoverScaleInfo(targetWidth, targetHeight) {
    if (!coverSourceImage) {
      return {
        drawWidth: targetWidth,
        drawHeight: targetHeight,
        maxShiftX: 0,
        maxShiftY: 0
      };
    }

    const zoom = Number(coverZoomRange ? coverZoomRange.value : 1);
    const baseScale = Math.max(targetWidth / coverSourceImage.width, targetHeight / coverSourceImage.height);
    const drawWidth = coverSourceImage.width * baseScale * zoom;
    const drawHeight = coverSourceImage.height * baseScale * zoom;

    return {
      drawWidth,
      drawHeight,
      maxShiftX: Math.max(0, (drawWidth - targetWidth) / 2),
      maxShiftY: Math.max(0, (drawHeight - targetHeight) / 2)
    };
  }

  function drawCoverCropPreview() {
    if (!coverCropCtx || !coverCropCanvas || !coverSourceImage) return;

    const { drawWidth, drawHeight, maxShiftX, maxShiftY } = getCoverScaleInfo(COVER_WIDTH, COVER_HEIGHT);
    const shiftX = maxShiftX * coverOffsetXRatio;
    const shiftY = maxShiftY * coverOffsetYRatio;

    const drawX = (COVER_WIDTH - drawWidth) / 2 - shiftX;
    const drawY = (COVER_HEIGHT - drawHeight) / 2 - shiftY;

    coverCropCtx.clearRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
    coverCropCtx.fillStyle = '#f3f8ff';
    coverCropCtx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
    coverCropCtx.drawImage(coverSourceImage, drawX, drawY, drawWidth, drawHeight);
    coverCropCanvas.style.cursor = isCoverDragging ? 'grabbing' : 'grab';
  }

  function loadCoverForCropping(file) {
    if (!file || !coverCropSection || !coverCropCanvas) return;
    resetCoverCropControls();

    if (coverObjectUrl) {
      URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = '';
    }

    const image = new Image();
    coverObjectUrl = URL.createObjectURL(file);
    image.onload = () => {
      coverSourceImage = image;
      isCoverDragging = false;
      coverDragPointerId = null;
      coverCropSection.classList.remove('hidden-block');
      drawCoverCropPreview();
    };
    image.src = coverObjectUrl;
  }

  async function applyCoverCropAndUpload() {
    if (!coverCropCanvas || !coverSourceImage) return;

    const blob = await new Promise((resolve) => {
      coverCropCanvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (!blob) throw new Error('Cover crop failed.');

    const file = new File([blob], `cover-${Date.now()}.jpg`, { type: 'image/jpeg' });
    const imageUrl = await uploadImage(file);

    postCoverImage.value = imageUrl;
    updateCoverPreview(imageUrl);
    coverImageUpload.value = '';

    if (coverCropSection) coverCropSection.classList.add('hidden-block');
    if (coverObjectUrl) {
      URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = '';
    }
    coverSourceImage = null;
    isCoverDragging = false;
    coverDragPointerId = null;
  }

  function appendChat(role, text, draft) {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-bubble ${role}`;

    const textBlock = document.createElement('pre');
    textBlock.className = 'chat-text';
    textBlock.textContent = text;
    wrapper.appendChild(textBlock);

    if (role === 'assistant') {
      const actions = document.createElement('div');
      actions.className = 'row chat-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn ghost small';
      copyBtn.textContent = '복사';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch (_) {
          // ignore clipboard failure
        }
      });

      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.className = 'btn ghost small';
      insertBtn.textContent = '에디터로 이동 후 삽입';
      insertBtn.addEventListener('click', () => {
        setWorkspace('editor');
        insertIntoEditor(text.replace(/\n/g, '<br/>'));
      });

      actions.appendChild(copyBtn);
      actions.appendChild(insertBtn);

      if (draft && draft.content) {
        const applyDraftBtn = document.createElement('button');
        applyDraftBtn.type = 'button';
        applyDraftBtn.className = 'btn small';
        applyDraftBtn.textContent = '초안 전체를 에디터로 가져가기';
        applyDraftBtn.addEventListener('click', () => {
          applyAIDraft(draft);
          setWorkspace('editor');
        });
        actions.appendChild(applyDraftBtn);
      }

      wrapper.appendChild(actions);
    }

    chatBox.appendChild(wrapper);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function getEditorHtml() {
    if (currentMode === 'quill') {
      return quill.root.innerHTML;
    }
    return htmlSourceEditor.value;
  }

  function setEditorHtml(html) {
    if (currentMode === 'quill') {
      quill.root.innerHTML = html || '';
      htmlSourceEditor.value = quill.root.innerHTML;
    } else {
      htmlSourceEditor.value = html || '';
    }
  }

  function setMode(mode) {
    currentMode = mode;
    const isQuill = mode === 'quill';

    if (isQuill) {
      quill.root.innerHTML = htmlSourceEditor.value || quill.root.innerHTML;
      quillWrap.classList.remove('hidden-block');
      htmlWrap.classList.add('hidden-block');
    } else {
      htmlSourceEditor.value = quill.root.innerHTML;
      quillWrap.classList.add('hidden-block');
      htmlWrap.classList.remove('hidden-block');
    }

    modeTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.editorMode === mode);
    });
  }

  function insertIntoEditor(html) {
    if (currentMode === 'quill') {
      const range = quill.getSelection(true);
      const index = range ? range.index : quill.getLength();
      quill.clipboard.dangerouslyPasteHTML(index, html);
    } else {
      const start = htmlSourceEditor.selectionStart || htmlSourceEditor.value.length;
      const end = htmlSourceEditor.selectionEnd || htmlSourceEditor.value.length;
      htmlSourceEditor.value =
        htmlSourceEditor.value.slice(0, start) + html + htmlSourceEditor.value.slice(end);
    }
  }

  function applyAIDraft(draft) {
    if (!draft) return;
    latestAIDraft = draft;

    postTitle.value = draft.title || postTitle.value;
    postSummary.value = draft.summary || postSummary.value;
    postCoverImage.value = draft.coverImage || postCoverImage.value;
    updateCoverPreview(postCoverImage.value);
    setEditorHtml(draft.content || getEditorHtml());
  }

  async function uploadImage(file) {
    const formData = new FormData();
    formData.append('imageFile', file);

    const response = await fetch('/blog/manage/upload-image', {
      method: 'POST',
      body: formData
    });

    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Upload failed');
    return json.imageUrl || json.location;
  }

  async function sendPrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    appendChat('user', prompt);

    const response = await fetch('/blog/manage/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        title: postTitle.value,
        summary: postSummary.value,
        coverImage: postCoverImage.value,
        content: getEditorHtml()
      })
    });

    const json = await response.json();
    if (!json.ok) {
      appendChat('assistant', json.error || 'AI response failed.');
      return;
    }

    latestAIDraft = json.draft || null;

    const preview = json.draft && json.draft.content
      ? `${json.assistantMessage || ''}\n\n${json.draft.content}`
      : (json.assistantMessage || 'Draft updated.');

    appendChat('assistant', preview, json.draft || null);
    promptInput.value = '';
  }

  workspaceTabs.forEach((tab) => {
    tab.addEventListener('click', () => setWorkspace(tab.dataset.workspaceTab));
  });

  modeTabs.forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.editorMode));
  });

  if (editorUploadBtn && editorImageUpload) {
    editorUploadBtn.addEventListener('click', async () => {
      const file = editorImageUpload.files && editorImageUpload.files[0];
      if (!file) return;

      try {
        const url = await uploadImage(file);
        insertIntoEditor(`<p><img src="${url}" alt="image" /></p>`);
        editorImageUpload.value = '';
      } catch (error) {
        appendChat('assistant', error.message || 'Image upload failed.');
        setWorkspace('ai');
      }
    });
  }

  if (coverUploadBtn && coverImageUpload) {
    coverUploadBtn.addEventListener('click', () => {
      const file = coverImageUpload.files && coverImageUpload.files[0];
      if (!file) return;
      loadCoverForCropping(file);
    });
  }

  if (coverApplyCropBtn) {
    coverApplyCropBtn.addEventListener('click', async () => {
      try {
        await applyCoverCropAndUpload();
      } catch (error) {
        appendChat('assistant', error.message || 'Cover image upload failed.');
        setWorkspace('ai');
      }
    });
  }

  if (coverResetCropBtn) {
    coverResetCropBtn.addEventListener('click', () => {
      resetCoverCropControls();
      drawCoverCropPreview();
    });
  }

  if (coverZoomRange) {
    coverZoomRange.addEventListener('input', () => {
      coverOffsetXRatio = clamp(coverOffsetXRatio, -1, 1);
      coverOffsetYRatio = clamp(coverOffsetYRatio, -1, 1);
      drawCoverCropPreview();
    });
  }

  if (coverCropCanvas) {
    coverCropCanvas.addEventListener('pointerdown', (event) => {
      if (!coverSourceImage) return;

      isCoverDragging = true;
      coverDragPointerId = event.pointerId;
      coverDragStartX = event.clientX;
      coverDragStartY = event.clientY;
      coverDragStartOffsetX = coverOffsetXRatio;
      coverDragStartOffsetY = coverOffsetYRatio;
      coverCropCanvas.setPointerCapture(event.pointerId);
      drawCoverCropPreview();
    });

    coverCropCanvas.addEventListener('pointermove', (event) => {
      if (!isCoverDragging || event.pointerId !== coverDragPointerId || !coverSourceImage) return;

      const { maxShiftX, maxShiftY } = getCoverScaleInfo(COVER_WIDTH, COVER_HEIGHT);
      const dx = event.clientX - coverDragStartX;
      const dy = event.clientY - coverDragStartY;

      if (maxShiftX > 0) {
        coverOffsetXRatio = clamp(coverDragStartOffsetX - dx / maxShiftX, -1, 1);
      }
      if (maxShiftY > 0) {
        coverOffsetYRatio = clamp(coverDragStartOffsetY - dy / maxShiftY, -1, 1);
      }

      drawCoverCropPreview();
    });

    coverCropCanvas.addEventListener('pointerup', (event) => {
      if (event.pointerId !== coverDragPointerId) return;
      try {
        coverCropCanvas.releasePointerCapture(event.pointerId);
      } catch (_) {
        // ignore
      }
      isCoverDragging = false;
      coverDragPointerId = null;
      drawCoverCropPreview();
    });

    coverCropCanvas.addEventListener('pointercancel', () => {
      isCoverDragging = false;
      coverDragPointerId = null;
      drawCoverCropPreview();
    });
  }

  sendBtn.addEventListener('click', () => {
    sendPrompt().catch((error) => appendChat('assistant', error.message || 'AI response failed.'));
  });

  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendBtn.click();
    }
  });

  insertLatestBtn.addEventListener('click', () => {
    if (latestAIDraft) {
      setWorkspace('editor');
      applyAIDraft(latestAIDraft);
    }
  });

  if (postCoverImage) {
    postCoverImage.addEventListener('input', () => {
      updateCoverPreview(postCoverImage.value);
    });
  }

  form.addEventListener('submit', (event) => {
    if (currentWorkspace === 'ai') {
      event.preventDefault();
      appendChat('assistant', 'AI 탭에서는 제출할 수 없습니다. 에디터 작업 탭으로 이동해 제출하세요.');
      setWorkspace('editor');
      return;
    }
    contentField.value = getEditorHtml();
  });

  setEditorHtml(initial.post && initial.post.content ? initial.post.content : '');
  setMode('quill');
  setWorkspace(initial.mode === 'create' ? 'ai' : 'editor');
  updateCoverPreview(initial.post && initial.post.coverImage ? initial.post.coverImage : '');
})();
