# El backoffice (backoffice/) en ECS Fargate, público en https://<dominio>/backoffice/, detrás de un balanceador (ALB).
# La raíz del dominio muestra una portada (backoffice/portada/) que no enlaza al backoffice.
# Lee las corridas del almacén y las revisiones de su tabla (almacen.tf), con un rol de solo lectura.
#
# El DNS del dominio está en Cloudflare, no en AWS: el registro que valida el certificado y el que apunta el dominio
# al balanceador se crean a mano allá (infra/README.md, "El backoffice en chameleonmode.app").
#
# Terraform también construye la imagen, como el zip de la Lambda: si cambia lo que entra a la imagen, la construye
# con docker, la sube a ECR con un tag que es el hash de esos archivos y la tarea nueva usa ese tag. Por eso el apply
# necesita docker y la AWS CLI (el runner de GitHub Actions los trae).

locals {
  backoffice_nombre = "chameleon-backoffice"
  backoffice_puerto = 4848
  backoffice_dir    = "${path.module}/../../backoffice"

  # Lo que copia backoffice/Dockerfile, y el Dockerfile mismo.
  backoffice_archivos = sort([
    for archivo in setunion(
      fileset(local.backoffice_dir, "{Dockerfile,.dockerignore,package.json,package-lock.json,servidor.js}"),
      fileset(local.backoffice_dir, "lib/**"),
      fileset(local.backoffice_dir, "public/**"),
      fileset(local.backoffice_dir, "portada/**"),
    ) : archivo if !endswith(archivo, ".DS_Store")
  ])
  backoffice_tag = substr(sha256(join("\n", [
    for archivo in local.backoffice_archivos : "${archivo} ${filesha256("${local.backoffice_dir}/${archivo}")}"
  ])), 0, 16)
  backoffice_imagen = "${aws_ecr_repository.backoffice.repository_url}:${local.backoffice_tag}"
}

# --- La imagen ---------------------------------------------------------------

resource "aws_ecr_repository" "backoffice" {
  name                 = local.backoffice_nombre
  image_tag_mutability = "MUTABLE"
  force_delete         = true # un destroy la borra con sus imágenes
}

resource "aws_ecr_lifecycle_policy" "backoffice" {
  repository = aws_ecr_repository.backoffice.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Guarda las 10 imagenes mas nuevas"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

resource "terraform_data" "backoffice_imagen" {
  triggers_replace = [local.backoffice_imagen]

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = <<-EOT
      set -euo pipefail
      aws ecr get-login-password --region ${var.region} \
        | docker login --username AWS --password-stdin ${split("/", aws_ecr_repository.backoffice.repository_url)[0]}
      docker build --platform linux/amd64 -t ${local.backoffice_imagen} ${local.backoffice_dir}
      docker push ${local.backoffice_imagen}
    EOT
  }
}

# --- Roles -------------------------------------------------------------------

data "aws_iam_policy_document" "confianza_ecs" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Con el que ECS baja la imagen y escribe los logs.
resource "aws_iam_role" "backoffice_ejecucion" {
  name               = "${local.backoffice_nombre}-ejecucion"
  assume_role_policy = data.aws_iam_policy_document.confianza_ecs.json
}

