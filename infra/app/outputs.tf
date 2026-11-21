output "function_url" {
  description = "URL pública de la API. Va en extension/src/background/config.js (API_URL), sin el / final."
  value       = aws_lambda_function_url.backend.function_url
}
