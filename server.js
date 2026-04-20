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
const ALLEVA_API_BASE = process.env.ALLEVA_API_BASE || "https://api.allevasoft.com";
const ALLEVA_API_VERSION = process.env.ALLEVA_API_VERSION || "1";

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
  return trimmed.replace(/\D/g, "");
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

function mapGender(value) {
  const normalized = safeTrim(value).toLowerCase();
  if (normalized === "female") return "Female";
  if (normalized === "male") return "Male";
  return safeTrim(value);
}

function mapCountry(value) {
  const normalized = safeTrim(value).toLowerCase();
  if (normalized === "united_states") return "United States";
  return safeTrim(value);
}

function mapStateName(value) {
  const normalized = safeTrim(value).toUpperCase();
  const stateMap = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
    MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
    NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
    ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
    TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
    WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
  };
  return stateMap[normalized] || "";
}

function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, value]) => {
        if (value === null || value === undefined) return false;
        if (typeof value === "string" && value.trim() === "") return false;
        if (typeof value === "object" && !Array.isArray(value)) {
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
          "pt__first_name,pt__last_name,pt__address,pt__address_2,pt__alternative_phone_for_consumer,pt__city,pt__consumers_dob,pt__zip_code,pt__state,pt__primary_phone,pt__email,pt__country,pt__ethnicityrace,pt__gender,pt__pronouns,pt__client_identifies_as,alleva_patient_id,alleva_sync_status,alleva_last_sync_at,alleva_sync_error"
      }
    );

    const props = hsContact.data.properties || {};

    console.log("HubSpot raw properties:", JSON.stringify(props, null, 2));

    const allevaPayload = compact({
      name: {
        first: safeTrim(props.pt__first_name),
        last: safeTrim(props.pt__last_name)
      },
      dateOfBirth: formatHubSpotDate(props.pt__consumers_dob),
      email: safeTrim(props.pt__email),
      gender: mapGender(props.pt__gender),
      phone: {
        number: normalizePhone(
          props.pt__alternative_phone_for_consumer || props.pt__primary_phone
        )
      },
      address: {
        line1: safeTrim(props.pt__address),
        line2: safeTrim(props.pt__address_2),
        city: safeTrim(props.pt__city),
        state: mapStateName(props.pt__state),
        stateAbbr: safeTrim(props.pt__state).toUpperCase(),
        country: mapCountry(props.pt__country),
        zipCode: safeTrim(props.pt__zip_code)
      }
    });

    // Import endpoints often expect an array/bulk wrapper.
    // This is our best documented guess for a single-record import test.
    const importPayload = {
      prospects: [allevaPayload]
    };

    const allevaUrl = `/v${ALLEVA_API_VERSION}/prospects/import`;

    console.log("Testing HubSpot contact:", hubspotContactId);
    console.log("Alleva request method:", "POST");
    console.log("Alleva request URL:", allevaUrl);
    console.log("Alleva payload:", JSON.stringify(importPayload, null, 2));

    const allevaResponse = await allevaRequest("POST", allevaUrl, importPayload);

    console.log(
      "Alleva response:",
      JSON.stringify(allevaResponse.data, null, 2)
    );

    const allevaPatientId =
      allevaResponse.data?.patientId ||
      allevaResponse.data?.id ||
      allevaResponse.data?.result ||
      allevaResponse.data?.leadId ||
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
