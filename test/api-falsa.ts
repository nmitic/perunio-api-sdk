/**
 * Una API Perunio falsa para las pruebas: un `fetch` que responde según el método y
 * la ruta, y guarda cada llamada para revisarla después.
 */

import { ClientePerunio, type DescargaMasiva } from '../src/indice';

export interface Llamada {
    metodo: string;
    url: URL;
    encabezados: Record<string, string>;
    cuerpo: unknown;
}

type Manejador = (llamada: Llamada) => Response | Promise<Response>;

export function apiFalsa() {
    const rutas = new Map<string, Manejador[]>();
    const llamadas: Llamada[] = [];

    const fetchFalso: typeof fetch = async (entrada, init) => {
        const url = new URL(String(entrada));
        const encabezados = Object.fromEntries(new Headers(init?.headers).entries());
        const llamada: Llamada = {
            metodo: init?.method ?? 'GET',
            url,
            encabezados,
            cuerpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        };
        llamadas.push(llamada);
        const clave = `${llamada.metodo} ${url.origin === 'https://api.perunio.pe' ? url.pathname.replace(/^\/v1/, '') : url.href.split('?')[0]}`;
        const cola = rutas.get(clave);
        if (!cola?.length) throw new Error(`Sin respuesta preparada para ${clave}`);
        // El último manejador de una ruta se repite; los anteriores se usan una vez cada uno.
        const manejador = cola.length > 1 ? cola.shift()! : cola[0]!;
        return manejador(llamada);
    };

    return {
        llamadas,
        fetch: fetchFalso,
        /** Prepara la respuesta a `METODO /ruta` (sin `/v1`). Varias llamadas encolan respuestas. */
        en(metodoRuta: string, manejador: Manejador | Response | unknown) {
            const cola = rutas.get(metodoRuta) ?? [];
            cola.push(typeof manejador === 'function' ? (manejador as Manejador) : () => clonar(manejador));
            rutas.set(metodoRuta, cola);
            return this;
        },
        cliente(opciones: { reintentos?: number; intervaloConsultaMs?: number } = {}) {
            return new ClientePerunio({
                claveApi: 'prn_live_prueba',
                fetch: fetchFalso,
                reintentos: opciones.reintentos ?? 0,
                intervaloConsultaMs: opciones.intervaloConsultaMs ?? 1,
            });
        },
    };
}

function clonar(valor: unknown): Response {
    return valor instanceof Response ? valor.clone() : json(valor);
}

export const json = (cuerpo: unknown, estado = 200, encabezados: Record<string, string> = {}) =>
    new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json', ...encabezados } });

export const errorApi = (estado: number, codigo: string, detalles?: unknown, encabezados: Record<string, string> = {}) =>
    json({ error: { codigo, mensaje: `mensaje de ${codigo}`, ...(detalles === undefined ? {} : { detalles }), idSolicitud: 'req_1' } }, estado, encabezados);

export const ID = '6f1c0000-0000-0000-0000-000000000001';

export function trabajo(cambios: Partial<DescargaMasiva> = {}): DescargaMasiva {
    return {
        id: ID,
        estado: 'en_cola',
        modo: 'periodo',
        registro: 'rce',
        periodo: '202610',
        tiposArchivo: ['xml', 'pdf', 'cdr'],
        reintentosMaximos: 3,
        totalComprobantes: 0,
        comprobantesProcesados: 0,
        archivosDescargados: 0,
        archivosFallidos: 0,
        archivoDisponible: false,
        tamanoArchivoBytes: null,
        expiraEn: null,
        error: null,
        creadoEn: '2026-11-18T12:00:00.000Z',
        iniciadoEn: null,
        terminadoEn: null,
        enlaces: {
            propio: `/v1/descargas-masivas/${ID}`,
            comprobantes: `/v1/descargas-masivas/${ID}/comprobantes`,
            archivo: `/v1/descargas-masivas/${ID}/archivo`,
        },
        ...cambios,
    };
}
