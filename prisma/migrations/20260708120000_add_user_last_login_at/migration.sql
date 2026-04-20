ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_id_agency_last_login_at_idx"
ON "User" ("id_agency", "last_login_at");
