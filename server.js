require("dotenv").config();
const express = require("express");
const axios = require("axios");
const {
  generateHubSpotSubmissionPdf,
  generateSamplePdf
} = require("./pdfHelper");
const {
  getAllevaDocumentTypes,
  uploadAllevaDocument
} = require("./allevaDocuments");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const ALLEVA_CLIENT_ID = process.env.ALLEVA_CLIENT_ID;
const ALLEVA_CLIENT_SECRET = process.env.ALLEVA_CLIENT_SECRET;
const ALLEVA_TOKEN_URL = process.env.ALLEVA_TOKEN_URL;
const ALLEVA_API_BASE = process.env.ALLEVA_API_BASE;
const ALLEVA_FACILITY_NAME =
  process.env.ALLEVA_FACILITY_NAME || "Advocate Support Services";
const ALLEVA_DEFAULT_STATUS =
  process.env.ALLEVA_DEFAULT_STATUS || "Active";
const ALLEVA_DEFAULT_COUNTRY =
  process.env.ALLEVA_DEFAULT_COUNTRY || "United States";
const ALLEVA_DOCUMENT_TYPE_ID = process.env.ALLEVA_DOCUMENT_TYPE_ID;
const REFERRAL_FORM_LINK =
  process.env.REFERRAL_FORM_LINK ||
  "advocatesupport.formstack.com/forms/advocate_referral_2026";
const REFERRAL_FORM_EVENT_NAME =
  process.env.REFERRAL_FORM_EVENT_NAME ||
  "Advocate Adult PRP Referral Form – 2026: ADV Adult Referral Form 2026";

const HUBSPOT_SYNC_PROPERTIES = [
  "pt__first_name",
  "pt__last_name",
  "firstname",
  "lastname",
  "email",
  "pt__address",
  "pt__address_2",
  "pt__alternative_phone_for_consumer",
  "pt__city",
  "pt__consumers_dob",
  "pt__zip_code",
  "pt__state",
  "pt__state_sensitive",
  "pt__address_sensitive",
  "pt__address_2_sensitive",
  "pt__city_sensitive",
  "pt__zip_code_sensitive",
  "pt__date_of_birth",
  "pt__maryland_medicaid__medical_assistance_number",
  "pt__medication_provider_info",
  "pt__primary_diagnosis_sensitive",
  "pt__secondary_diagnosis_sensitive",
  "pt__primary_phone",
  "phone",
  "relationship_to_patient",
  "address", "city", "state", "zip", "country",
  "date_of_birth", "date_of_birth_date", "migrated_birthdate", "gender",
  "form_link", "recent_conversion_event_name",
  "person_who_completed_form_first_name",
  "person_who_completed_form_last_name",
  "person_who_completed_form_phone",
  "person_who_completed_form_email",
  "referral_source_type", "referring_organization__practice_name",
  "referring_provider_first_name", "referring_provider_middle_name",
  "referring_provider_last_name", "referring_provider_suffix",
  "referring_provider_email", "provider_email", "provider_phone",
  "credentials", "credentials_dropdown", "referring_provider_license_number",
  "your_national_provider_identifier_npi_with_active_medicaid",
  "supervisor_first_name", "supervisor_middle_name", "supervisor_last_name",
  "supervisor_suffix", "supervisors_credentials", "supervisor_license_number",
  "supervisor_individual_npi", "referral_attestations", "typed_name_of_signer",
  "date_and_time_signed",
  "pt__email",
  "pt__country",
  "pt__ethnicityrace",
  "pt__gender",
  "pt__pronouns",
  "pt__client_identifies_as",
  "alleva_patient_id",
  "alleva_sync_status",
  "alleva_last_sync_at",
  "alleva_sync_error",
  "alleva_pdf_upload_status",
  "alleva_pdf_upload_at",
  "alleva_pdf_document_type_id",
  "alleva_pdf_upload_error"
];

let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstPresent(...values) {
  for (const value of values) {
    const trimmed = safeTrim(value);
    if (trimmed) return trimmed;
  }
  return "";
}

function joinName(...parts) {
  return parts.map(safeTrim).filter(Boolean).join(" ");
}

function isReferralFormSubmission(properties) {
  return safeTrim(properties.form_link) === REFERRAL_FORM_LINK ||
    safeTrim(properties.recent_conversion_event_name) === REFERRAL_FORM_EVENT_NAME;
}

