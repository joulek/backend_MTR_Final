// utils/mailer.js
import nodemailer from "nodemailer";

const smtpCommonConfig = () => {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465; // SSL direct uniquement si port 465

  return {
    host: process.env.SMTP_HOST,
    port,
    secure, // ✔ Si 465 → SSL direct
    requireTLS: !secure, // Si port 587 → STARTTLS obligatoire

    auth: {
      // Rempli dynamiquement (commercial ou admin)
      user: "",
      pass: "",
    },

    // ⏱ Timeout sécurisés
    connectionTimeout: 30000,
    greetingTimeout: 20000,
    socketTimeout: 40000,

    // 🔐 TLS sécurisé (strict en production)
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
  };
};

/**
 * 📤 Transport pour envoi d'emails via compte ADMIN
 * → utilisé lorsque le client envoie une demande (client → MTR).
 */
export function makeTransport() {
  const config = smtpCommonConfig();
  config.auth = {
    user: process.env.SMTP_ADMIN_USER,
    pass: process.env.SMTP_ADMIN_PASS,
  };
  return nodemailer.createTransport(config);
}

/**
 * 📤 Transport pour envoi de devis au client
 * → utilisé lorsque MTR (commercial) envoie le devis au client.
 */
export function makeTransportCommercial() {
  const config = smtpCommonConfig();
  config.auth = {
    user: process.env.SMTP_COMMERCIAL_USER,
    pass: process.env.SMTP_COMMERCIAL_PASS,
  };
  return nodemailer.createTransport(config);
}
export function makeTransportContact() {
  const config = smtpCommonConfig();
  config.auth = {
    user: process.env.SMTP_CONTACT_USER,
    pass: process.env.SMTP_CONTACT_PASS,
  };
  return nodemailer.createTransport(config);
}
