const PDFDocument = require("pdfkit");

function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function formatValue(value) {
  const text = safeString(value);
  return text || "Not provided";
}

function addField(doc, label, value) {
  doc.font("Helvetica-Bold").fontSize(10).text(label, { continued: true });
  doc.font("Helvetica").text(` ${formatValue(value)}`);
  doc.moveDown(0.35);
}

function addSection(doc, title, fields) {
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(13).text(title);
  doc.moveDown(0.35);

  fields.forEach(([label, value]) => addField(doc, label, value));
}

function generateHubSpotSubmissionPdf(contact, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const props = contact?.properties || contact || {};
      const doc = new PDFDocument({
        size: "LETTER",
        margin: 50,
        info: {
          Title: "HubSpot/Formstack Submission Summary",
          Author: "HubSpot Alleva Middleware"
        }
      });

      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.font("Helvetica-Bold").fontSize(18).text("HubSpot/Formstack Submission Summary");
      doc.moveDown(0.3);
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(`Generated: ${new Date().toISOString()}`)
        .text(`HubSpot Contact ID: ${formatValue(contact?.id || options.hubspotContactId)}`)
        .text(`Alleva Lead ID: ${formatValue(options.leadId)}`);

      addSection(doc, "Prospective Client", [
        ["First name:", props.pt__first_name],
        ["Last name:", props.pt__last_name],
        ["Date of birth:", props.pt__consumers_dob],
        ["Gender:", props.pt__gender],
        ["Pronouns:", props.pt__pronouns],
        ["Client identifies as:", props.pt__client_identifies_as],
        ["Ethnicity/race:", props.pt__ethnicityrace],
        ["Email:", props.pt__email],
        ["Primary phone:", props.pt__primary_phone],
        ["Alternative phone:", props.pt__alternative_phone_for_consumer]
      ]);

      addSection(doc, "Address", [
        ["Address:", props.pt__address],
        ["Address 2:", props.pt__address_2],
        ["City:", props.pt__city],
        ["State:", props.pt__state],
        ["ZIP code:", props.pt__zip_code],
        ["Country:", props.pt__country]
      ]);

      addSection(doc, "Primary Contact", [
        ["First name:", props.firstname],
        ["Phone:", props.phone],
        ["Relationship to patient:", props.relationship_to_patient]
      ]);

      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(13).text("Raw HubSpot Properties");
      doc.moveDown(0.35);
      Object.keys(props)
        .sort()
        .forEach((key) => addField(doc, `${key}:`, props[key]));

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function generateSamplePdf(leadId) {
  return generateHubSpotSubmissionPdf(
    {
      id: "sample",
      properties: {
        pt__first_name: "Sample",
        pt__last_name: "Prospect",
        pt__consumers_dob: "1990-01-01",
        pt__primary_phone: "5555555555",
        pt__email: "sample@example.com",
        pt__address: "123 Test Street",
        pt__city: "Test City",
        pt__state: "Test State",
        pt__zip_code: "12345",
        pt__country: "United States",
        firstname: "Sample Contact",
        phone: "5555555555",
        relationship_to_patient: "Self"
      }
    },
    { leadId }
  );
}

module.exports = {
  generateHubSpotSubmissionPdf,
  generateSamplePdf
};
