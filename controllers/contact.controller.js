// controllers/contact.controller.js
import { makeTransportContact } from "../utils/mailer.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sanitize = (s = "") => String(s).replace(/\r?\n/g, " ").trim();
const escapeHtml = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function contactSend(req, res) {
  try {
    const b = req.body || {};
    const nom = sanitize(b.nom ?? b.name ?? "");
    const email = sanitize(b.email ?? "");
    const sujet = sanitize(b.sujet ?? b.subject ?? "Message via formulaire");
    const message = (b.message ?? "").toString().trim();

    if (!nom || !email || !message) {
      return res.status(400).json({
        success: false,
        message: "Champs manquants (nom, email, message)."
      });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: "Adresse e-mail invalide." });
    }

    // 📍 Email de destination → contact !
    const toContact = (process.env.CONTACT_EMAIL || "").trim();
    if (!toContact) {
      return res.status(500).json({ success: false, message: "CONTACT_EMAIL non configuré." });
    }

    const subject = `Contact – ${sujet}`;
    const safeMsg = escapeHtml(message).replace(/\r?\n/g, "<br>");

    // ================= EMAIL HTML =================
    const BRAND_PRIMARY = "#002147";
    const BAND_DARK = "#0B2239";
    const BAND_TEXT = "#FFFFFF";
    const PAGE_BG = "#F5F7FB";
    const CONTAINER_W = 680;

    const html = `<!doctype html>
<html>
<head>
  <meta charSet="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;background:${PAGE_BG};font-family:Arial;color:#111;">
<table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PAGE_BG};padding:24px;">
<tr><td align="center">

<table cellpadding="0" cellspacing="0" border="0" style="width:${CONTAINER_W}px;max-width:100%;">
<tr>
  <td style="background:${BAND_DARK};color:${BAND_TEXT};text-align:center;padding:14px;border-radius:8px;">
    MTR – Manufacture Tunisienne des ressorts
  </td>
</tr>

<tr><td style="height:16px;"></td></tr>

<tr><td style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
  <h1 style="margin:0 0 12px;color:${BRAND_PRIMARY};font-size:18px;">
    Nouveau message du site
  </h1>

  <ul style="margin:0 0 16px 20px;padding:0;">
    <li><strong>Nom :</strong> ${escapeHtml(nom)}</li>
    <li><strong>Email :</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></li>
    <li><strong>Objet :</strong> ${escapeHtml(sujet)}</li>
  </ul>

  <h2 style="margin:12px 0;font-size:15px;">Message</h2>
  <div style="border:1px solid #ddd;border-radius:8px;padding:12px;background:#fafafa;">
    ${safeMsg}
  </div>
</td></tr>

<tr><td style="height:16px;"></td></tr>
<tr>
  <td style="background:${BAND_DARK};color:${BAND_TEXT};padding:14px;border-radius:8px;">&nbsp;</td>
</tr>

</table>
</td></tr>
</table>
</body></html>`;

    const textBody = [
      "Nouveau message du site :",
      "",
      `Nom    : ${nom}`,
      `Email  : ${email}`,
      `Sujet  : ${sujet}`,
      "",
      "Message :",
      message,
    ].join("\n");

    // 📧 envoyer via SMTP_CONTACT_USER
    const transport = makeTransportContact();
    await transport.sendMail({
      from: `Contact MTR <${process.env.SMTP_CONTACT_USER}>`,
      to: toContact,
      replyTo: email, // pour répondre directement au client !
      subject,
      text: textBody,
      html,
    });

    return res.json({ success: true, message: "Message envoyé. Merci !" });

  } catch (err) {
    console.error("contactSend error:", err);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de l’envoi. Réessayez plus tard."
    });
  }
}
