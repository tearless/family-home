const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireFamily } = require('../middleware/auth');
const { saveSettings, settingsMap, testAiConnection } = require('../services/ai');
const { profileUpload, landingUpload } = require('../middleware/upload');
const { uploadImageFile, resolveImageUrl } = require('../services/media');

const router = express.Router();

function normalizeProfileBio(input) {
  return String(input || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function uploadProfileImage(req, res, next) {
  profileUpload.single('imageFile')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Profile upload failed.' });
    }
    return next();
  });
}

function uploadLandingBackground(req, res, next) {
  landingUpload.single('imageFile')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Background upload failed.' });
    }
    return next();
  });
}

router.get('/login', (req, res) => {
  res.render('admin/login', { title: 'Family Admin Login' });
});

router.post('/login', async (req, res) => {
  const name = (req.body.name || '').trim();
  const password = (req.body.password || '').trim();

  const user = await db.get('SELECT * FROM family_users WHERE name = ?', name);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.session.flash = { type: 'error', text: 'Invalid family credentials.' };
    return res.redirect('/admin/login');
  }

  req.session.familyUser = { id: user.id, name: user.name, role: user.role };
  req.session.flash = { type: 'success', text: `Welcome, ${user.name}.` };
  return res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.familyUser = null;
  req.session.flash = { type: 'success', text: 'Logged out from admin.' };
  res.redirect('/');
});

router.get('/', requireFamily, async (req, res) => {
  const pendingRequests = await db.all(
    'SELECT * FROM member_requests WHERE status = ? ORDER BY created_at ASC',
    'pending'
  );
  const familyProfiles = await db.all(
    `SELECT id, name, profile_image, profile_bio
     FROM family_users
     WHERE role = 'family'
     ORDER BY CASE name
       WHEN 'Anton' THEN 1
       WHEN 'Olivia' THEN 2
       WHEN 'Eliana' THEN 3
       ELSE 99 END, id ASC`
  );

  const apiSettings = await settingsMap();
  const apiConfigured = Boolean(apiSettings.ai_url && apiSettings.ai_key);
  const familyProfilesWithUrls = await Promise.all(familyProfiles.map(async (profile) => ({
    ...profile,
    profile_image_url: await resolveImageUrl(profile.profile_image || '')
  })));
  const landingBackgroundImageRef = String(apiSettings.landing_background_image || '').trim();
  const landingBackgroundImage = await resolveImageUrl(landingBackgroundImageRef);

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    pendingRequests,
    familyProfiles: familyProfilesWithUrls,
    landingBackgroundImage,
    landingBackgroundImageRef,
    apiSettings,
    apiConfigured
  });
});

router.post('/family-profiles/:id/photo', requireFamily, uploadProfileImage, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid profile id.' });
  }

  const profile = await db.get('SELECT id, name, role FROM family_users WHERE id = ?', id);

  if (!profile || profile.role !== 'family') {
    return res.status(404).json({ ok: false, error: 'Family profile not found.' });
  }

  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No image uploaded.' });
  }

  try {
    const uploaded = await uploadImageFile({ file: req.file, folder: 'profiles' });
    await db.run('UPDATE family_users SET profile_image = ? WHERE id = ?', uploaded.ref, id);

    return res.json({
      ok: true,
      profileId: id,
      profileName: profile.name,
      imageRef: uploaded.ref,
      imageUrl: uploaded.url
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Profile upload failed.' });
  }
});

router.post('/landing-background/photo', requireFamily, uploadLandingBackground, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No image uploaded.' });
  }

  try {
    const uploaded = await uploadImageFile({ file: req.file, folder: 'landing' });
    await db.run(
      `INSERT INTO api_settings (setting_key, setting_value)
       VALUES ('landing_background_image', ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`
      ,
      uploaded.ref
    );

    return res.json({
      ok: true,
      imageRef: uploaded.ref,
      imageUrl: uploaded.url
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Background upload failed.' });
  }
});

router.post('/family-profiles/:id/bio', requireFamily, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    req.session.flash = { type: 'error', text: 'Invalid profile id.' };
    return res.redirect('/admin');
  }

  const profile = await db.get('SELECT id, name, role FROM family_users WHERE id = ?', id);
  if (!profile || profile.role !== 'family') {
    req.session.flash = { type: 'error', text: 'Family profile not found.' };
    return res.redirect('/admin');
  }

  const bio = normalizeProfileBio(req.body.profileBio);
  if (bio.length > 600) {
    req.session.flash = { type: 'error', text: '소개 문구는 600자 이내로 입력해주세요.' };
    return res.redirect('/admin');
  }

  await db.run('UPDATE family_users SET profile_bio = ? WHERE id = ?', bio, id);
  req.session.flash = { type: 'success', text: `${profile.name} 소개 문구가 업데이트되었습니다.` };
  return res.redirect('/admin');
});

