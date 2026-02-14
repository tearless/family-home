const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/member/request', (req, res) => {
  return res.redirect('/auth/member/login');
});

router.post('/member/request', (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();

  if (!name || !email) {
    req.session.flash = { type: 'error', text: 'ID and email are required.' };
    return res.redirect('/auth/member/login');
  }

  const approvedAccount = db
    .prepare('SELECT is_approved FROM member_accounts WHERE email = ?')
    .get(email);

  if (approvedAccount && approvedAccount.is_approved === 1) {
    req.session.flash = { type: 'success', text: 'This email is already approved. Please login.' };
    return res.redirect('/auth/member/login');
  }

  db.prepare(
    `INSERT INTO member_requests (name, email, status)
     VALUES (?, ?, 'pending')
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       status = 'pending',
       created_at = datetime('now'),
       approved_at = NULL,
       approved_by = NULL`
  ).run(name, email);

  db.prepare(
    `INSERT INTO member_accounts (name, email, is_approved)
     VALUES (?, ?, 0)
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name`
  ).run(name, email);

  req.session.flash = { type: 'success', text: 'Request submitted. Family will review and approve it.' };
  return res.redirect('/auth/member/login');
});

router.get('/member/login', (req, res) => {
  res.render('auth/member-login', { title: 'Member Login' });
});

router.post('/member/login', (req, res) => {
  const memberId = (req.body.memberId || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();

  if (!memberId || !email) {
    req.session.flash = { type: 'error', text: 'ID and email are required.' };
    return res.redirect('/auth/member/login');
  }

  const member = db
    .prepare(
      `SELECT name, email, is_approved
       FROM member_accounts
       WHERE lower(email) = lower(?) AND lower(name) = lower(?)`
    )
    .get(email, memberId);

  if (!member) {
    req.session.flash = {
      type: 'error',
      text: 'No matching approved member. Please submit a request first.'
    };
    return res.redirect('/auth/member/login');
  }

  if (!member.is_approved) {
    req.session.flash = {
      type: 'error',
      text: 'Your request is pending approval.'
    };
    return res.redirect('/auth/member/login');
  }

  req.session.memberUser = { name: member.name, email: member.email };
  req.session.flash = { type: 'success', text: `Welcome ${member.name}!` };
  return res.redirect('/album');
});

router.post('/member/logout', (req, res) => {
  req.session.memberUser = null;
  req.session.flash = { type: 'success', text: 'Logged out from member area.' };
  res.redirect('/');
});

module.exports = router;
