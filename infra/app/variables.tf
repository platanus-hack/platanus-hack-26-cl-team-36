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

variable "nombre_corridas" {
  description = "Prefijo del bucket de corridas de los agentes (lleva el id de la cuenta al final) y de sus políticas IAM."
  type        = string
  default     = "chameleon-corridas"
}

variable "dias_videos" {
  description = "Días que se guarda un video de corrida (los objetos con la etiqueta tipo=video) antes de borrarse."
  type        = number
  default     = 30
}
