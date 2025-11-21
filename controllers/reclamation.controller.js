// controllers/reclamation.controller.js
import Reclamation from "../models/reclamation.js";
import Counter from "../models/Counter.js";
import { buildReclamationPDF } from "../utils/pdf.reclamation.js";
import { makeTransport } from "../utils/mailer.js";
import mongoose from "mongoose";

/* ------------------- Helpers -------------------- */
const toDate = (v) => (v ? new Date(v) : undefined);
const toInt = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
function isValidEmail(s) { return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()); }
const isOther = (v) => /^autre?s?$/i.test(String(v || "").trim()) || /^other$/i.test(String(v || "").trim());
const pickPreciseField = (obj, keys) => keys.find((k) => obj?.[k] && String(obj[k]).trim()) && String(obj[keys.find((k)=>obj?.[k])]).trim();
const extractFromDescription = (s = "") => ({
  natureTxt: s.match(/Précisez\s+la\s+nature\s*:\s*([^|]+?)(?:\||$)/i)?.[1]?.trim(),
  attenteTxt: s.match(/Précisez\s+votre\s+attente\s*:\s*([^|]+?)(?:\||$)/i)?.[1]?.trim(),
});

/* ------------------- 1) Création Réclamation -------------------- */
export const createReclamation = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });

    let commande, nature, attente, description, piecesJointes = [];
    const b = req.body || {};
    const isMultipart = !!req.files || /multipart\/form-data/i.test(req.headers["content-type"] || "");

    if (isMultipart) {
      commande = {
        typeDoc: req.body["commande[typeDoc]"] || req.body?.commande?.typeDoc,
        numero: req.body["commande[numero]"] || req.body?.commande?.numero,
        dateLivraison: toDate(req.body["commande[dateLivraison]"]),
        referenceProduit: req.body["commande[referenceProduit]"],
        quantite: toInt(req.body["commande[quantite]"]),
      };
      nature = req.body.nature;
      attente = req.body.attente;
      description = req.body.description;
      const precisezNature = pickPreciseField(req.body, ["precisezNature", "natureAutre", "natureTexte"]);
      const precisezAttente = pickPreciseField(req.body, ["precisezAttente", "attenteAutre", "attenteTexte"]);
      if (isOther(nature) && precisezNature) nature = precisezNature;
      if (isOther(attente) && precisezAttente) attente = precisezAttente;
      if (isOther(nature) || isOther(attente)) {
        const { natureTxt, attenteTxt } = extractFromDescription(description);
        if (isOther(nature) && natureTxt) nature = natureTxt;
        if (isOther(attente) && attenteTxt) attente = attenteTxt;
      }
      piecesJointes = (req.files || []).map((f) => ({ filename: f.originalname, mimetype: f.mimetype, data: f.buffer, size: f.size }));
    } else {
      commande = b.commande;
      nature = b.nature;
      attente = b.attente;
      description = b.description;
      piecesJointes = (b.piecesJointes || []).map((p) => ({
        filename: p.filename, mimetype: p.mimetype,
        data: Buffer.from(p.data, "base64"),
      }));
    }

    if (!commande?.typeDoc) return res.status(400).json({ success: false, message: "commande.typeDoc obligatoire" });
    if (!commande?.numero) return res.status(400).json({ success: false, message: "commande.numero obligatoire" });
    if (!nature) return res.status(400).json({ success: false, message: "nature obligatoire" });
    if (!attente) return res.status(400).json({ success: false, message: "attente obligatoire" });

    const year = new Date().getFullYear();
    const yy = String(year).slice(-2);
    const c = await Counter.findOneAndUpdate({ _id: `reclamation:${year}` }, { $inc: { seq: 1 }, $setOnInsert: { key: `reclamation-${yy}` } }, { upsert: true, new: true });
    const numero = `R${yy}${String(c.seq).padStart(5, "0")}`;

    const rec = await Reclamation.create({ numero, user: req.user.id, commande, nature, attente, description, piecesJointes });
    res.status(201).json({ success: true, data: rec });

    /* ---- Async: PDF + Email ---- */
    setImmediate(async () => {
      try {
        const full = await Reclamation.findById(rec._id).populate("user", "nom prenom email").lean();
        const pdfBuffer = await buildReclamationPDF(full);
        await Reclamation.findByIdAndUpdate(full._id, { $set: { demandePdf: { data: pdfBuffer, contentType: "application/pdf", generatedAt: new Date() } } });

        const BAND_DARK = "#0B2239", BAND_TEXT = "#FFFFFF", PAGE_BG = "#F5F7FB", CONTAINER_W = 680;
        const fullName = [full.user?.prenom, full.user?.nom].filter(Boolean).join(" ") || "Client";
        const replyTo = isValidEmail(full.user?.email) ? full.user.email : undefined;
        const smtpCommercial = process.env.SMTP_COMMERCIAL_USER;
        const transporter = makeTransport();
        const subject = `Réclamation ${full.numero} – ${fullName}`;

        const html = `<!doctype html>
<html>
  <body style="margin:0;background:${PAGE_BG};font-family:Arial,Roboto,Helvetica,sans-serif;">
    <table align="center" width="100%" style="padding:24px 16px;">
      <tr><td align="center">
        <table width="${CONTAINER_W}" style="max-width:100%;">
          <tr><td style="background:${BAND_DARK};color:${BAND_TEXT};text-align:center;padding:14px 20px;font-weight:800;font-size:14px;border-radius:8px;">
              MTR – Manufacture Tunisienne des Ressorts
          </td></tr>
          <tr><td style="height:16px"></td></tr>
          <tr><td style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
              <h2>Nouvelle réclamation reçue</h2>
              <p><b>Numéro :</b> ${full.numero}</p>
              <p><b>Client :</b> ${fullName}</p>
              <p><b>Email :</b> ${replyTo}</p>
              <p><b>Document :</b> ${full.commande?.typeDoc} – ${full.commande?.numero}</p>
          </td></tr>
          <tr><td style="height:16px"></td></tr>
          <tr><td style="background:${BAND_DARK};color:${BAND_TEXT};text-align:center;padding:14px;border-radius:8px;">&nbsp;</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

        const attachments = [
          { filename: `reclamation-${full.numero}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
          ...piecesJointes.map((p) => ({ filename: p.filename, content: p.data, contentType: p.mimetype }))
        ];

        await transporter.sendMail({ from: replyTo || smtpCommercial, to: smtpCommercial, subject, replyTo, html, attachments });
        console.log(`📨 Réclamation ${full.numero} envoyée`);
      } catch (err) { console.error("❌ Erreur email:", err); }
    });

  } catch (err) { console.error("createReclamation:", err); res.status(400).json({ success: false, message: err.message }); }
};

