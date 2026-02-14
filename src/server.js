require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { initDb } = require('./db');

const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const albumRoutes = require('./routes/album');
const adminRoutes = require('./routes/admin');
const blogRoutes = require('./routes/blog');

initDb();

const app = express();
const PORT = process.env.PORT || 3010;
const HOST = process.env.HOST || '127.0.0.1';
const isVercel = process.env.VERCEL === '1';

const uploadStaticRoot = isVercel
  ? path.join('/tmp', 'family-home-uploads')
  : path.join(__dirname, '..', 'public', 'uploads');

if (!fs.existsSync(uploadStaticRoot)) {
  fs.mkdirSync(uploadStaticRoot, { recursive: true });
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(uploadStaticRoot));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'family-home-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 6 }
  })
);

app.use((req, res, next) => {
  res.locals.familyUser = req.session.familyUser || null;
  res.locals.memberUser = req.session.memberUser || null;
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  next();
});

app.use('/', indexRoutes);
app.use('/auth', authRoutes);
app.use('/album', albumRoutes);
app.use('/admin', adminRoutes);
app.use('/blog', blogRoutes);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`family-home running on http://${HOST}:${PORT}`);
  });
}

module.exports = app;
