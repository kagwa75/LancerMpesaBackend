import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { supabase } from "./Client.js";
import { updateProject } from "./supabase.js";

dotenv.config();

const router = express.Router();

// ==================== RATE LIMITING ====================
// M-Pesa allows 5 requests per 60 seconds - we use 4 to be safe
const mpesaQueryLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 4, // 4 requests per minute
  message: {
    status: "error",
    message: "Too many requests. Please wait before trying again.",
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || "anonymous";
  },
});

const mpesaStkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: {
    status: "error",
    message: "Too many payment requests. Please wait.",
  },
});

// ==================== ACCESS TOKEN CACHE ====================
const ACCESS_TOKEN_BUFFER_MS = 60 * 1000; // refresh 1 minute early
const accessTokenCache = {
  token: null,
  expiresAt: 0,
  inFlight: null,
};

// ==================== M-PESA CONFIGURATION ====================
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  shortCode: process.env.MPESA_SHORTCODE,
  passKey: process.env.MPESA_PASSKEY,
  initiatorName: process.env.MPESA_INITIATOR_NAME,
  securityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
  environment: process.env.MPESA_ENVIRONMENT || "sandbox",
};

const BASE_URL =
  MPESA_CONFIG.environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

const CALLBACK_BASE_URL =
  process.env.CALLBACK_BASE_URL || "https://yourdomain.com/mpesa";

// ==================== UTILITY FUNCTIONS ====================

/**
 * Generate M-Pesa Access Token with caching
 */
