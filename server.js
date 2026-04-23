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
const ALLEVA_API_BASE = process.env.ALLEVA_API_BASE;
const ALLEVA_FACILITY_NAME =
  process.env.ALLEVA_FACILITY_NAME || "Advocate Support Services";
const ALLEVA_DEFAULT_STATUS =
  process.env.ALLEVA_DEFAULT_STATUS || "Active";

let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
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

async function syncHubSpotContact(hubspotContactId) {
  try {
    const hsContact = await hubspotRequest(
      "GET",
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      null,
      {
        properties:
          "pt__first_name,pt__last_name,firstname,pt__address,pt__address_2,pt__alternative_phone_for_consumer,pt__city,pt__consumers_dob,pt__zip_code,pt__state,pt__primary_phone,phone,relationship_to_patient,pt__email,pt__country,pt__ethnicityrace,pt__gender,pt__pronouns,pt__client_identifies_as,alleva_patient_id,alleva_sync_status,alleva_last_sync_at,alleva_sync_error"
      }
    );

    const props = hsContact.data.properties || {};

    console.log("HubSpot raw properties:", JSON.stringify(props, null, 2));

    const firstName = safeTrim(props.pt__first_name);
    const lastName = safeTrim(props.pt__last_name);
    const dob = formatHubSpotDate(props.pt__consumers_dob);
    const country = mapCountry(props.pt__country);
    const state = mapStateName(props.pt__state);
    const gender = mapGender(props.pt__gender);

    const address1 = safeTrim(props.pt__address);
    const address2 = safeTrim(props.pt__address_2);
    const city = safeTrim(props.pt__city);
    const zipCode = safeTrim(props.pt__zip_code);
    const email = safeTrim(props.pt__email);

    const prospectPhone = normalizePhone(props.pt__primary_phone);
    const primaryContactPhone = normalizePhone(props.phone);
    const primaryContactFirstName = safeTrim(props.firstname);
    const relationshipToPatient = safeTrim(props.relationship_to_patient);

    if (!firstName || !lastName || !dob || !country || !state || !prospectPhone) {
      const missingFields = [];

      if (!firstName) missingFields.push("pt__first_name");
      if (!lastName) missingFields.push("pt__last_name");
      if (!dob) missingFields.push("pt__consumers_dob");
      if (!country) missingFields.push("pt__country");
      if (!state) missingFields.push("pt__state");
      if (!prospectPhone) missingFields.push("pt__primary_phone");

      throw new Error(
        `Missing required HubSpot fields for prospect: ${missingFields.join(", ")}`
      );
    }

    if (!primaryContactPhone || !primaryContactFirstName || !relationshipToPatient) {
      const missingPrimaryFields = [];

      if (!primaryContactPhone) missingPrimaryFields.push("phone");
      if (!primaryContactFirstName) missingPrimaryFields.push("firstname");
      if (!relationshipToPatient) missingPrimaryFields.push("relationship_to_patient");

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
    console.log("HubSpot pt__primary_phone:", props.pt__primary_phone);
    console.log("HubSpot phone:", props.phone);
    console.log("HubSpot firstname:", props.firstname);
    console.log("HubSpot relationship_to_patient:", props.relationship_to_patient);
    console.log("Prospect phone:", prospectPhone);
    console.log("Primary contact name:", primaryContactFirstName);
    console.log("Primary contact relationship:", relationshipToPatient);
    console.log("Primary contact phone:", primaryContactPhone);
    console.log("Alleva payload:", JSON.stringify(allevaPayload, null, 2));

    const allevaResponse = await allevaRequest(
      allevaMethod,
      allevaUrl,
      allevaPayload,
      { "api-version": "1.0" }
    );

    console.log(
      "Alleva response:",
      JSON.stringify(allevaResponse.data, null, 2)
    );

    const responseData = allevaResponse.data;

    const allevaPatientId =
      responseData?.patientId ||
      responseData?.id ||
      responseData?.result ||
      responseData?.prospectId ||
      responseData?.data?.patientId ||
      responseData?.data?.id ||
      props.alleva_patient_id ||
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
    console.error("Alleva response headers:", error.response?.headers);
    console.error(
      "Alleva response data:",
      typeof error.response?.data === "string"
        ? error.response.data
        : JSON.stringify(error.response?.data, null, 2)
    );
    console.error(
      "Axios error JSON:",
      error.toJSON ? JSON.stringify(error.toJSON(), null, 2) : error.message
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

async function searchContactsNeedingSync(after = null) {
  const body = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "pt__first_name",
            operator: "HAS_PROPERTY"
          },
          {
            propertyName: "pt__last_name",
            operator: "HAS_PROPERTY"
          }
        ]
      }
    ],
    properties: [
      "pt__first_name",
      "pt__last_name",
      "firstname",
      "pt__address",
      "pt__address_2",
      "pt__alternative_phone_for_consumer",
      "pt__city",
      "pt__consumers_dob",
      "pt__zip_code",
      "pt__state",
      "pt__primary_phone",
      "phone",
      "relationship_to_patient",
      "pt__email",
      "pt__country",
      "pt__ethnicityrace",
      "pt__gender",
      "pt__pronouns",
      "pt__client_identifies_as",
      "alleva_patient_id",
      "alleva_sync_status",
      "alleva_last_sync_at",
      "alleva_sync_error"
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