resource "aws_iam_role_policy_attachment" "backoffice_ejecucion" {
  role       = aws_iam_role.backoffice_ejecucion.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# El del servidor: solo leer el almacén y la tabla de revisiones.
resource "aws_iam_role" "backoffice_tarea" {
  name               = "${local.backoffice_nombre}-tarea"
  assume_role_policy = data.aws_iam_policy_document.confianza_ecs.json
}

data "aws_iam_policy_document" "backoffice_lectura" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.almacen.arn]
  }

  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.almacen.arn}/*"]
  }

  statement {
    actions   = ["dynamodb:Query", "dynamodb:Scan"]
    resources = [aws_dynamodb_table.revisiones.arn]
  }
}

resource "aws_iam_role_policy" "backoffice_lectura" {
  name   = "lectura"
  role   = aws_iam_role.backoffice_tarea.id
  policy = data.aws_iam_policy_document.backoffice_lectura.json
}

# --- Red: la VPC por defecto, sin NAT ----------------------------------------
# La tarea va en las subredes públicas con IP pública para salir a ECR, S3, DynamoDB y CloudWatch;
# solo el balanceador puede entrar a ella.

data "aws_vpc" "por_defecto" {
  default = true
}

data "aws_subnets" "por_defecto" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.por_defecto.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

resource "aws_security_group" "backoffice_alb" {
  name        = "${local.backoffice_nombre}-alb"
  description = "Balanceador del backoffice: HTTP y HTTPS desde internet"
  vpc_id      = data.aws_vpc.por_defecto.id
}

resource "aws_vpc_security_group_ingress_rule" "backoffice_alb" {
  for_each = toset(["80", "443"])

  security_group_id = aws_security_group.backoffice_alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
}

resource "aws_vpc_security_group_egress_rule" "backoffice_alb_a_tarea" {
  security_group_id            = aws_security_group.backoffice_alb.id
  referenced_security_group_id = aws_security_group.backoffice_tarea.id
  ip_protocol                  = "tcp"
  from_port                    = local.backoffice_puerto
  to_port                      = local.backoffice_puerto
}

resource "aws_security_group" "backoffice_tarea" {
  name        = "${local.backoffice_nombre}-tarea"
  description = "Tarea del backoffice: solo entra el balanceador"
  vpc_id      = data.aws_vpc.por_defecto.id
}

resource "aws_vpc_security_group_ingress_rule" "backoffice_tarea_desde_alb" {
  security_group_id            = aws_security_group.backoffice_tarea.id
  referenced_security_group_id = aws_security_group.backoffice_alb.id
  ip_protocol                  = "tcp"
  from_port                    = local.backoffice_puerto
  to_port                      = local.backoffice_puerto
}

resource "aws_vpc_security_group_egress_rule" "backoffice_tarea_salida" {
  security_group_id = aws_security_group.backoffice_tarea.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- Certificado y balanceador -----------------------------------------------

resource "aws_acm_certificate" "backoffice" {
  domain_name       = var.dominio
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Espera a que el registro de validación esté en Cloudflare. La primera vez hay que crearlo a mano mientras el
# apply espera (infra/README.md); después ACM renueva solo mientras el registro siga ahí.
resource "aws_acm_certificate_validation" "backoffice" {
  certificate_arn = aws_acm_certificate.backoffice.arn

  timeouts {
    create = "45m"
  }
}

resource "aws_lb" "backoffice" {
  name                       = local.backoffice_nombre
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.backoffice_alb.id]
  subnets                    = data.aws_subnets.por_defecto.ids
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "backoffice" {
  name                 = local.backoffice_nombre
  port                 = local.backoffice_puerto
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = data.aws_vpc.por_defecto.id
  deregistration_delay = 10

  health_check {
    path                = "/salud"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "backoffice_http" {
  load_balancer_arn = aws_lb.backoffice.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "backoffice_https" {
  load_balancer_arn = aws_lb.backoffice.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.backoffice.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backoffice.arn
  }
}

# --- ECS ---------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "backoffice" {
  name              = "/ecs/${local.backoffice_nombre}"
  retention_in_days = 14
}

resource "aws_ecs_cluster" "chameleon" {
  name = "chameleon"
}

resource "aws_ecs_task_definition" "backoffice" {
  family                   = local.backoffice_nombre
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.backoffice_ejecucion.arn
  task_role_arn            = aws_iam_role.backoffice_tarea.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name         = "backoffice"
    image        = local.backoffice_imagen
    essential    = true
    portMappings = [{ containerPort = local.backoffice_puerto, protocol = "tcp" }]
    environment = [
      { name = "PORT", value = tostring(local.backoffice_puerto) },
      { name = "BACKOFFICE_ESCUCHA", value = "0.0.0.0" },
      { name = "BACKOFFICE_HOSTS", value = var.dominio },
      { name = "BACKOFFICE_FUENTE", value = "s3" },
      { name = "BACKOFFICE_ALMACEN", value = "s3://${aws_s3_bucket.almacen.bucket}/" },
      { name = "BACKOFFICE_TABLA", value = aws_dynamodb_table.revisiones.name },
      { name = "AWS_REGION", value = var.region },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.backoffice.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "backoffice"
      }
    }
  }])

  # La imagen tiene que estar en ECR antes de que el servicio la pida.
  depends_on = [terraform_data.backoffice_imagen]
}

resource "aws_ecs_service" "backoffice" {
  name                              = local.backoffice_nombre
  cluster                           = aws_ecs_cluster.chameleon.id
  task_definition                   = aws_ecs_task_definition.backoffice.arn
  desired_count                     = 1
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 30
  # El apply falla si la versión nueva no queda sana (y ECS vuelve a la anterior).
  wait_for_steady_state = true

  network_configuration {
    subnets          = data.aws_subnets.por_defecto.ids
    security_groups  = [aws_security_group.backoffice_tarea.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backoffice.arn
    container_name   = "backoffice"
    container_port   = local.backoffice_puerto
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # El grupo de destino tiene que estar unido al balanceador (por el listener HTTPS) antes de crear el servicio.
  depends_on = [aws_lb_listener.backoffice_https]
}
