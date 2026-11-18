# Cambios

## 0.1.0

Primera versión.

- `ClientePerunio` con `descargaMasiva`, `trabajo`, `listarDescargasMasivas`, `obtenerComprobantes`, `obtenerComprobantesFallidos`, `reintentarFallidos` y `descargarArchivo`.
- `TrabajoDescargaMasiva` con `alProgresar`, `terminado`, `actualizar`, `cancelar`, `descargarZip`, `flujoZip` y `comprobantes`.
- `@perunio.dev/sdk/node`: `guardarZip` y `guardarArchivo`.
- Reintentos ante fallas pasajeras, `Idempotency-Key` automática y `ErrorPerunio` con el código de la API.
