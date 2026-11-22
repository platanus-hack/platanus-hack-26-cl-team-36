# Infraestructura en AWS

La API (`backend/`) corre en AWS como una Lambda, en https://api.chameleonmode.app (API Gateway) y en su URL pública
de Lambda. Terraform la crea y la actualiza desde GitHub Actions, en el repo personal
[brayanmoreno/hackathon-grupo36](https://github.com/brayanmoreno/hackathon-grupo36).
El backoffice (`backoffice/`) corre en ECS Fargate, en https://chameleonmode.app, y también lo crea Terraform
(ver [El backoffice en chameleonmode.app](#el-backoffice-en-chameleonmodeapp)).
Los agentes (`agents/`) corren en AgentCore Runtime, en un solo runtime, `chameleon`; lo despliega la CLI de
AgentCore desde `agentcore/`, en el mismo repo personal.

**Por qué un repo personal.** Este repo es público y de la organización: no podemos guardarle secretos, y los logs de
Actions, con el plan de Terraform, quedarían a la vista. El repo personal es privado y es una copia de `main` de este.

**La cuenta de AWS.** Todo corre en una cuenta creada con el registro nuevo de AWS (*Sign up for AWS (new)*). Con ese
registro, la cuenta es un "proyecto" dentro de una organización que administra AWS, y las políticas de esa organización
(SCP) limitan lo que se puede hacer en ella:

- Los recursos regionales, como S3 o Lambda, solo se pueden crear en la región del proyecto, `us-east-2` (Ohio). La
  región se ve en [settings.aws.com](https://settings.aws.com) → Project → Additional info.
- No se pueden crear grupos IAM ni usuarios IAM con contraseña. El equipo entra invitado al proyecto (ver
  [Acceso del equipo](#acceso-del-equipo)).
- Bedrock no da acceso a Claude Opus 4.7 ni a los modelos posteriores: responden *is not available for this account*,
  y eso solo lo puede habilitar AWS (Sales o Support). Por eso el Visitante usa Claude Sonnet 4.6 (ver
  [el Visitante](../agents/app/visitor/README.md#en-aws-agentcore)).

Antes, el proyecto corría en una subcuenta de desarrollo de la organización de AWS de Unholster.

## Cómo llega un cambio a AWS

1. Se mergea una PR en este repo.
2. El workflow `Sincroniza desde la organización` copia `main` al repo personal. Corre cada 5 minutos, aunque GitHub
   suele atrasarlo.
3. Si el cambio toca `backend/`, `backoffice/` (menos sus pruebas) o `infra/app/`, el workflow `Terraform` del repo
   personal hace `plan` y `apply`.
4. Las URLs de la API y del backoffice quedan en el resumen de esa ejecución.
5. Si el cambio toca `infra/agentcore/`, `agents/` (menos las pruebas) o `.claude/skills/`, el workflow `AgentCore`
   despliega el runtime `chameleon` con la [CLI de AgentCore](https://github.com/aws/agentcore-cli) (`agentcore
   deploy`), con el mismo rol. La CLI construye la imagen (`agents/app/runtime/Dockerfile`, con la raíz del repo como
   contexto) en CodeBuild, para arm64, y aplica su propio stack de CDK; no pasa por Terraform. La primera vez también
   prepara la cuenta para CDK (`CDKToolkit`). Desde un computador: `just aws`.

Las PRs no muestran un plan. Antes de mergear un cambio de infraestructura, corre `terraform plan` en local (ver más
abajo).

## Carpetas

- `bootstrap/`: lo que debe existir antes de que Actions pueda correr Terraform: el bucket del estado, la entrada de
  GitHub a AWS por OIDC (sin llaves guardadas), el rol que asume el workflow y una alerta de presupuesto. Se aplica
  una vez, a mano, y su estado queda en el computador de quien lo aplicó.
- `app/`: la Lambda, su URL, su rol y su log; la API en `api.<dominio>` (`api.tf`); el almacén de los agentes (bucket `chameleon-almacen-<cuenta>`,
  privado) y la tabla `chameleon-revisiones` (DynamoDB, `PK`/`SK`); el backoffice en ECS (`backoffice.tf`). Su estado
  vive en el bucket del estado.
  `/revisiones` de la API marca cada página en la tabla y dispara el conductor en el runtime cuyo nombre termina en
  `runtime_agentes` (`chameleon`); la Lambda `chameleon-backend-proyectora` (`backend/proyectora.js`) recibe los
  `manifest.json` nuevos del bucket y actualiza el estado de cada revisión. Sin `REVISIONES_TABLA` (en local),
  `/revisiones` responde 404.
  Un `POST` sobre una página cuya revisión quedó `failed`, o `queued`/`running` sin novedades hace más de una hora,
  dispara otra. Con `revisiones_en_curso_max` (5) revisiones
  `queued`/`running` con novedades en la última hora, un `POST` que crearía otra responde 429.
- `agentcore/`: los agentes en AgentCore Runtime. `infra/` es el proyecto de la
  [CLI de AgentCore](https://github.com/aws/agentcore-cli): `agentcore/agentcore.json` declara el runtime `chameleon`
  (desplegado como `ChameleonAgents_default_chameleon`), con su entrada en `../agents/app/runtime/` y la raíz del repo
  como contexto de la imagen; `Dockerfile.dockerignore` deja entrar solo `agents/` y `.claude/skills/`.
  `agentcore/cdk/` es el stack que la CLI genera. Cada invocación (`{stage, revision, url, ...}`) responde al
  instante y corre el CLI de su etapa en segundo plano (modo async: la sesión sigue viva hasta 8 h); el conductor
  (`stage: "revision"`) invoca las demás etapas en este mismo runtime, cuyo ARN saca de `OTEL_RESOURCE_ATTRIBUTES`.
  `agentcore/cdk/lib/cdk-stack.ts` le da al runtime `AGENTS_STORE=s3://chameleon-almacen-<cuenta>/`, lectura y
  escritura en ese bucket (lo crea Terraform) y permiso para invocar runtimes de la cuenta (el conductor).
  `agentcore/.cli/deployed-state.json` enlaza el proyecto con lo desplegado. `agentcore/aws-targets.json` queda con el
  id de la cuenta después de desplegar desde un computador: no lo subas, el repo es público.
- `justfile`: `just aws`, los comandos del runtime en AgentCore (`revision`, `deploy`, `status`, `logs`) y `seed`.
  `just aws revision <url>` pide la revisión a la API (`POST /revisiones`), muestra cómo avanza cada etapa y guarda
  `tema.css` en `local/.state/aws/`.
- `siembra/`: `just aws seed`, ver [Sembrar revisiones](#sembrar-revisiones).
- `../backend/lambda.js`: entrada de la Lambda. Levanta el servidor de `index.js` y le reenvía cada request, así
  `index.js` funciona igual en local y en AWS.

## Acceso del equipo

La cuenta no tiene usuarios IAM. Cada persona entra con su AWS Builder ID, invitada al proyecto, y saca credenciales
temporales con `aws login`. Los invitados son administradores del proyecto, que es lo que necesitan Terraform y la CLI
de AgentCore, pero no pueden invitar a otros ni ver la facturación.

1. **Invitar**, quien es dueño del proyecto: [settings.aws.com](https://settings.aws.com) → **Team** → **Invite new
   team member**, con el correo de la persona y el proyecto, y **Send invitation**. La invitación dura 14 días.
2. **Aceptar**, la persona invitada: abre el correo de AWS y entra con su AWS Builder ID. Si no tiene uno, lo crea
   ahí mismo.
3. **Entrar desde la CLI**, con la AWS CLI 2.32 o más nueva (`aws --version`):

   ```bash
   aws login --profile grupo36          # abre el navegador: elige el proyecto
   aws configure set region us-east-2 --profile grupo36
   export AWS_PROFILE=grupo36
   aws sts get-caller-identity          # confirma que es la cuenta del proyecto
   ```

   La sesión dura hasta 12 horas; después, `aws login --profile grupo36` otra vez. Si Terraform no logra leer esas
   credenciales: `eval "$(aws configure export-credentials --format env)"`.

## Puesta en marcha (una vez)

Necesitas Terraform 1.11 o más nuevo (`brew install hashicorp/tap/terraform`) y la AWS CLI con un perfil de la cuenta
del proyecto, con permisos de administrador.

**1. Bootstrap**, quien tenga la cuenta de AWS:

```bash
export AWS_PROFILE=<perfil de la cuenta del proyecto>
aws sts get-caller-identity          # confirma que es la cuenta correcta antes de seguir
cd infra/bootstrap
terraform init
# Si Terraform no logra renovar la sesión SSO: eval "$(aws configure export-credentials --format env)"
terraform apply -var="email_alertas=<correo para las alertas>"
```

Guarda `infra/bootstrap/terraform.tfstate`: no se sube al repo y sirve para modificar o borrar estos recursos. La
alerta avisa al pasar el 50 % y el 100 % de 20 USD al mes, contando el gasto antes de descontar créditos.

**2. Repo personal**, Brayan como dueño, en Settings → Secrets and variables → Actions:

- Variable `AWS_ROLE_ARN`: el valor de `terraform output -raw aws_role_arn` del paso 1.
- Secreto `SYNC_TOKEN`: un token fine-grained (GitHub → Settings → Developer settings → Fine-grained tokens) con
  acceso solo a `hackathon-grupo36`, y permisos *Contents* y *Workflows* en lectura y escritura. El token por defecto
  de Actions no sirve: no puede subir cambios a `.github/workflows/` y lo que sube no dispara otros workflows.
- Secretos `WEB_EXT_API_KEY` y `WEB_EXT_API_SECRET`: las claves de addons.mozilla.org para el workflow
  `Publicar extensión`, que firma la extensión al subir un tag `vX.Y.Z` (ver `extension/README.md`).
  Se cargan desde un `extension/.env` con `gh secret set -f extension/.env -R brayanmoreno/hackathon-grupo36`.

**3. Primera copia.** El workflow de sincronización solo corre cuando ya está en `main` del repo personal, así que la
primera copia se hace a mano, después de mergear esta PR:

```bash
git switch main && git pull
git push git@github.com:brayanmoreno/hackathon-grupo36.git main
```

Eso dispara `Terraform` por primera vez. La extensión llama a `api.chameleonmode.app` (`API_URL_AWS` de
`extension/src/background/config.js`); ver [La API en api.chameleonmode.app](#la-api-en-apichameleonmodeapp).

## El backoffice en chameleonmode.app

[`app/backoffice.tf`](app/backoffice.tf) pone el backoffice (`backoffice/`) en https://chameleonmode.app: una tarea de
ECS Fargate en la VPC por defecto, detrás de un balanceador (ALB) con certificado de ACM, que lee el almacén y la tabla
de revisiones con un rol de solo lectura. **Es público, sin login**, por decisión del equipo: lo que está en el almacén
lo ve cualquiera. Terraform también construye la imagen (`backoffice/Dockerfile`) con docker y la sube a ECR cuando
cambia algo de lo que entra en ella; el runner de Actions trae docker, así que un `apply` en local también lo necesita.

Cuesta unos 40 USD al mes, casi todo el balanceador y las IP públicas: pasa la alerta de 20 USD de `bootstrap/`.

El dominio se compró en Cloudflare y su DNS está allá, fuera de Terraform. Dos registros se crean a mano, los dos
**DNS only** (nube gris): el certificado lo pone el balanceador, no Cloudflare.

**La primera vez**, al mergear:

1. Terraform crea el certificado y espera hasta 45 min a que se valide. Mientras espera, saca el registro:

   ```bash
   arn=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='chameleonmode.app'].CertificateArn" --output text)
   aws acm describe-certificate --certificate-arn "$arn" --query "Certificate.DomainValidationOptions[0].ResourceRecord"
   ```

2. En Cloudflare → `chameleonmode.app` → DNS → *Add record*: tipo `CNAME`, el `Name` y el `Value` de arriba, *DNS
   only*. ACM lo valida en unos minutos y Terraform sigue: sube la imagen, crea el balanceador y el servicio, y espera a
   que la tarea quede sana. Ese registro no se borra: con él ACM renueva el certificado solo.
3. Cuando termine, otro `CNAME` en Cloudflare: `Name` `@`, `Value` el balanceador que muestra el resumen del workflow
   (`terraform output -raw backoffice_alb`), *DNS only*.

Si el apply se corta por tiempo antes del paso 2, crea el registro y vuelve a correr `Terraform`: reutiliza el
certificado.

**Día a día.** Un cambio en `backoffice/` (menos `test/`) dispara `Terraform` y despliega una imagen nueva; si la
tarea nueva no queda sana, ECS vuelve a la anterior y el apply falla. Los logs: `aws logs tail
/ecs/chameleon-backoffice --follow`. El backoffice muestra lo que hay en el almacén: lo que escriben los agentes en
AgentCore o lo que se sube a mano con `aws s3 sync agents/.runs/ s3://chameleon-almacen-<cuenta>/` (queda público).

## La API en api.chameleonmode.app

[`app/api.tf`](app/api.tf) pone la Lambda detrás de API Gateway (HTTP API) en https://api.chameleonmode.app, con
certificado de ACM. API Gateway le entrega a la Lambda el mismo evento que la function URL (formato 2.0), así que
`backend/lambda.js` no cambia. Cobra por pedido (alrededor de 1 USD por millón), sin costo fijo. Corta los pedidos a
los 30 s, lo mismo que el timeout de la Lambda.

La function URL sigue publicada (`terraform output -raw function_url`): la usan las versiones de la extensión
anteriores al dominio. Se puede quitar cuando nadie las tenga.

**La primera vez**, al mergear, los mismos pasos que el backoffice, con dos `CNAME` en Cloudflare, los dos *DNS only*:

1. Mientras Terraform espera el certificado, saca el registro de validación con los comandos del backoffice, cambiando
   `chameleonmode.app` por `api.chameleonmode.app`, y créalo en Cloudflare. No se borra.
2. Cuando termine, `Name` `api` y `Value` el destino que muestra el resumen del workflow
   (`terraform output -raw api_destino`, un `d-….execute-api.us-east-2.amazonaws.com`).
3. Recién entonces publica una versión de la extensión (`just publish vX.Y.Z`): desde esta versión llama a
   `api.chameleonmode.app`.

## Día a día

- Para no esperar la copia automática, o si GitHub no la está lanzando: `just sync`. Copia `main` al repo personal
  y, si hay algo que desplegar, sigue el deploy hasta que termine.
- Nunca hagas commits directo en `main` del repo personal: la copia siguiente los borra.
- Terraform en local, para revisar un cambio antes de mergearlo:

  ```bash
  cd infra/app
  terraform init -backend-config="bucket=hackathon-grupo36-tfstate-$(aws sts get-caller-identity --query Account --output text)"
  terraform plan
  ```

  El estado tiene un candado: si Actions está aplicando, tu `plan` falla con un error de candado (reintenta en un
  rato), y al revés.

## Sembrar revisiones

Para que la demo tenga temas listos, `just aws seed` pide a la API desplegada una revisión de cada página y la sigue
hasta `done` o `failed`; termina con un resumen y sale con error si alguna no quedó `done`. Sin URLs usa
`agents/tasks/demo.json` (los `start_url` de las tareas). No necesita credenciales de AWS.

```bash
just aws seed                                   # las páginas de demo
just aws seed https://www.wom.cl/ --force       # revisión nueva aunque ya tenga una terminada
```

Lo mismo desde GitHub: Actions → `Sembrar revisiones` → *Run workflow*, en el repo personal. Las que pasan el tope de
revisiones en curso (429) se vuelven a pedir solas.

## Al terminar la hackatón

1. Actions → `Terraform` → *Run workflow* → `destroy`, en el repo personal. El runtime no es parte de
   Terraform: en CloudFormation (us-east-2), borra el stack `AgentCore-ChameleonAgents-…` y después `CDKToolkit`.
   El dominio sigue en Cloudflare: borra los cuatro `CNAME` y decide si se renueva (la renovación automática está activa).
2. Desactiva `Sincroniza desde la organización`. Corre unas 290 veces al día y cada vez cuenta como un minuto de los
   2.000 gratis al mes de un repo privado.
3. Para borrar también lo de `bootstrap/`, quita `prevent_destroy` del bucket, vacíalo (incluidas las versiones
   anteriores) y corre `terraform destroy` en `infra/bootstrap`. Si se cierra la cuenta de AWS, no hace falta.
