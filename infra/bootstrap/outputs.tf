output "aws_role_arn" {
  description = "Va como variable AWS_ROLE_ARN en el repo personal (Settings → Secrets and variables → Actions → Variables)."
  value       = aws_iam_role.github_actions.arn
}

output "bucket_estado" {
  description = "Bucket del estado de infra/app."
  value       = aws_s3_bucket.estado.bucket
}
