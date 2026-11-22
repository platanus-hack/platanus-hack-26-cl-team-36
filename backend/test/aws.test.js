import { test } from "node:test";
import assert from "node:assert/strict";
import { expresionActualizar } from "../aws.js";

test("expresionActualizar: SET de los atributos, sin los undefined", () => {
  assert.deepEqual(expresionActualizar({ css_key: "a/tema.css", nada: undefined }), {
    UpdateExpression: "SET #a0 = :a0",
    ExpressionAttributeNames: { "#a0": "css_key" },
    ExpressionAttributeValues: { ":a0": "a/tema.css" },
  });
});

test("expresionActualizar: solo avanza desde los estados previos y, si se pide, sobre un ítem existente", () => {
  const { ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } = expresionActualizar(
    { status: "done" },
    { previos: ["queued", "running"], existente: true },
  );
  assert.equal(
    ConditionExpression,
    "(attribute_not_exists(#status) OR #status IN (:p0, :p1)) AND attribute_exists(PK)",
  );
  assert.equal(ExpressionAttributeNames["#status"], "status");
  assert.deepEqual(ExpressionAttributeValues, { ":a0": "done", ":p0": "queued", ":p1": "running" });
});

test("expresionActualizar: pending solo se escribe si no hay estado", () => {
  assert.equal(expresionActualizar({ status: "pending" }, { previos: [] }).ConditionExpression, "attribute_not_exists(#status)");
});
