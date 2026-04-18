require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const ALLEVA_CLIENT_ID = process.env.ALLEVA_CLIENT_ID;
const ALLEVA_CLIENT_SECRET = process.env.ALLEVA_CLIENT_SECRET;
const ALLEVA_TOKEN_URL = process.env.ALLEVA_TOKEN_URL;

// Real UI endpoint base you found
const ALLEVA_LEAD_API_BASE =
  process.env.ALLEVA_LEAD_API_BASE ||
  "https://allevasoftproapi-prod2.allevasoft.com";

const ALLEVA_REHAB_HEADER =
  process.env.ALLEVA_REHAB_HEADER || "advocatesupport";

// Defaults captured from the working Alleva browser request
const ALLEVA_CREATED_BY = process.env.ALLEVA_CREATED_BY || "1032";
const ALLEVA_FACILITY_ID = process.env.ALLEVA_FACILITY_ID || "2197";
const ALLEVA_REHAB_ID = process.env.ALLEVA_REHAB_ID || "704";
const ALLEVA_COUNTRY_ID = process.env.ALLEVA_COUNTRY_ID || "6";
const ALLEVA_OK_STATE_ID = process.env.ALLEVA_OK_STATE_ID || "78";
const ALLEVA_FEMALE_GENDER_ID = process.env.ALLEVA_FEMALE_GENDER_ID || "1018";
const ALLEVA_STATUS_ID = Number(process.env.ALLEVA_STATUS_ID || 1049);
const ALLEVA_LEAD_INTAKE_STATUS_ID = Number(
  process.env.ALLEVA_LEAD_INTAKE_STATUS_ID || 1102
);
const ALLEVA_LEAD_SELF_STATUS_ID =
  process.env.ALLEVA_LEAD_SELF_STATUS_ID || "1546";
const ALLEVA_RELATION_ID = process.env.ALLEVA_RELATION_ID || "1454";
const ALLEVA_TIMEZONE_ID = process.env.ALLEVA_TIMEZONE_ID || "8";

let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function onlyDigits(value) {
  return safeTrim(value).replace(/\D/g, "");
}

function formatPhoneForAlleva(value) {
  const digits = onlyDigits(value);
  if (!digits) return "";

  const normalized =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (normalized.length === 10) {
    return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  }

  return digits;
}

