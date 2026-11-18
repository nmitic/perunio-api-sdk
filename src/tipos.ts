/**
 * Los tipos públicos del SDK. Los que describen respuestas de la API salen de
 * `tipos-api.ts`, generado desde la especificación OpenAPI, así que no pueden
 * desviarse de lo que el servidor envía.
 */

import type { components } from './tipos-api';

type Esquemas = components['schemas'];

/** Una descarga masiva, tal como la devuelve la API. */
export type DescargaMasiva = Esquemas['DescargaMasiva'];
/** La respuesta al crear una descarga masiva: el trabajo y los comprobantes descartados. */
export type DescargaMasivaCreada = Esquemas['DescargaMasivaCreada'];
/** Un comprobante del periodo, leído de SIRE, con el estado de descarga de cada archivo. */
export type Comprobante = Esquemas['Comprobante'];
/** Lo que identifica a un comprobante para descargarlo. */
export type ComprobanteADescargar = Esquemas['ComprobanteADescargar'];
/** Un comprobante que la API descartó al crear el trabajo: tipo no descargable o repetido. */
export type ComprobanteOmitido = Esquemas['ComprobanteOmitido'];
/** El resultado de un comprobante dentro de una descarga masiva. */
export type ComprobanteDeDescarga = Esquemas['ComprobanteDeDescarga'];

export type Registro = DescargaMasiva['registro'];
export type TipoArchivo = DescargaMasiva['tiposArchivo'][number];
export type EstadoDescargaMasiva = DescargaMasiva['estado'];
export type EstadoComprobanteDeDescarga = ComprobanteDeDescarga['estado'];

/** Los códigos de error que puede responder la API. */
export type CodigoErrorApi = Esquemas['Error']['error']['codigo'];

/** Un comprobante con algún archivo fallido, y cuáles vale la pena volver a pedir. */
export type ComprobanteFallido = Comprobante & {
    /** Los archivos cuyo último intento falló (sin `COMPROBANTE_NO_ENCONTRADO`, salvo que se pida). */
    tiposFallidos: TipoArchivo[];
};

/** Opciones que aceptan todas las llamadas. */
export interface OpcionesLlamada {
    /** Cancela la llamada (y la espera entre consultas) cuando se aborta. */
    senal?: AbortSignal | undefined;
}

/** Un archivo descargado con `descargarArchivo`. */
export interface ArchivoDescargado {
    /** El nombre que dio SUNAT, o `RUC-TIPO-SERIE-NUMERO.ext`. */
    nombre: string;
    tipoContenido: string;
    datos: ArrayBuffer;
    /** Descargas que quedan en el periodo del plan; `null` si el plan es ilimitado. */
    descargasRestantes: number | null;
}

/** Lo que recibe `alProgresar` cada vez que el trabajo avanza. */
export interface Progreso {
    estado: EstadoDescargaMasiva;
    totalComprobantes: number;
    comprobantesProcesados: number;
    archivosDescargados: number;
    archivosFallidos: number;
    /** De 0 a 100. `null` mientras se lista el periodo, porque aún no se sabe el total. */
    porcentaje: number | null;
    /** El trabajo completo, tal como lo devolvió la API. */
    trabajo: DescargaMasiva;
}

export const ESTADOS_FINALES: readonly EstadoDescargaMasiva[] = ['completado', 'fallido', 'cancelado'];
export const TODOS_LOS_TIPOS: readonly TipoArchivo[] = ['xml', 'pdf', 'cdr'];
