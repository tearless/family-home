const express = require('express');
const { db } = require('../db');
const { requireFamily } = require('../middleware/auth');
const { markdownToHtml } = require('../services/text');
const {
  generateBlogFromPrompt,
  reviseBlogDraft,
  uniqueBlogSlug
} = require('../services/ai');
const { blogUpload } = require('../middleware/upload');
const { uploadImageFile } = require('../services/media');

const router = express.Router();

function uploadBlogImage(req, res, next) {
  blogUpload.single('imageFile')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Image upload failed.' });
    }
    return next();
  });
}

async function requirePostAuthor(req, res, next) {
  const id = Number(req.params.id);
  const post = await db.get('SELECT id, author FROM blog_posts WHERE id = ?', id);

  if (!post) {
    req.session.flash = { type: 'error', text: 'Blog post not found.' };
    return res.redirect('/blog/manage');
  }

  if (post.author !== req.session.familyUser.name) {
    req.session.flash = { type: 'error', text: 'Only the author can modify this blog post.' };
    return res.redirect('/blog/manage');
  }

  req.blogPost = post;
  return next();
}

function ensureHtmlDraft(draft = {}) {
  const raw = String(draft.content || '').trim();
  const looksLikeHtml = /<[^>]+>/.test(raw);
  return {
    ...draft,
    content: looksLikeHtml ? raw : markdownToHtml(raw)
  };
}

router.get('/manage', requireFamily, async (req, res) => {
  const posts = await db.all(
    `SELECT id, title, slug, author, summary, cover_image, created_at
     FROM blog_posts
     WHERE published = 1
     ORDER BY datetime(created_at) DESC`
  );

  const ownPosts = posts.filter((post) => post.author === req.session.familyUser.name);

  res.render('blog/manage', {
    title: 'Manage Blog',
    posts,
    ownPosts,
    currentFamilyName: req.session.familyUser.name
  });
});

router.get('/manage/new', requireFamily, (req, res) => {
  res.render('blog/editor', {
    title: 'Write Blog',
    mode: 'create',
    formAction: '/blog/manage/create',
    submitLabel: 'Publish',
    post: {
      id: null,
      title: '',
      summary: '',
      content: '',
      content_format: 'html',
      cover_image: ''
    }
  });
});

router.get('/manage/:id/edit', requireFamily, requirePostAuthor, async (req, res) => {
  const id = Number(req.params.id);
  const source = await db.get(
    `SELECT id, title, summary, content, content_format, cover_image
     FROM blog_posts
     WHERE id = ?`,
    id
  );

  const post = {
    ...source,
    content: source.content_format === 'html' ? source.content : markdownToHtml(source.content)
  };

  return res.render('blog/editor', {
    title: 'Edit Blog',
    mode: 'edit',
    formAction: `/blog/manage/${id}/update`,
    submitLabel: 'Update',
    post
  });
});

router.post('/manage/upload-image', requireFamily, uploadBlogImage, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No image file uploaded.' });
  }

  try {
    const imageUrl = await uploadImageFile({ file: req.file, folder: 'blog' });
    return res.json({
      ok: true,
      imageUrl,
      location: imageUrl
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Image upload failed.' });
  }
});

router.post('/manage/ai/chat', requireFamily, async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  const draft = {
    title: String(req.body.title || '').trim(),
    summary: String(req.body.summary || '').trim(),
    content: String(req.body.content || '').trim(),
    coverImage: String(req.body.coverImage || '').trim()
  };

  if (!prompt) {
    return res.status(400).json({ ok: false, error: 'Prompt is required.' });
  }

  const hasDraft = Boolean(draft.title || draft.summary || draft.content || draft.coverImage);

  if (!hasDraft) {
    const initial = await generateBlogFromPrompt({
      prompt,
      author: req.session.familyUser.name
    });
    const draft = ensureHtmlDraft(initial);

    return res.json({
      ok: true,
      assistantMessage: '초안이 생성되었습니다. 원하는 텍스트를 복사/삽입해 편집하세요.',
      draft
    });
  }

  const revised = await reviseBlogDraft({
    instruction: prompt,
    draft,
    author: req.session.familyUser.name
  });
  const draftResult = ensureHtmlDraft(revised.draft);

  return res.json({
    ok: true,
    assistantMessage: revised.assistantMessage,
    draft: draftResult
  });
});

router.post('/manage/create', requireFamily, async (req, res) => {
  const title = (req.body.title || '').trim();
  const summary = (req.body.summary || '').trim();
  const content = (req.body.content || '').trim();
  const coverImage = (req.body.coverImage || '').trim();

  if (!title || !summary || !content) {
    req.session.flash = { type: 'error', text: 'Title, summary, and content are required.' };
    return res.redirect('/blog/manage/new');
  }

  const slug = await uniqueBlogSlug(title);

  await db.run(
    `INSERT INTO blog_posts (title, slug, author, summary, content, content_format, cover_image, published, updated_at)
     VALUES (?, ?, ?, ?, ?, 'html', ?, 1, datetime('now'))`
    ,
    title,
    slug,
    req.session.familyUser.name,
    summary,
    content,
    coverImage
  );

  req.session.flash = { type: 'success', text: `Blog "${title}" published.` };
  return res.redirect('/blog/manage');
});

router.post('/manage/:id/update', requireFamily, requirePostAuthor, async (req, res) => {
  const id = Number(req.params.id);
  const title = (req.body.title || '').trim();
  const summary = (req.body.summary || '').trim();
  const content = (req.body.content || '').trim();
  const coverImage = (req.body.coverImage || '').trim();

  if (!title || !summary || !content) {
    req.session.flash = { type: 'error', text: 'Title, summary, and content are required.' };
    return res.redirect(`/blog/manage/${id}/edit`);
  }

  await db.run(
    `UPDATE blog_posts
     SET title = ?, summary = ?, content = ?, content_format = 'html', cover_image = ?, updated_at = datetime('now')
     WHERE id = ?`
    ,
    title,
    summary,
    content,
    coverImage,
    id
  );

  req.session.flash = { type: 'success', text: 'Blog post updated.' };
  return res.redirect('/blog/manage');
});

router.post('/manage/:id/delete', requireFamily, requirePostAuthor, async (req, res) => {
  const id = Number(req.params.id);
  await db.run('DELETE FROM blog_posts WHERE id = ?', id);
  req.session.flash = { type: 'success', text: 'Blog post deleted.' };
  return res.redirect('/blog/manage');
});

router.get('/', async (req, res) => {
  const posts = await db.all(
    `SELECT id, title, slug, author, summary, cover_image, created_at
     FROM blog_posts
     WHERE published = 1
     ORDER BY datetime(created_at) DESC`
  );

  res.render('blog/list', {
    title: 'Blog',
    posts
  });
});

router.get('/:slug', async (req, res) => {
  const post = await db.get('SELECT * FROM blog_posts WHERE slug = ? AND published = 1', req.params.slug);

  if (!post) {
    return res.status(404).render('404', { title: 'Blog Not Found' });
  }

  const htmlContent = post.content_format === 'html' ? post.content : markdownToHtml(post.content);
  return res.render('blog/detail', {
    title: post.title,
    post,
    htmlContent
  });
});

module.exports = router;
