variable "region" {
  description = "Región de AWS donde viven el bucket del estado y la app. Debe ser la del proyecto de AWS (ver infra/README.md)."
  type        = string
  default     = "us-east-2"
}

variable "github_sub_prefix" {
  description = <<-EOT
    Inicio del claim sub que GitHub pone en el token OIDC del repo personal. Ese repo usa el formato
    con ids (dueño@id/repo@id), que no se puede suplantar recreando un repo con el mismo nombre.
    Se consulta con: gh api repos/brayanmoreno/hackathon-grupo36/actions/oidc/customization/sub
  EOT
  type        = string
  default     = "repo:brayanmoreno@37162737/hackathon-grupo36@1466120956"
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
