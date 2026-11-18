import type { CodigoErrorApi, DescargaMasiva } from './tipos';

/**
 * Códigos que produce el propio SDK, sin respuesta de la API:
 * - `CLAVE_EN_NAVEGADOR`: se creó el cliente con una clave `prn_live_` dentro de un navegador.
 * - `SIN_CLAVE`: no hay clave ni una `urlBase` propia (un backend que la agregue).
 * - `ERROR_DE_RED`: no hubo respuesta, después de los reintentos.
 * - `RESPUESTA_INESPERADA`: la respuesta no tiene la forma de la API (por ejemplo, un proxy).
 * - `TRABAJO_CANCELADO`: se esperaba que la descarga masiva terminara, y se canceló.
 */
export type CodigoErrorSdk =
    | 'CLAVE_EN_NAVEGADOR'
    | 'SIN_CLAVE'
    | 'ERROR_DE_RED'
    | 'RESPUESTA_INESPERADA'
    | 'TRABAJO_CANCELADO';

export type CodigoError = CodigoErrorApi | CodigoErrorSdk;

interface DatosError {
    estadoHttp?: number | null;
    detalles?: unknown;
    idSolicitud?: string | null;
    trabajo?: DescargaMasiva;
    causa?: unknown;
}

/**
 * Todo error del SDK. Decide con `codigo`, que es estable; `message` es para personas.
 *
 * ```ts
 * try { ... } catch (e) {
 *   if (e instanceof ErrorPerunio && e.codigo === 'TRABAJO_ACTIVO_EXISTENTE') perunio.trabajo(e.idTrabajo!);
 * }
 * ```
 */
export class ErrorPerunio extends Error {
    readonly codigo: CodigoError;
    /** El estado HTTP de la respuesta; `null` si el error no vino de una respuesta. */
    readonly estadoHttp: number | null;
    /** Los `detalles` que envió la API, si los hay. */
    readonly detalles: unknown;
    /** El `idSolicitud` de la respuesta: inclúyelo si escribes a soporte. */
    readonly idSolicitud: string | null;
    /** La descarga masiva, cuando el error es que falló o se canceló. */
    readonly trabajo: DescargaMasiva | undefined;

    constructor(codigo: CodigoError, mensaje: string, datos: DatosError = {}) {
        super(mensaje, datos.causa === undefined ? undefined : { cause: datos.causa });
        this.name = 'ErrorPerunio';
        this.codigo = codigo;
        this.estadoHttp = datos.estadoHttp ?? null;
        this.detalles = datos.detalles;
        this.idSolicitud = datos.idSolicitud ?? null;
        this.trabajo = datos.trabajo;
    }

    /** Con `TRABAJO_ACTIVO_EXISTENTE` o `CLAVE_IDEMPOTENCIA_REUSADA`, el id del trabajo que ya existe. */
    get idTrabajo(): string | undefined {
        const detalles = this.detalles as { idTrabajo?: unknown } | null | undefined;
        return typeof detalles?.idTrabajo === 'string' ? detalles.idTrabajo : undefined;
    }
}
