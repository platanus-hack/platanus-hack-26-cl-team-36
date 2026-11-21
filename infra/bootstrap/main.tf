# Lo que tiene que existir antes de que GitHub Actions pueda correr Terraform:
# el bucket del estado, el proveedor OIDC de GitHub, el rol que asume el workflow
# y una alerta de presupuesto. Se aplica una sola vez, a mano, con credenciales de
# administrador de la cuenta. Su estado queda local (ver infra/README.md).

terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "hackathon-grupo36"
      ManagedBy = "terraform-bootstrap"
    }
  }
}

data "aws_caller_identity" "actual" {}

locals {
  # Los nombres de bucket son globales en S3; el id de la cuenta lo hace único.
  bucket_estado = "hackathon-grupo36-tfstate-${data.aws_caller_identity.actual.account_id}"
}

# --- Estado remoto de infra/app -------------------------------------------------

resource "aws_s3_bucket" "estado" {
  bucket = local.bucket_estado

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "estado" {
  bucket = aws_s3_bucket.estado.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "estado" {
  bucket = aws_s3_bucket.estado.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "estado" {
  bucket = aws_s3_bucket.estado.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- GitHub Actions entra a AWS por OIDC, sin llaves guardadas ------------------

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "confianza_github" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Solo workflows del repo personal, corriendo sobre main.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "github-actions-terraform"
  assume_role_policy = data.aws_iam_policy_document.confianza_github.json
}

# Terraform crea recursos de cualquier tipo (incluidos roles IAM para la Lambda),
# así que el rol es administrador. Es aceptable porque la cuenta es solo de la
# hackatón y la confianza está limitada a main del repo personal.
resource "aws_iam_role_policy_attachment" "github_actions_admin" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# --- Alerta de presupuesto -------------------------------------------------------

resource "aws_budgets_budget" "mensual" {
  name         = "hackathon-grupo36-mensual"
  budget_type  = "COST"
  limit_amount = tostring(var.presupuesto_mensual_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Sin descontar créditos: si no, el gasto se ve en 0 hasta que se acaban y la
  # alerta llega tarde.
  cost_types {
    include_credit = false
    include_refund = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.email_alertas]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.email_alertas]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.email_alertas]
  }
}
