# Almacén de los agentes (AGENTS_STORE del runtime de AgentCore) y tabla con el
# estado de cada revisión. S3 es la fuente de verdad; la tabla es una proyección.

data "aws_caller_identity" "actual" {}

resource "aws_s3_bucket" "almacen" {
  bucket = "chameleon-almacen-${data.aws_caller_identity.actual.account_id}"
}

resource "aws_s3_bucket_public_access_block" "almacen" {
  bucket                  = aws_s3_bucket.almacen.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "almacen" {
  bucket = aws_s3_bucket.almacen.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_dynamodb_table" "revisiones" {
  name         = "chameleon-revisiones"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }
}
