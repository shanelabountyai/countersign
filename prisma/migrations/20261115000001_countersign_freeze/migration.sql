-- D-21 (review of PR #1): a version that has left `draft` is frozen in the database, not only in app code.
--  * ProposalVersion: inserted only as `draft`; id/orgId/proposalId/number never change; out of `draft`, only
--    `status` and `statusAt` may change, and only along the Phase 1 table (versioning.ts); entering `sent` needs a
--    64-char lower-case hex pdfSha256 (D-14/D-15 canonical form); `signed` and `superseded` accept no update at all;
--    only a `draft` can be deleted.
--  * ProposalSection / ProposalLine: rows of a non-draft version cannot be inserted, updated or deleted.
--  * Escape hatch: org deletion. Once the Org row is gone the cascade may remove everything (INV tenancy/delete.ts).
-- TRUNCATE is left alone (row triggers do not fire on it), as for AuditEvent, so tests can still empty the tables.
-- Every refusal starts with "countersign_frozen:" so the app can tell it apart.

CREATE FUNCTION countersign_org_gone(org UUID) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM "Org" WHERE id = org)
$$;

CREATE FUNCTION countersign_version_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'countersign_frozen: a version is created as draft, not %', NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' OR countersign_org_gone(OLD."orgId") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'countersign_frozen: version % is %, only a draft can be deleted', OLD.id, OLD.status;
  END IF;

  -- UPDATE
  IF NEW.id <> OLD.id OR NEW."orgId" <> OLD."orgId" OR NEW."proposalId" <> OLD."proposalId" OR NEW.number <> OLD.number THEN
    RAISE EXCEPTION 'countersign_frozen: a version''s identity (id, orgId, proposalId, number) never changes';
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status = 'draft' THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'sent' THEN
      IF NEW."pdfSha256" IS NULL OR NEW."pdfSha256" !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'countersign_frozen: version % cannot be sent without a canonical pdfSha256', OLD.id;
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'countersign_frozen: draft -> % is not a transition', NEW.status;
  END IF;

  IF OLD.status IN ('signed', 'superseded') THEN
    RAISE EXCEPTION 'countersign_frozen: version % is % and never changes', OLD.id, OLD.status;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'statusAt') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'statusAt') THEN
    RAISE EXCEPTION 'countersign_frozen: version % is %, its content and pdfSha256 are frozen', OLD.id, OLD.status;
  END IF;

  IF (OLD.status::text || '>' || NEW.status::text) NOT IN (
    'sent>viewed', 'sent>expired', 'sent>superseded',
    'viewed>viewed', 'viewed>signed', 'viewed>declined', 'viewed>expired', 'viewed>superseded',
    'declined>superseded', 'expired>superseded'
  ) THEN
    RAISE EXCEPTION 'countersign_frozen: % -> % is not a transition', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProposalVersion_freeze"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProposalVersion"
  FOR EACH ROW EXECUTE FUNCTION countersign_version_freeze();

-- Sections and lines: the parent version must be a draft. On DELETE a missing parent means the version itself is being
-- deleted (only a draft can be, see above), so the cascade is allowed.
CREATE FUNCTION countersign_content_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st "ProposalStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO st FROM "ProposalVersion" WHERE id = OLD."versionId";
    IF FOUND AND st <> 'draft' AND NOT countersign_org_gone(OLD."orgId") THEN
      RAISE EXCEPTION 'countersign_frozen: version % is %, its % rows are frozen', OLD."versionId", st, TG_TABLE_NAME;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO st FROM "ProposalVersion" WHERE id = NEW."versionId";
    IF NOT FOUND OR st <> 'draft' THEN
      RAISE EXCEPTION 'countersign_frozen: version % is %, its % rows are frozen', NEW."versionId", coalesce(st::text, 'missing'), TG_TABLE_NAME;
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "ProposalSection_freeze"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProposalSection"
  FOR EACH ROW EXECUTE FUNCTION countersign_content_freeze();

CREATE TRIGGER "ProposalLine_freeze"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProposalLine"
  FOR EACH ROW EXECUTE FUNCTION countersign_content_freeze();