const generateAccessToken = async () => {
  const now = Date.now();
  
  // Return cached token if still valid
  if (accessTokenCache.token && accessTokenCache.expiresAt > now) {
    console.log("✅ Using cached access token");
    return accessTokenCache.token;
  }

  // Wait for in-flight request if one exists
  if (accessTokenCache.inFlight) {
    console.log("⏳ Waiting for in-flight token request");
    return accessTokenCache.inFlight;
  }

  // Generate new token
  accessTokenCache.inFlight = (async () => {
    try {
      console.log("🔄 Generating new access token...");
      const auth = Buffer.from(
        `${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`
      ).toString("base64");

      const response = await axios.get(
        `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
          },
          timeout: 10000,
        }
      );

      const { access_token, expires_in } = response.data || {};
      if (!access_token) {
        throw new Error("Access token missing in response");
      }

      const ttlMs = (Number(expires_in) || 3599) * 1000;
      accessTokenCache.token = access_token;
      accessTokenCache.expiresAt = Date.now() + ttlMs - ACCESS_TOKEN_BUFFER_MS;

      console.log(`✅ Token cached, expires in ${Math.round(ttlMs / 1000)}s`);
      return access_token;
    } catch (error) {
      accessTokenCache.token = null;
      accessTokenCache.expiresAt = 0;
      console.error("❌ Access Token Error:", error.response?.data || error.message);
      throw new Error("Failed to generate access token");
    } finally {
      accessTokenCache.inFlight = null;
    }
  })();

  return accessTokenCache.inFlight;
};
/**
 * Generate Password for STK Push
 */
const generatePassword = () => {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  const password = Buffer.from(
    `${MPESA_CONFIG.shortCode}${MPESA_CONFIG.passKey}${timestamp}`
  ).toString("base64");
  return { password, timestamp };
};

/**
 * Format phone number to M-Pesa format (254XXXXXXXXX)
 */
const formatPhoneNumber = (phone) => {
  // Remove any spaces, dashes, or plus signs
  let cleaned = phone.replace(/[\s\-+]/g, "");

  // If starts with 0, replace with 254
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }

  // If doesn't start with 254, add it
  if (!cleaned.startsWith("254")) {
    cleaned = "254" + cleaned;
  }

  return cleaned;
};

// ==================== CLIENT PAYMENT ROUTES (STK PUSH) ====================

/**
 * @route   POST /mpesa/stk-push
 * @desc    Initiate STK Push to client's phone for payment
 * @access  Public
 */
router.post("/stk-push", mpesaStkLimiter, async (req, res) => {
  try {
    const { phoneNumber, amount, accountReference, transactionDesc } = req.body;

    // Validation
    if (!phoneNumber || !amount) {
      return res.status(400).json({
        status: "error",
        message: "Phone number and amount are required",
      });
    }

    if (amount < 1) {
      return res.status(400).json({
        status: "error",
        message: "Amount must be at least 1 KES",
      });
    }

    // Get access token
    const accessToken = await generateAccessToken();
    console.log("Token :", accessToken);

    // Generate password and timestamp
    const { password, timestamp } = generatePassword();
console.log("password & timestamp:", password,timestamp);
    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);

    // STK Push payload
    const stkPushPayload = {
      BusinessShortCode: MPESA_CONFIG.shortCode,
      Password: "MTc0Mzc5YmZiMjc5ZjlhYTliZGJjZjE1OGU5N2RkNzFhNDY3Y2QyZTBjODkzMDU5YjEwZjc4ZTZiNzJhZGExZWQyYzkxOTIwMjEwNjI4MDkyNDA4",
      Timestamp: "20210628092408",
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(amount), // M-Pesa doesn't accept decimals
      PartyA: formattedPhone,
      PartyB: MPESA_CONFIG.shortCode,
      PhoneNumber: formattedPhone,
      CallBackURL: `${CALLBACK_BASE_URL}/callback/stk-push`,
      AccountReference: accountReference || "Payment",
      TransactionDesc: transactionDesc || "Payment for services",
    };
console.log("payload:", stkPushPayload);
    // Make STK Push request
    const response = await axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      stkPushPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({
      status: "success",
      message: "STK Push initiated successfully",
      data: {
        merchantRequestID: response.data.MerchantRequestID,
        checkoutRequestID: response.data.CheckoutRequestID,
        responseCode: response.data.ResponseCode,
        responseDescription: response.data.ResponseDescription,
        customerMessage: response.data.CustomerMessage,
      },
    });
  } catch (error) {
    console.error("STK Push Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "error",
      message: "Failed to initiate STK Push",
      error: error.response?.data || error.message,
    });
  }
});

/**
 * @route   POST /mpesa/callback/stk-push
 * @desc    Callback for STK Push payment confirmation
 * @access  Public (M-Pesa callback)
 */
router.post("/callback/stk-push", async (req, res) => {
  try {
    console.log("STK Push Callback Received:", JSON.stringify(req.body, null, 2));

    const { Body } = req.body;
    const { stkCallback } = Body;

    // Extract callback data
    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata,
    } = stkCallback;

    if (ResultCode === 0) {
      // Payment successful
      const metadata = {};
      CallbackMetadata?.Item?.forEach((item) => {
        metadata[item.Name] = item.Value;
      });

      console.log("Payment Successful:", {
        merchantRequestID: MerchantRequestID,
        checkoutRequestID: CheckoutRequestID,
        amount: metadata.Amount,
        mpesaReceiptNumber: metadata.MpesaReceiptNumber,
        phoneNumber: metadata.PhoneNumber,
        transactionDate: metadata.TransactionDate,
      });

      // TODO: Update your database with payment confirmation
      // Example: await updatePaymentStatus(CheckoutRequestID, 'completed', metadata);
    } else {
      // Payment failed
      console.log("Payment Failed:", {
        merchantRequestID: MerchantRequestID,
        checkoutRequestID: CheckoutRequestID,
        resultCode: ResultCode,
        resultDesc: ResultDesc,
      });

      // TODO: Update your database with payment failure
      // Example: await updatePaymentStatus(CheckoutRequestID, 'failed', { ResultDesc });
    }

    // Always respond to M-Pesa with success
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  } catch (error) {
    console.error("STK Callback Error:", error);
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  }
});

/**
 * @route   POST /mpesa/query-stk
 * @desc    Query the status of an STK Push transaction
 * @access  Public
 */
router.post("/query-stk",mpesaQueryLimiter, async (req, res) => {
  try {
    const { checkoutRequestID } = req.body;

    if (!checkoutRequestID) {
      return res.status(400).json({
        status: "error",
        message: "CheckoutRequestID is required",
      });
    }

    const accessToken = await generateAccessToken();
    const { password, timestamp } = generatePassword();

    const queryPayload = {
      BusinessShortCode: MPESA_CONFIG.shortCode,
      Password: "MTc0Mzc5YmZiMjc5ZjlhYTliZGJjZjE1OGU5N2RkNzFhNDY3Y2QyZTBjODkzMDU5YjEwZjc4ZTZiNzJhZGExZWQyYzkxOTIwMjEwNjI4MDkyNDA4",
      Timestamp: "20210628092408",
      CheckoutRequestID: checkoutRequestID,
    };

    const response = await axios.post(
      `${BASE_URL}/mpesa/stkpushquery/v1/query`,
      queryPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({
      status: "success",
      data: response.data,
    });
  } catch (error) {
    console.error("Query STK Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "error",
      message: "Failed to query transaction",
      error: error.response?.data || error.message,
    });
  }
});

// ==================== FREELANCER PAYOUT ROUTES (B2C) ====================

/**
 * @route   POST /mpesa/b2c-payment
 * @desc    Send payment to freelancer via B2C
 * @access  Public
 */
router.post("/b2c-payment", async (req, res) => {
  try {
    const { phoneNumber,transaction,finalProjectId, amount, remarks, occasion } = req.body;

    // Validation
    if (!phoneNumber || !amount) {
      return res.status(400).json({
        status: "error",
        message: "Phone number and amount are required",
      });
    }

    if (amount < 10) {
      return res.status(400).json({
        status: "error",
        message: "Minimum B2C amount is 10 KES",
      });
    }

    // Get access token
    const accessToken = await generateAccessToken();

    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);

    // B2C payload
    const b2cPayload = {
       OriginatorConversationID: "600997_Test_32et3241ed8yu", 
      InitiatorName: MPESA_CONFIG.initiatorName,
      SecurityCredential: MPESA_CONFIG.securityCredential,
      CommandID: "BusinessPayment", // or "SalaryPayment" or "PromotionPayment"
      Amount: Math.round(amount),
      PartyA: MPESA_CONFIG.shortCode,
      PartyB: formattedPhone,
      Remarks: remarks || "Payment to freelancer",
      QueueTimeOutURL: `${CALLBACK_BASE_URL}/callback/b2c-timeout`,
      ResultURL: `${CALLBACK_BASE_URL}/callback/b2c-result`,
      Occasion: occasion || "Freelancer Payment",
    };

    // Make B2C request
    const response = await axios.post(
      `${BASE_URL}/mpesa/b2c/v3/paymentrequest`,
      b2cPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
 // 3. Update transaction
      await supabase
        .from("transactions")
        .update({
          status: "released",
          mpesa_conversation_id: response.data.conversationID,
        })
        .eq("id", transaction.id);

        //update projects
        if (finalProjectId) {
              const { data: projectData, error: projectError } = await updateProject(finalProjectId);
              
              if (projectError) {
                console.error("Project update failed:", projectError);
               
              } else {
                console.log("Project status updated to completed:", projectData);
              }
            }

    res.status(200).json({
      status: "success",
      message: "B2C payment initiated successfully",
      data: {
        conversationID: response.data.ConversationID,
        originatorConversationID: response.data.OriginatorConversationID,
        responseCode: response.data.ResponseCode,
        responseDescription: response.data.ResponseDescription,
      },
    });
  } catch (error) {
    console.error("B2C Payment Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "error",
      message: "Failed to initiate B2C payment",
      error: error.response?.data || error.message,
    });
  }
});

/**
 * @route   POST /mpesa/callback/b2c-result
 * @desc    Callback for B2C payment result
 * @access  Public (M-Pesa callback)
 */

router.post("/callback/b2c-result", async (req, res) => {
  try {
    console.log("B2C Result Callback:", JSON.stringify(req.body, null, 2));

    const { Result } = req.body;
    const { ResultCode, ResultDesc, ResultParameters, ConversationID } = Result;

    if (ResultCode === 0) {
      // Payment successful - update database
      const parameters = {};
      Result.ResultParameters?.ResultParameter?.forEach((param) => {
        parameters[param.Key] = param.Value;
      });

      console.log("B2C Payment Successful:", {
        conversationID: ConversationID,
        transactionID: parameters.TransactionID,
        amount: parameters.TransactionAmount,
        recipientPhone: parameters.ReceiverPartyPublicName,
      });

      // TODO: Update your database
      await supabase
        .from('transactions')
        .update({
          status: 'released',
          mpesa_transaction_id: parameters.TransactionID,
          b2c_result_code: '0',
          b2c_result_description: ResultDesc,
          released_at: new Date().toISOString(),
        })
        .eq('mpesa_conversation_id', ConversationID);

      // TODO: Update project status
      // TODO: Notify freelancer

    } else {
      // Payment failed
      console.log("B2C Payment Failed:", {
        conversationID: ConversationID,
        resultCode: ResultCode,
        resultDesc: ResultDesc,
      });

      // TODO: Update database with failure
      await supabase
        .from('transactions')
        .update({
          status: 'failed',
          b2c_result_code: ResultCode,
          b2c_result_description: ResultDesc,
        })
        .eq('mpesa_conversation_id', ConversationID);
    }

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  } catch (error) {
    console.error("B2C Result Callback Error:", error);
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  }
});

/**
 * @route   POST /mpesa/callback/b2c-timeout
 * @desc    Callback for B2C timeout
 * @access  Public (M-Pesa callback)
 */
router.post("/callback/b2c-timeout", async (req, res) => {
  try {
    console.log("B2C Timeout Callback:", JSON.stringify(req.body, null, 2));

    // TODO: Handle timeout - maybe retry or mark as failed
    // Example: await updatePayoutStatus(req.body.ConversationID, 'timeout');

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  } catch (error) {
    console.error("B2C Timeout Callback Error:", error);
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  }
});

// ==================== UTILITY ROUTES ====================

/**
 * @route   GET /mpesa/health
 * @desc    Health check for M-Pesa service
 * @access  Public
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "M-Pesa service is running",
    environment: MPESA_CONFIG.environment,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @route   POST /mpesa/validate-phone
 * @desc    Validate and format phone number
 * @access  Public
 */
router.post("/validate-phone", (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        status: "error",
        message: "Phone number is required",
      });
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);

    // Basic validation - Kenyan numbers should be 12 digits (254XXXXXXXXX)
    if (formattedPhone.length !== 12 || !formattedPhone.startsWith("254")) {
      return res.status(400).json({
        status: "error",
        message: "Invalid Kenyan phone number",
      });
    }

    res.status(200).json({
      status: "success",
      data: {
        original: phoneNumber,
        formatted: formattedPhone,
        isValid: true,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Phone validation failed",
      error: error.message,
    });
  }
});
/**
 * @route   GET /mpesa/debug-config
 * @desc    Debug endpoint to check configuration (DO NOT USE IN PRODUCTION)
 * @access  Public
 */
router.get("/debug-config", (req, res) => {
  try {
    const config = {
      hasConsumerKey: !!MPESA_CONFIG.consumerKey,
      hasConsumerSecret: !!MPESA_CONFIG.consumerSecret,
      hasShortCode: !!MPESA_CONFIG.shortCode,
      hasPassKey: !!MPESA_CONFIG.passKey,
      environment: MPESA_CONFIG.environment,
      consumerKeyPreview: MPESA_CONFIG.consumerKey 
        ? MPESA_CONFIG.consumerKey.substring(0, 10) + "..." 
        : "NOT SET",
      consumerSecretPreview: MPESA_CONFIG.consumerSecret
        ? MPESA_CONFIG.consumerSecret.substring(0, 10) + "..."
        : "NOT SET",
      shortCode: MPESA_CONFIG.shortCode || "NOT SET",
      baseUrl: BASE_URL,
    };

    const issues = [];
    
    if (!MPESA_CONFIG.consumerKey || MPESA_CONFIG.consumerKey.includes("your_")) {
      issues.push("Consumer Key is not set or is a placeholder");
    }
    if (!MPESA_CONFIG.consumerSecret || MPESA_CONFIG.consumerSecret.includes("your_")) {
      issues.push("Consumer Secret is not set or is a placeholder");
    }
    if (!MPESA_CONFIG.shortCode || MPESA_CONFIG.shortCode.includes("your_")) {
      issues.push("Shortcode is not set or is a placeholder");
    }
    if (!MPESA_CONFIG.passKey || MPESA_CONFIG.passKey.includes("your_")) {
      issues.push("Passkey is not set or is a placeholder");
    }

    res.status(200).json({
      status: issues.length === 0 ? "success" : "warning",
      message: issues.length === 0 
        ? "Configuration looks good" 
        : "Configuration issues found",
      config,
      issues,
      nextSteps: issues.length > 0 
        ? [
            "1. Check your .env file",
            "2. Make sure you've copied actual credentials from Daraja portal",
            "3. Restart your server after updating .env",
            "4. Run: node verify-credentials.js"
          ]
        : [
            "1. Run: node verify-credentials.js to test token generation",
            "2. Test STK Push with the test script",
          ]
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Debug failed",
      error: error.message,
    });
  }
});

/**
 * @route   GET /mpesa/test-token
 * @desc    Test access token generation
 * @access  Public
 */
router.get("/test-token", async (req, res) => {
  try {
    const accessToken = await generateAccessToken();
    
    res.status(200).json({
      status: "success",
      message: "Access token generated successfully",
      tokenPreview: accessToken.substring(0, 20) + "...",
      tokenLength: accessToken.length,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to generate access token",
      error: error.message,
      possibleCauses: [
        "Consumer Key is incorrect",
        "Consumer Secret is incorrect",
        "Using wrong environment credentials (sandbox vs production)",
        "Credentials have extra spaces",
      ],
      howToFix: [
        "1. Go to https://developer.safaricom.co.ke/",
        "2. Login and select your app",
        "3. Copy Consumer Key and Consumer Secret exactly",
        "4. Update .env file (remove any spaces)",
        "5. Restart your server",
      ]
    });
  }
});

export default router;
