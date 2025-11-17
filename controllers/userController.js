// controllers/userController.js
import User from "../models/User.js";
import mongoose from "mongoose";
// controllers/adminUsers.controller.js
import crypto from "crypto";
import bcrypt from "bcryptjs";
const ttlHours = 48; // lien valable 48h
import { makeTransport } from "../utils/mailer.js";
import { normalizeAccountType, sha256 } from "./_auth.helpers.js";

const ttlInviteHours = 48;    // lien d’invitation valable 48h
const ttlCodeMinutes = 10;    // code 6 chiffres valable 10 min
/** Récupérer l'utilisateur connecté */
export const me = async (req, res) => {
  // ⚠️ lire l'id depuis req.user.id (middleware auth)
  const user = await User.findById(req.user?.id);
  if (!user)
    return res.status(404).json({ message: "Utilisateur introuvable" });
  res.json(user.toJSON());
};

/** Modifier le profil de l'utilisateur connecté */
export const updateMe = async (req, res) => {
  try {
    const allowed = [
      "nom",
      "prenom",
      "numTel",
      "adresse",
      "personal",
      "company",
    ];
    const payload = {};
    for (const key of allowed) {
      if (key in req.body) payload[key] = req.body[key];
    }

    // ⚠️ lire l'id depuis req.user.id (middleware auth)
    const user = await User.findByIdAndUpdate(req.user?.id, payload, {
      new: true,
    });
    if (!user)
      return res.status(404).json({ message: "Utilisateur introuvable" });
    res.json(user.toJSON());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/** Liste des utilisateurs (admin) */
export const listUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users.map((u) => u.toJSON()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// controllers/admin.users.controller.js




/* ================== INVITER UN UTILISATEUR (par lien) ================== */
export const inviteUser = async (req, res) => {
  try {
    let {
      nom, prenom, email, numTel, adresse,
      accountType = "personnel",
      role = "client",
      personal,
      company,
    } = req.body || {};

    if (!email) return res.status(400).json({ success:false, message:"email est obligatoire" });

    const exists = await User.findOne({ email }).lean();
    if (exists) return res.status(409).json({ success:false, message:"Utilisateur existe déjà" });

    accountType = normalizeAccountType(accountType);

    // règle métier: client => nom + prénom obligatoires
    if (role === "client" && (!nom || !prenom)) {
      return res.status(400).json({ success:false, message:"Nom et prénom requis pour un client." });
    }

    // لا نعيّن passwordHash (compte invité)
    const user = await User.create({
      nom, prenom, email, numTel, adresse,
      accountType, role, personal, company,
      passwordHash: undefined,
    });

    // نولّد token خام، نخزّن الـ sha256 في passwordReset.codeHash
    const rawToken = crypto.randomBytes(24).toString("hex");
    const codeHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + ttlInviteHours * 3600 * 1000);

    user.passwordReset = { codeHash, expiresAt, usedAt: null, attempts: 0, lastSentAt: new Date() };
    await user.save();

    // رابط صفحة الفرونت set-password (بدّل الـ URL إذا لزم)
    const appUrl = process.env.APP_FRONT_URL || "http://localhost:3000";
    const locale = "fr"; // تنجم تبدّلها حسب لغتك
    const setPwdLink = `${appUrl}/${locale}/set-password?uid=${user._id}&token=${rawToken}`;

    // إرسال الإيميل من حساب الإدارة
    let emailResult = { sent:false };
    try {
      const transport = makeTransport();
      const from = process.env.MAIL_FROM_ADMIN || process.env.SMTP_ADMIN_USER || process.env.MAIL_FROM || process.env.SMTP_USER;

      const subject = "Activez votre compte MTR Industrie";
      const html = `<!doctype html>
<html>
  <head><meta charSet="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
  <body style="margin:0;background:#F5F7FB;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F5F7FB;margin:0;padding:24px 16px;border-collapse:collapse;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:680px;max-width:100%;border-collapse:collapse;">
          <tr><td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#0B2239;color:#FFFFFF;text-align:center;padding:14px 20px;font-weight:800;font-size:14px;border-radius:8px;">
                  MTR – Manufacture Tunisienne des ressorts
                </td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
          <tr><td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;border-collapse:separate;">
              <tr><td style="padding:24px;">
                <h1 style="margin:0 0 12px 0;font-size:18px;line-height:1.35;color:#002147;">Activez votre compte</h1>
                <p style="margin:0 0 8px 0;color:#002147;">Bonjour ${[prenom, nom].filter(Boolean).join(" ") || "et bienvenue"},</p>
                <p style="margin:0 0 16px 0;color:#002147;">Un administrateur vous a créé un compte sur <strong style="color:#002147;">MTR Manufacture Tunisienne des Ressorts</strong>.</p>
                <p style="margin:0 0 16px 0;">Cliquez sur le bouton ci-dessous pour définir votre mot de passe. Le lien est valable <strong>${ttlInviteHours}h</strong>.</p>
                <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:10px auto 6px;">
                  <tr><td align="center">
                    <a href="${setPwdLink}" style="display:inline-block;background:#0B1E3A;color:#ffffff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;">Définir mon mot de passe</a>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
          <tr><td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="background:#0B2239;color:#FFFFFF;text-align:center;padding:14px 20px;font-weight:800;font-size:14px;border-radius:8px;">&nbsp;</td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

      const text = `Bonjour ${prenom || ""} ${nom || ""},
Un administrateur vous a créé un compte sur MTR Manufacture Tunisienne des Ressorts.
Définissez votre mot de passe (valable ${ttlInviteHours}h). Si le bouton n'apparaît pas, ouvrez cet email en HTML.
Lien: ${setPwdLink}
`;

      await transport.sendMail({ from, to: email, subject, html, text });
      emailResult.sent = true;
    } catch (e) {
      console.error("inviteUser mail error:", e?.response || e?.message || e);
      emailResult = { sent:false, error: e?.message || "SMTP error" };
    }

    return res.status(201).json({ success:true, userId: user._id, setPwdLink, email: emailResult });
  } catch (e) {
    console.error("inviteUser:", e);
    return res.status(500).json({ success:false, message:"Erreur serveur" });
  }
};


/* ============= DÉFINIR LE MOT DE PASSE (depuis le lien) ============= */
// NB: هذا يعتمد فقط على passwordReset.{codeHash,expiresAt,usedAt} (ما فيش 6 chiffres للـ front)
export const setPassword = async (req, res) => {
  try {
    const { uid, token, password } = req.body || {};

    // validations
    if (!uid || !token || !password) {
      return res.status(400).json({ success:false, message:"Lien invalide" });
    }
    if (!mongoose.isValidObjectId(uid)) {
      return res.status(400).json({ success:false, message:"Lien invalide" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success:false, message:"Mot de passe trop court." });
    }

    // لازم نـselectّيو subfields المخفية
    const user = await User.findById(uid).select(
      "+passwordHash +passwordReset.codeHash +passwordReset.expiresAt +passwordReset.usedAt +passwordReset.attempts"
    );
    if (!user) return res.status(404).json({ success:false, message:"Utilisateur introuvable." });

    const pr = user.passwordReset || {};
    if (!pr.codeHash || !pr.expiresAt) {
      // ما ثماش دعوة صالحة مخزّنة
      return res.status(400).json({ success:false, message:"Lien invalide" });
    }
    if (pr.usedAt) {
      return res.status(400).json({ success:false, message:"Lien déjà utilisé." });
    }
    if (pr.expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({ success:false, message:"Lien expiré." });
    }

    // نقارن sha256(token) باللي مخزّن
    const providedHash = sha256(token);
    if (providedHash !== pr.codeHash) {
      // زيادة attempts (اختياري)
      await User.updateOne({ _id: user._id }, { $inc: { "passwordReset.attempts": 1 } });
      return res.status(400).json({ success:false, message:"Lien invalide" });
    }

    // OK → نسجّل الباسورد ونعلّم الرابط مستعمل
    user.passwordHash = await bcrypt.hash(String(password), 12);
    user.passwordReset.usedAt = new Date();
    await user.save();

    return res.json({ success:true, message:"Mot de passe défini avec succès" });
  } catch (e) {
    console.error("setPassword:", e);
    return res.status(500).json({ success:false, message:"Erreur serveur" });
  }
};



export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success:false, message:"Paramètres manquants." });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success:false, message:"Mot de passe trop court." });
    }

    // utilisateur authentifié via middleware auth -> req.user.id
    const user = await User.findById(req.user?.id).select("+passwordHash");
    if (!user) return res.status(404).json({ success:false, message:"Utilisateur introuvable." });

    // vérifier l'ancien mot de passe
    const ok = await bcrypt.compare(currentPassword, user.passwordHash || "");
    if (!ok) return res.status(400).json({ success:false, message:"Mot de passe actuel invalide." });

    // enregistrer le nouveau mot de passe
    const hash = await bcrypt.hash(newPassword, 12);
    user.passwordHash = hash;

    // Optionnel: invalider un éventuel reset token non utilisé
    if (user.passwordReset) {
      user.passwordReset.usedAt = new Date();
    }

    await user.save();
    return res.json({ success:true, message:"Mot de passe modifié." });
  } catch (e) {
    console.error("changePassword:", e);
    return res.status(500).json({ success:false, message:"Erreur serveur" });
  }
};