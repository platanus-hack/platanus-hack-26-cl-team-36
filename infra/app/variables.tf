variable "region" {
  description = "Región de AWS. Debe coincidir con la del backend en versions.tf."
  type        = string
  default     = "us-east-2"
}

variable "nombre" {
  description = "Nombre de la Lambda y prefijo de sus recursos."
  type        = string
  default     = "chameleon-backend"
}
