-- Countersign D-66: per-org branding for client pages (accent colour and logo). Hand-written (D-27: CI diffs it
-- against prisma/schema).

-- CreateTable
CREATE TABLE "OrgBrand" (
    "orgId" UUID NOT NULL,
    "accentHex" TEXT,
    "logoType" TEXT,
    "logoBytes" BYTEA,
    "logoSha256" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OrgBrand_pkey" PRIMARY KEY ("orgId")
);

-- AddForeignKey
ALTER TABLE "OrgBrand" ADD CONSTRAINT "OrgBrand_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The shape the app writes, held by the database too.
ALTER TABLE "OrgBrand" ADD CONSTRAINT "OrgBrand_accentHex_check" CHECK ("accentHex" IS NULL OR "accentHex" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "OrgBrand" ADD CONSTRAINT "OrgBrand_logo_check" CHECK (
  ("logoBytes" IS NULL AND "logoType" IS NULL AND "logoSha256" IS NULL)
  OR ("logoBytes" IS NOT NULL AND "logoType" IN ('image/png', 'image/jpeg') AND octet_length("logoBytes") <= 102400 AND "logoSha256" ~ '^[0-9a-f]{64}$')
);
