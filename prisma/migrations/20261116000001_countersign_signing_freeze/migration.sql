-- D-35 (Phase 3): the signing record is tamper-evident in the database, as D-21 made the version itself.
--  * ProposalDocument: insert-only. `sha256` and `byteLength` must be those of `bytes` (computed here, not trusted).
--    A `proposal` document only for a draft version (it is stored just before the send), a `certificate` only for a
--    signed one; one of each per version (unique index).
--  * ProposalVersion: entering `sent` needs a stored proposal document whose sha256 is the version's pdfSha256, so a
--    recorded hash always names bytes we hold (CS-02).
--  * SigningLink: created only for a sent or viewed version; afterwards only `revokedAt` may be set, once.
--  * ProposalSignature: insert-only, only for a signed version, and only for the document that version recorded.
--  * Every child row's orgId must be its version's orgId.
--  * Escape hatch, as D-21: once the Org row is gone the cascade may remove everything; a missing parent version on
--    DELETE means the version itself is being deleted (only a draft can be).
-- Every refusal starts with "countersign_frozen:".

CREATE FUNCTION countersign_parent(version UUID) RETURNS "ProposalVersion" LANGUAGE sql STABLE AS $$
  SELECT * FROM "ProposalVersion" WHERE id = version
$$;

CREATE FUNCTION countersign_document_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v "ProposalVersion";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'countersign_frozen: a stored document never changes';
  END IF;
  IF TG_OP = 'DELETE' THEN
    v := countersign_parent(OLD."versionId");
    IF v.id IS NULL OR v.status = 'draft' OR countersign_org_gone(OLD."orgId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'countersign_frozen: version % is %, its stored documents are kept', OLD."versionId", v.status;
  END IF;
  v := countersign_parent(NEW."versionId");
  IF v.id IS NULL OR v."orgId" <> NEW."orgId" THEN
    RAISE EXCEPTION 'countersign_frozen: a document must belong to a version of the same org';
  END IF;
  IF NEW."byteLength" <> length(NEW.bytes) OR NEW.sha256 <> encode(sha256(NEW.bytes), 'hex') THEN
    RAISE EXCEPTION 'countersign_frozen: sha256 and byteLength must be those of the stored bytes';
  END IF;
  IF NEW.kind = 'proposal' AND v.status <> 'draft' THEN
    RAISE EXCEPTION 'countersign_frozen: version % is %, a proposal document is stored only before the send', v.id, v.status;
  END IF;
  IF NEW.kind = 'certificate' AND v.status <> 'signed' THEN
    RAISE EXCEPTION 'countersign_frozen: version % is %, a certificate is stored only for a signed version', v.id, v.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProposalDocument_freeze"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProposalDocument"
  FOR EACH ROW EXECUTE FUNCTION countersign_document_freeze();

CREATE FUNCTION countersign_sent_has_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'sent' AND NOT EXISTS (
    SELECT 1 FROM "ProposalDocument" d WHERE d."versionId" = NEW.id AND d.kind = 'proposal' AND d.sha256 = NEW."pdfSha256"
  ) THEN
    RAISE EXCEPTION 'countersign_frozen: version % cannot be sent: no stored proposal document has sha256 %', NEW.id, NEW."pdfSha256";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProposalVersion_sent_document"
  BEFORE UPDATE ON "ProposalVersion"
  FOR EACH ROW EXECUTE FUNCTION countersign_sent_has_document();

CREATE FUNCTION countersign_link_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v "ProposalVersion";
BEGIN
  IF TG_OP = 'DELETE' THEN
    v := countersign_parent(OLD."versionId");
    IF v.id IS NULL OR countersign_org_gone(OLD."orgId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'countersign_frozen: a signing link is revoked, never deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL
       AND (to_jsonb(NEW) - 'revokedAt') = (to_jsonb(OLD) - 'revokedAt') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'countersign_frozen: a signing link can only be revoked, once';
  END IF;
  v := countersign_parent(NEW."versionId");
  IF v.id IS NULL OR v."orgId" <> NEW."orgId" THEN
    RAISE EXCEPTION 'countersign_frozen: a signing link must belong to a version of the same org';
  END IF;
  IF v.status NOT IN ('sent', 'viewed') OR NEW."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'countersign_frozen: version % is %, a signing link is created only for a sent version', v.id, v.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SigningLink_freeze"
  BEFORE INSERT OR UPDATE OR DELETE ON "SigningLink"
  FOR EACH ROW EXECUTE FUNCTION countersign_link_freeze();

CREATE FUNCTION countersign_signature_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v "ProposalVersion";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'countersign_frozen: a signature never changes';
  END IF;
  IF TG_OP = 'DELETE' THEN
    v := countersign_parent(OLD."versionId");
    IF v.id IS NULL OR countersign_org_gone(OLD."orgId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'countersign_frozen: a signature is never deleted';
  END IF;
  v := countersign_parent(NEW."versionId");
  IF v.id IS NULL OR v."orgId" <> NEW."orgId" THEN
    RAISE EXCEPTION 'countersign_frozen: a signature must belong to a version of the same org';
  END IF;
  IF v.status <> 'signed' THEN
    RAISE EXCEPTION 'countersign_frozen: version % is %, a signature is stored only for a signed version', v.id, v.status;
  END IF;
  IF NEW."pdfSha256" IS DISTINCT FROM v."pdfSha256" THEN
    RAISE EXCEPTION 'countersign_frozen: a signature must name the document its version recorded';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProposalSignature_freeze"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProposalSignature"
  FOR EACH ROW EXECUTE FUNCTION countersign_signature_freeze();
