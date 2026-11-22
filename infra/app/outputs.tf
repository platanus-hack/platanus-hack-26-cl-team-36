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

output "backoffice_url" {
  description = "URL pública del backoffice."
  value       = "https://${var.dominio}"
}

output "backoffice_alb" {
  description = "Nombre del balanceador. En Cloudflare, el CNAME de <dominio> apunta acá, sin proxy."
  value       = aws_lb.backoffice.dns_name
}

output "backoffice_validacion" {
  description = "El CNAME que valida el certificado del dominio. Va en Cloudflare, sin proxy, y no se borra."
  value = [for opcion in aws_acm_certificate.backoffice.domain_validation_options : {
    nombre = opcion.resource_record_name
    tipo   = opcion.resource_record_type
    valor  = opcion.resource_record_value
  }]
}
