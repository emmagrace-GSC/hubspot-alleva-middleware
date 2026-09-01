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
        ["First name:", props.pt__first_name || props.firstname],
        ["Last name:", props.pt__last_name || props.lastname],
        ["Date of birth:", props.pt__date_of_birth || props.pt__consumers_dob || props.date_of_birth_date || props.date_of_birth],
        ["Gender:", props.pt__gender || props.gender],
        ["Pronouns:", props.pt__pronouns],
        ["Client identifies as:", props.pt__client_identifies_as],
        ["Ethnicity/race:", props.pt__ethnicityrace],
        ["Email:", props.pt__email || props.email],
        ["Primary phone:", props.pt__primary_phone || props.phone],
        ["Alternative phone:", props.pt__alternative_phone_for_consumer]
      ]);

      addSection(doc, "Address", [
        ["Address:", props.pt__address_sensitive || props.pt__address || props.address],
        ["Address 2:", props.pt__address_2_sensitive || props.pt__address_2],
        ["City:", props.pt__city_sensitive || props.pt__city || props.city],
        ["State:", props.pt__state || props.pt__state_sensitive || props.state],
        ["ZIP code:", props.pt__zip_code_sensitive || props.pt__zip_code || props.zip],
        ["Country:", props.pt__country || props.country]
      ]);

      addSection(doc, "Primary Contact", [
        ["Name:", [props.referring_provider_first_name, props.referring_provider_last_name].filter(Boolean).join(" ") || props.firstname],
        ["Phone:", props.provider_phone || props.person_who_completed_form_phone || props.phone],
        ["Email:", props.provider_email],
        ["Relationship to patient:", props.relationship_to_patient]
      ]);

      addSection(doc, "Referral", [
        ["Referral source type:", props.referral_source_type],
        ["Referring organization:", props.referring_organization__practice_name],
        ["Referring provider:", [props.referring_provider_first_name, props.referring_provider_middle_name, props.referring_provider_last_name, props.referring_provider_suffix].filter(Boolean).join(" ")],
        ["Referring provider email:", props.referring_provider_email || props.provider_email],
        ["Referring provider phone:", props.provider_phone],
        ["Credentials:", props.credentials_dropdown || props.credentials],
        ["License number:", props.referring_provider_license_number],
        ["NPI:", props.your_national_provider_identifier_npi_with_active_medicaid]
      ]);

      addSection(doc, "Clinical Information", [
        ["Maryland Medicaid/Medical Assistance number:", props.pt__maryland_medicaid__medical_assistance_number],
        ["Primary diagnosis:", props.pt__primary_diagnosis_sensitive],
        ["Secondary diagnosis:", props.pt__secondary_diagnosis_sensitive],
        ["Medication provider information:", props.pt__medication_provider_info]
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
