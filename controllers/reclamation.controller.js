// controllers/reclamation.controller.js
import Reclamation from "../models/reclamation.js"; // ⚠️ casse exacte
import Counter from "../models/Counter.js";
import { buildReclamationPDF } from "../utils/pdf.reclamation.js";
import { makeTransport } from "../utils/mailer.js";
import mongoose from "mongoose";

// petits helpers
const toDate = (v) => (v ? new Date(v) : undefined);
const toInt = (v) =>
  v === undefined || v === null || v === "" ? undefined : Number(v);
// 🔎 ➕ AJOUTER ICI
function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
const isOther = (v) =>
  /^autre?s?$/i.test(String(v || "").trim()) || /^other$/i.test(String(v || "").trim());

const safe = (s = "") => {
  const v = String(s ?? "").trim();
  return v || "-";
};

// récupère la 1ère clé non vide parmi plusieurs alias envoyés par le front
function pickPreciseField(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return undefined;
}

// fallback: extraction depuis description "Précisez la nature: X | Précisez votre attente: Y"
function extractFromDescription(desc = "") {
  const s = String(desc || "");
  const mNature  = s.match(/Précisez\s+la\s+nature\s*:\s*([^|]+?)(?:\||$)/i);
  const mAttente = s.match(/Précisez\s+votre\s+attente\s*:\s*([^|]+?)(?:\||$)/i);
  return {
    natureTxt:  mNature  ? mNature[1].trim()  : undefined,
    attenteTxt: mAttente ? mAttente[1].trim() : undefined,
  };
}

