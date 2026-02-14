const express = require('express');
const { db } = require('../db');
const { requireAlbumAccess, requireFamily } = require('../middleware/auth');
const { sanitizeContent } = require('../services/moderation');
const { secureToken } = require('../services/tokens');
const { sendCommentAlert } = require('../services/email');
const { categorizePhoto } = require('../services/ai');
const { photoUpload } = require('../middleware/upload');
const { uploadImageFile } = require('../services/media');

const router = express.Router();
const allowedEmojis = ['❤️', '😍', '🥰', '👏', '🎉', '🌞', '✨'];

function getAlbumActor(req) {
  if (req.session.memberUser) {
    return {
      email: req.session.memberUser.email,
      displayName: req.session.memberUser.name
    };
  }

  if (req.session.familyUser) {
    return {
      email: `${req.session.familyUser.name.toLowerCase()}@family-admin.local`,
      displayName: req.session.familyUser.name
    };
  }

  return null;
}

function uploadPhotoMiddleware(req, res, next) {
  photoUpload.single('photoFile')(req, res, (err) => {
    if (err) {
      req.session.flash = { type: 'error', text: err.message || 'Photo upload failed.' };
      return res.redirect('/album/manage');
    }
    return next();
  });
}

router.get('/manage', requireFamily, (req, res) => {
  const categories = db
    .prepare('SELECT id, name, slug, created_at FROM photo_categories ORDER BY name ASC')
    .all();

  const recentPhotos = db
    .prepare(
      `SELECT p.id, p.title, p.caption, p.image_url, p.created_at, p.created_by, c.name AS category_name
       FROM album_photos p
       LEFT JOIN photo_categories c ON c.id = p.category_id
       ORDER BY datetime(p.created_at) DESC
       LIMIT 40`
    )
    .all();

  res.render('album/manage', {
    title: 'Manage Gallery',
    categories,
    recentPhotos,
    currentFamilyName: req.session.familyUser.name
  });
});

