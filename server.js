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

async function allevaRequest(method, url, data = null, params = null) {
  let token = await getAllevaToken();

  try {
    return await axios({
      method,
      url: `${ALLEVA_API_BASE}${url}`,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
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
          "Content-Type": "application/json"
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
          "pt__first_name,pt__last_name,pt__address,pt__address_2,pt__alternative_phone_for_consumer,pt__city,pt__consumers_dob,pt__zip_code,pt__state,pt__primary_phone,pt__email,alleva_patient_id,alleva_sync_status,alleva_last_sync_at,alleva_sync_error"
      }
    );

    const props = hsContact.data.properties || {};

    console.log("HubSpot raw properties:", JSON.stringify(props, null, 2));

    const allevaPayload = compact({
      name: {
        first: safeTrim(props.pt__first_name),
        last: safeTrim(props.pt__last_name)
      },
      dateOfBirth: safeTrim(props.pt__consumers_dob),
      phone: {
        number: normalizePhone(
          props.pt__alternative_phone_for_consumer || props.pt__primary_phone
        )
      },
      email: safeTrim(props.pt__email),
      address: {
        line1: safeTrim(props.pt__address),
        line2: safeTrim(props.pt__address_2),
        city: safeTrim(props.pt__city),
        stateAbbr: safeTrim(props.pt__state),
        zipCode: safeTrim(props.pt__zip_code)
      }
    });

    const allevaMethod = props.alleva_patient_id ? "PATCH" : "POST";
    const allevaUrl = props.alleva_patient_id
      ? `/prospects/${props.alleva_patient_id}`
      : `/prospects`;

    console.log("Testing HubSpot contact:", hubspotContactId);
    console.log("Alleva request method:", allevaMethod);
    console.log("Alleva request URL:", allevaUrl);
    console.log("Alleva payload:", JSON.stringify(allevaPayload, null, 2));

    const allevaResponse = await allevaRequest(
      allevaMethod,
      allevaUrl,
      allevaPayload
    );

    const allevaPatientId =
      allevaResponse.data?.patientId ||
      allevaResponse.data?.id ||
      props.alleva_patient_id ||
      "";

    await hubspotRequest(
      "PATCH",
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      {
        properties: {
          alleva_patient_id: allevaPatientId,
          alleva_last_sync_at: new Date().toISOString(),
          alleva_sync_status: "success",
          alleva_sync_error: ""
        }
      }
    );

    return {
      ok: true,
      hubspotContactId,
      allevaPatientId
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
