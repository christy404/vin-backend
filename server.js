const express = require("express");
const axios = require("axios");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve reports folder
app.use("/reports", express.static(path.join(__dirname, "reports")));

// MAILJET SETUP
const mailjet = require("node-mailjet").apiConnect(
  process.env.MJ_API_KEY,
  process.env.MJ_SECRET_KEY
);

// VIN API ROUTE
app.get("/api/vin/:vin", async (req, res) => {
  const vin = req.params.vin;
  const email = req.query.email || null;

  try {
    // 1. Fetch VIN details using NHTSA API (free)
    const response = await axios.get(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`
    );

    const data = response.data.Results[0];

    // 2. Generate PDF
    const pdfPath = path.join(__dirname, "reports", `${vin}.pdf`);

    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(pdfPath));

    doc.fontSize(20).text("Vehicle History Report", { underline: true });
    doc.moveDown();

    doc.fontSize(12).text(`VIN: ${vin}`);
    doc.text(`Make: ${data.Make}`);
    doc.text(`Model: ${data.Model}`);
    doc.text(`Year: ${data.ModelYear}`);
    doc.text(`Body Type: ${data.BodyClass}`);
    doc.text(`Engine: ${data.EngineCylinders} cylinders`);
    doc.text(`Manufacturer: ${data.Manufacturer}`);
    doc.text(`Plant Country: ${data.PlantCountry}`);
    doc.moveDown();

    doc.text("Full Raw Data:", { underline: true });
    doc.moveDown();

    Object.keys(data).forEach((key) => {
      if (data[key]) doc.text(`${key}: ${data[key]}`);
    });

    doc.end();

    // 3. If no email, return only PDF link
    if (!email) {
      return res.json({
        success: true,
        message: "PDF generated",
        download: `${req.protocol}://${req.get("host")}/reports/${vin}.pdf`,
        email: null
      });
    }

    // 4. Send Email via Mailjet
    const emailData = await mailjet.post("send", { version: "v3.1" }).request({
      Messages: [
        {
          From: {
            Email: process.env.MJ_SENDER,
            Name: "VIN Report Service"
          },
          To: [
            {
              Email: email
            }
          ],
          Subject: `Your VIN Report - ${vin}`,
          TextPart: "Attached is your vehicle report PDF.",
          HTMLPart: `<h3>Your Vehicle Report</h3>
                     <p>VIN: <b>${vin}</b></p>
                     <p>Download here:</p>
                     <a href="${req.protocol}://${req.get("host")}/reports/${vin}.pdf">
                        Click to download PDF
                     </a>`
        }
      ]
    });

    return res.json({
      success: true,
      message: "PDF generated successfully",
      download: `${req.protocol}://${req.get("host")}/reports/${vin}.pdf`,
      email: { ok: true, message: "Email sent successfully" }
    });
  } catch (error) {
    console.error(error);
    return res.json({
      success: false,
      message: "VIN lookup or email failed",
      error: error.message
    });
  }
});

// SERVER START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
