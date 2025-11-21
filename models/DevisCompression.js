// models/DevisCompression.js
import mongoose from "mongoose";
import { devisBase } from "./_devisBase.js";

const spec = new mongoose.Schema({
  d: { type: Number, required: true },
  DE: { type: Number, required: true },
  H: Number,
  S: Number,
  DI: { type: Number, required: true },
  Lo: { type: Number, required: true },
  nbSpires: { type: Number, required: true },
  pas: Number,
  quantite: { type: Number, required: true },
  matiere: {
    type: String,
    enum: [
      "Fil ressort noir SH",
      "Fil ressort noir SM",
      "Fil ressort galvanisé",
      "Fil ressort inox",
    ],
    required: true,
  },
  enroulement: { type: String, enum: ["Enroulement gauche", "Enroulement droite"] },
  extremite: { type: String, enum: ["ERM", "EL", "ELM", "ERNM"] },
}, { _id: false });

const schema = new mongoose.Schema({});
schema.add(devisBase);
schema.add({
  spec,
  demandePdf: {
    data: Buffer,
    contentType: String
  }
});

/* 🔥🔥 INDEXES OPTIMISÉS 🔥🔥 */
schema.index({ createdAt: -1 });      // Accélère le tri DESC
schema.index({ numero: 1 });          // Accélère les recherches sur numéro
schema.index({ user: 1 });            // Utile pour filtrer / jointures utilisateur

export default mongoose.model("DemandeDevisCompression", schema);
