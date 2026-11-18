/**
 * Las solicitudes HTTP del SDK: la clave, el JSON, los reintentos y los errores, en
 * un solo lugar. Usa solo `fetch`, así que corre en Node 20+, Bun, Deno y el edge.
 */

import { ErrorPerunio } from './errores';

export interface OpcionesTransporte {
    urlBase: string;
    claveApi: string | undefined;
    fetch: typeof fetch;
    /** Reintentos ante una falla pasajera (red, 429, 502, 503, 504). */
    reintentos: number;
}

export interface Solicitud {
    metodo?: 'GET' | 'POST' | 'DELETE';
    ruta: string;
    consulta?: Record<string, string | number | undefined>;
    cuerpo?: unknown;
    encabezados?: Record<string, string>;
    senal?: AbortSignal | undefined;
    /** Si se puede repetir sin riesgo. Las lecturas siempre; un POST solo con `Idempotency-Key`. */
    reintentable?: boolean;
    /** Para `/archivo`: no seguir la redirección, para que la clave no viaje al enlace temporal. */
    redireccionManual?: boolean;
}

const ESTADOS_PASAJEROS = new Set([429, 502, 503, 504]);
const ESPERA_MAXIMA_MS = 60_000;

/** Espera `ms`, o rechaza con el motivo de la señal si se aborta antes. */
export function esperar(ms: number, senal?: AbortSignal): Promise<void> {
    return new Promise((resolver, rechazar) => {
        if (senal?.aborted) return rechazar(senal.reason);
        const temporizador = setTimeout(() => {
            senal?.removeEventListener('abort', alAbortar);
            resolver();
        }, ms);
        const alAbortar = () => {
            clearTimeout(temporizador);
            rechazar(senal?.reason);
        };
        senal?.addEventListener('abort', alAbortar, { once: true });
    });
}

/** Los segundos de `Retry-After`, en milisegundos; `null` si no viene o no es un número. */
export function esperaSugerida(respuesta: Response): number | null {
    const valor = respuesta.headers.get('retry-after');
    if (valor === null) return null;
    const segundos = Number(valor);
    return Number.isFinite(segundos) && segundos >= 0 ? Math.min(segundos * 1000, ESPERA_MAXIMA_MS) : null;
}

export class Transporte {
    constructor(private readonly opciones: OpcionesTransporte) {}

    /** La respuesta cruda; lanza `ErrorPerunio` si no es 2xx ni (con `redireccionManual`) 3xx. */
    async solicitar(solicitud: Solicitud): Promise<Response> {
        const metodo = solicitud.metodo ?? 'GET';
        const reintentable = solicitud.reintentable ?? metodo === 'GET';
        const intentos = reintentable ? this.opciones.reintentos + 1 : 1;

        for (let intento = 1; ; intento++) {
            let respuesta: Response;
            try {
                respuesta = await this.opciones.fetch(this.url(solicitud), {
                    method: metodo,
                    headers: this.encabezados(solicitud),
                    ...(solicitud.cuerpo === undefined ? {} : { body: JSON.stringify(solicitud.cuerpo) }),
                    ...(solicitud.redireccionManual ? { redirect: 'manual' as const } : {}),
                    ...(solicitud.senal ? { signal: solicitud.senal } : {}),
                });
            } catch (error) {
                if (solicitud.senal?.aborted) throw error;
                if (intento < intentos) {
                    await esperar(retroceso(intento), solicitud.senal);
                    continue;
                }
                throw new ErrorPerunio('ERROR_DE_RED', 'No se pudo conectar con la API Perunio.', { causa: error });
            }

            if (respuesta.ok || (solicitud.redireccionManual && esRedireccion(respuesta))) return respuesta;

            if (ESTADOS_PASAJEROS.has(respuesta.status) && intento < intentos) {
                // Liberar la conexión sin esperar: cancelar puede quedar pendiente en algunos entornos.
                void respuesta.body?.cancel().catch(() => undefined);
                await esperar(esperaSugerida(respuesta) ?? retroceso(intento), solicitud.senal);
                continue;
            }
            throw await errorDeRespuesta(respuesta);
        }
    }

    /** Un enlace fuera de la API (el ZIP firmado): sin la clave, con el `fetch` configurado. */
    async externo(url: string, senal?: AbortSignal): Promise<Response> {
        const respuesta = await this.opciones.fetch(url, senal ? { signal: senal } : {});
        if (!respuesta.ok) {
            throw new ErrorPerunio('RESPUESTA_INESPERADA', `No se pudo bajar el archivo (${respuesta.status}).`, { estadoHttp: respuesta.status });
        }
        return respuesta;
    }

    /** El cuerpo JSON de una respuesta correcta. */
    async json<T>(solicitud: Solicitud): Promise<{ datos: T; respuesta: Response }> {
        const respuesta = await this.solicitar(solicitud);
        try {
            return { datos: (await respuesta.json()) as T, respuesta };
        } catch (error) {
            throw new ErrorPerunio('RESPUESTA_INESPERADA', 'La API respondió algo que no es JSON.', {
                estadoHttp: respuesta.status,
                causa: error,
            });
        }
    }

    private url({ ruta, consulta }: Solicitud): string {
        const url = new URL(this.opciones.urlBase.replace(/\/+$/, '') + ruta);
        for (const [nombre, valor] of Object.entries(consulta ?? {})) {
            if (valor !== undefined) url.searchParams.set(nombre, String(valor));
        }
        return url.toString();
    }

    private encabezados(solicitud: Solicitud): Record<string, string> {
        return {
            Accept: 'application/json',
            ...(this.opciones.claveApi ? { Authorization: `Bearer ${this.opciones.claveApi}` } : {}),
            ...(solicitud.cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...solicitud.encabezados,
        };
    }
}

const esRedireccion = (respuesta: Response) =>
    (respuesta.status >= 300 && respuesta.status < 400) || respuesta.type === 'opaqueredirect';

/** 1 s, 2 s, 4 s… hasta 30 s. */
const retroceso = (intento: number) => Math.min(1000 * 2 ** (intento - 1), 30_000);

/** El error de la API (`{ error: { codigo, mensaje, detalles, idSolicitud } }`) como ErrorPerunio. */
async function errorDeRespuesta(respuesta: Response): Promise<ErrorPerunio> {
    let cuerpo: unknown;
    try {
        cuerpo = await respuesta.json();
    } catch {
        cuerpo = undefined;
    }
    const error = (cuerpo as { error?: { codigo?: unknown; mensaje?: unknown; detalles?: unknown; idSolicitud?: unknown } } | undefined)?.error;
    if (!error || typeof error.codigo !== 'string') {
        return new ErrorPerunio('RESPUESTA_INESPERADA', `La API respondió ${respuesta.status} sin un error reconocible.`, {
            estadoHttp: respuesta.status,
            idSolicitud: respuesta.headers.get('x-request-id'),
        });
    }
    return new ErrorPerunio(error.codigo as ErrorPerunio['codigo'], typeof error.mensaje === 'string' ? error.mensaje : error.codigo, {
        estadoHttp: respuesta.status,
        detalles: error.detalles,
        idSolicitud: typeof error.idSolicitud === 'string' ? error.idSolicitud : respuesta.headers.get('x-request-id'),
    });
}
