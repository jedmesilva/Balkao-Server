CREATE TYPE "public"."document_type" AS ENUM('CPF', 'CNPJ');--> statement-breakpoint
CREATE TYPE "public"."identity_status" AS ENUM('pending_identity_verification', 'pluggy_widget_opened', 'pending_multi_approval', 'identity_mismatch', 'identity_verified', 'pending_reauth_full', 'pending_sms_verification', 'blocked_risk_flag', 'blocked_possible_number_recycling');--> statement-breakpoint
CREATE TABLE "identity_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"status" "identity_status" DEFAULT 'pending_identity_verification' NOT NULL,
	"document_type" "document_type" NOT NULL,
	"declared_document" text NOT NULL,
	"pluggy_item_id" text,
	"pluggy_client_user_id" text,
	"verified_at" timestamp,
	"last_sms_verification_at" timestamp,
	"last_bank_reauth_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "identity_verifications_phone_number_unique" UNIQUE("phone_number")
);
