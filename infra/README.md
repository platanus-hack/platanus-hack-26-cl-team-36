# Infraestructura en AWS

La API (`backend/`) corre en AWS como una Lambda con URL pública. Terraform la crea y la actualiza desde GitHub
Actions, en el repo personal [brayanmoreno/hackathon-grupo36](https://github.com/brayanmoreno/hackathon-grupo36).

**Por qué un repo personal.** Este repo es público y de la organización: no podemos guardarle secretos, y los logs de
Actions, con el plan de Terraform, quedarían a la vista. El repo personal es privado y es una copia de `main` de este.

**Por qué `us-east-2`.** La cuenta de AWS se creó con el registro nuevo de AWS (*Sign up for AWS (new)*). Con ese
registro, la cuenta es un "proyecto" dentro de una organización que administra AWS. Las políticas de esa organización
solo dejan crear recursos regionales, como S3 o Lambda, en la región asignada al proyecto, y a Chile le corresponde
`us-east-2` (Ohio). Cualquier otra región responde *explicit deny in a service control policy*. La región del
proyecto se ve en [settings.aws.com](https://settings.aws.com) → Project → Additional info.

## Cómo llega un cambio a AWS

1. Se mergea una PR en este repo.
2. El workflow `Sincroniza desde la organización` copia `main` al repo personal. Corre cada 5 minutos, aunque GitHub
   suele atrasarlo.
3. Si el cambio toca `backend/` o `infra/app/`, el workflow `Terraform` del repo personal hace `plan` y `apply`.
4. La URL de la API queda en el resumen de esa ejecución.

Las PRs no muestran un plan. Antes de mergear un cambio de infraestructura, corre `terraform plan` en local (ver más
abajo).

## Carpetas

- `bootstrap/`: lo que debe existir antes de que Actions pueda correr Terraform: el bucket del estado, la entrada de
  GitHub a AWS por OIDC (sin llaves guardadas), el rol que asume el workflow y una alerta de presupuesto. Se aplica
  una vez, a mano, y su estado queda en el computador de quien lo aplicó.
- `app/`: la Lambda, su URL, su rol y su log. Su estado vive en el bucket.
- `../backend/lambda.js`: entrada de la Lambda. Levanta el servidor de `index.js` y le reenvía cada request, así
  `index.js` funciona igual en local y en AWS.

## Puesta en marcha (una vez)

Necesitas Terraform 1.11 o más nuevo (`brew install hashicorp/tap/terraform`) y la AWS CLI con un perfil de la cuenta
de la hackatón, con permisos de administrador.

**1. Bootstrap**, quien tenga la cuenta de AWS:

```bash
export AWS_PROFILE=<perfil de la cuenta de la hackatón>
aws sts get-caller-identity          # confirma que es la cuenta correcta antes de seguir
cd infra/bootstrap
terraform init
terraform apply -var="email_alertas=<correo para las alertas>"
```

Guarda `infra/bootstrap/terraform.tfstate`: no se sube al repo y sirve para modificar o borrar estos recursos. La
alerta avisa al pasar el 50 % y el 100 % de 20 USD al mes, contando el gasto antes de descontar créditos.

**2. Repo personal**, Brayan como dueño, en Settings → Secrets and variables → Actions:

- Variable `AWS_ROLE_ARN`: el valor de `terraform output -raw aws_role_arn` del paso 1.
- Secreto `SYNC_TOKEN`: un token fine-grained (GitHub → Settings → Developer settings → Fine-grained tokens) con
  acceso solo a `hackathon-grupo36`, y permisos *Contents* y *Workflows* en lectura y escritura. El token por defecto
  de Actions no sirve: no puede subir cambios a `.github/workflows/` y lo que sube no dispara otros workflows.

**3. Primera copia.** El workflow de sincronización solo corre cuando ya está en `main` del repo personal, así que la
primera copia se hace a mano, después de mergear esta PR:

```bash
git switch main && git pull
git push git@github.com:brayanmoreno/hackathon-grupo36.git main
```

Eso dispara `Terraform` por primera vez. Cuando termine, copia la URL del resumen en `API_URL` de
`extension/src/background/config.js`, sin el `/` final.

## Día a día

- Para no esperar la copia automática: Actions → `Sincroniza desde la organización` → *Run workflow*, en el repo
  personal.
- Nunca hagas commits directo en `main` del repo personal: la copia siguiente los borra.
- Terraform en local, para revisar un cambio antes de mergearlo:

  ```bash
  cd infra/app
  terraform init -backend-config="bucket=hackathon-grupo36-tfstate-$(aws sts get-caller-identity --query Account --output text)"
  terraform plan
  ```

  El estado tiene un candado: si Actions está aplicando, tu `plan` falla con un error de candado (reintenta en un
  rato), y al revés.

## Al terminar la hackatón

1. Actions → `Terraform` → *Run workflow* → `destroy`, en el repo personal.
2. Desactiva `Sincroniza desde la organización`. Corre unas 290 veces al día y cada vez cuenta como un minuto de los
   2.000 gratis al mes de un repo privado.
3. Para borrar también lo de `bootstrap/`, quita `prevent_destroy` del bucket, vacíalo (incluidas las versiones
   anteriores) y corre `terraform destroy` en `infra/bootstrap`. Si se cierra la cuenta de AWS, no hace falta.
