import type { RelationshipTuple, Resource, Subject } from "@access-kit/core";
import type { RebacLocalApp } from "./runtime-app.js";
import { asJsonRecord } from "./runtime-shared.js";
import {
  persistGraphRelationship,
  persistGraphResource,
  persistGraphSubject,
  recordAudit
} from "./runtime-state.js";

export function createSubject(app: RebacLocalApp, subject: Subject): Subject {
  const saved = app.store.upsertSubject(subject);
  const event = recordAudit(app, {
    eventType: "subject.created",
    actor: app.actor,
    subjectId: saved.id,
    correlationId: `corr:${saved.id}:${saved.version}`,
    payload: asJsonRecord(saved)
  });
  persistGraphSubject(app, saved, event.occurredAt);
  return saved;
}

export function createResource(app: RebacLocalApp, resource: Resource): Resource {
  const saved = app.store.upsertResource(resource);
  const event = recordAudit(app, {
    eventType: "resource.discovered",
    actor: app.actor,
    resourceId: saved.id,
    correlationId: `corr:${saved.id}:${saved.version}`,
    payload: asJsonRecord(saved)
  });
  persistGraphResource(app, saved, event.occurredAt);
  return saved;
}

export function putRelationship(app: RebacLocalApp, relationship: RelationshipTuple): RelationshipTuple {
  const saved = app.store.upsertRelationship(relationship);
  const event = recordAudit(app, {
    eventType: "relationship.created",
    actor: app.actor,
    subjectId: saved.subjectId,
    resourceId: saved.objectId,
    correlationId: `corr:${saved.id}:${saved.version}`,
    payload: asJsonRecord(saved)
  });
  persistGraphRelationship(app, saved, event.occurredAt);
  return saved;
}

export function deleteRelationship(app: RebacLocalApp, relationshipId: string): RelationshipTuple | undefined {
  const deleted = app.store.deleteRelationship(relationshipId, app.now());

  if (deleted) {
    const event = recordAudit(app, {
      eventType: "relationship.deleted",
      actor: app.actor,
      subjectId: deleted.subjectId,
      resourceId: deleted.objectId,
      correlationId: `corr:${deleted.id}:deleted`,
      payload: asJsonRecord(deleted)
    });
    persistGraphRelationship(app, deleted, event.occurredAt);
  }

  return deleted;
}
