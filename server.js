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
    const filename = `${vin}.pdf`;
    const filepath = path.join(__dirname, "reports", filename);

    const pdf = new PDFDocument();
    pdf.pipe(fs.createWriteStream(filepath));

    pdf.fontSize(22).text("Vehicle History Report", { align: "center" });
    pdf.moveDown();

    pdf.fontSize(14).text(`VIN: ${vin}`);
    pdf.text(`Make: ${data.Make}`);
    pdf.text(`Model: ${data.Model}`);
    pdf.text(`Year: ${data.ModelYear}`);
    pdf.text(`Manufacturer: ${data.Manufacturer}`);
    pdf.text(`Body Class: ${data.BodyClass}`);
    pdf.text(`Engine: ${data.EngineModel}`);
    pdf.text(`Fuel Type: ${data.FuelTypePrimary}`);
    pdf.text(`Country: ${data.PlantCountry}`);

    pdf.end();

    let emailStatus = null;

    // 3. SEND EMAIL (only if email provided)
    if (email) {
      try {
        const pdfBuffer = fs.readFileSync(filepath);

        const send = await mailjet.post("send", { version: "v3.1" }).request({
          Messages: [
            {
              From: {
                Email: process.env.MJ_SENDER,
                Name: "VIN Report Service",
              },
              To: [
                {
                  Email: email,
                },
              ],
              Subject: `Your Vehicle Report for VIN ${vin}`,
              TextPart: "Your PDF report is attached.",
              Attachments: [
                {
                  ContentType: "application/pdf",
                  Filename: filename,
                  Base64Content: pdfBuffer.toString("base64"),
                },
              ],
            },
          ],
        });

        emailStatus = { ok: true, message: "Mailjet email sent" };
      } catch (err) {
        console.error("Mailjet Error:", err.message);
        emailStatus = { ok: false, message: "Mailjet send failed" };
      }
    }

    // RESPONSE JSON
    res.json({
      success: true,
      message: "PDF generated successfully",
      download: `http://localhost:3000/reports/${filename}`,
      email: emailStatus,
    });
  } catch (error) {
    console.error("VIN Lookup Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to process VIN",
    });
  }
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
