/**
 * `ClientePerunio`: la entrada al SDK. Cada método es una línea que delega en su
 * recurso (`recursos/`); una función nueva de la API es un recurso nuevo y un método aquí.
 */

import { ErrorPerunio } from './errores';
import {
    descargarArchivo,
    obtenerComprobantes,
    obtenerComprobantesFallidos,
    type OpcionesArchivo,
    type OpcionesFallidos,
    type OpcionesPeriodo,
} from './recursos/comprobantes';
import {
    crearDescargaMasiva,
    listarDescargasMasivas,
    type FiltroDescargasMasivas,
    type OpcionesDescargaMasiva,
} from './recursos/descargas-masivas';
import { reintentarFallidos, type OpcionesReintento, type ResumenReintento } from './reintentar';
import { TrabajoDescargaMasiva, type OpcionesTrabajo } from './trabajo';
import { Transporte } from './transporte';
import type { ArchivoDescargado, Comprobante, ComprobanteFallido, DescargaMasiva } from './tipos';

export const URL_BASE = 'https://api.perunio.pe/v1';

export interface OpcionesCliente {
    /** La clave de la empresa (`prn_live_…`), creada en Perunio → Integraciones → API. */
    claveApi?: string;
    /**
     * Otra dirección para la API. Úsala para pasar por tu propio backend, que agrega la
     * clave: así el SDK puede correr en un navegador sin que la clave llegue a él.
     */
    urlBase?: string;
    /** Un `fetch` propio (proxy, pruebas). Por defecto, el global. */
    fetch?: typeof fetch;
    /** Reintentos ante fallas pasajeras de red o de la API (429, 502, 503, 504). Por defecto 3. */
    reintentos?: number;
    /** Cada cuánto consultar una descarga masiva en curso, si la API no sugiere otro intervalo. Por defecto 5 s. */
    intervaloConsultaMs?: number;
}

export class ClientePerunio {
    private readonly transporte: Transporte;
    private readonly opcionesTrabajo: OpcionesTrabajo;

    /**
     * ```ts
     * const perunio = new ClientePerunio(process.env.PERUNIO_API_KEY!);
     * ```
     */
    constructor(claveApiUOpciones: string | OpcionesCliente) {
        const opciones = typeof claveApiUOpciones === 'string' ? { claveApi: claveApiUOpciones } : claveApiUOpciones;
        const urlBase = opciones.urlBase ?? URL_BASE;

        if (opciones.claveApi && enNavegador()) {
            throw new ErrorPerunio(
                'CLAVE_EN_NAVEGADOR',
                'No uses la clave de API en un navegador: cualquiera podría leerla y descargar los comprobantes de la empresa. ' +
                    'Llama a la API desde tu servidor, o pasa `urlBase` con tu propio backend, que agregue la clave.',
            );
        }
        if (!opciones.claveApi && urlBase === URL_BASE) {
            throw new ErrorPerunio('SIN_CLAVE', 'Falta la clave de API (`prn_live_…`), creada en Perunio → Integraciones → API.');
        }
        const fetchPropio = opciones.fetch ?? globalThis.fetch;
        if (typeof fetchPropio !== 'function') {
            throw new ErrorPerunio('ERROR_DE_RED', 'Este entorno no tiene `fetch`. Usa Node.js 20 o superior, o pasa `fetch` en las opciones.');
        }

        this.transporte = new Transporte({
            urlBase,
            claveApi: opciones.claveApi,
            // Se envuelve para que un `fetch` de navegador no pierda su `this`.
            fetch: (entrada, init) => fetchPropio(entrada, init),
            reintentos: opciones.reintentos ?? 3,
        });
        this.opcionesTrabajo = { intervaloConsultaMs: opciones.intervaloConsultaMs ?? 5_000 };
    }

    /**
     * Crea una descarga masiva: el periodo completo, o solo `comprobantes`. Devuelve el
     * trabajo en curso; espéralo con `terminado()` y baja el ZIP con `descargarZip()`.
     */
    descargaMasiva(opciones: OpcionesDescargaMasiva): Promise<TrabajoDescargaMasiva> {
        return crearDescargaMasiva(this.transporte, this.opcionesTrabajo, opciones);
    }

    /** Retoma una descarga masiva existente por su id (por ejemplo, después de reiniciar tu proceso). */
    trabajo(id: string): TrabajoDescargaMasiva {
        return new TrabajoDescargaMasiva(id, this.transporte, this.opcionesTrabajo);
    }

    /** Las descargas masivas creadas por API para esta empresa, de la más reciente a la más antigua. */
    listarDescargasMasivas(filtro: FiltroDescargasMasivas = {}): AsyncGenerator<DescargaMasiva> {
        return listarDescargasMasivas(this.transporte, filtro);
    }

    /** Los comprobantes del periodo, leídos de SIRE en el momento. No consume descargas. */
    obtenerComprobantes(opciones: OpcionesPeriodo): Promise<Comprobante[]> {
        return obtenerComprobantes(this.transporte, opciones);
    }

    /** Los comprobantes del periodo con algún archivo que SUNAT no entregó, con `tiposFallidos`. */
    obtenerComprobantesFallidos(opciones: OpcionesFallidos): Promise<ComprobanteFallido[]> {
        return obtenerComprobantesFallidos(this.transporte, opciones);
    }

    /** Vuelve a descargar solo lo que falló en el periodo, en vueltas, hasta que no quede nada. */
    reintentarFallidos(opciones: OpcionesReintento): Promise<ResumenReintento> {
        return reintentarFallidos(this.transporte, this.opcionesTrabajo, opciones);
    }

    /** Un archivo (XML, PDF o CDR) de un comprobante, al instante. Consume 1 descarga del plan. */
    descargarArchivo(opciones: OpcionesArchivo): Promise<ArchivoDescargado> {
        return descargarArchivo(this.transporte, opciones);
    }
}

/** Un navegador (no Node, Bun, Deno ni un worker de servidor): hay `window` y `document`. */
function enNavegador(): boolean {
    const global = globalThis as { window?: unknown; document?: unknown };
    return typeof global.window !== 'undefined' && typeof global.document !== 'undefined';
}
