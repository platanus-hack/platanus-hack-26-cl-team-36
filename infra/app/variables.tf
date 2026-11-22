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

variable "runtime_agentes" {
  description = "Runtime de AgentCore que corre las revisiones: su nombre o el final de él (la CLI le antepone `<proyecto>_<destino>_`)."
  type        = string
  default     = "chameleon"
}

variable "goals_max" {
  description = "Goals por revisión que la proyectora espera del catálogo; el mismo default que el conductor."
  type        = number
  default     = 6
}

variable "revisiones_en_curso_max" {
  description = "Tope de revisiones queued/running a la vez: más allá, POST /revisiones responde 429."
  type        = number
  default     = 10
}

variable "dominio" {
  description = "Dominio del proyecto, con su DNS en Cloudflare: el backoffice en la raíz y la API en api.<dominio>."
  type        = string
  default     = "chameleonmode.app"
}
