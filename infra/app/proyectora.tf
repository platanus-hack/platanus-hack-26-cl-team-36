# La proyectora: cada manifest.json del almacén actualiza la tabla de revisiones
# (backend/proyectora.js, mismo paquete que la API).

resource "aws_iam_role" "proyectora" {
  name               = "${var.nombre}-proyectora"
  assume_role_policy = data.aws_iam_policy_document.confianza_lambda.json
}

resource "aws_iam_role_policy_attachment" "proyectora_logs" {
  role       = aws_iam_role.proyectora.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "proyectora" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.almacen.arn}/*/manifest.json", "${aws_s3_bucket.almacen.arn}/*/cataloger/*/goals.json"]
  }

  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.revisiones.arn]
  }
}

resource "aws_iam_role_policy" "proyectora" {
  name   = "almacen-y-revisiones"
  role   = aws_iam_role.proyectora.id
  policy = data.aws_iam_policy_document.proyectora.json
}

resource "aws_cloudwatch_log_group" "proyectora" {
  name              = "/aws/lambda/${var.nombre}-proyectora"
  retention_in_days = 14
}

resource "aws_lambda_function" "proyectora" {
  function_name    = "${var.nombre}-proyectora"
  role             = aws_iam_role.proyectora.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "proyectora.handler"
  filename         = data.archive_file.backend.output_path
  source_code_hash = data.archive_file.backend.output_base64sha256
  memory_size      = 256
  timeout          = 30

  environment {
    variables = {
      REVISIONES_TABLA = aws_dynamodb_table.revisiones.name
      ALMACEN_BUCKET   = aws_s3_bucket.almacen.bucket
      GOALS_MAX        = var.goals_max
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.proyectora,
    aws_iam_role_policy_attachment.proyectora_logs,
  ]
}

resource "aws_lambda_permission" "almacen_invoca_proyectora" {
  statement_id   = "AllowS3Invoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.proyectora.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.almacen.arn
  source_account = data.aws_caller_identity.actual.account_id
}

resource "aws_s3_bucket_notification" "almacen" {
  bucket = aws_s3_bucket.almacen.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.proyectora.arn
    events              = ["s3:ObjectCreated:*"]
    filter_suffix       = "manifest.json"
  }

  depends_on = [aws_lambda_permission.almacen_invoca_proyectora]
}