function normalizePhone(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) return "";

  let digits = trimmed.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  return digits;
}

function formatHubSpotDate(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [mm, dd, yyyy] = trimmed.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function mapCountry(value) {
  const normalized = safeTrim(value).toLowerCase();

  const countryMap = {
    united_states: "United States",
    "united states": "United States",
    us: "United States",
    usa: "United States"
  };

  return countryMap[normalized] || safeTrim(value);
}

function mapStateName(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) return "";

  const normalized = trimmed.toUpperCase();

  const stateMap = {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming"
  };

  return stateMap[normalized] || trimmed;
}

function mapGender(value) {
  const normalized = safeTrim(value).toLowerCase();

  if (normalized === "female") return "Female";
  if (normalized === "male") return "Male";

  return safeTrim(value);
}

function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, value]) => {
        if (value === null || value === undefined) return false;
        if (typeof value === "string" && value.trim() === "") return false;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return Object.keys(compact(value)).length > 0;
        }
        return true;
      })
      .map(([key, value]) => {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return [key, compact(value)];
        }
        return [key, value];
      })
  );
}

function isValidUsTenDigitPhone(value) {
  return /^\d{10}$/.test(value);
}

async function getAllevaToken(forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    tokenCache.accessToken &&
    now < tokenCache.expiresAt - 5 * 60 * 1000
  ) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("client_id", ALLEVA_CLIENT_ID);
  body.append("client_secret", ALLEVA_CLIENT_SECRET);

  const response = await axios.post(ALLEVA_TOKEN_URL, body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });

  tokenCache.accessToken = response.data.access_token;
  tokenCache.expiresAt = Date.now() + response.data.expires_in * 1000;

  return tokenCache.accessToken;
}

async function hubspotRequest(method, url, data = null, params = null) {
  return axios({
    method,
    url: `https://api.hubapi.com${url}`,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    data,
    params
  });
}

async function allevaRequest(method, url, data = null, params = null) {
  let token = await getAllevaToken();

  try {
    return await axios({
      method,
      url: `${ALLEVA_API_BASE}${url}`,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      data,
      params
    });
  } catch (error) {
    if (error.response?.status === 401) {
      token = await getAllevaToken(true);

      return await axios({
        method,
        url: `${ALLEVA_API_BASE}${url}`,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        data,
        params
      });
    }

    throw error;
  }
}

function extractAllevaLeadId(responseData, existingAllevaPatientId = "") {
  const leadId =
    responseData?.leadId ||
    responseData?.patientId ||
    responseData?.id ||
    responseData?.prospectId ||
    responseData?.result?.leadId ||
    responseData?.result?.patientId ||
    responseData?.result?.id ||
    responseData?.result?.prospectId ||
    responseData?.result ||
    responseData?.data?.leadId ||
    responseData?.data?.patientId ||
    responseData?.data?.id ||
    responseData?.data?.prospectId ||
    existingAllevaPatientId ||
    "";

  if (typeof leadId === "object") return "";

  return leadId;
}

function getAllevaDuplicateResults(responseData) {
  if (Array.isArray(responseData)) return responseData;
  if (Array.isArray(responseData?.data)) return responseData.data;
  if (Array.isArray(responseData?.results)) return responseData.results;
  return [];
}

function getAllevaDuplicateLeadId(duplicate) {
  const leadId =
    duplicate?.leadId ||
    duplicate?.id ||
    duplicate?.prospectId ||
    duplicate?.clientId;

  return leadId && typeof leadId !== "object" ? leadId : "";
}

function isAllevaEmailInUseError(error) {
  if (error.response?.status !== 422) return false;

  const responseText = JSON.stringify(error.response?.data || "").toLowerCase();
  return responseText.includes("email address is already in use");
}