router.post('/member-requests/:id/approve', requireFamily, async (req, res) => {
  const id = Number(req.params.id);
  const request = await db.get('SELECT * FROM member_requests WHERE id = ?', id);
  if (!request) {
    req.session.flash = { type: 'error', text: 'Membership request not found.' };
    return res.redirect('/admin');
  }

  await db.run(
    `UPDATE member_requests
     SET status = 'approved', approved_at = datetime('now'), approved_by = ?
     WHERE id = ?`
    ,
    req.session.familyUser.name,
    id
  );

  await db.run(
    `UPDATE member_accounts
     SET is_approved = 1, approved_at = datetime('now')
     WHERE email = ?`
    ,
    request.email
  );

  req.session.flash = { type: 'success', text: `Approved ${request.email}.` };
  return res.redirect('/admin');
});

router.post('/member-requests/:id/reject', requireFamily, async (req, res) => {
  const id = Number(req.params.id);
  await db.run('UPDATE member_requests SET status = ? WHERE id = ?', 'rejected', id);
  req.session.flash = { type: 'success', text: 'Request rejected.' };
  return res.redirect('/admin');
});

router.post('/api-settings', requireFamily, async (req, res) => {
  await saveSettings({
    ai_provider: req.body.aiProvider,
    ai_url: req.body.aiUrl,
    ai_key: req.body.aiKey,
    ai_model: req.body.aiModel,
    ai_blog_system_prompt: req.body.aiBlogSystemPrompt,
    ai_category_system_prompt: req.body.aiCategorySystemPrompt
  });

  req.session.flash = { type: 'success', text: 'AI/API settings updated.' };
  return res.redirect('/admin');
});

router.post('/api-settings/test', requireFamily, async (req, res) => {
  const result = await testAiConnection();
  req.session.flash = {
    type: result.ok ? 'success' : 'error',
    text: result.message
  };
  return res.redirect('/admin');
});

router.post('/password/change', requireFamily, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '').trim();
  const nextPassword = String(req.body.newPassword || '').trim();
  const confirmPassword = String(req.body.confirmPassword || '').trim();

  if (!currentPassword || !nextPassword || !confirmPassword) {
    req.session.flash = { type: 'error', text: 'All password fields are required.' };
    return res.redirect('/admin');
  }

  if (nextPassword.length < 4) {
    req.session.flash = { type: 'error', text: 'New password must be at least 4 characters.' };
    return res.redirect('/admin');
  }

  if (nextPassword !== confirmPassword) {
    req.session.flash = { type: 'error', text: 'New password and confirmation do not match.' };
    return res.redirect('/admin');
  }

  const user = await db.get('SELECT * FROM family_users WHERE id = ?', req.session.familyUser.id);
  if (!user) {
    req.session.flash = { type: 'error', text: 'Family user not found. Please login again.' };
    req.session.familyUser = null;
    return res.redirect('/admin/login');
  }

  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    req.session.flash = { type: 'error', text: 'Current password is incorrect.' };
    return res.redirect('/admin');
  }

  const nextHash = bcrypt.hashSync(nextPassword, 10);
  await db.run('UPDATE family_users SET password_hash = ? WHERE id = ?', nextHash, user.id);

  req.session.flash = { type: 'success', text: 'Password updated successfully.' };
  return res.redirect('/admin');
});

router.get('/comments/delete/:token', async (req, res) => {
  const token = req.params.token;
  const tokenRow = await db.get(
    `SELECT t.*, c.deleted_at
     FROM comment_delete_tokens t
     JOIN album_comments c ON c.id = t.comment_id
     WHERE t.token = ? AND t.used_at IS NULL`,
    token
  );

  if (!tokenRow) {
    return res.status(400).render('message', {
      title: 'Delete Link Invalid',
      message: 'This delete link is invalid or already used.'
    });
  }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return res.status(400).render('message', {
      title: 'Delete Link Expired',
      message: 'This delete link has expired.'
    });
  }

  await db.run("UPDATE album_comments SET deleted_at = datetime('now') WHERE id = ?", tokenRow.comment_id);
  await db.run("UPDATE comment_delete_tokens SET used_at = datetime('now') WHERE id = ?", tokenRow.id);

  return res.render('message', {
    title: 'Comment Deleted',
    message: 'The comment was deleted successfully.'
  });
});

module.exports = router;
