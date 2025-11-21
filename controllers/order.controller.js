import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { makeTransport } from "../utils/mailer.js";

import DemandeAutre from "../models/DevisAutre.js";
import DemandeCompression from "../models/DevisCompression.js";
import DemandeTraction from "../models/DevisTraction.js";
import DemandeTorsion from "../models/DevisTorsion.js";
import DemandeFilDresse from "../models/DevisFilDresse.js";
import DemandeGrille from "../models/DevisGrille.js";
import ClientOrder from "../models/ClientOrder.js";
import User from "../models/User.js";
import Devis from "../models/Devis.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORIGIN =
  process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;

const DEMANDE_MODELS = [
  { type: "autre", Model: DemandeAutre },
  { type: "compression", Model: DemandeCompression },
  { type: "traction", Model: DemandeTraction },
  { type: "torsion", Model: DemandeTorsion },
  { type: "fil", Model: DemandeFilDresse },
  { type: "grille", Model: DemandeGrille },
];

// Host propre (masque localhost)
function getSiteHost(req) {
  const fromEnv =
    (process.env.SITE_HOST ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.PUBLIC_SITE_URL ||
      process.env.PUBLIC_BACKEND_URL ||
      "").trim();

  const clean = (v) =>
    v.toString().replace(/^https?:\/\//, "").replace(/\/+$/, "");

  let host = "";
  if (fromEnv) {
    try { host = new URL(fromEnv).host || clean(fromEnv); }
    catch { host = clean(fromEnv); }
  } else {
    const xfHost = req.headers["x-forwarded-host"];
    host = Array.isArray(xfHost) ? xfHost[0] : (xfHost || req.headers.host || "");
    host = clean(host);
  }

  const isLocal = /^(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|.+\.local)$/i.test(host);
  return isLocal ? "" : host;
}

async function findOwnedDemande(demandeId, userId) {
  for (const { type, Model } of DEMANDE_MODELS) {
    const doc = await Model.findById(demandeId).populate("user");
    if (doc && String(doc.user?._id) === String(userId)) return { type, doc };
  }
  return null;
}

function buildAttachmentFromPdfInfo(devisNumero, devisPdf) {
  if (devisNumero) {
    const filename = `${devisNumero}.pdf`;
    const localPath = path.resolve(process.cwd(), "storage", "devis", filename);
    if (fs.existsSync(localPath)) return { filename, path: localPath };
  }
  if (devisPdf) {
    const filename = `${devisNumero || "devis"}.pdf`;
    return { filename, path: devisPdf };
  }
  return null;
}

function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** POST /api/order/client/commander */
export async function placeClientOrder(req, res) {
  try {
    const {
      devisId,               // <<=== NEW obligatoire
      devisNumero: bodyDevisNumero,
      devisPdf: bodyDevisPdf,
      note = ""
    } = req.body || {};

    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Non authentifié" });
    }
    if (!devisId) {
      return res.status(400).json({ success: false, message: "devisId manquant" });
    }

    // 1) Charger le devis et vérifier la propriété (client.id === userId)
    const devis = await Devis.findById(devisId).lean();
    if (!devis) {
      return res.status(404).json({ success: false, message: "Devis introuvable" });
    }
    const ownerId = String(devis?.client?.id || "");
    if (!ownerId || String(ownerId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Accès interdit" });
    }

    // 2) Préparer infos issues du devis
    const devisNumero = bodyDevisNumero || devis.numero || null;
    const devisPdf =
      bodyDevisPdf ||
      (devisNumero ? `${ORIGIN}/files/devis/${encodeURIComponent(devisNumero)}.pdf` : null);

    // Regrouper les N° de demandes & types (multi-DDV)
    const demandeNumerosSet = new Set([
      ...(Array.isArray(devis?.meta?.demandes)
        ? devis.meta.demandes.map((d) => d?.numero).filter(Boolean)
        : []),
      devis?.demandeNumero || "",
      devis?.meta?.demandeNumero || "",
      ...(Array.isArray(devis?.items)
        ? devis.items.map((it) => it?.demandeNumero).filter(Boolean)
        : []),
    ].filter(Boolean));

    const demandeNumeros = Array.from(demandeNumerosSet);
    const primaryDemandeNumero = demandeNumeros[0] || null;

    const typesSet = new Set([
      ...(Array.isArray(devis?.meta?.demandes)
        ? devis.meta.demandes.map((d) => d?.type).filter(Boolean)
        : []),
    ]);
    const types = Array.from(typesSet);

    // 3) Upsert ClientOrder par (user, devisId)
    const orderDoc = await ClientOrder.findOneAndUpdate(
      { user: userId, devisId },
      {
        $set: {
          status: "confirmed",
          devisNumero: devisNumero || null,
          devisPdf: devisPdf || null,
          demandeNumeros,
          demandeType: types[0] || null, // pour compat si tu as un champ unique
          note: note || "",
        },
      },
      { upsert: true, new: true }
    );

    // 4) Infos client pour email
    const dbUser = await User.findById(userId)
      .select("prenom nom email tel numTel")
      .lean()
      .catch(() => null);

    const uEmail = (req.user?.email || dbUser?.email || "").trim();
    const uTel = (req.user?.tel || dbUser?.tel || dbUser?.numTel || "").trim();
    const uPrenom = (req.user?.prenom || dbUser?.prenom || "").trim();
    const uNom = (req.user?.nom || dbUser?.nom || "").trim();
    const clientDisplay = (uPrenom || uNom)
      ? `${uPrenom} ${uNom}`.trim()
      : (uEmail || "Client");

    // 5) Sujet & pièces jointes
    const subject = `Commande confirmée – ${devisNumero ? `Devis ${devisNumero}` : `Devis ${devisId}`}`;

    const devisAttachment = buildAttachmentFromPdfInfo(devisNumero, devisPdf);
    const devisLink = devisPdf;

    // 6) Corps texte
    const lines = [
      `Bonjour,`,
      ``,
      `Un client confirme une commande :`,
      `• Client : ${clientDisplay}`,
      `• Email : ${uEmail || "-"}`,
      `• Téléphone : ${uTel || "-"}`,
      devisNumero ? `• N° Devis : ${devisNumero}` : `• Devis ID : ${devisId}`,
      demandeNumeros.length ? `• N° Demandes liées : ${demandeNumeros.join(", ")}` : null,
      types.length ? `• Types : ${types.join(", ")}` : null,
      devisLink ? `• Lien PDF devis : ${devisLink}` : null,
      note ? `• Note : ${note}` : null,
      ``,
      `Merci.`,
    ].filter(Boolean);
    const textBody = lines.join("\n");

    // 7) Email HTML (identique à ton style, compacté)
    const BRAND_PRIMARY = "#002147";
    const BAND_DARK = "#0B2239";
    const BAND_TEXT = "#FFFFFF";
    const PAGE_BG = "#F5F7FB";
    const CONTAINER_W = 680;
    const SITE_HOST = getSiteHost(req);
    const html = `<!doctype html>
<html>
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;background:${PAGE_BG};font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji';color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;background:${PAGE_BG};margin:0;padding:24px 16px;border-collapse:collapse;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"
               style="width:${CONTAINER_W}px;max-width:100%;border-collapse:collapse;">
          <tr>
            <td style="background:${BAND_DARK};color:${BAND_TEXT};text-align:center;padding:14px 20px;font-weight:800;font-size:14px;letter-spacing:.3px;border-radius:8px;">
              MTR – Manufacture Tunisienne des ressorts
            </td>
          </tr>
          <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;border-collapse:separate;">
                <tr><td style="padding:24px;">
                  <p style="margin:0 0 12px 0;">Bonjour, Vous avez reçu une nouvelle commande&nbsp;:</p>
                  <ul style="margin:0 0 16px 20px;padding:0;">
                    <li><strong>Client&nbsp;:</strong> ${clientDisplay}</li>
                    <li><strong>Email&nbsp;:</strong> ${uEmail || "-"}</li>
                    <li><strong>Téléphone&nbsp;:</strong> ${uTel || "-"}</li>
                    ${devisNumero ? `<li><strong>N° Devis&nbsp;:</strong> ${devisNumero}</li>` : `<li><strong>Devis ID&nbsp;:</strong> ${devisId}</li>`}
                    ${demandeNumeros.length ? `<li><strong>Demandes liées&nbsp;:</strong> ${demandeNumeros.join(", ")}</li>` : ""}
                    ${types.length ? `<li><strong>Types&nbsp;:</strong> ${types.join(", ")}</li>` : ""}
                    ${note ? `<li><strong>Note&nbsp;:</strong> ${note}</li>` : ""}
                  </ul>
                  ${devisLink ? `<p style="margin:0;"><a href="${devisLink}" style="color:${BRAND_PRIMARY};text-decoration:underline;">Ouvrir le devis (PDF)</a></p>` : ""}
                </td></tr>
              </table>
            </td>
          </tr>
          <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
          <tr>
            <td style="background:${BAND_DARK};color:${BAND_TEXT};text-align:center;padding:14px 20px;font-weight:800;font-size:14px;letter-spacing:.3px;border-radius:8px;">
              &nbsp;
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

    // 8) Envoi email
    const adminToRaw = (process.env.ADMIN_EMAIL || "").trim();
    const adminTo = isValidEmail(adminToRaw);
    const from = process.env.MAIL_FROM_ADMIN ;
    const cc = isValidEmail(uEmail) ? [uEmail] : undefined;

    const transport = makeTransport();
   // Envoi email ASYNCHRONE (sans bloquer la réponse HTTP)
transport.sendMail({
  from: `${clientDisplay} <${process.env.SMTP_COMMERCIAL_USER}>`,
  to: process.env.SMTP_COMMERCIAL_USER,
  replyTo: uEmail || undefined,
  subject,
  text: textBody,
  html,
  attachments: devisAttachment ? [devisAttachment] : [],
})
  .then(() => {
    console.log("📩 Mail envoyé au commercial");
  })
  .catch((err) => {
    console.error("❌ Erreur envoi mail", err);
  });



    return res.json({ success: true, message: "Commande confirmée", orderId: orderDoc?._id });
  } catch (err) {
    console.error("placeClientOrder error:", err);
    return res.status(500).json({ success: false, message: "Erreur envoi commande" });
  }
}


/** GET /api/order/client/status?ids=ID1,ID2,... => { map: { [demandeId]: boolean } } */
export async function getClientOrderStatus(req, res) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ success: false, message: "Non authentifié" });

    const ids = String(req.query.ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!ids.length) return res.json({ success: true, map: {} });

    const objIds = ids.map((s) => new mongoose.Types.ObjectId(s));
    const rows = await ClientOrder.find({
      user: userId,
      demandeId: { $in: objIds },
    })
      .select("demandeId status")
      .lean();

    const map = {};
    for (const id of ids) map[id] = false;
    for (const r of rows) map[String(r.demandeId)] = r.status === "confirmed";

    return res.json({ success: true, map });
  } catch (err) {
    console.error("getClientOrderStatus error:", err);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}
