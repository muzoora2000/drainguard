-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SUPERVISOR', 'TECHNICIAN', 'ENGINEER');

-- CreateEnum
CREATE TYPE "DrainStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('LITTER', 'WATER_UPSTREAM', 'WATER_DOWNSTREAM');

-- CreateEnum
CREATE TYPE "DeviceHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'FAULTY', 'OFFLINE');

-- CreateEnum
CREATE TYPE "ReadingQuality" AS ENUM ('OK', 'SUSPECT', 'FAULTY');

-- CreateEnum
CREATE TYPE "RainfallSource" AS ENUM ('SENSOR', 'MANUAL', 'WEATHER_API');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('BASKET_NEARLY_FULL', 'HIGH_WATER', 'POSSIBLE_BLOCKAGE', 'SYSTEM_HEALTH', 'ENGINEERING_REVIEW');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('PRIMARY', 'ESCALATION');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('LITTER_REMOVAL', 'BLOCKAGE_INSPECTION', 'ENGINEERING_INVESTIGATION', 'DEVICE_REPAIR');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sms_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "in_app_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "is_fallback_contact" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_token_hash" TEXT,
    "created_by_ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drains" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "zone" TEXT NOT NULL,
    "address" TEXT,
    "status" "DrainStatus" NOT NULL DEFAULT 'ACTIVE',
    "fallback_contact_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drain_thresholds" (
    "id" TEXT NOT NULL,
    "drain_id" TEXT NOT NULL,
    "basket_fill_percent" DOUBLE PRECISION NOT NULL DEFAULT 85,
    "water_rise_rate_cm_per_min" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "level_difference_cm" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "difference_persist_minutes" INTEGER NOT NULL DEFAULT 15,
    "intense_rainfall_mm_per_hour" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "rainfall_lookback_minutes" INTEGER NOT NULL DEFAULT 30,
    "heartbeat_timeout_minutes" INTEGER NOT NULL DEFAULT 10,
    "repeat_blockage_count" INTEGER NOT NULL DEFAULT 3,
    "repeat_blockage_window_days" INTEGER NOT NULL DEFAULT 30,
    "alert_cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
    "escalation_minutes" INTEGER NOT NULL DEFAULT 15,
    "rise_rate_window_minutes" INTEGER NOT NULL DEFAULT 10,
    "level_match_window_minutes" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drain_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "drain_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "type" "DeviceType" NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "api_key_prefix" TEXT NOT NULL,
    "health_status" "DeviceHealth" NOT NULL DEFAULT 'UNKNOWN',
    "health_reason" TEXT,
    "health_updated_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "last_reading_at" TIMESTAMPTZ(3),
    "battery_percent" DOUBLE PRECISION,
    "firmware_version" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_readings" (
    "id" BIGSERIAL NOT NULL,
    "device_id" TEXT NOT NULL,
    "drain_id" TEXT NOT NULL,
    "type" "DeviceType" NOT NULL,
    "litter_fill_percent" DOUBLE PRECISION,
    "water_level_cm" DOUBLE PRECISION,
    "quality" "ReadingQuality" NOT NULL DEFAULT 'OK',
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "external_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rainfall_readings" (
    "id" BIGSERIAL NOT NULL,
    "zone" TEXT NOT NULL,
    "mm_per_hour" DOUBLE PRECISION NOT NULL,
    "source" "RainfallSource" NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "external_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rainfall_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "drain_id" TEXT NOT NULL,
    "device_id" TEXT,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "rule" TEXT NOT NULL,
    "trigger_data" JSONB NOT NULL,
    "message" TEXT,
    "active_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_id" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" TEXT,
    "resolution_note" TEXT,
    "last_notified_at" TIMESTAMPTZ(3),
    "escalation_due_at" TIMESTAMPTZ(3),
    "escalated_at" TIMESTAMPTZ(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "user_id" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "kind" "NotificationKind" NOT NULL DEFAULT 'PRIMARY',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT NOT NULL,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "provider_response" JSONB,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "next_retry_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_tasks" (
    "id" TEXT NOT NULL,
    "drain_id" TEXT NOT NULL,
    "alert_id" TEXT,
    "type" "TaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "assigned_to_id" TEXT,
    "created_by_id" TEXT,
    "scheduled_for" TIMESTAMPTZ(3),
    "due_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maintenance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "drain_id" TEXT NOT NULL,
    "performed_by_id" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "actions_taken" TEXT,
    "photos" JSONB,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drain_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "drain_id" TEXT,
    "zone" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drain_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" TEXT,
    "actor_role" "Role",
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_active_idx" ON "users"("role", "active");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "drains_zone_status_idx" ON "drains"("zone", "status");

-- CreateIndex
CREATE INDEX "drains_status_idx" ON "drains"("status");

-- CreateIndex
CREATE INDEX "drains_latitude_longitude_idx" ON "drains"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "drain_thresholds_drain_id_key" ON "drain_thresholds"("drain_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_serial_number_key" ON "devices"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "devices_api_key_hash_key" ON "devices"("api_key_hash");

-- CreateIndex
CREATE INDEX "devices_drain_id_type_idx" ON "devices"("drain_id", "type");

-- CreateIndex
CREATE INDEX "devices_health_status_last_seen_at_idx" ON "devices"("health_status", "last_seen_at");

-- CreateIndex
CREATE INDEX "devices_last_seen_at_idx" ON "devices"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "devices_drain_id_type_key" ON "devices"("drain_id", "type");

-- CreateIndex
CREATE INDEX "sensor_readings_drain_id_recorded_at_idx" ON "sensor_readings"("drain_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "sensor_readings_device_id_recorded_at_idx" ON "sensor_readings"("device_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "sensor_readings_drain_id_type_recorded_at_idx" ON "sensor_readings"("drain_id", "type", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "sensor_readings_recorded_at_idx" ON "sensor_readings"("recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sensor_readings_device_id_recorded_at_key" ON "sensor_readings"("device_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_readings_device_id_external_id_key" ON "sensor_readings"("device_id", "external_id");

-- CreateIndex
CREATE INDEX "rainfall_readings_zone_recorded_at_idx" ON "rainfall_readings"("zone", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "rainfall_readings_recorded_at_idx" ON "rainfall_readings"("recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "rainfall_readings_zone_external_id_key" ON "rainfall_readings"("zone", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_active_key_key" ON "alerts"("active_key");

-- CreateIndex
CREATE INDEX "alerts_drain_id_created_at_idx" ON "alerts"("drain_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_status_severity_created_at_idx" ON "alerts"("status", "severity", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_type_status_idx" ON "alerts"("type", "status");

-- CreateIndex
CREATE INDEX "alerts_drain_id_type_created_at_idx" ON "alerts"("drain_id", "type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_status_escalation_due_at_idx" ON "alerts"("status", "escalation_due_at");

-- CreateIndex
CREATE INDEX "notifications_alert_id_created_at_idx" ON "notifications"("alert_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_next_retry_at_idx" ON "notifications"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "maintenance_tasks_status_priority_scheduled_for_idx" ON "maintenance_tasks"("status", "priority", "scheduled_for");

-- CreateIndex
CREATE INDEX "maintenance_tasks_assigned_to_id_status_idx" ON "maintenance_tasks"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_tasks_drain_id_status_created_at_idx" ON "maintenance_tasks"("drain_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "maintenance_tasks_alert_id_idx" ON "maintenance_tasks"("alert_id");

-- CreateIndex
CREATE INDEX "maintenance_records_drain_id_completed_at_idx" ON "maintenance_records"("drain_id", "completed_at" DESC);

-- CreateIndex
CREATE INDEX "maintenance_records_task_id_idx" ON "maintenance_records"("task_id");

-- CreateIndex
CREATE INDEX "maintenance_records_performed_by_id_idx" ON "maintenance_records"("performed_by_id");

-- CreateIndex
CREATE INDEX "drain_assignments_drain_id_idx" ON "drain_assignments"("drain_id");

-- CreateIndex
CREATE INDEX "drain_assignments_zone_idx" ON "drain_assignments"("zone");

-- CreateIndex
CREATE INDEX "drain_assignments_user_id_idx" ON "drain_assignments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drain_assignments_user_id_drain_id_key" ON "drain_assignments"("user_id", "drain_id");

-- CreateIndex
CREATE UNIQUE INDEX "drain_assignments_user_id_zone_key" ON "drain_assignments"("user_id", "zone");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drains" ADD CONSTRAINT "drains_fallback_contact_id_fkey" FOREIGN KEY ("fallback_contact_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drain_thresholds" ADD CONSTRAINT "drain_thresholds_drain_id_fkey" FOREIGN KEY ("drain_id") REFERENCES "drains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_drain_id_fkey" FOREIGN KEY ("drain_id") REFERENCES "drains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_drain_id_fkey" FOREIGN KEY ("drain_id") REFERENCES "drains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_drain_id_fkey" FOREIGN KEY ("drain_id") REFERENCES "drains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_drain_id_fkey" FOREIGN KEY ("drain_id") REFERENCES "drains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "maintenance_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_drain_id_fkey" FOREIGN KEY ("drain_id") REFERENCES "drains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drain_assignments" ADD CONSTRAINT "drain_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drain_assignments" ADD CONSTRAINT "drain_assignments_drain_id_fkey" FOREIGN KEY ("drain_id") REFERENCES "drains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
