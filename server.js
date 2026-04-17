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

async function syncHubSpotContact(hubspotContactId) {
  try {
    const hsContact = await hubspotRequest(
      "GET",
      `/crm/v3/objects/contacts/${hubspotContactId}`,
      null,
      {
        properties: [
  "firstname",
  "lastname",
  "pt__alternative_phone_for_consumer",
  "pt__consumers_dob",
  "alleva_patient_id",
  "alleva_sync_status",
  "alleva_last_sync_at",
  "alleva_sync_error"
]
      }
    );

    const props = hsContact.data.properties || {};

console.log("HubSpot raw properties:", JSON.stringify(hsContact.data.properties, null, 2));
console.log("HubSpot alt phone:", props.pt__alternative_phone_for_consumer);
console.log("HubSpot DOB:", props.pt__consumers_dob);

const allevaPayload = {
  firstName: props.firstname?.trim() || "",
  lastName: props.lastname?.trim() || "",
  ...(props.pt__alternative_phone_for_consumer?.trim()
    ? { phone: props.pt__alternative_phone_for_consumer.trim() }
    : {}),
  ...(props.pt__consumers_dob ? { dateOfBirth: props.pt__consumers_dob } : {})
};

console.log("Testing HubSpot contact:", hubspotContactId);
console.log("Alleva payload:", JSON.stringify(allevaPayload, null, 2));

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
  JSON.stringify(error.response?.data, null, 2)
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
            propertyName: "firstname",
            operator: "HAS_PROPERTY"
          },
          {
            propertyName: "lastname",
            operator: "HAS_PROPERTY"
          }
        ]
      }
    ],
    properties: [
  "firstname",
  "lastname",
  "pt__alternative_phone_for_consumer",
  "pt__consumers_dob",
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

  return hubspotRequest(
    "POST",
    "/crm/v3/objects/contacts/search",
    body
  );
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