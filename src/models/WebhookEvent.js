const mongoose = require("mongoose");
const crypto = require("crypto");

const webhookEventSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      index: true,
    },
    source: {
      type: String,
      enum: ["github", "sonarqube"],
      required: true,
      index: true,
    },
    eventType: { type: String, default: null, index: true },
    deliveryId: { type: String, default: null, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    processed: { type: Boolean, default: false },
    processingError: { type: String, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);
