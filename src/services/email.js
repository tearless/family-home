const nodemailer = require('nodemailer');

const hasEmailConfig =
  process.env.EMAIL_HOST &&
  process.env.EMAIL_PORT &&
  process.env.EMAIL_USER &&
  process.env.EMAIL_PASS;

const transporter = hasEmailConfig
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT),
      secure: String(process.env.EMAIL_SECURE).toLowerCase() === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    })
  : null;

async function sendMail({ to, subject, html, text }) {
  if (!transporter) {
    // eslint-disable-next-line no-console
    console.log('[email disabled] to=%s subject=%s', to, subject);
    return;
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject,
    html,
    text
  });
}

async function sendMemberCode(email, code) {
  await sendMail({
    to: email,
    subject: 'Your Family Home verification code',
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`
  });
}

async function sendCommentAlert({ commentId, photoTitle, displayName, content, deleteUrl }) {
  const to = process.env.ANTON_NOTIFY_EMAIL || 'byung.yu@gmail.com';
  await sendMail({
    to,
    subject: `New Family Home comment (#${commentId})`,
    text: `${displayName} commented on "${photoTitle}": ${content}\nDelete: ${deleteUrl}`,
    html: `
      <h2>New Family Home Comment</h2>
      <p><strong>${displayName}</strong> commented on <strong>${photoTitle}</strong>:</p>
      <blockquote>${content}</blockquote>
      <p>
        <a href="${deleteUrl}" style="display:inline-block;padding:10px 14px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;">
          Delete This Comment
        </a>
      </p>
    `
  });
}

module.exports = { sendMemberCode, sendCommentAlert };