async function findAllevaDuplicateByEmail(email) {
  const normalizedEmail = safeTrim(email).toLowerCase();
  if (!normalizedEmail) return null;

  const response = await allevaRequest(
    "GET",
    "/clients/duplicates",
    null,
    {
      email: normalizedEmail,
      "api-version": "1.0"
    }
  );

  const matches = getAllevaDuplicateResults(response.data).filter(
    duplicate => safeTrim(duplicate?.email).toLowerCase() === normalizedEmail
  );

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Alleva returned multiple records for email ${normalizedEmail}; manual review is required`
    );
  }

  const leadId = getAllevaDuplicateLeadId(matches[0]);
  if (!leadId) {
    throw new Error(
      `Alleva duplicate lookup found ${normalizedEmail} but did not return a lead ID`
    );
  }

  return {
    leadId,
    record: matches[0]
  };
}

async function updateHubSpotPdfUploadStatus(hubspotContactId, statusFields) {
  try {
    await hubspotRequest(
      "PATCH",
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      {
        properties: {
          alleva_pdf_upload_status: statusFields.status || "",
          alleva_pdf_upload_at: statusFields.uploadedAt || "",
          alleva_pdf_document_type_id: statusFields.documentTypeId
            ? String(statusFields.documentTypeId)
            : "",
          alleva_pdf_upload_error: statusFields.error
            ? String(statusFields.error).slice(0, 65000)
            : ""
        }
      }
    );
  } catch (error) {
    console.error(
      "Could not update HubSpot PDF upload fields:",
      error.response?.data || error.message
    );
  }
}

async function uploadHubSpotSummaryPdf({
  hubspotContact,
  hubspotContactId,
  leadId
}) {
  if (!leadId) {
    throw new Error("Cannot generate or upload summary PDF because Alleva leadId is missing");
  }

  if (!ALLEVA_DOCUMENT_TYPE_ID) {
    throw new Error("Missing ALLEVA_DOCUMENT_TYPE_ID environment variable");
  }

  await updateHubSpotPdfUploadStatus(hubspotContactId, {
    status: "generating_pdf",
    documentTypeId: ALLEVA_DOCUMENT_TYPE_ID
  });

  const pdfBuffer = await generateHubSpotSubmissionPdf(hubspotContact, {
    hubspotContactId,
    leadId
  });

  await updateHubSpotPdfUploadStatus(hubspotContactId, {
    status: "uploading_to_alleva",
    documentTypeId: ALLEVA_DOCUMENT_TYPE_ID
  });

  const uploadResponse = await uploadAllevaDocument({
    allevaApiBase: ALLEVA_API_BASE,
    getAccessToken: getAllevaToken,
    leadId,
    typeId: ALLEVA_DOCUMENT_TYPE_ID,
    pdfBuffer,
    filename: `hubspot-formstack-summary-${hubspotContactId}.pdf`
  });

  console.log(
    "Alleva document upload response:",
    JSON.stringify(
      {
        leadId,
        typeId: ALLEVA_DOCUMENT_TYPE_ID,
        status: uploadResponse.status,
        data: uploadResponse.data,
        createdDocumentId: uploadResponse.createdDocumentId,
        verification: uploadResponse.verification,
        manualVerificationRequired: uploadResponse.manualVerificationRequired
      },
      null,
      2
    )
  );

  await updateHubSpotPdfUploadStatus(hubspotContactId, {
    status: "uploaded_needs_manual_verification",
    uploadedAt: new Date().toISOString(),
    documentTypeId: ALLEVA_DOCUMENT_TYPE_ID
  });

  return {
    ok: true,
    ...uploadResponse
  };
}

async function syncHubSpotContact(hubspotContactId) {
  try {
    const hsContact = await hubspotRequest(
      "GET",
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      null,
      {
        properties: HUBSPOT_SYNC_PROPERTIES.join(",")
      }
    );

    const props = hsContact.data.properties || {};

    const isNewReferralForm = isReferralFormSubmission(props);
    const firstName = firstPresent(props.pt__first_name, props.firstname);
    const lastName = firstPresent(props.pt__last_name, props.lastname);
    const dob = formatHubSpotDate(firstPresent(
      props.pt__date_of_birth,
      props.pt__consumers_dob,
      props.date_of_birth_date,
      props.date_of_birth,
      props.migrated_birthdate
    ));
    const country = mapCountry(firstPresent(props.pt__country, props.country)) ||
      ALLEVA_DEFAULT_COUNTRY;
    const state = mapStateName(firstPresent(
      props.pt__state,
      props.pt__state_sensitive,
      props.state
    ));
    const gender = mapGender(firstPresent(props.pt__gender, props.gender));

    const address1 = firstPresent(
      props.pt__address_sensitive,
      props.pt__address,
      props.address
    );
    const address2 = firstPresent(
      props.pt__address_2_sensitive,
      props.pt__address_2
    );
    const city = firstPresent(
      props.pt__city_sensitive,
      props.pt__city,
      props.city
    );
    const zipCode = firstPresent(
      props.pt__zip_code_sensitive,
      props.pt__zip_code,
      props.zip
    );
    const email = firstPresent(props.pt__email, props.email);

    const prospectPhone = normalizePhone(firstPresent(
      props.pt__primary_phone,
      props.phone
    ));
    const primaryContactPhone = normalizePhone(
      isNewReferralForm
        ? firstPresent(props.provider_phone, props.person_who_completed_form_phone)
        : props.phone
    );
    const primaryContactFirstName = isNewReferralForm
      ? joinName(
          props.referring_provider_first_name,
          props.referring_provider_last_name
        )
      : safeTrim(props.firstname);
    const relationshipToPatient = firstPresent(
      props.relationship_to_patient,
      isNewReferralForm ? "Referring provider" : ""
    );

    if (!firstName || !lastName || !prospectPhone || (!isNewReferralForm && (!dob || !state))) {
      const missingFields = [];

      if (!firstName) missingFields.push("first name");
      if (!lastName) missingFields.push("last name");
      if (!dob && !isNewReferralForm) missingFields.push("date of birth");
      if (!state && !isNewReferralForm) missingFields.push("state");
      if (!prospectPhone) missingFields.push("phone");

      throw new Error(
        `Missing required HubSpot fields for prospect: ${missingFields.join(", ")}`
      );
    }

    if (!primaryContactPhone || !primaryContactFirstName) {
      const missingPrimaryFields = [];

      if (!primaryContactPhone) missingPrimaryFields.push("phone");
      if (!primaryContactFirstName) missingPrimaryFields.push("firstname");

      throw new Error(
        `Missing required HubSpot fields for primary contact: ${missingPrimaryFields.join(", ")}`
      );
    }

    if (!isValidUsTenDigitPhone(prospectPhone)) {
      throw new Error(
        `Invalid prospect phone for Alleva: ${props.pt__primary_phone} -> ${prospectPhone}`
      );
    }

    if (!isValidUsTenDigitPhone(primaryContactPhone)) {
      throw new Error(
        `Invalid primary contact phone for Alleva: ${props.phone} -> ${primaryContactPhone}`
      );
    }

    const allevaPayload = compact({
      name: {
        first: firstName,
        last: lastName
      },
      gender,
      dateOfBirth: dob,
      address: {
        line1: address1,
        line2: address2,
        city,
        state,
        country,
        zipCode
      },
      phone: {
        other: prospectPhone
      },
      email,
      contact: {
        name: primaryContactFirstName,
        phone: primaryContactPhone,
        relationship: relationshipToPatient,
        isPrimary: true,
        isEmergencyContact: false
      },
      facilityName: ALLEVA_FACILITY_NAME,
      status: ALLEVA_DEFAULT_STATUS
    });

    const allevaMethod = props.alleva_patient_id ? "PATCH" : "POST";
    const allevaUrl = props.alleva_patient_id
      ? `/prospects/${props.alleva_patient_id}`
      : `/prospects`;

    console.log("Testing HubSpot contact:", hubspotContactId);
    console.log("Alleva request method:", allevaMethod);
    console.log("Alleva request URL:", allevaUrl);
    console.log("HubSpot form link:", props.form_link);
    console.log("Using new referral form mapping:", isNewReferralForm);
    console.log("Prospect phone:", prospectPhone);
    console.log("Primary contact name:", primaryContactFirstName);
    console.log("Primary contact relationship:", relationshipToPatient);
    console.log("Primary contact phone:", primaryContactPhone);
    let duplicateMatch = null;
    let allevaResponse = null;

    if (!props.alleva_patient_id && email) {
      duplicateMatch = await findAllevaDuplicateByEmail(email);
    }

    if (!duplicateMatch) {
      try {
        allevaResponse = await allevaRequest(
          allevaMethod,
          allevaUrl,
          allevaPayload,
          { "api-version": "1.0" }
        );
      } catch (error) {
        // A prospect can be created between the lookup and POST. Resolve that
        // race by looking up the record Alleva says already owns the email.
        if (allevaMethod !== "POST" || !email || !isAllevaEmailInUseError(error)) {
          throw error;
        }

        duplicateMatch = await findAllevaDuplicateByEmail(email);
        if (!duplicateMatch) throw error;
      }
    }

    if (duplicateMatch) {
      console.log("Linked HubSpot contact to existing Alleva record:", {
        hubspotContactId,
        allevaPatientId: String(duplicateMatch.leadId)
      });
    } else {
      console.log(
        "Alleva response:",
        JSON.stringify(allevaResponse.data, null, 2)
      );
    }

    const responseData = allevaResponse?.data || duplicateMatch?.record || {};

    const allevaPatientId = duplicateMatch?.leadId || extractAllevaLeadId(
      responseData,
      props.alleva_patient_id
    );

    if (!allevaPatientId) {
      throw new Error(
        `Alleva prospect response did not include a lead/prospect ID: ${JSON.stringify(responseData)}`
      );
    }

    await hubspotRequest(
      "PATCH",
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      {
        properties: {
          alleva_patient_id: String(allevaPatientId || ""),
          alleva_last_sync_at: new Date().toISOString(),
          alleva_sync_status: "success",
          alleva_sync_error: ""
        }
      }
    );

    let pdfUpload = null;

    if (props.alleva_pdf_upload_status === "uploaded_needs_manual_verification") {
      pdfUpload = {
        ok: true,
        skipped: true,
        status: props.alleva_pdf_upload_status,
        message: "PDF upload already recorded in HubSpot"
      };
    } else {
      try {
        pdfUpload = await uploadHubSpotSummaryPdf({
          hubspotContact: hsContact.data,
          hubspotContactId,
          leadId: allevaPatientId
        });
      } catch (pdfError) {
        const pdfErrorText = pdfError.response?.data
          ? JSON.stringify(pdfError.response.data)
          : pdfError.message;

        console.error(
          `PDF upload failed for HubSpot contact ${hubspotContactId} / Alleva lead ${allevaPatientId}:`,
          pdfErrorText
        );

        await updateHubSpotPdfUploadStatus(hubspotContactId, {
          status: "failed",
          uploadedAt: new Date().toISOString(),
          documentTypeId: ALLEVA_DOCUMENT_TYPE_ID,
          error: pdfErrorText
        });

        pdfUpload = {
          ok: false,
          error: pdfErrorText
        };
      }
    }

    return {
      ok: true,
      hubspotContactId,
      allevaPatientId,
      pdfUpload,
      matchedExistingAllevaRecord: Boolean(duplicateMatch),
      allevaResponse: responseData
    };
  } catch (error) {
    const errText = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;

    console.error(`Sync failed for HubSpot contact ${hubspotContactId}`);
    console.error("Alleva response status:", error.response?.status);
    console.error("Alleva response headers:", error.response?.headers);
    console.error(
      "Alleva response data:",
      typeof error.response?.data === "string"
        ? error.response.data
        : JSON.stringify(error.response?.data, null, 2)
    );
    console.error("Request failure summary:", {
      name: error.name,
      code: error.code,
      status: error.response?.status,
      method: error.config?.method,
      url: error.config?.url
    });
    console.error("Full error message:", error.message);

    try {
      await hubspotRequest(
        "PATCH",
        `/crm/v3/objects/contacts/${hubspotContactId}`,
        {
          properties: {
            alleva_last_sync_at: new Date().toISOString(),
            alleva_sync_status: "failed",
            alleva_sync_error: errText.slice(0, 65000)
          }
        }
      );
    } catch (patchError) {
      console.error(
        "Could not update HubSpot error fields:",
        patchError.response?.data || patchError.message
      );
    }

    throw new Error(errText);
  }
}

async function searchContactsNeedingSync(after = null) {
  const body = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "form_link",
            operator: "EQ",
            value: REFERRAL_FORM_LINK
          }
        ]
      },
      {
        filters: [
          {
            propertyName: "recent_conversion_event_name",
            operator: "EQ",
            value: REFERRAL_FORM_EVENT_NAME
          }
        ]
      }
    ],
    properties: [
      ...HUBSPOT_SYNC_PROPERTIES
    ],
    limit: 100,
    sorts: [
      {
        propertyName: "createdate",
        direction: "ASCENDING"
      }
    ]
  };

  if (after) {
    body.after = after;
  }

  return hubspotRequest("POST", "/crm/v3/objects/contacts/search", body);
}

app.get("/", (req, res) => {
  res.send("Middleware is live");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Middleware is running" });
});

app.get("/test-alleva-token", async (req, res) => {
  try {
    const token = await getAllevaToken();
    res.json({
      ok: true,
      tokenPreview: token.substring(0, 20) + "..."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

app.get("/alleva/document-types", async (req, res) => {
  try {
    const response = await getAllevaDocumentTypes({
      allevaApiBase: ALLEVA_API_BASE,
      getAccessToken: getAllevaToken
    });

    res.json({
      ok: true,
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

app.post("/test-alleva-document-upload", async (req, res) => {
  try {
    const { leadId, typeId } = req.body;
    const documentTypeId = typeId || ALLEVA_DOCUMENT_TYPE_ID;

    if (!leadId) {
      return res.status(400).json({
        ok: false,
        error: "Missing leadId"
      });
    }

    if (!documentTypeId) {
      return res.status(400).json({
        ok: false,
        error: "Missing typeId or ALLEVA_DOCUMENT_TYPE_ID"
      });
    }

    const pdfBuffer = await generateSamplePdf(leadId);
    const uploadResponse = await uploadAllevaDocument({
      allevaApiBase: ALLEVA_API_BASE,
      getAccessToken: getAllevaToken,
      leadId,
      typeId: documentTypeId,
      pdfBuffer,
      filename: `alleva-document-upload-test-${leadId}.pdf`
    });

    console.log(
      "Alleva test document upload response:",
      JSON.stringify(
        {
          leadId,
          typeId: documentTypeId,
          status: uploadResponse.status,
          data: uploadResponse.data,
          manualVerificationRequired: uploadResponse.manualVerificationRequired
        },
        null,
        2
      )
    );

    res.json({
      ok: true,
      leadId,
      typeId: String(documentTypeId),
      uploadStatusCode: uploadResponse.status,
      manualVerificationRequired: true,
      message:
        "Alleva returned a 2xx response. Manually verify this sample PDF appears on the Prospective Client record in Alleva.",
      allevaResponse: uploadResponse.data,
      createdDocumentId: uploadResponse.createdDocumentId,
      allevaDocumentVerification: uploadResponse.verification
    });
  } catch (error) {
    console.error(
      "Test Alleva document upload failed:",
      error.response?.data || error.message
    );
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

app.post("/test-hubspot-summary-pdf-upload", async (req, res) => {
  try {
    const { hubspotContactId, leadId } = req.body;

    if (!hubspotContactId) {
      return res.status(400).json({
        ok: false,
        error: "Missing hubspotContactId"
      });
    }

    const hsContact = await hubspotRequest(
      "GET",
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      null,
      {
        properties: HUBSPOT_SYNC_PROPERTIES.join(",")
      }
    );
    const props = hsContact.data.properties || {};
    const allevaLeadId = leadId || props.alleva_patient_id;

    if (!allevaLeadId) {
      return res.status(400).json({
        ok: false,
        error: "Missing leadId and HubSpot contact has no alleva_patient_id"
      });
    }

    const uploadResponse = await uploadHubSpotSummaryPdf({
      hubspotContact: hsContact.data,
      hubspotContactId,
      leadId: allevaLeadId
    });

    res.json({
      ok: true,
      hubspotContactId,
      leadId: String(allevaLeadId),
      upload: uploadResponse
    });
  } catch (error) {
    console.error(
      "Test HubSpot summary PDF upload failed:",
      error.response?.data || error.message
    );
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

app.post("/hubspot/contact-sync", async (req, res) => {
  try {
    const { hubspotContactId } = req.body;

    if (!hubspotContactId) {
      return res.status(400).json({
        ok: false,
        error: "Missing hubspotContactId"
      });
    }

    const result = await syncHubSpotContact(hubspotContactId);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post("/poll-hubspot-once", async (req, res) => {
  try {
    let after = null;
    let scanned = 0;
    let matched = 0;
    let processed = 0;
    let failed = 0;

    do {
      const response = await searchContactsNeedingSync(after);
      const results = response.data?.results || [];

      scanned += results.length;

      const contactsToSync = results.filter((contact) => {
        const status = contact.properties?.alleva_sync_status;
        return !status || status === "failed";
      });

      matched += contactsToSync.length;

      for (const contact of contactsToSync) {
        try {
          await syncHubSpotContact(contact.id);
          processed += 1;
        } catch (error) {
          failed += 1;
          console.error(
            `Polling sync failed for contact ${contact.id}:`,
            error.message
          );
        }
      }

      after = response.data?.paging?.next?.after || null;
    } while (after);

    res.json({
      ok: true,
      scanned,
      matched,
      processed,
      failed
    });
  } catch (error) {
    console.error("Polling error:", error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Middleware running on port ${PORT}`);
});
