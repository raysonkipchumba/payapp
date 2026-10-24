import mongoose from "mongoose";

const paymentRequestSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    ownerUid: { type: String, required: true, index: true },
    description: { type: String, required: true, maxlength: 100 },
    amountCents: { type: Number, required: true, min: 1, max: 500000 },
    currency: { type: String, required: true, enum: ["USD"], default: "USD" },
    status: { type: String, required: true, enum: ["pending", "paid"], default: "pending", index: true },
    orderId: { type: String, default: null },
    checkoutLockUntil: { type: Date, default: null },
    captureId: { type: String, default: null },
    payerName: { type: String, default: null, maxlength: 100 }
  },
  { timestamps: true }
);

paymentRequestSchema.index({ ownerUid: 1, createdAt: -1 });

export const PaymentRequest = mongoose.model("PaymentRequest", paymentRequestSchema);
