output "function_url" {
  description = "URL pública de la API. Va en extension/src/background/config.js (API_URL), sin el / final."
  value       = aws_lambda_function_url.backend.function_url
}

output "almacen_bucket" {
  description = "Bucket de los agentes. El runtime de AgentCore lo recibe como AGENTS_STORE=s3://<bucket>/."
  value       = aws_s3_bucket.almacen.bucket
}

output "revisiones_tabla" {
  description = "Tabla DynamoDB con el estado de cada revisión."
  value       = aws_dynamodb_table.revisiones.name
}
