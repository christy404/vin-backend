const express = require("express");
const axios = require("axios");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

// ✅ REMOVE dotenv for Render deployment
// require("dotenv").config();

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
        // Fetch VIN details
        const response = await axios.get(
            `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`
        );

        const data = response.data.Results[0];

        // Create PDF file path
        const filePath = path.join(__dirname, "reports", `${vin}.pdf`);
        const pdf = new PDFDocument();
        pdf.pipe(fs.createWriteStream(filePath));

        pdf.fontSize(20).text("Vehicle Report", { align: "center" });
        pdf.moveDown();
        pdf.fontSize(12).text(JSON.stringify(data, null, 2));

        pdf.end();

        // Email sending (optional)
        let emailResult = null;
        if (email) {
            const mailRequest = mailjet.post("send", { version: "v3.1" }).request({
                Messages: [
                    {
                        From: {
                            Email: process.env.MJ_SENDER,
                            Name: "VIN Reports"
                        },
                        To: [
                            {
                                Email: email
                            }
                        ],
                        Subject: "Your Vehicle PDF Report",
                        TextPart: "Attached is your VIN report.",
                        Attachments: [
                            {
                                ContentType: "application/pdf",
                                Filename: `${vin}.pdf`,
                                Base64Content: fs.readFileSync(filePath).toString("base64")
                            }
                        ]
                    }
                ]
            });

            await mailRequest;
            emailResult = { ok: true, message: "Email sent" };
        }

        res.json({
            success: true,
            message: "PDF generated successfully",
            download: `https://yourapp.onrender.com/reports/${vin}.pdf`,
            email: emailResult || null
        });

    } catch (error) {
        console.error(error);
        res.json({ success: false, error: error.message });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server started on port", PORT));
