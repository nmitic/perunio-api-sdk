/**
 * Una descarga masiva en curso o terminada. La API no avisa cuando avanza: el trabajo
 * se consulta cada pocos segundos, pero solo mientras alguien escucha (`alProgresar`)
 * o espera (`terminado`), y deja de consultar cuando termina.
 */

import { ErrorPerunio } from './errores';
import { esperar, esperaSugerida, type Transporte } from './transporte';
import {
    ESTADOS_FINALES,
    type ComprobanteDeDescarga,
    type ComprobanteOmitido,
    type DescargaMasiva,
    type EstadoComprobanteDeDescarga,
    type OpcionesLlamada,
    type Progreso,
} from './tipos';

export const RUTA_DESCARGAS_MASIVAS = '/descargas-masivas';

type Oyente = (progreso: Progreso) => void;

export interface OpcionesTrabajo {
    /** Cada cuánto consultar el trabajo, si la API no sugiere otro intervalo. */
    intervaloConsultaMs: number;
}

export class TrabajoDescargaMasiva {
    /** Los comprobantes que la API descartó al crear el trabajo (solo si se creó en esta instancia). */
    readonly comprobantesOmitidos: ComprobanteOmitido[];

    private ultimo: DescargaMasiva | null;
    private readonly oyentes = new Set<Oyente>();
    private esperando = 0;
    private sondeo: Promise<DescargaMasiva> | null = null;

    constructor(
        readonly id: string,
        private readonly transporte: Transporte,
        private readonly opciones: OpcionesTrabajo,
        inicial?: DescargaMasiva,
        omitidos: ComprobanteOmitido[] = [],
    ) {
        this.ultimo = inicial ?? null;
        this.comprobantesOmitidos = omitidos;
    }

    /** El último estado conocido del trabajo, sin consultar la API; `null` si aún no se consultó. */
    get estado(): DescargaMasiva | null {
        return this.ultimo;
    }

    private get ruta(): string {
        return `${RUTA_DESCARGAS_MASIVAS}/${encodeURIComponent(this.id)}`;
    }

    /**
     * Llama a `oyente` con el avance del trabajo cada vez que cambia, hasta que termina.
     * Devuelve una función que deja de escuchar.
     */
    alProgresar(oyente: Oyente): () => void {
        this.oyentes.add(oyente);
        if (this.ultimo) oyente(progresoDe(this.ultimo));
        void this.sondear().catch(() => undefined);
        return () => {
            this.oyentes.delete(oyente);
        };
    }

    /**
     * Espera a que el trabajo termine. Devuelve el trabajo si se completó; lanza
     * `ErrorPerunio` con el código de la API si falló, o `TRABAJO_CANCELADO` si se canceló.
     * Un trabajo completado puede traer `archivosFallidos` > 0: mira `comprobantes({ estado: 'fallido' })`.
     */
    async terminado(opciones: OpcionesLlamada = {}): Promise<DescargaMasiva> {
        this.esperando++;
        try {
            const final = await conSenal(this.sondear(), opciones.senal);
            if (final.estado === 'fallido') {
                throw new ErrorPerunio(
                    (final.error?.codigo ?? 'ERROR_INTERNO') as ErrorPerunio['codigo'],
                    final.error?.mensaje ?? 'La descarga masiva falló.',
                    { trabajo: final },
                );
            }
            if (final.estado === 'cancelado') {
                throw new ErrorPerunio('TRABAJO_CANCELADO', 'La descarga masiva se canceló.', { trabajo: final });
            }
            return final;
        } finally {
            this.esperando--;
        }
    }

    /** Consulta el trabajo una vez y avisa a los oyentes. */
    async actualizar(opciones: OpcionesLlamada = {}): Promise<DescargaMasiva> {
        const { datos } = await this.transporte.json<DescargaMasiva>({ ruta: this.ruta, senal: opciones.senal });
        this.recibir(datos);
        return datos;
    }

    /** Cancela el trabajo. Un trabajo cancelado no consume descargas del plan y no deja ZIP. */
    async cancelar(opciones: OpcionesLlamada = {}): Promise<DescargaMasiva> {
        const { datos } = await this.transporte.json<DescargaMasiva>({ metodo: 'DELETE', ruta: this.ruta, senal: opciones.senal });
        this.recibir(datos);
        return datos;
    }

    /** El ZIP completo en memoria. Para archivos grandes en Node, usa `guardarZip` de `@perunio/sdk/node`. */
    async descargarZip(opciones: OpcionesLlamada = {}): Promise<ArrayBuffer> {
        return (await this.respuestaZip(opciones)).arrayBuffer();
    }

    /** El ZIP como flujo, sin cargarlo entero en memoria. */
    async flujoZip(opciones: OpcionesLlamada = {}): Promise<ReadableStream<Uint8Array>> {
        const respuesta = await this.respuestaZip(opciones);
        if (!respuesta.body) throw new ErrorPerunio('RESPUESTA_INESPERADA', 'El ZIP llegó vacío.', { estadoHttp: respuesta.status });
        return respuesta.body;
    }

