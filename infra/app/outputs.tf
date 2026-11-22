output "function_url" {
  description = "URL pública de la API. Va en extension/src/background/config.js (API_URL), sin el / final."
  value       = aws_lambda_function_url.backend.function_url
}

output "bucket_corridas" {
  description = "Bucket de las corridas de los agentes."
  value       = aws_s3_bucket.corridas.bucket
}

output "agents_store" {
  description = "Valor de AGENTS_STORE para que los agentes escriban en el bucket (ver agents/shared/README.md)."
  value       = "s3://${aws_s3_bucket.corridas.bucket}"
}

output "politica_escritura_corridas_arn" {
  description = "Política para quien corre agentes: listar, leer y escribir corridas, sin borrar."
  value       = aws_iam_policy.corridas_escritura.arn
}

output "politica_lectura_corridas_arn" {
  description = "Política para quien lee corridas (backoffice): listar y leer."
  value       = aws_iam_policy.corridas_lectura.arn
}
