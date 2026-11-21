variable "region" {
  description = "Región de AWS donde viven el bucket del estado y la app. Debe ser la del proyecto de AWS (ver infra/README.md)."
  type        = string
  default     = "us-east-2"
}

variable "github_repo" {
  description = "Repo (dueño/nombre) cuyos workflows en main pueden asumir el rol."
  type        = string
  default     = "brayanmoreno/hackathon-grupo36"
}

variable "email_alertas" {
  description = "Correo que recibe las alertas de presupuesto."
  type        = string
}

variable "presupuesto_mensual_usd" {
  description = "Gasto mensual (sin descontar créditos) sobre el que se avisa."
  type        = number
  default     = 20
}
