// routes/admin.devis.routes.js
import { Router } from "express";
import auth, { only } from "../middleware/auth.js";
import DevisTraction from "../models/DevisTraction.js";
import DevisTorsion from "../models/DevisTorsion.js"; // ✅ ajouté
import DevisCompression from "../models/DevisCompression.js"; // ✅ ajouté
const router = Router();

/** Convertir les données Mongo en Buffer utilisable */
function toBuffer(maybeBinary) {
  if (!maybeBinary) return null;
  if (Buffer.isBuffer(maybeBinary)) return maybeBinary;
  if (maybeBinary.buffer && Buffer.isBuffer(maybeBinary.buffer)) {
    return Buffer.from(maybeBinary.buffer);
  }
  try {
    return Buffer.from(maybeBinary);
  } catch {
    return null;
  }
}
 /**
 * ----------------------------------------------------
 * 📌 ROUTE GLOBALE – /api/admin/devis/all
 * ----------------------------------------------------
 * Supporte :
 *  - type=all/compression/traction/...
 *  - q=motCle
 *  - page=1
 *  - limit=10
 */
router.get("/devis/all", auth, only("admin"), async (req, res) => {
  try {
    const { type = "all", q = "", page = 1, limit = 10 } = req.query;
    const pageNum = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Number(limit) || 10, 100);

    const typeMap = {
      compression: "compression",
      traction: "traction",
      torsion: "torsion",
      grille: "grille",
      fil: "fil",
      autre: "autre",
    };

    const getModels = () => {
      if (type !== "all") {
        switch (type) {
          case "compression": return [DevisCompression];
          case "traction": return [DevisTraction];
          case "torsion": return [DevisTorsion];
          case "grille": return [DevisGrille];
          case "fil": return [DevisFilDresse];
          case "autre": return [DevisAutre];
        }
      }
      return [
        DevisCompression,
        DevisTraction,
        DevisTorsion,
        DevisGrille,
        DevisFilDresse,
        DevisAutre,
      ];
    };

    const models = getModels();
    let allItems = [];

    for (const Model of models) {
      let docs;

      if (q) {
        docs = await Model.find({
          ...(type !== "all" ? { type: typeMap[type] } : {}),
          numero: { $regex: q, $options: "i" },
        })
          .select("_id numero type createdAt updatedAt documents")
          .populate("user", "prenom nom email") // 🔥 ajout client ici
          .lean();
      } else {
        docs = await Model.find()
          .select("_id numero type createdAt updatedAt documents")
          .populate("user", "prenom nom email") // 🔥 ajout client ici
          .lean();
      }

      allItems.push(...docs);
    }

    // Tri desc
    allItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = allItems.length;
    const paginated = allItems.slice((pageNum - 1) * pageSize, pageNum * pageSize);

    console.log("📦 Total:", total);
    console.log("📤 Exemple:", paginated[0]);

    res.json({
      success: true,
      items: paginated,
      total,
      page: pageNum,
      limit: pageSize,
    });
  } catch (err) {
    console.error("❌ GET /api/admin/devis/all error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});



/**
 * -------------------------
 * 📌 TRACTION
 * -------------------------
 */
router.get("/devis/traction", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisTraction.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/traction error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/traction/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisTraction.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="devis-traction-${req.params.id}.pdf"`
    );
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/traction/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/traction/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisTraction.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});

/**
 * -------------------------
 * 📌 TORSION
 * -------------------------
 */
router.get("/devis/torsion", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisTorsion.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/torsion error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/torsion/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisTorsion.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="devis-torsion-${req.params.id}.pdf"`
    );
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/torsion/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/torsion/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisTorsion.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});

/* ------------------------------------------------------------------
 * 📌 COMPRESSION  ✅ NOUVEAU
 * ------------------------------------------------------------------ */
router.get("/devis/compression", auth, only("admin"), async (req, res) => {
  console.log("📥 [GET] /api/admin/devis/compression");

  try {
    const items = await DevisCompression.find(
      {}, 
      { "demandePdf": 0, "documents.data": 0 } // 🚀 Exclure les buffers lourds
    )
      .sort({ createdAt: -1 })
      .allowDiskUse(true)                       // 🚨 Autorise utilisation disque
      .populate("user", "prenom nom email numTel")
      .lean();

    console.log(`🟢 ${items.length} devis récupérés avec succès`);
    res.json({ success: true, items });
  } catch (e) {
    console.error("❌ GET /api/admin/devis/compression error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});


// 📍 Pagination + recherche sécurisée
router.get("/devis/compression/paginated", auth, only("admin"), async (req, res) => {
  console.log("📥 [GET] /api/devis/compression/paginated", req.query);

  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 10;
  const skip = (page - 1) * pageSize;
  const search = (req.query.q || "").trim();

  try {
    // 🔍 Match uniquement sur numero
    const match1 = search ? { numero: { $regex: search, $options: "i" } } : {};

    const pipeline = [
      { $match: match1 },

      // ⚠️ Étape CRUCIALE : SUPPRIMER PDF AVANT TRI
      {
        $project: {
          numero: 1,
          type: 1,
          createdAt: 1,
          user: 1,
          remarques: 1,
          spec: 1,
          "documents.data": 0,
          "demandePdf": 0,
        }
      },

      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },

      // Recherche côté user
      ...(search ? [{
        $match: {
          $or: [
            { "user.nom": { $regex: search, $options: "i" } },
            { "user.prenom": { $regex: search, $options: "i" } }
          ]
        }
      }] : []),

      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: pageSize }
    ];

    // ⚠ Autorise le tri sur disque ICI
    const items = await DevisCompression.aggregate(pipeline).allowDiskUse(true);

    // ⚡ Plus rapide que countDocuments avec pipeline
    const total = await DevisCompression.countDocuments(match1);

    res.json({ success: true, items, total, page, pageSize });
  } catch (error) {
    console.error("❌ /api/devis/compression/paginated ERROR:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erreur serveur",
    });
  }
});

 router.get("/devis/compression/pdf/:numero", auth, only("admin"), async (req, res) => {
  const devis = await DevisCompression.findOne({ numero: req.params.numero }).lean();
  if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

  const buf = toBuffer(devis?.demandePdf?.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

  res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${devis.numero}.pdf"`);
  res.end(buf);
});

router.get("/devis/compression/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisCompression.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Content-Disposition", `inline; filename="devis-compression-${req.params.id}.pdf"`);
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/compression/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/compression/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisCompression.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});

// routes/admin.devis.routes.js (extrait – ajoute ce bloc GRILLE)
import DevisGrille from "../models/DevisGrille.js";

// util binaire déjà défini: toBuffer(...)

/** -------------------------
 * 📌 GRILLE
 * ------------------------- */
router.get("/devis/grille", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisGrille.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/grille error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/grille/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisGrille.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="devis-grille-${req.params.id}.pdf"`
    );
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/grille/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

router.get("/devis/grille/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisGrille.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});
/** -------------------------
 * 📌 FIL DRESSÉ
 * ------------------------- */
import DevisFilDresse from "../models/DevisFilDresse.js"; // 🔹 adapte le chemin selon ton projet


// 📌 Liste des devis fil dressé
router.get("/devis/fil", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisFilDresse.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/fil error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

// 📌 Récupération du PDF
router.get("/devis/fil/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisFilDresse.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Content-Disposition", `inline; filename="devis-fil-${req.params.id}.pdf"`);
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/fil/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

// 📌 Récupération d’un document joint
router.get("/devis/fil/:id/document/:index", auth, only("admin"), async (req, res) => {
  const devis = await DevisFilDresse.findById(req.params.id).lean();
  if (!devis || !Array.isArray(devis.documents))
    return res.status(404).json({ success: false, message: "Document non trouvé" });

  const doc = devis.documents[parseInt(req.params.index, 10)];
  if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

  const buf = toBuffer(doc.data);
  if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

  res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
  res.end(buf);
});
/** -------------------------
 * 📌 AUTRE ARTICLE
 * ------------------------- */
import DevisAutre from "../models/DevisAutre.js"; // 🔹 adapte le chemin/nom selon ton projet

// 📌 Liste des devis "autre"
router.get("/devis/autre", auth, only("admin"), async (req, res) => {
  try {
    const items = await DevisAutre.find({})
      .populate("user", "prenom nom email numTel")
      .sort("-createdAt")
      .lean();

    const mapped = items.map((it) => ({
      _id: it._id,
      numero: it.numero,
      type: it.type,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      user: it.user,
      spec: it.spec,               // ⚙️ tes champs spécifiques "autre"
      exigences: it.exigences,
      remarques: it.remarques,
      documents: (it.documents || []).map((d, idx) => ({
        index: idx,
        filename: d.filename,
        mimetype: d.mimetype,
        size: toBuffer(d?.data)?.length || 0,
        hasData: !!(toBuffer(d?.data)?.length),
      })),
      hasDemandePdf: !!(toBuffer(it?.demandePdf?.data)?.length),
    }));

    res.json({ success: true, items: mapped });
  } catch (e) {
    console.error("GET /api/admin/devis/autre error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

// 📌 Récupération du PDF "autre"
router.get("/devis/autre/:id/pdf", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisAutre.findById(req.params.id).lean();
    if (!devis) return res.status(404).json({ success: false, message: "Devis introuvable" });

    const buf = toBuffer(devis?.demandePdf?.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "PDF non trouvé" });

    res.setHeader("Content-Type", devis.demandePdf.contentType || "application/pdf");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Content-Disposition", `inline; filename="devis-autre-${req.params.id}.pdf"`);
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/autre/:id/pdf error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

// 📌 Récupération d’un document joint "autre"
router.get("/devis/autre/:id/document/:index", auth, only("admin"), async (req, res) => {
  try {
    const devis = await DevisAutre.findById(req.params.id).lean();
    if (!devis || !Array.isArray(devis.documents))
      return res.status(404).json({ success: false, message: "Document non trouvé" });

    const idx = parseInt(req.params.index, 10);
    const doc = devis.documents[idx];
    if (!doc) return res.status(404).json({ success: false, message: "Document inexistant" });

    const buf = toBuffer(doc.data);
    if (!buf?.length) return res.status(404).json({ success: false, message: "Contenu du document vide" });

    res.setHeader("Content-Type", doc.mimetype || "application/octet-stream");
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
    res.end(buf);
  } catch (e) {
    console.error("GET /api/admin/devis/autre/:id/document/:index error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});


export default router;