/* ------------------- 2) Liste Admin -------------------- */
export const adminListReclamations = async (req, res) => {
  try {
    const items = await Reclamation.find().sort({ createdAt: -1 }).select("-demandePdf.data").populate("user", "nom prenom email").lean();
    res.json({ success: true, items });
  } catch (err) { console.error("adminListReclamations:", err); res.status(500).json({ success: false, message: "Erreur serveur" }); }
};

/* ------------------- 3) Stream PDF -------------------- */
export const streamReclamationPdf = async (req, res) => {
  try {
    const r = await Reclamation.findById(req.params.id).select("+demandePdf.data +demandePdf.contentType").lean();
    if (!r?.demandePdf?.data) return res.status(404).json({ success: false, message: "PDF introuvable" });
    res.setHeader("Content-Type", r.demandePdf.contentType); res.send(r.demandePdf.data);
  } catch (err) { console.error("PDF error:", err); res.status(500).json({ success: false }); }
};

/* ------------------- 4) Stream Pièce Jointe -------------------- */
export const streamReclamationDocument = async (req, res) => {
  try {
    const { id, index } = req.params;
    const r = await Reclamation.findById(id).select("piecesJointes").lean();
    const pj = r?.piecesJointes?.[index];
    if (!pj?.data) return res.status(404).json({ success: false, message: "Document introuvable" });
    res.setHeader("Content-Type", pj.mimetype); res.send(pj.data);
  } catch (err) { console.error("Doc error:", err); res.status(500).json({ success: false }); }
};

/* ------------------- Export Final -------------------- */
export default {
  createReclamation,
  adminListReclamations,
  streamReclamationPdf,
  streamReclamationDocument,
};
