# Infraestructura en AWS

La API (`backend/`) corre en AWS como una Lambda con URL pública. Terraform la crea y la actualiza desde GitHub
Actions, en el repo personal [brayanmoreno/hackathon-grupo36](https://github.com/brayanmoreno/hackathon-grupo36).
El evaluador web (`agents/app/web_evaluator/`) corre en AgentCore Runtime; lo despliega la CLI de AgentCore desde
`agentcore/`, en el mismo repo personal.

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
  y eso solo lo puede habilitar AWS (Sales o Support). Por eso el evaluador web usa Claude Sonnet 4.6 (ver
  [el evaluador](../agents/app/web_evaluator/README.md#en-aws-agentcore)).

Antes, el proyecto corría en una subcuenta de desarrollo de la organización de AWS de Unholster.

## Cómo llega un cambio a AWS

1. Se mergea una PR en este repo.
2. El workflow `Sincroniza desde la organización` copia `main` al repo personal. Corre cada 5 minutos, aunque GitHub
   suele atrasarlo.
3. Si el cambio toca `backend/` o `infra/app/`, el workflow `Terraform` del repo personal hace `plan` y `apply`.
4. La URL de la API queda en el resumen de esa ejecución.
5. Si el cambio toca `infra/agentcore/` o `agents/app/web_evaluator/`, el workflow `AgentCore` despliega el evaluador
   web con la [CLI de AgentCore](https://github.com/aws/agentcore-cli) (`agentcore deploy`), con el mismo rol. La CLI
   construye la imagen del evaluador (`agents/app/web_evaluator/Dockerfile`) en CodeBuild, para arm64, y aplica su
   propio stack de CDK; no pasa por Terraform. La primera vez también prepara la cuenta para CDK (`CDKToolkit`). Desde
   un computador: `just aws` (ver [el evaluador](../agents/app/web_evaluator/README.md#en-aws-agentcore)).

Las PRs no muestran un plan. Antes de mergear un cambio de infraestructura, corre `terraform plan` en local (ver más
abajo).

## Carpetas

- `bootstrap/`: lo que debe existir antes de que Actions pueda correr Terraform: el bucket del estado, la entrada de
  GitHub a AWS por OIDC (sin llaves guardadas), el rol que asume el workflow y una alerta de presupuesto. Se aplica
  una vez, a mano, y su estado queda en el computador de quien lo aplicó.
- `app/`: la Lambda, su URL, su rol y su log, y el bucket de corridas de los agentes con sus políticas. Su estado vive
  en el bucket del estado.
- `agentcore/`: el evaluador web en AgentCore Runtime. `infra/` es el proyecto de la
  [CLI de AgentCore](https://github.com/aws/agentcore-cli): `agentcore/agentcore.json` declara el runtime
  `web_evaluator_image`, con su código en `../agents/app/web_evaluator/`, y `agentcore/cdk/` es el stack que la CLI
  genera. El runtime se llama así porque AgentCore no deja pasar un runtime de zip a imagen: el anterior,
  `web_evaluator`, era de zip y se reemplazó.
  `agentcore/.cli/deployed-state.json` enlaza el proyecto con lo desplegado. `agentcore/aws-targets.json` queda con el
  id de la cuenta después de desplegar desde un computador: no lo subas, el repo es público.
- `justfile`: `just aws`, los comandos del evaluador en AgentCore (`explore`, `deploy`, `status`, `logs`) y de las
  corridas en S3 (`runs-sync`, `runs`).
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

Eso dispara `Terraform` por primera vez. Cuando termine, copia la URL del resumen en `API_URL_AWS` de
`extension/src/background/config.js`, sin el `/` final.

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

## Corridas de los agentes en S3

`app/corridas.tf` crea el bucket `chameleon-corridas-<id de la cuenta>`, privado, donde `shared.store` guarda las
corridas de los agentes con el mismo árbol que `agents/.runs/`:
`<host>/<agente>/[<objetivo>/][<viewport>/]<corrida>/<archivo>`
(ver [`agents/shared/README.md`](../agents/shared/README.md)). Nada se borra, salvo los objetos con la etiqueta
`tipo=video`, que expiran a los `dias_videos` días (30 por defecto).

- **Apuntar un agente al bucket**: `AGENTS_STORE=$(terraform -chdir=infra/app output -raw agents_store)`, con
  credenciales de la cuenta del proyecto.
- **Subir las corridas locales**: `just aws runs-sync` (`aws s3 sync agents/.runs/ s3://<bucket>/`, sin archivos
  ocultos); `just aws runs-sync --dryrun` muestra lo que subiría. **Ver las de un host**: `just aws runs wom.cl`.
  Ambos leen el bucket de `terraform output`, así que necesitan el `terraform init` de [Día a día](#día-a-día).
- **Permisos**: dos políticas administradas. `chameleon-corridas-escritura` (listar, leer y escribir, sin borrar) y
  `chameleon-corridas-lectura` (listar y leer); sus ARN salen en `terraform output`.

Conectado: el runtime `web_evaluator_image` en AgentCore tiene la política de escritura y `AGENTS_STORE`
(`agentcore/cdk/lib/cdk-stack.ts`). Si AgentCore se despliega antes de que Terraform cree la política, el despliegue
falla: se vuelve a correr cuando `Terraform` termine.

A mano: el backoffice lee una carpeta local, así que nadie usa todavía la política de lectura. Cuando lea desde S3,
se adjunta `politica_lectura_corridas_arn` a su rol. Para que los videos expiren, `shared.store` tiene que subirlos con
la etiqueta `tipo=video` (`Tagging` al subir), y la política de escritura necesita además `s3:PutObjectTagging`.

## Al terminar la hackatón

1. El evaluador web no es parte de Terraform: en CloudFormation (us-east-2), borra el stack
   `AgentCore-ChameleonAgents-…` y después `CDKToolkit`. Va primero porque su rol usa la política de escritura de
   corridas, y IAM no borra una política adjunta.
2. Vacía el bucket de corridas (Terraform no borra un bucket con objetos) y, en el repo personal, Actions →
   `Terraform` → *Run workflow* → `destroy`.
3. Desactiva `Sincroniza desde la organización`. Corre unas 290 veces al día y cada vez cuenta como un minuto de los
   2.000 gratis al mes de un repo privado.
4. Para borrar también lo de `bootstrap/`, quita `prevent_destroy` del bucket, vacíalo (incluidas las versiones
   anteriores) y corre `terraform destroy` en `infra/bootstrap`. Si se cierra la cuenta de AWS, no hace falta.
