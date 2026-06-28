import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const identityStatusEnum = pgEnum("identity_status", [
  "pending_identity_verification",
  "pluggy_widget_opened",
  "pending_multi_approval",
  "identity_mismatch",
  "identity_verified",
  "pending_reauth_full",
  "pending_sms_verification",
  "blocked_risk_flag",
  "blocked_possible_number_recycling",
]);

export const documentTypeEnum = pgEnum("document_type", ["CPF", "CNPJ"]);

export const identityVerificationsTable = pgTable("identity_verifications", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  phoneNumber: text("phone_number").notNull().unique(),
  status: identityStatusEnum("status").notNull().default("pending_identity_verification"),
  documentType: documentTypeEnum("document_type").notNull(),
  declaredDocument: text("declared_document").notNull(),
  pluggyItemId: text("pluggy_item_id"),
  pluggyClientUserId: text("pluggy_client_user_id"),
  verifiedAt: timestamp("verified_at"),
  lastSmsVerificationAt: timestamp("last_sms_verification_at"),
  lastBankReauthAt: timestamp("last_bank_reauth_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertIdentityVerificationSchema = createInsertSchema(identityVerificationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectIdentityVerificationSchema = createSelectSchema(identityVerificationsTable);

export type InsertIdentityVerification = z.infer<typeof insertIdentityVerificationSchema>;
export type IdentityVerification = typeof identityVerificationsTable.$inferSelect;
export type IdentityStatus = IdentityVerification["status"];
