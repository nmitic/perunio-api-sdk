/**
 * `@perunio/sdk/node`: guardar en disco, solo para Node.js. Aparte del SDK principal,
 * que no usa nada de Node y corre también en Bun, Deno y el edge.
 */

import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as FlujoWeb } from 'node:stream/web';

/** Lo que `guardarZip` necesita de una descarga masiva (un `TrabajoDescargaMasiva`). */
interface ConZip {
    flujoZip(opciones?: { senal?: AbortSignal }): Promise<ReadableStream<Uint8Array>>;
}

/**
 * Guarda el ZIP de una descarga masiva terminada en `ruta`, sin cargarlo entero en memoria.
 *
 * ```ts
 * await guardarZip(trabajo, 'compras-202610.zip');
 * ```
 */
export async function guardarZip(trabajo: ConZip, ruta: string, opciones: { senal?: AbortSignal } = {}): Promise<void> {
    const flujo = await trabajo.flujoZip(opciones);
    await pipeline(Readable.fromWeb(flujo as unknown as FlujoWeb<Uint8Array>), createWriteStream(ruta));
}

/** Guarda un archivo de `descargarArchivo` en `ruta` (o en su propio nombre si `ruta` se omite). */
export async function guardarArchivo(archivo: { nombre: string; datos: ArrayBuffer }, ruta: string = archivo.nombre): Promise<void> {
    await writeFile(ruta, new Uint8Array(archivo.datos));
}
