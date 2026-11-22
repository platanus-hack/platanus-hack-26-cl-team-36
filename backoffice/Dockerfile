# Backoffice en AWS (ECS Fargate, ver infra/app/backoffice.tf). Lee las corridas de S3 y las revisiones de
# DynamoDB; la configuración llega por variables de entorno desde la definición de la tarea.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY servidor.js ./
COPY lib ./lib
COPY public ./public

USER node
EXPOSE 4848
CMD ["node", "servidor.js"]
