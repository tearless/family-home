const express = require('express');
const { db } = require('../db');
const { resolveImageUrl } = require('../services/media');

const router = express.Router();

router.get('/', async (req, res) => {
  const bioByName = {
    Anton: '기획과 구현을 담당하는 패밀리 메이커.',
    Olivia: '감성과 색감을 채우는 크리에이터.',
    Eliana: '작은 일상을 특별하게 만드는 주인공.'
  };
  const orderedNames = ['Anton', 'Olivia', 'Eliana'];
  const familyRows = await db.all(
    `SELECT id, name, profile_image, profile_bio
     FROM family_users
     WHERE role = 'family'
     ORDER BY CASE name
       WHEN 'Anton' THEN 1
       WHEN 'Olivia' THEN 2
       WHEN 'Eliana' THEN 3
       ELSE 99 END, id ASC`
  );
  const byName = new Map(familyRows.map((row) => [row.name, row]));
  const members = await Promise.all(orderedNames.map(async (name) => {
    const row = byName.get(name);
    return {
      id: row ? row.id : null,
      name,
      bio: row && String(row.profile_bio || '').trim() ? row.profile_bio : (bioByName[name] || ''),
      profileImage: row ? await resolveImageUrl(row.profile_image || '') : ''
    };
  }));

  const heroPhotoRows = await db.all(
    'SELECT id, title, image_url FROM album_photos ORDER BY highlight_order ASC, id DESC LIMIT 12'
  );
  const heroPhotos = await Promise.all(heroPhotoRows.map(async (row) => ({
    id: row.id,
    title: row.title,
    imageUrl: await resolveImageUrl(row.image_url)
  })));

  const recentPhotoRows = await db.all(
    `SELECT id, title, image_url AS image_url, caption AS summary, created_at
     FROM album_photos
     ORDER BY datetime(created_at) DESC
     LIMIT 5`
  );
  const recentPhotos = await Promise.all(recentPhotoRows.map(async (row) => ({
    type: 'photo',
    title: row.title,
    summary: row.summary || 'New family photo added to the album.',
    imageUrl: await resolveImageUrl(row.image_url),
    href: '/album',
    createdAt: row.created_at
  })));

  const recentBlogRows = await db.all(
    `SELECT id, title, slug, summary, cover_image, created_at
     FROM blog_posts
     WHERE published = 1
     ORDER BY datetime(created_at) DESC
     LIMIT 5`
  );
  const recentBlogs = await Promise.all(recentBlogRows.map(async (row) => ({
    type: 'blog',
    title: row.title,
    summary: row.summary,
    imageUrl: await resolveImageUrl(row.cover_image || ''),
    href: `/blog/${row.slug}`,
    createdAt: row.created_at
  })));

  const recentUpdates = [...recentPhotos, ...recentBlogs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  const landingBackgroundImageRow = await db.get(
    "SELECT setting_value FROM api_settings WHERE setting_key = 'landing_background_image'"
  );
  const landingBackgroundImageRef = landingBackgroundImageRow
    ? String(landingBackgroundImageRow.setting_value || '').trim()
    : '';
  const landingBackgroundImage = await resolveImageUrl(landingBackgroundImageRef);

  res.render('index', {
    title: 'Family Home',
    members,
    heroPhotos,
    recentUpdates,
    landingBackgroundImage
  });
});

module.exports = router;
