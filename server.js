const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use("/reports", express.static("reports"));

// Mailtrap transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// VIN API Route
app.get("/api/vin/:vin", async (req, res) => {
  const vin = req.params.vin;
  const email = req.query.email;
  const pdfPath = `reports/${vin}.pdf`;

  try {
    const response = await axios.get(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`
    );

    const data = response.data.Results[0];

    // Generate PDF
    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(pdfPath));

    doc.fontSize(22).text("Vehicle History Report", { underline: true });
    doc.moveDown();

    doc.fontSize(14)
      .text(`VIN: ${vin}`)
      .text(`Make: ${data.Make}`)
      .text(`Model: ${data.Model}`)
      .text(`Year: ${data.ModelYear}`)
      .moveDown();

    doc.text("Full Data:", { underline: true }).moveDown();
    Object.entries(data).forEach(([key, value]) => {
      doc.text(`${key}: ${value}`);
    });

    doc.end();

    // If email provided → send email
    let emailResult = null;
    if (email) {
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: email,
        subject: `Your Vehicle History Report - ${vin}`,
        text: "Your PDF report is attached.",
        attachments: [
          {
            filename: `${vin}.pdf`,
            path: pdfPath
          }
        ]
      });

      emailResult = { ok: true, message: "Email sent" };
    }

    res.json({
      success: true,
      message: "PDF generated successfully",
      download: `https://your-render-url.onrender.com/${pdfPath}`,
      email: emailResult
    });

  } catch (error) {
    console.log(error);
    res.json({
      success: false,
      message: "Error processing VIN",
      error: error.message
    });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
