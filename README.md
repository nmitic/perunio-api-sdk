# @perunio/sdk

Cliente TypeScript de la [API Perunio](https://perunio.pe/desarrolladores): descarga el XML, PDF y CDR de los comprobantes SUNAT de una empresa, de compras (`rce`) y de ventas (`rvie`).

- Sin dependencias. Corre en Node.js 20+, Bun, Deno y el edge (Cloudflare Workers, Vercel).
- Tipos generados desde la especificación OpenAPI de la API.
- Para usar desde tu servidor: la clave da acceso a todos los comprobantes de la empresa, y el SDK no se crea dentro de un navegador.

```bash
npm install @perunio/sdk
```

## Crear el cliente

La clave es de una empresa: créala en Perunio → **Integraciones → API**. Guárdala como secreto, nunca en el código.

```ts
import { ClientePerunio } from '@perunio/sdk';

const perunio = new ClientePerunio(process.env.PERUNIO_API_KEY!);
```

## Descarga masiva

Todo un periodo en un ZIP: XML, PDF y CDR de cada comprobante.

```ts
import { guardarZip } from '@perunio/sdk/node';

const trabajo = await perunio.descargaMasiva({ registro: 'rce', periodo: '202610' });
await trabajo.terminado();
await guardarZip(trabajo, 'compras-202610.zip');
```

Solo algunos comprobantes, o solo algunos archivos:

```ts
const trabajo = await perunio.descargaMasiva({
  registro: 'rce',
  periodo: '202610',
  comprobantes: [{ rucEmisor: '20100070970', codTipoCdp: '01', serie: 'F001', numero: '123' }],
  tiposArchivo: ['xml'],
});
```

Cada archivo descargado consume 1 descarga del plan. Un trabajo que falla o se cancela no consume nada.

## Reintentar los que fallaron

Si SUNAT no entregó algún archivo, el trabajo termina igual con todo lo demás. Para volver a pedir solo lo que falló, como en Registros de la app:

```ts
const { trabajos, siguenFallando } = await perunio.reintentarFallidos({
  registro: 'rce',
  periodo: '202610',
  alTerminarTrabajo: (trabajo) => guardarZip(trabajo, `reintento-${trabajo.id}.zip`),
});
```

Pide cada archivo solo una vez (no vuelve a cobrar lo que ya se descargó), deja fuera lo que SUNAT no tiene (`COMPROBANTE_NO_ENCONTRADO`) y repite hasta 3 vueltas. Para hacerlo a mano:

```ts
const fallidos = await perunio.obtenerComprobantesFallidos({ registro: 'rce', periodo: '202610' });
// cada uno trae tiposFallidos, por ejemplo ['pdf']
await perunio.descargaMasiva({ registro: 'rce', periodo: '202610', comprobantes: fallidos, tiposArchivo: ['pdf'] });
```

## Progreso y cancelación

```ts
const dejarDeEscuchar = trabajo.alProgresar(({ estado, porcentaje, archivosDescargados }) => {
  console.log(estado, porcentaje, archivosDescargados); // porcentaje es null mientras se lista el periodo
});

await trabajo.cancelar();

// Retomar un trabajo por su id, por ejemplo después de reiniciar el proceso
const mismo = perunio.trabajo('6f1c…');
```

El trabajo se consulta solo mientras alguien escucha o espera, y deja de consultarse al terminar.

## Comprobantes del periodo

Leídos de SIRE en el momento. No consume descargas.

```ts
const comprobantes = await perunio.obtenerComprobantes({ registro: 'rvie', periodo: '202610' });
// fechaEmision, contraparte, montos, estadosDescarga…
```

## Un archivo

```ts
import { guardarArchivo } from '@perunio/sdk/node';

const archivo = await perunio.descargarArchivo({
  registro: 'rce', rucEmisor: '20100070970', codTipoCdp: '01', serie: 'F001', numero: '123', tipoArchivo: 'xml',
});
await guardarArchivo(archivo); // con el nombre que dio SUNAT
```

## Errores

Todo error es un `ErrorPerunio`. Decide con `codigo`, que no cambia; `message` es para personas.

```ts
import { ErrorPerunio } from '@perunio/sdk';

try {
  await perunio.descargaMasiva({ registro: 'rce', periodo: '202610' });
} catch (error) {
  if (error instanceof ErrorPerunio && error.codigo === 'TRABAJO_ACTIVO_EXISTENTE') {
    await perunio.trabajo(error.idTrabajo!).terminado();
  }
}
```

Los códigos de la API están en la [documentación](https://perunio.pe/desarrolladores#api). El SDK agrega `SIN_CLAVE`, `CLAVE_EN_NAVEGADOR`, `ERROR_DE_RED`, `RESPUESTA_INESPERADA` y `TRABAJO_CANCELADO`. Las fallas pasajeras (red, 429, 502, 503, 504) se reintentan solas; crear una descarga masiva lleva una `Idempotency-Key`, así que un reintento nunca la duplica.

## Opciones

| Opción | Por defecto | |
|---|---|---|
| `claveApi` | | La clave de la empresa |
| `urlBase` | `https://api.perunio.pe/v1` | Otra dirección, por ejemplo un entorno de pruebas |
| `fetch` | el global | Un `fetch` propio |
| `reintentos` | `3` | Ante fallas pasajeras |
| `intervaloConsultaMs` | `5000` | Cada cuánto consultar un trabajo en curso |

Toda llamada acepta `senal` (un `AbortSignal`) para cancelarla.

## Licencia

MIT
