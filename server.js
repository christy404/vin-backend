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

// create transporter using .env credentials
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: (process.env.SMTP_SECURE === "true"), // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify transporter on startup (optional, helpful)
transporter.verify().then(() => {
  console.log("SMTP transporter ready");
}).catch(err => {
  console.warn("SMTP transporter not ready:", err.message || err);
});

// -----------------------
// PDF generator
// -----------------------
function generatePDF(vinData, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Header (logo optional)
    try {
      const logoPath = path.join(__dirname, "logo.png");
      if (fs.existsSync(logoPath)) doc.image(logoPath, 40, 20, { width: 80 });
    } catch (e) {}

    doc.fontSize(20).fillColor("#222").text("VEHICLE HISTORY REPORT", 140, 30);
    doc.moveDown();
    doc.fontSize(10).text(`Generated on: ${new Date().toLocaleString()}`);
    doc.moveDown(1.2);

    // Summary box
    doc.roundedRect(40, 100, 520, 120, 8).stroke("#888");
    doc.fontSize(12).fillColor("#000");
    doc.text(`VIN: ${vinData.VIN || "-"}`, 50, 115);
    doc.text(`Year: ${vinData.ModelYear || "-"}`, 320, 115);
    doc.text(`Make: ${vinData.Make || "-"}`, 50, 140);
    doc.text(`Model: ${vinData.Model || "-"}`, 320, 140);
    doc.text(`Engine: ${vinData.EngineCylinders || "-"} Cyl`, 50, 165);
    doc.text(`Body: ${vinData.BodyClass || "-"}`, 320, 165);
    doc.text(`Country: ${vinData.PlantCountry || "-"}`, 50, 190);

    // Section title
    doc.moveDown(6);
    doc.fontSize(14).fillColor("#1a73e8").text("Vehicle Details");
    doc.moveTo(40, doc.y + 4).lineTo(560, doc.y + 4).stroke("#1a73e8");
    doc.moveDown();

    // Details list
    const details = [
      ["Make", vinData.Make],
      ["Model", vinData.Model],
      ["Model Year", vinData.ModelYear],
      ["Body Class", vinData.BodyClass],
      ["Engine Cylinders", vinData.EngineCylinders],
      ["Manufacturer", vinData.Manufacturer],
      ["Plant Country", vinData.PlantCountry],
      ["Vehicle Type", vinData.VehicleType],
    ];

    doc.fontSize(11).fillColor("#000");
    details.forEach(([label, val]) => {
      doc.font("Helvetica-Bold").text(`${label}:`, { continued: true });
      doc.font("Helvetica").text(` ${val || "-"}`);
    });

    // Add a page with raw data (optional)
    doc.addPage();
    doc.fontSize(13).fillColor("#1a73e8").text("Full Raw VIN Data");
    doc.moveTo(40, doc.y + 4).lineTo(560, doc.y + 4).stroke("#1a73e8");
    doc.moveDown();
    doc.fontSize(9).fillColor("#333").text(JSON.stringify(vinData, null, 2), {
      width: 520,
      align: "left"
    });

    // Footer
    doc.fontSize(9).fillColor("#777");
    doc.text("© 2025 YourCompany Inc. — All Rights Reserved", 40, 760, {
      align: "center",
      width: 520
    });

    doc.end();

    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });
}

// -----------------------
// Helper: send email with attachment
// -----------------------
async function sendReportEmail(toEmail, subject, text, attachmentPath) {
  const mailOptions = {
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to: toEmail,
    subject: subject,
    text: text,
    attachments: [
      {
        filename: path.basename(attachmentPath),
        path: attachmentPath,
      },
    ],
  };

  return transporter.sendMail(mailOptions);
}

// -----------------------
// VIN route: generate PDF and optionally email
// Usage: GET /api/vin/:vin?email=customer@example.com
// (or receive email from Shopify webhook and call this internally)
// -----------------------
app.get("/api/vin/:vin", async (req, res) => {
  const vin = req.params.vin;
  const customerEmail = req.query.email; // optional

  try {
    // 1) Fetch VIN data using NHTSA free API
    const apiResp = await axios.get(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`
    );
    const vinData = (apiResp.data && apiResp.data.Results && apiResp.data.Results[0]) || {};

    // 2) Ensure reports folder
    const reportsDir = path.join(__dirname, "reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    // 3) Generate PDF
    const filePath = path.join(reportsDir, `${vin}.pdf`);
    await generatePDF(vinData, filePath);

    // 4) If email provided, send the PDF
    let emailResult = null;
    if (customerEmail) {
      try {
        await sendReportEmail(
          customerEmail,
          `Your Vehicle History Report - VIN ${vin}`,
          `Hello,\n\nAttached is the vehicle history report for VIN ${vin}.\n\nRegards,\nYourCompany`,
          filePath
        );
        emailResult = { ok: true, message: "Email sent" };
      } catch (err) {
        console.error("Email error:", err && err.message ? err.message : err);
        emailResult = { ok: false, message: err.message || "Email failed" };
      }
    }

    // 5) Respond with download link and email status
    res.json({
      success: true,
      message: "PDF generated successfully",
      download: `${req.protocol}://${req.get("host")}/reports/${encodeURIComponent(vin)}.pdf`,
      email: emailResult,
    });

  } catch (err) {
    console.error("VIN route error:", err && err.message ? err.message : err);
    res.status(500).json({
      success: false,
      message: "VIN lookup / PDF / Email failed",
      error: err.message || String(err),
    });
  }
});

// default route
app.get("/", (req, res) => res.send("VIN Backend API is running..."));

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