export const createReclamation = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });
    }

    // ------------------ 1) Lecture body / fichiers ------------------
    const isMultipart =
      !!req.files || /multipart\/form-data/i.test(req.headers["content-type"] || "");
    let commande, nature, attente, description, piecesJointes = [];
    let precisezNature, precisezAttente;
    let b = req.body || {};

    if (isMultipart) {
      commande = {
        typeDoc: req.body["commande[typeDoc]"] || req.body?.commande?.typeDoc,
        numero: req.body["commande[numero]"] || req.body?.commande?.numero,
        dateLivraison: toDate(req.body["commande[dateLivraison]"] || req.body?.commande?.dateLivraison),
        referenceProduit: req.body["commande[referenceProduit]"] || req.body?.commande?.referenceProduit,
        quantite: toInt(req.body["commande[quantite]"] || req.body?.commande?.quantite),
      };
      nature = req.body.nature;
      attente = req.body.attente;
      description = req.body.description;
      precisezNature = pickPreciseField(req.body, ["precisezNature","natureAutre","natureTexte","nature_precise"]);
      precisezAttente = pickPreciseField(req.body, ["precisezAttente","attenteAutre","attenteTexte","attente_precise"]);
      if (isOther(nature) && precisezNature) nature = precisezNature;
      if (isOther(attente) && precisezAttente) attente = precisezAttente;
      if (isOther(nature) || isOther(attente)) {
        const { natureTxt, attenteTxt } = extractFromDescription(description);
        if (isOther(nature) && !precisezNature && natureTxt) nature = natureTxt;
        if (isOther(attente) && !precisezAttente && attenteTxt) attente = attenteTxt;
      }
      piecesJointes = (Array.isArray(req.files) ? req.files : []).map((f) => ({
        filename: f.originalname,
        mimetype: f.mimetype,
        data: f.buffer,
        size: f.size,
      }));
    } else {
      commande = {
        typeDoc: b?.commande?.typeDoc,
        numero: b?.commande?.numero,
        dateLivraison: toDate(b?.commande?.dateLivraison),
        referenceProduit: b?.commande?.referenceProduit,
        quantite: toInt(b?.commande?.quantite),
      };
      nature = b.nature;
      attente = b.attente;
      description = b.description;
      precisezNature = pickPreciseField(b, ["precisezNature","natureAutre","natureTexte","nature_precise"]);
      precisezAttente = pickPreciseField(b, ["precisezAttente","attenteAutre","attenteTexte","attente_precise"]);
      if (isOther(nature) && precisezNature) nature = precisezNature;
      if (isOther(attente) && precisezAttente) attente = precisezAttente;
      if (Array.isArray(b.piecesJointes)) {
        piecesJointes = b.piecesJointes.map((p) =>
          p?.data && typeof p.data === "string"
            ? { filename: p.filename, mimetype: p.mimetype || "application/octet-stream", data: Buffer.from(p.data, "base64") }
            : p
        );
      }
    }

    // ------------------ 2) Validations ------------------
    if (!commande?.typeDoc) return res.status(400).json({ success: false, message: "commande.typeDoc obligatoire" });
    if (!commande?.numero) return res.status(400).json({ success: false, message: "commande.numero obligatoire" });
    if (!nature) return res.status(400).json({ success: false, message: "nature obligatoire" });
    if (!attente) return res.status(400).json({ success: false, message: "attente obligatoire" });

    if (piecesJointes.length > 10) {
      return res.status(400).json({ success:false, message:`Trop de fichiers (max 10)` });
    }

    // ------------------ 3) Génération Numéro ------------------
    const year = new Date().getFullYear();
    const yy = String(year).slice(-2);
    const c = await Counter.findOneAndUpdate(
      { _id: `reclamation:${year}` },
      { $inc: { seq: 1 }, $setOnInsert: { key: `reclamation-${yy}` } },
      { upsert: true, new: true }
    );
    const numero = `R${yy}${String(c.seq).padStart(5,"0")}`;

    const rec = await Reclamation.create({
      numero,
      user: req.user.id,
      commande,
      nature,
      attente,
      description,
      piecesJointes,
    });

    // --- Réponse immédiate (rapide) ---
    res.status(201).json({ success: true, data: rec });

    // ------------------ 4) Traitement async (PDF + mail) ------------------
    setImmediate(async () => {
      try {

        // Récupérer full reclamation
        const full = await Reclamation.findById(rec._id)
          .populate("user", "nom prenom email numTel adresse")
          .lean();

        const pdfBuffer = await buildReclamationPDF(full);

        // Stockage PDF
        await Reclamation.findByIdAndUpdate(full._id, {
          $set: {
            demandePdf: {
              data: pdfBuffer,
              contentType: "application/pdf",
              generatedAt: new Date(),
            },
          },
        });

        // 📩 Email → Commercial (pas admin)
        const smtpCommercial = (process.env.SMTP_COMMERCIAL_USER || "").trim();
        const emailCommercial = isValidEmail(smtpCommercial) ? smtpCommercial : null;

        const transporter = makeTransport();
        const fullName = [full.user?.prenom, full.user?.nom].filter(Boolean).join(" ") || "Client";
        const replyTo = isValidEmail(full.user?.email) ? full.user.email : undefined;

        const subject = `Réclamation ${full.numero} – ${fullName}`;
        const text = `Nouvelle réclamation\n\nNuméro : ${full.numero}\nDocument : ${commande.typeDoc} ${commande.numero}\nClient : ${fullName}\nEmail : ${replyTo || "-"}`;

        // HTML MENU
        const html = `<p><b>Nouvelle réclamation</b></p><p>Numéro : ${full.numero}</p><p>Client : ${fullName}</p><p>Email : ${replyTo}</p>`;

        // 📎 Attachments
        const attachments = [
          { filename:`reclamation-${full.numero}.pdf`, content: pdfBuffer, contentType:"application/pdf" },
          ...piecesJointes.map(p => ({
            filename: p.filename,
            content: p.data,
            contentType: p.mimetype,
          }))
        ];

        // ⚡ Envoi rapide + non bloquant
        transporter.sendMail({
          from: replyTo || process.env.MAIL_FROM_ADMIN || smtpCommercial,
          to: emailCommercial,
          replyTo: replyTo || emailCommercial,
          subject,
          text,
          html,
          attachments,
        }).then(() => {
          console.log(`📨 Réclamation ${full.numero} envoyée au commercial`);
        }).catch(err => {
          console.error(`❌ Échec envoi mail réclamation ${full.numero}`, err);
        });

      } catch (err) {
        console.error("❌ Erreur post-email :", err);
      }
    });
  } catch (e) {
    console.error("createReclamation:", e);
    res.status(400).json({ success: false, message: e.message || "Données invalides" });
  }
};

