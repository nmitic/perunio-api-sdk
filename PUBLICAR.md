# Publicar una versión

Para quien mantiene el SDK. El paquete es `@perunio.dev/sdk` en npm.

## Una sola vez

1. **Organización en npm.** En npmjs.com, crea la organización `perunio.dev` (gratis para paquetes públicos) y activa la verificación en dos pasos en tu cuenta.
2. **Repositorio en GitHub.** Crea `nmitic/perunio-api-sdk` (vacío) y súbelo:
   ```bash
   git remote add origin git@github.com:nmitic/perunio-api-sdk.git
   git push -u origin main
   ```
3. **Primera versión, a mano** (npm necesita que el paquete exista antes de configurar la publicación desde CI):
   ```bash
   npm login
   npm publish --access public   # corre `npm run verificar` antes
   ```
4. **Publicación de confianza (Trusted Publishing).** En npmjs.com → `@perunio.dev/sdk` → Settings → Trusted Publisher → GitHub Actions: repositorio `nmitic/perunio-api-sdk`, workflow `publicar.yml`. Desde ahí GitHub publica sin guardar ningún token, y cada versión lleva la procedencia (provenance) firmada.

## Cada versión

1. Si cambió la API: `npm run sincronizar:openapi` (copia la especificación desde `../perunio-backend`) y ajusta el código.
2. Anota los cambios en `CHANGELOG.md`.
3. Sube la versión y la etiqueta:
   ```bash
   npm version patch   # o minor / major
   git push --follow-tags
   ```
   La etiqueta `v*` dispara `.github/workflows/publicar.yml`, que verifica y publica.

Publica una versión del SDK solo cuando la API que usa ya está en producción.

## Otros registros

- **JSR** (jsr.io), para quien usa Deno: opcional; se agrega con un `jsr.json` y `npx jsr publish`.
- **GitHub Packages**: no conviene. Instalar desde ahí pide autenticación incluso para paquetes públicos.
