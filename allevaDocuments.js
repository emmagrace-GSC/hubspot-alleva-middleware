const axios = require("axios");

function normalizeTypeId(typeId) {
  const parsed = Number.parseInt(typeId, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error("ALLEVA_DOCUMENT_TYPE_ID must be an integer");
  }

  return parsed;
}

async function postMultipartDocument({
  allevaApiBase,
  token,
  leadId,
  typeId,
  pdfBuffer,
  filename,
  apiVersion = "1.0"
}) {
  const normalizedTypeId = normalizeTypeId(typeId);
  const payload = {
    name: filename,
    description: "HubSpot/Formstack submission summary PDF",
    typeId: normalizedTypeId,
    uploadedDocuments: [
      {
        name: filename,
        base64String: pdfBuffer.toString("base64")
      }
    ]
  };

  return axios({
    method: "POST",
    url: `${allevaApiBase}/clients/${encodeURIComponent(String(leadId))}/documents`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: `text/json; ver=${apiVersion}`,
      "X-Version": apiVersion,
      "Content-Type": `application/json; ver=${apiVersion}`
    },
    data: payload,
    params: {
      "api-version": apiVersion
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true
  });
}

async function getAllevaDocument({
  allevaApiBase,
  token,
  documentId,
  apiVersion = "1.0"
}) {
  return axios({
    method: "GET",
    url: `${allevaApiBase}/documents/${encodeURIComponent(String(documentId))}`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: `text/json; ver=${apiVersion}`,
      "X-Version": apiVersion
    },
    params: {
      "api-version": apiVersion
    },
    validateStatus: () => true
  });
}

async function uploadAllevaDocument({
  allevaApiBase,
  getAccessToken,
  leadId,
  typeId,
  pdfBuffer,
  filename = "hubspot-formstack-summary.pdf",
  apiVersion = "1.0"
}) {
  if (!leadId) {
    throw new Error("Cannot upload Alleva document without a leadId");
  }

  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error("Cannot upload Alleva document without PDF content");
  }

  let token = await getAccessToken();
  let response = await postMultipartDocument({
    allevaApiBase,
    token,
    leadId,
    typeId,
    pdfBuffer,
    filename,
    apiVersion
  });

  if (response.status === 401) {
    token = await getAccessToken(true);
    response = await postMultipartDocument({
      allevaApiBase,
      token,
      leadId,
      typeId,
      pdfBuffer,
      filename,
      apiVersion
    });
  }

  if (response.status < 200 || response.status >= 300) {
    const responseText =
      typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    throw new Error(`Alleva document upload failed with ${response.status}: ${responseText}`);
  }

  const createdDocumentId = Array.isArray(response.data)
    ? response.data[0]?.id
    : response.data?.id;
  let verification = null;

  if (createdDocumentId) {
    const documentResponse = await getAllevaDocument({
      allevaApiBase,
      token,
      documentId: createdDocumentId,
      apiVersion
    });

    verification = {
      status: documentResponse.status,
      data: documentResponse.data
    };
  }

  return {
    status: response.status,
    data: response.data,
    createdDocumentId,
    verification,
    manualVerificationRequired: true
  };
}

async function getAllevaDocumentTypes({ allevaApiBase, getAccessToken, apiVersion = "1.0" }) {
  let token = await getAccessToken();

  const request = async (accessToken) =>
    axios({
      method: "GET",
      url: `${allevaApiBase}/documents/type`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: `text/json; ver=${apiVersion}`,
        "X-Version": apiVersion
      },
      params: {
        "api-version": apiVersion
      }
    });

  try {
    return await request(token);
  } catch (error) {
    if (error.response?.status === 401) {
      token = await getAccessToken(true);
      return request(token);
    }

    throw error;
  }
}

module.exports = {
  getAllevaDocumentTypes,
  uploadAllevaDocument
};
