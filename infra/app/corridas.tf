# Bucket de las corridas de los agentes (agents/shared, AGENTS_STORE=s3://<bucket>).
# Mismo árbol de claves que agents/.runs/ (ver agents/shared/README.md).

data "aws_caller_identity" "actual" {}

locals {
  # Los nombres de bucket son globales en S3; el id de la cuenta lo hace único.
  # infra/agentcore/cdk/lib/cdk-stack.ts arma el mismo nombre y los de las políticas.
  bucket_corridas = "${var.nombre_corridas}-${data.aws_caller_identity.actual.account_id}"
}

resource "aws_s3_bucket" "corridas" {
  bucket        = local.bucket_corridas
  force_destroy = false
}

# Sin versionado: una corrida no se reescribe; solo su manifest.json cambia una vez, de running al estado final.

resource "aws_s3_bucket_ownership_controls" "corridas" {
  bucket = aws_s3_bucket.corridas.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "corridas" {
  bucket = aws_s3_bucket.corridas.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "corridas" {
  bucket = aws_s3_bucket.corridas.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "corridas" {
  bucket = aws_s3_bucket.corridas.id

  # S3 no filtra por extensión: el filtro es la etiqueta que lleva cada video.webm al subirse.
  rule {
    id     = "expira-videos"
    status = "Enabled"

    filter {
      tag {
        key   = "tipo"
        value = "video"
      }
    }

    expiration {
      days = var.dias_videos
    }
  }

  rule {
    id     = "aborta-subidas-incompletas"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# --- Políticas para quien escribe y quien lee ------------------------------------

# Lo que usa shared.store: listar prefijos, leer, y escribir con If-None-Match. Sin borrar.
data "aws_iam_policy_document" "corridas_escritura" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.corridas.arn]
  }

  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:PutObjectTagging"]
    resources = ["${aws_s3_bucket.corridas.arn}/*"]
  }
}

data "aws_iam_policy_document" "corridas_lectura" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.corridas.arn]
  }

  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.corridas.arn}/*"]
  }
}

resource "aws_iam_policy" "corridas_escritura" {
  name        = "${var.nombre_corridas}-escritura"
  description = "Escribe y lee corridas de agentes en ${local.bucket_corridas}, sin borrar."
  policy      = data.aws_iam_policy_document.corridas_escritura.json
}

resource "aws_iam_policy" "corridas_lectura" {
  name        = "${var.nombre_corridas}-lectura"
  description = "Lee corridas de agentes en ${local.bucket_corridas}."
  policy      = data.aws_iam_policy_document.corridas_lectura.json
}
