terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # El bucket lleva el id de la cuenta, así que no va acá: se pasa al iniciar.
  #   terraform init -backend-config="bucket=hackathon-grupo36-tfstate-<id de la cuenta>"
  backend "s3" {
    key          = "app/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "hackathon-grupo36"
      ManagedBy = "terraform"
    }
  }
}
