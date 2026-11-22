# La API (la Lambda de main.tf) en https://api.<dominio>, con API Gateway (HTTP API) delante.
#
# API Gateway le entrega a la Lambda el mismo evento que la function URL (formato 2.0), así que backend/lambda.js
# no cambia. La function URL sigue: la usan las versiones de la extensión anteriores al dominio.
#
# El DNS del dominio está en Cloudflare: el registro que valida el certificado y el CNAME de api.<dominio> se crean a
# mano allá (infra/README.md, "La API en api.chameleonmode.app").

locals {
  api_dominio = "api.${var.dominio}"
}

resource "aws_apigatewayv2_api" "backend" {
  name          = var.nombre
  protocol_type = "HTTP"
}

# Todas las rutas a la Lambda; las rutas las decide backend/index.js.
resource "aws_apigatewayv2_integration" "backend" {
  api_id                 = aws_apigatewayv2_api.backend.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backend.arn
  payload_format_version = "2.0"
  # El máximo de API Gateway: un pedido que llegue a los 30 s de la Lambda recibe 503 de API Gateway.
  timeout_milliseconds = 30000
}

resource "aws_apigatewayv2_route" "backend" {
  api_id    = aws_apigatewayv2_api.backend.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.backend.id}"
}

resource "aws_apigatewayv2_stage" "backend" {
  api_id      = aws_apigatewayv2_api.backend.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.backend.execution_arn}/*/*"
}

# --- api.<dominio> -----------------------------------------------------------

resource "aws_acm_certificate" "api" {
  domain_name       = local.api_dominio
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Espera a que el registro de validación esté en Cloudflare, como el del backoffice (backoffice.tf).
resource "aws_acm_certificate_validation" "api" {
  certificate_arn = aws_acm_certificate.api.arn

  timeouts {
    create = "45m"
  }
}

resource "aws_apigatewayv2_domain_name" "api" {
  domain_name = local.api_dominio

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.api.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "api" {
  api_id      = aws_apigatewayv2_api.backend.id
  domain_name = aws_apigatewayv2_domain_name.api.id
  stage       = aws_apigatewayv2_stage.backend.id
}
