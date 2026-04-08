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

    const hsContact = await hubspotRequest(
      "GET",
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      null,
      {
        properties: [
          "firstname",
          "lastname",
          "email",
          "phone",
          "date_of_birth",
          "alleva_patient_id"
        ]
      }
    );

    const props = hsContact.data.properties;

    const allevaPayload = {
  name: {
    first: props.firstname || "",
    last: props.lastname || ""
  },
  email: props.email || "",
  phone: {
    mobile: props.phone || ""
  },
  dateOfBirth: props.date_of_birth || null
};

    let allevaResponse;

    if (props.alleva_patient_id) {
  allevaResponse = await allevaRequest(
    "PATCH",
    `/prospects/${props.alleva_patient_id}`,
    allevaPayload
  );
} else {
  allevaResponse = await allevaRequest(
    "POST",
    `/prospects`,
    allevaPayload
  );
    }

    const allevaPatientId =
      allevaResponse.data.patientId ||
      allevaResponse.data.id ||
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

    res.json({
      ok: true,
      allevaPatientId
    });
  } catch (error) {
    const errText = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;

    if (req.body.hubspotContactId) {
      try {
        await hubspotRequest(
          "PATCH",
          `/crm/v3/objects/contacts/${req.body.hubspotContactId}`,
          {
            properties: {
              alleva_last_sync_at: new Date().toISOString(),
              alleva_sync_status: "failed",
              alleva_sync_error: errText.slice(0, 65000)
            }
          }
        );
      } catch (patchError) {
        console.error("Could not update HubSpot error fields:", patchError.message);
      }
    }

    res.status(500).json({
      ok: false,
      error: errText
    });
  }
});

app.listen(PORT, () => {
  console.log(`Middleware running on port ${PORT}`);
});
