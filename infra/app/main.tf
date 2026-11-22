# La API (backend/) como una Lambda con URL pública (HTTPS).
# backend/lambda.js adapta los eventos de Lambda al servidor de backend/index.js.

data "archive_file" "backend" {
  type        = "zip"
  source_dir  = "${path.module}/../../backend"
  output_path = "${path.module}/.build/backend.zip"
  excludes    = ["test/**", "node_modules/**", "**/.DS_Store"]
}

data "aws_iam_policy_document" "confianza_lambda" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backend" {
  name               = "${var.nombre}-lambda"
  assume_role_policy = data.aws_iam_policy_document.confianza_lambda.json
}

resource "aws_iam_role_policy_attachment" "backend_logs" {
  role       = aws_iam_role.backend.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# /revisiones: marca páginas y crea revisiones (TransactWriteItems pide los permisos de
# cada Put), lee el tema.css del almacén y dispara el conductor, que busca por nombre.
data "aws_iam_policy_document" "backend" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.revisiones.arn]
  }

  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.almacen.arn}/*"]
  }

  statement {
    actions   = ["bedrock-agentcore:InvokeAgentRuntime"]
    resources = ["arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.actual.account_id}:runtime/*"]
  }

  statement {
    actions   = ["bedrock-agentcore:ListAgentRuntimes"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "backend" {
  name   = "revisiones"
  role   = aws_iam_role.backend.id
  policy = data.aws_iam_policy_document.backend.json
}

# Se crea antes que la Lambda para que Terraform controle la retención y lo borre
# en un destroy (si no, Lambda lo crea solo y queda huérfano).
resource "aws_cloudwatch_log_group" "backend" {
  name              = "/aws/lambda/${var.nombre}"
  retention_in_days = 14
}

resource "aws_lambda_function" "backend" {
  function_name    = var.nombre
  role             = aws_iam_role.backend.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "lambda.handler"
  filename         = data.archive_file.backend.output_path
  source_code_hash = data.archive_file.backend.output_base64sha256
  memory_size      = 256
  # POST /revisiones espera a que AgentCore acepte la invocación del conductor (hasta 10 s).
  timeout = 30

  environment {
    variables = {
      REVISIONES_TABLA = aws_dynamodb_table.revisiones.name
      ALMACEN_BUCKET   = aws_s3_bucket.almacen.bucket
      AGENTE_RUNTIME   = var.runtime_agentes
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.backend,
    aws_iam_role_policy_attachment.backend_logs,
  ]
}

resource "aws_lambda_function_url" "backend" {
  function_name      = aws_lambda_function.backend.function_name
  authorization_type = "NONE"
}

# Una URL pública necesita los dos permisos: invocar la URL y invocar la función
# (este último limitado a invocaciones que llegan por la URL).
resource "aws_lambda_permission" "url_publica" {
  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.backend.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "invocar_por_url" {
  statement_id             = "FunctionURLAllowInvokeAction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.backend.function_name
  principal                = "*"
  invoked_via_function_url = true
}
