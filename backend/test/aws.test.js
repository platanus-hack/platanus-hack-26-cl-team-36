import { test } from "node:test";
import assert from "node:assert/strict";
import { clienteAgentCore, coincideRuntime, condicionRegistro, expresionActualizar, filtroEnCurso, runtimeAgentes } from "../aws.js";

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

test("expresionActualizar: `hasta` exige que el atributo no exista o no sea mayor", () => {
  const { ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } = expresionActualizar(
    { resumen: {}, updated_at: "t1" },
    { existente: true, hasta: { updated_at: "t1" } },
  );
  assert.equal(ConditionExpression, "(attribute_not_exists(#h0) OR #h0 <= :h0) AND attribute_exists(PK)");
  assert.equal(ExpressionAttributeNames["#h0"], "updated_at");
  assert.equal(ExpressionAttributeValues[":h0"], "t1");
});

test("filtroEnCurso: META con esos estados y novedades desde la fecha", () => {
  assert.deepEqual(filtroEnCurso(["queued", "running"], "2026-11-21T11:00:00.000Z"), {
    FilterExpression: "SK = :meta AND #status IN (:e0, :e1) AND updated_at >= :desde",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: { ":meta": "META", ":desde": "2026-11-21T11:00:00.000Z", ":e0": "queued", ":e1": "running" },
  });
});

test("coincideRuntime: por nombre exacto o como sufijo del nombre de la CLI", () => {
  assert.ok(coincideRuntime("chameleon", "chameleon"));
  assert.ok(coincideRuntime("ChameleonAgents_default_chameleon", "chameleon"));
  assert.ok(!coincideRuntime("ChameleonAgents_default_web_evaluator_image", "chameleon"));
  assert.ok(!coincideRuntime("otro_chameleon2", "chameleon"));
});

test("condicionRegistro: ítem nuevo o reemplazo de la revisión vista", () => {
  assert.deepEqual(condicionRegistro(null), { ConditionExpression: "attribute_not_exists(PK)" });
  assert.deepEqual(condicionRegistro("rev-1"), {
    ConditionExpression: "#revision = :revision",
    ExpressionAttributeNames: { "#revision": "revision" },
    ExpressionAttributeValues: { ":revision": "rev-1" },
  });
});

const CREDENCIALES = () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secreto" });
const ARN = "arn:aws:bedrock-agentcore:us-east-2:123456789012:runtime/Proyecto_default_chameleon-abc";

function agentesConRespuestas(respuestas) {
  const llamadas = [];
  const fetch = async (url, opciones) => {
    llamadas.push({ url, ...opciones });
    const [estado, cuerpo] = respuestas.shift();
    return new Response(JSON.stringify(cuerpo), { status: estado });
  };
  const llamar = clienteAgentCore({ region: "us-east-2", credenciales: CREDENCIALES, fetch });
  return { llamadas, agentes: runtimeAgentes("chameleon", { llamar }) };
}

test("runtimeAgentes: resuelve el ARN por nombre, paginando, e invoca con una sesión nueva cada vez", async () => {
  const { llamadas, agentes } = agentesConRespuestas([
    [200, { agentRuntimes: [{ agentRuntimeName: "otro", agentRuntimeArn: "x" }], nextToken: "t" }],
    [200, { agentRuntimes: [{ agentRuntimeName: "Proyecto_default_chameleon", agentRuntimeArn: ARN }] }],
    [200, {}],
    [200, {}],
  ]);
  await agentes.invocar({ stage: "revision" });
  await agentes.invocar({ stage: "revision" });

  assert.equal(llamadas.length, 4);
  assert.equal(llamadas[0].url, "https://bedrock-agentcore-control.us-east-2.amazonaws.com/runtimes/");
  assert.equal(JSON.parse(llamadas[1].body).nextToken, "t");
  assert.equal(llamadas[2].url, `https://bedrock-agentcore.us-east-2.amazonaws.com/runtimes/${encodeURIComponent(ARN)}/invocations`);
  assert.equal(llamadas[2].body, '{"stage":"revision"}');
  assert.match(llamadas[2].headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  const sesion = (i) => llamadas[i].headers["x-amzn-bedrock-agentcore-runtime-session-id"];
  assert.ok(sesion(2).length >= 33); // mínimo de AgentCore
  assert.notEqual(sesion(2), sesion(3));
});

test("runtimeAgentes: un error HTTP lanza y la siguiente invocación vuelve a resolver el ARN", async () => {
  const lista = [200, { agentRuntimes: [{ agentRuntimeName: "chameleon", agentRuntimeArn: ARN }] }];
  const { llamadas, agentes } = agentesConRespuestas([lista, [404, { message: "no existe" }], lista, [200, {}]]);
  await assert.rejects(agentes.invocar({}), { name: "AgentCore404" });
  await agentes.invocar({});
  assert.equal(llamadas.length, 4);
});