function formatDateMMDDYYYY(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) return "";

  // Already in MM/DD/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  // Convert YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yyyy, mm, dd] = trimmed.split("-");
    return `${mm}/${dd}/${yyyy}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    const yyyy = parsed.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  return trimmed;
}

function formatTodayMMDDYYYY() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function getGenderId(genderValue) {
  const normalized = safeTrim(genderValue).toLowerCase();

  if (normalized === "female") return ALLEVA_FEMALE_GENDER_ID;
  if (normalized === "male") return process.env.ALLEVA_MALE_GENDER_ID || "";
  return process.env.ALLEVA_DEFAULT_GENDER_ID || "";
}

function getStateId(stateValue) {
  const normalized = safeTrim(stateValue).toUpperCase();

  if (normalized === "OK") return ALLEVA_OK_STATE_ID;
  return process.env.ALLEVA_DEFAULT_STATE_ID || "";
}

function getCountryId(countryValue) {
  const normalized = safeTrim(countryValue).toLowerCase();

  if (normalized === "united_states" || normalized === "united states") {
    return ALLEVA_COUNTRY_ID;
  }

  return process.env.ALLEVA_DEFAULT_COUNTRY_ID || "";
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
  tokenCache.expiresAt = now + response.data.expires_in * 1000;

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

async function createAllevaLead(leadInfo) {
  const token = await getAllevaToken();

  return axios.post(
    `${ALLEVA_LEAD_API_BASE}/api/LeadAPI/AddNewLead`,
    { leadInfo },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
        rehab: ALLEVA_REHAB_HEADER
      }
    }
  );
}

async function syncHubSpotContact(hubspotContactId) {
  try {
    const hsContact = await hubspotRequest(
      "GET",
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      null,
      {
        properties:
          "pt__first_name,pt__last_name,pt__address,pt__address_2,pt__alternative_phone_for_consumer,pt__city,pt__consumers_dob,pt__zip_code,pt__state,pt__primary_phone,pt__email,pt__country,pt__ethnicityrace,pt__gender,pt__pronouns,pt__client_identifies_as,alleva_patient_id,alleva_sync_status,alleva_last_sync_at,alleva_sync_error"
      }
    );

    const props = hsContact.data.properties || {};

    console.log("HubSpot raw properties:", JSON.stringify(props, null, 2));

    // Prevent duplicate create until we know the correct update endpoint
    if (props.alleva_patient_id) {
      console.log(
        "Skipping create because alleva_patient_id already exists:",
        props.alleva_patient_id
      );

      return {
        ok: true,
        hubspotContactId,
        allevaPatientId: props.alleva_patient_id,
        skipped: true
      };
    }

    const firstName = safeTrim(props.pt__first_name);
    const lastName = safeTrim(props.pt__last_name);
    const altPhone = formatPhoneForAlleva(props.pt__alternative_phone_for_consumer);
    const primaryPhone = formatPhoneForAlleva(props.pt__primary_phone);
    const dob = formatDateMMDDYYYY(props.pt__consumers_dob);
    const address1 = safeTrim(props.pt__address);
    const city = safeTrim(props.pt__city).toUpperCase();
    const zipCode = safeTrim(props.pt__zip_code);
    const email = safeTrim(props.pt__email);
    const countryId = getCountryId(props.pt__country);
    const stateId = getStateId(props.pt__state);
    const genderId = getGenderId(props.pt__gender);

    const leadInfo = {
      Address1: address1,
      AdmissionDate: formatTodayMMDDYYYY(),
      City: city,
      ContactFirstName: firstName,
      ContactPhoneNumber: altPhone,
      CountryId: countryId || ALLEVA_COUNTRY_ID,
      CreatedBy: ALLEVA_CREATED_BY,
      DateOfBirth: dob,
      EmailAddress: email,
      FacilityId: ALLEVA_FACILITY_ID,
      FirstName: firstName,
      Gender: genderId || ALLEVA_FEMALE_GENDER_ID,
      IsFavourite: false,
      IsLeadHot: false,
      LastName: lastName,
      LeadIntakeStatusId: ALLEVA_LEAD_INTAKE_STATUS_ID,
      LeadSelfStatus: ALLEVA_LEAD_SELF_STATUS_ID,
      OtherNumber: primaryPhone,
      PostalCode: zipCode,
      Prefix: 0,
      RehabId: ALLEVA_REHAB_ID,
      Relation: ALLEVA_RELATION_ID,
      StateId: stateId || ALLEVA_OK_STATE_ID,
      StatusId: ALLEVA_STATUS_ID,
      TimeZoneId: ALLEVA_TIMEZONE_ID
    };

    // Include Address2 only if Alleva tolerates it. Your captured request did not show it.
    if (safeTrim(props.pt__address_2)) {
      leadInfo.Address2 = safeTrim(props.pt__address_2);
    }

    console.log("Testing HubSpot contact:", hubspotContactId);
    console.log(
      "Alleva request URL:",
      `${ALLEVA_LEAD_API_BASE}/api/LeadAPI/AddNewLead`
    );
    console.log("Alleva leadInfo payload:", JSON.stringify(leadInfo, null, 2));

    const allevaResponse = await createAllevaLead(leadInfo);

    console.log(
      "Alleva AddNewLead response:",
      JSON.stringify(allevaResponse.data, null, 2)
    );

    const allevaPatientId =
      allevaResponse.data?.id ||
      allevaResponse.data?.result ||
      allevaResponse.data?.leadId ||
      allevaResponse.data?.clientId ||
      "";

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

    return {
      ok: true,
      hubspotContactId,
      allevaPatientId,
      allevaResponse: allevaResponse.data
    };
  } catch (error) {
    const errText = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;

    console.error(`Sync failed for HubSpot contact ${hubspotContactId}`);
    console.error("Alleva response status:", error.response?.status);
    console.error(
      "Alleva response data:",
      typeof error.response?.data === "string"
        ? error.response.data
        : JSON.stringify(error.response?.data, null, 2)
    );
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

app.listen(PORT, () => {
  console.log(`Middleware running on port ${PORT}`);
});