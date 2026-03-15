require('dotenv').config();

const userService = require("./services/userService");

const createResponse = (statusCode, data) => {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*", // Enable CORS for browser access
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify(data),
  };
};

const parseBody = (body) => {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error("Invalid JSON body");
  }
};

const getPathParameter = (event, key) => (event && event.pathParameters ? event.pathParameters[key] : null);

const handleError = (err) => {
  console.error(err);
  if (err && err.code === "ER_DUP_ENTRY") return createResponse(409, { error: "Duplicate entry", message: err.message });
  return createResponse(500, { error: "Server error", message: err.message || String(err) });
};

exports.hello = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Go Serverless v4! Your function executed successfully!",
    }),
  };
};
