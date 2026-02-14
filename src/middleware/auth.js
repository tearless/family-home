function requireFamily(req, res, next) {
  if (!req.session.familyUser) {
    req.session.flash = { type: 'error', text: 'Family login required.' };
    return res.redirect('/admin/login');
  }
  return next();
}

function requireMember(req, res, next) {
  if (!req.session.memberUser) {
    req.session.flash = { type: 'error', text: 'Please login as an approved member to access the album.' };
    return res.redirect('/auth/member/login');
  }
  return next();
}

function requireAlbumAccess(req, res, next) {
  if (req.session.familyUser || req.session.memberUser) {
    return next();
  }

  req.session.flash = {
    type: 'error',
    text: 'Please login first. Family users can use Admin login, others need approved member login.'
  };
  return res.redirect('/auth/member/login');
}

module.exports = { requireFamily, requireMember, requireAlbumAccess };