/** [ADMIN] Liste des réclamations (paginée, filtrée) */
export async function adminListReclamations(req, res) {
  try {
    const page     = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || "10", 10), 1), 100);

    const q = (req.query.q || "").trim();
    const and = [];

    if (q) {
      const rx = new RegExp(q.replace(/\s+/g, ".*"), "i");
      and.push({
        $or: [
          { numero: rx },
          { "commande.typeDoc": rx },
          { "commande.numero": rx },
          { nature: rx },
          { attente: rx },
          { "piecesJointes.filename": rx },
          // client will be matched after populate (in-memory)
        ],
      });
    }

    const where = and.length ? { $and: and } : {};

    const [docs, total] = await Promise.all([
      Reclamation.find(where)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        // select everything *except* large buffers; keep generatedAt as a flag
        .select("-demandePdf.data -piecesJointes.data")
        .populate("user", "prenom nom email")
        .lean(),
      Reclamation.countDocuments(where),
    ]);

    // Optional: client-side filter on client name/email when q is present
    const filtered = !q
      ? docs
      : docs.filter((r) => {
          const clientStr = `${r?.user?.prenom || ""} ${r?.user?.nom || ""} ${r?.user?.email || ""}`.toLowerCase();
          return clientStr.includes(q.toLowerCase()) || true; // we already matched other fields in DB
        });

    // Map to the exact shape your frontend expects
    const items = filtered.map((r) => {
      const client = `${r?.user?.prenom || ""} ${r?.user?.nom || ""}`.trim() || r?.user?.email || "";
      return {
        _id: r._id,
        numero: r.numero,
        client,
        typeDoc: r?.commande?.typeDoc || r?.typeDoc || "",
        date: r.createdAt,
        // Boolean only: front shows “Aucun” when falsey
        pdf: Boolean(r?.demandePdf?.generatedAt),
        // expose only filename/mimetype (no data)
        piecesJointes: Array.isArray(r.piecesJointes)
          ? r.piecesJointes.map((p) => ({ filename: p?.filename, mimetype: p?.mimetype }))
          : [],
      };
    });

    res.json({ success: true, data: items, total, page, pageSize });
  } catch (err) {
    console.error("adminListReclamations:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
}

// --- STREAM PDF (admin) ---
export const streamReclamationPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const r = await Reclamation.findById(id).select("demandePdf pdf").lean();

    const bin = r?.demandePdf?.data || r?.pdf?.data;
    const type = r?.demandePdf?.contentType || r?.pdf?.contentType || "application/pdf";
    if (!bin) return res.status(404).json({ success: false, message: "PDF introuvable" });

    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `inline; filename="reclamation-${id}.pdf"`);
    return res.send(Buffer.from(bin.buffer || bin));
  } catch (e) {
    console.error("streamReclamationPdf:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

export const streamReclamationDocument = async (req, res) => {
  try {
    const { id, index } = req.params;
    const r = await Reclamation.findById(id).select("piecesJointes").lean();
    const i = Number(index);
    const pj = r?.piecesJointes?.[i];
    if (!pj?.data) return res.status(404).json({ success: false, message: "Pièce jointe introuvable" });

    res.setHeader("Content-Type", pj.mimetype || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${pj.filename || `piece-${i + 1}`}"`);
    return res.send(Buffer.from(pj.data.buffer || pj.data));
  } catch (e) {
    console.error("streamReclamationDocument:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};
