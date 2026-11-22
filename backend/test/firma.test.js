import { test } from "node:test";
import assert from "node:assert/strict";
import { firmar } from "../firma.js";

const EJEMPLO = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

test("vectores de la suite de SigV4 de AWS", () => {
  const firma = (metodo, url) =>
    firmar({ metodo, url, region: "us-east-1", servicio: "service", credenciales: EJEMPLO, fecha: new Date("2015-08-30T12:36:00Z") })
      .authorization.split("Signature=")[1];
  assert.equal(firma("GET", "https://example.amazonaws.com/"), "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  assert.equal(firma("POST", "https://example.amazonaws.com/"), "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b");
  assert.equal(
    firma("GET", "https://example.amazonaws.com/?Param2=value2&Param1=value1"),
    "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
  );
});

// Firma esperada generada con botocore para la misma request.
test("InvokeAgentRuntime igual que botocore: el ARN del path se codifica dos veces", () => {
  const arn = "arn:aws:bedrock-agentcore:us-east-2:492299754669:runtime/ChameleonAgents_default_chameleon-ba5FXd7A7J";
  const cabeceras = firmar({
    metodo: "POST",
    url: `https://bedrock-agentcore.us-east-2.amazonaws.com/runtimes/${encodeURIComponent(arn)}/invocations`,
    cabeceras: {
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": "0f3a6c2e-1111-4222-8333-944455556666",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cuerpo: '{"stage":"revision"}',
    region: "us-east-2",
    servicio: "bedrock-agentcore",
    credenciales: { ...EJEMPLO, sessionToken: "TOKEN" },
    fecha: new Date("2026-11-22T02:11:47Z"),
  });
  assert.equal(cabeceras["x-amz-security-token"], "TOKEN");
  assert.equal(cabeceras.host, undefined);
  assert.match(cabeceras.authorization, /Signature=d27bbd8fb4e51a82d0ab430e1fe4baf9ebfc34ca74aa6a7258070c943e7b22f7$/);
});
