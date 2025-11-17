// utils/mailer.js
import nodemailer from "nodemailer";

export function makeTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: process.env.SMTP_ADMIN_USER,
      pass: process.env.SMTP_ADMIN_PASS,
    },
    family: 4,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 25000,
    tls: { minVersion: "TLSv1.2" },
  });
}

export function makeTransportCommercial() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: process.env.SMTP_COMMERCIAL_USER,
      pass: process.env.SMTP_COMMERCIAL_PASS,
    },
    family: 4,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 25000,
    tls: { minVersion: "TLSv1.2" },
  });
}