router.post('/manage/photos', requireFamily, uploadPhotoMiddleware, async (req, res) => {
  const title = (req.body.title || '').trim();
  const caption = (req.body.caption || '').trim();
  const sourceType = (req.body.sourceType || 'url').trim();
  const imageUrlInput = (req.body.imageUrl || '').trim();
  const highlightOrder = Number(req.body.highlightOrder || 0);

  let finalImageUrl = '';
  if (sourceType === 'upload') {
    if (!req.file) {
      req.session.flash = { type: 'error', text: 'Please choose a photo file to upload.' };
      return res.redirect('/album/manage');
    }
    try {
      finalImageUrl = await uploadImageFile({ file: req.file, folder: 'photos' });
    } catch (error) {
      req.session.flash = { type: 'error', text: error.message || 'Photo upload failed.' };
      return res.redirect('/album/manage');
    }
  } else {
    finalImageUrl = imageUrlInput;
  }

  if (!title || !finalImageUrl) {
    req.session.flash = { type: 'error', text: 'Photo title and image source are required.' };
    return res.redirect('/album/manage');
  }

  const category = await categorizePhoto({ title, caption, imageUrl: finalImageUrl });

  db.prepare(
    `INSERT INTO album_photos (title, caption, image_url, category_id, created_by, highlight_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(title, caption, finalImageUrl, category.id, req.session.familyUser.name, highlightOrder);

  req.session.flash = {
    type: 'success',
    text: `Photo added and categorized as "${category.name}".`
  };
  return res.redirect('/album/manage');
});

router.post('/manage/photos/:id/delete', requireFamily, (req, res) => {
  const id = Number(req.params.id);
  const photo = db.prepare('SELECT id, created_by FROM album_photos WHERE id = ?').get(id);

  if (!photo) {
    req.session.flash = { type: 'error', text: 'Photo not found.' };
    return res.redirect('/album/manage');
  }

  if (photo.created_by !== req.session.familyUser.name) {
    req.session.flash = { type: 'error', text: 'Only the author can delete this photo.' };
    return res.redirect('/album/manage');
  }

  db.prepare(
    'DELETE FROM comment_reactions WHERE comment_id IN (SELECT id FROM album_comments WHERE photo_id = ?)'
  ).run(id);
  db.prepare('DELETE FROM album_comments WHERE photo_id = ?').run(id);
  db.prepare('DELETE FROM emoji_reactions WHERE photo_id = ?').run(id);
  db.prepare('DELETE FROM album_photos WHERE id = ?').run(id);

  req.session.flash = { type: 'success', text: 'Photo deleted.' };
  return res.redirect('/album/manage');
});

router.get('/', requireAlbumAccess, (req, res) => {
  const categorySlug = (req.query.category || '').trim();

  const categories = db
    .prepare(
      `SELECT c.id, c.name, c.slug, COUNT(p.id) AS photo_count
       FROM photo_categories c
       LEFT JOIN album_photos p ON p.category_id = c.id
       GROUP BY c.id, c.name, c.slug
       ORDER BY c.name ASC`
    )
    .all();

  let photos;
  if (categorySlug) {
    photos = db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM album_photos p
         LEFT JOIN photo_categories c ON c.id = p.category_id
         WHERE c.slug = ?
         ORDER BY p.id DESC`
      )
      .all(categorySlug);
  } else {
    photos = db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM album_photos p
         LEFT JOIN photo_categories c ON c.id = p.category_id
         ORDER BY p.id DESC`
      )
      .all();
  }

  const commentsByPhoto = {};
  photos.forEach((photo) => {
    commentsByPhoto[photo.id] = db
      .prepare(
        `SELECT * FROM album_comments
         WHERE photo_id = ? AND deleted_at IS NULL
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT 30`
      )
      .all(photo.id);
  });

  const reactionRows = db
    .prepare(
      `SELECT photo_id, emoji, COUNT(*) AS count
       FROM emoji_reactions
       GROUP BY photo_id, emoji`
    )
    .all();

  const reactions = reactionRows.reduce((acc, row) => {
    if (!acc[row.photo_id]) acc[row.photo_id] = {};
    acc[row.photo_id][row.emoji] = row.count;
    return acc;
  }, {});

  const commentReactionRows = db
    .prepare(
      `SELECT comment_id, emoji, COUNT(*) AS count
       FROM comment_reactions
       GROUP BY comment_id, emoji`
    )
    .all();

  const commentReactions = commentReactionRows.reduce((acc, row) => {
    if (!acc[row.comment_id]) acc[row.comment_id] = {};
    acc[row.comment_id][row.emoji] = row.count;
    return acc;
  }, {});

  res.render('album/index', {
    title: 'Photo Album',
    photos,
    categories,
    selectedCategory: categorySlug,
    commentsByPhoto,
    commentReactions,
    reactions,
    allowedEmojis
  });
});

router.post('/comment', requireAlbumAccess, async (req, res) => {
  const actor = getAlbumActor(req);
  const photoId = Number(req.body.photoId);
  const content = (req.body.content || '').trim();

  if (!actor) {
    req.session.flash = { type: 'error', text: 'Please login first.' };
    return res.redirect('/auth/member/login');
  }

  if (!photoId || !content) {
    req.session.flash = { type: 'error', text: 'Photo and comment content are required.' };
    return res.redirect('/album');
  }

  const moderation = sanitizeContent(content);
  if (moderation.filtered) {
    req.session.flash = {
      type: 'error',
      text: 'Your comment contains language that is not allowed. Please keep it kind.'
    };
    return res.redirect('/album');
  }

  const result = db
    .prepare(
      `INSERT INTO album_comments (photo_id, member_email, display_name, content, content_type, filtered)
       VALUES (?, ?, ?, ?, 'text', 0)`
    )
    .run(photoId, actor.email, actor.displayName, moderation.cleanText);

  const commentId = result.lastInsertRowid;
  const token = secureToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

  db.prepare(
    'INSERT INTO comment_delete_tokens (comment_id, token, expires_at) VALUES (?, ?, ?)'
  ).run(commentId, token, expiresAt);

  const photo = db.prepare('SELECT title FROM album_photos WHERE id = ?').get(photoId);
  const baseUrl = process.env.BASE_URL || 'http://localhost:3010';
  const deleteUrl = `${baseUrl}/admin/comments/delete/${token}`;

  try {
    await sendCommentAlert({
      commentId,
      photoTitle: photo ? photo.title : 'Photo',
      displayName: actor.displayName,
      content: moderation.cleanText,
      deleteUrl
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('comment alert email failed', error);
  }

  req.session.flash = { type: 'success', text: 'Thanks for sharing love with the family!' };
  return res.redirect('/album');
});

router.post('/comment-reaction', requireAlbumAccess, (req, res) => {
  const actor = getAlbumActor(req);
  const commentId = Number(req.body.commentId);
  const emoji = String(req.body.emoji || '').trim();

  if (!actor) {
    req.session.flash = { type: 'error', text: 'Please login first.' };
    return res.redirect('/auth/member/login');
  }

  if (!commentId || !allowedEmojis.includes(emoji)) {
    req.session.flash = { type: 'error', text: 'Invalid comment reaction.' };
    return res.redirect('/album');
  }

  const comment = db
    .prepare('SELECT id FROM album_comments WHERE id = ? AND deleted_at IS NULL')
    .get(commentId);
  if (!comment) {
    req.session.flash = { type: 'error', text: 'Comment not found.' };
    return res.redirect('/album');
  }

  db.prepare(
    'INSERT INTO comment_reactions (comment_id, member_email, emoji) VALUES (?, ?, ?)'
  ).run(commentId, actor.email, emoji);

  req.session.flash = { type: 'success', text: 'Comment reaction saved!' };
  return res.redirect('/album');
});

router.post('/emoji', requireAlbumAccess, (req, res) => {
  const actor = getAlbumActor(req);
  const photoId = Number(req.body.photoId);
  const emoji = (req.body.emoji || '').trim();

  if (!actor) {
    req.session.flash = { type: 'error', text: 'Please login first.' };
    return res.redirect('/auth/member/login');
  }

  if (!photoId || !allowedEmojis.includes(emoji)) {
    req.session.flash = { type: 'error', text: 'Invalid emoji reaction.' };
    return res.redirect('/album');
  }

  db.prepare(
    'INSERT INTO emoji_reactions (photo_id, member_email, emoji) VALUES (?, ?, ?)'
  ).run(photoId, actor.email, emoji);

  req.session.flash = { type: 'success', text: 'Reaction saved!' };
  return res.redirect('/album');
});

module.exports = router;
