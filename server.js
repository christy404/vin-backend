require("dotenv").config();
const express = require("express");
const axios = require("axios");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());
app.use("/reports", express.static("reports"));

// ---------------------
// Mailjet Transporter
// ---------------------
const transporter = nodemailer.createTransport({
  host: "in-v3.mailjet.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.MJ_API_KEY,
    pass: process.env.MJ_SECRET_KEY,
  },
});

// Verify SMTP
transporter.verify((err) => {
  if (err) console.log("Mailjet Error:", err);
  else console.log("Mailjet SMTP Ready");
});

// ---------------------
// PDF Generator
// ---------------------
function generatePDF(vinData, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(20).text("VEHICLE HISTORY REPORT", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`VIN: ${vinData.VIN}`);
    doc.text(`Make: ${vinData.Make}`);
    doc.text(`Model: ${vinData.Model}`);
    doc.text(`Year: ${vinData.ModelYear}`);
    doc.text(`Body Style: ${vinData.BodyClass}`);
    doc.text(`Manufacturer: ${vinData.Manufacturer}`);
    doc.text(`Engine: ${vinData.EngineCylinders}`);
    doc.text(`Country: ${vinData.PlantCountry}`);

    doc.moveDown();
    doc.text("RAW VIN DATA:");
    doc.fontSize(10).text(JSON.stringify(vinData, null, 2));

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

// ---------------------
// Email Sender
// ---------------------
async function sendEmail(to, subject, text, attachmentPath) {
  return transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to: to,
    subject: subject,
    text: text,
    attachments: [
      {
        filename: path.basename(attachmentPath),
        path: attachmentPath,
      },
    ],
  });
}

// ---------------------
// VIN Route + Email
// ---------------------
app.get("/api/vin/:vin", async (req, res) => {
  const vin = req.params.vin;
  const email = req.query.email;

  try {
    // Fetch VIN data
    const response = await axios.get(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`
    );

    const vinData = response.data.Results[0];

    if (!fs.existsSync("./reports")) fs.mkdirSync("./reports");

    const filePath = `./reports/${vin}.pdf`;

    // Create PDF
    await generatePDF(vinData, filePath);

    let emailStatus = null;

    if (email) {
      try {
        await sendEmail(
          email,
          `Your Vehicle History Report (${vin})`,
          `Hello,\n\nYour vehicle history report is attached.\n\nRegards,\nVIN Report Service`,
          filePath
        );

        emailStatus = { sent: true };
      } catch (err) {
        emailStatus = { sent: false, error: err.message };
      }
    }

    res.json({
      success: true,
      pdf: `https://YOUR-RENDER-URL/reports/${vin}.pdf`,
      email: emailStatus,
    });
  } catch (err) {
    console.log("ERR", err);
    res.status(500).json({
      success: false,
      message: "VIN lookup or email failed",
      error: err.message,
    });
  }
});

// ---------------------
// Default Route
// ---------------------
app.get("/", (req, res) => {
  res.send("VIN API Running…");
});

// ---------------------
// Start Server
// ---------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