    /** El resultado por comprobante, en el orden enviado, página por página. */
    async *comprobantes(
        filtro: { estado?: EstadoComprobanteDeDescarga; porPagina?: number } & OpcionesLlamada = {},
    ): AsyncGenerator<ComprobanteDeDescarga> {
        let cursor: string | undefined;
        do {
            const { datos } = await this.transporte.json<{ datos: ComprobanteDeDescarga[]; siguienteCursor: string | null }>({
                ruta: `${this.ruta}/comprobantes`,
                consulta: { estado: filtro.estado, limite: filtro.porPagina ?? 500, cursor },
                senal: filtro.senal,
            });
            yield* datos.datos;
            cursor = datos.siguienteCursor ?? undefined;
        } while (cursor);
    }

    /**
     * `/archivo` responde 302 a un enlace temporal. El enlace se pide sin la clave: es de
     * otro dominio y ya está firmado. Un backend propio (`urlBase`) puede entregar el ZIP directo.
     */
    private async respuestaZip(opciones: OpcionesLlamada): Promise<Response> {
        const respuesta = await this.transporte.solicitar({ ruta: `${this.ruta}/archivo`, senal: opciones.senal, redireccionManual: true });
        if (respuesta.ok) return respuesta;
        const enlace = respuesta.headers.get('location');
        if (!enlace) {
            throw new ErrorPerunio('RESPUESTA_INESPERADA', 'La API no indicó dónde está el ZIP.', { estadoHttp: respuesta.status });
        }
        return this.transporte.externo(enlace, opciones.senal);
    }

    /** Un solo bucle de consultas, compartido por todos los que escuchan o esperan. */
    private sondear(): Promise<DescargaMasiva> {
        if (this.ultimo && ESTADOS_FINALES.includes(this.ultimo.estado)) return Promise.resolve(this.ultimo);
        this.sondeo ??= this.bucle().finally(() => {
            this.sondeo = null;
        });
        return this.sondeo;
    }

    private async bucle(): Promise<DescargaMasiva> {
        for (;;) {
            const respuesta = await this.transporte.solicitar({ ruta: this.ruta });
            const trabajo = (await respuesta.json()) as DescargaMasiva;
            this.recibir(trabajo);
            if (ESTADOS_FINALES.includes(trabajo.estado)) return trabajo;
            // Nadie escucha ni espera: no seguir consultando (ni mantener vivo el proceso).
            if (this.oyentes.size === 0 && this.esperando === 0) return trabajo;
            await esperar(esperaSugerida(respuesta) ?? this.opciones.intervaloConsultaMs);
            // `cancelar()` o `actualizar()` pudieron traer el final mientras se esperaba.
            const ultimo = this.ultimo;
            if (ultimo && ESTADOS_FINALES.includes(ultimo.estado)) return ultimo;
        }
    }

    private recibir(trabajo: DescargaMasiva): void {
        const anterior = this.ultimo;
        this.ultimo = trabajo;
        if (anterior && !cambio(anterior, trabajo)) return;
        const progreso = progresoDe(trabajo);
        for (const oyente of this.oyentes) oyente(progreso);
    }
}

export function progresoDe(trabajo: DescargaMasiva): Progreso {
    const total = trabajo.totalComprobantes;
    let porcentaje: number | null;
    if (trabajo.estado === 'listando') porcentaje = null;
    else if (trabajo.estado === 'completado') porcentaje = 100;
    else if (total === 0) porcentaje = 0;
    else porcentaje = Math.min(100, Math.round((trabajo.comprobantesProcesados / total) * 100));
    return {
        estado: trabajo.estado,
        totalComprobantes: total,
        comprobantesProcesados: trabajo.comprobantesProcesados,
        archivosDescargados: trabajo.archivosDescargados,
        archivosFallidos: trabajo.archivosFallidos,
        porcentaje,
        trabajo,
    };
}

const cambio = (a: DescargaMasiva, b: DescargaMasiva) =>
    a.estado !== b.estado ||
    a.totalComprobantes !== b.totalComprobantes ||
    a.comprobantesProcesados !== b.comprobantesProcesados ||
    a.archivosDescargados !== b.archivosDescargados ||
    a.archivosFallidos !== b.archivosFallidos;

/** La promesa, o el motivo de la señal si se aborta antes (sin cancelar la consulta compartida). */
function conSenal<T>(promesa: Promise<T>, senal?: AbortSignal): Promise<T> {
    if (!senal) return promesa;
    if (senal.aborted) return Promise.reject(senal.reason);
    return new Promise<T>((resolver, rechazar) => {
        const alAbortar = () => rechazar(senal.reason);
        senal.addEventListener('abort', alAbortar, { once: true });
        promesa.then(
            (valor) => {
                senal.removeEventListener('abort', alAbortar);
                resolver(valor);
            },
            (error: unknown) => {
                senal.removeEventListener('abort', alAbortar);
                rechazar(error);
            },
        );
    });
}
