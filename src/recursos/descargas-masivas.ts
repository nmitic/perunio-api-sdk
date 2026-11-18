/** `/descargas-masivas`: crear, retomar y listar descargas masivas. */

import { RUTA_DESCARGAS_MASIVAS, TrabajoDescargaMasiva, type OpcionesTrabajo } from '../trabajo';
import type { Transporte } from '../transporte';
import {
    TODOS_LOS_TIPOS,
    type ComprobanteADescargar,
    type DescargaMasiva,
    type DescargaMasivaCreada,
    type EstadoDescargaMasiva,
    type OpcionesLlamada,
    type Registro,
    type TipoArchivo,
} from '../tipos';

export interface OpcionesDescargaMasiva extends OpcionesLlamada {
    registro: Registro;
    /** AAAAMM, por ejemplo `"202610"`. */
    periodo: string;
    /**
     * Los comprobantes a descargar (hasta 10 000). Sin ellos se descarga el periodo
     * completo según SIRE. Acepta las filas de `obtenerComprobantes` tal cual.
     */
    comprobantes?: ComprobanteADescargar[];
    /** Por defecto XML, PDF y CDR. Cada archivo descargado consume 1 descarga del plan. */
    tiposArchivo?: TipoArchivo[];
    /** Reintentos por archivo ante fallas pasajeras de SUNAT, de 0 a 8 (la API usa 3 si no se envía). */
    reintentosMaximos?: number;
    /**
     * Repetir la llamada con la misma clave devuelve el mismo trabajo en vez de crear otro.
     * El SDK genera una por llamada, así que un reintento por un corte de red nunca duplica el trabajo.
     */
    claveIdempotencia?: string;
}

export async function crearDescargaMasiva(
    transporte: Transporte,
    opcionesTrabajo: OpcionesTrabajo,
    opciones: OpcionesDescargaMasiva,
): Promise<TrabajoDescargaMasiva> {
    const cuerpo = {
        registro: opciones.registro,
        periodo: opciones.periodo,
        tiposArchivo: opciones.tiposArchivo ?? [...TODOS_LOS_TIPOS],
        ...(opciones.comprobantes
            ? { comprobantes: opciones.comprobantes.map(({ rucEmisor, codTipoCdp, serie, numero }) => ({ rucEmisor, codTipoCdp, serie, numero })) }
            : {}),
        ...(opciones.reintentosMaximos === undefined ? {} : { reintentosMaximos: opciones.reintentosMaximos }),
    };
    const { datos } = await transporte.json<DescargaMasivaCreada>({
        metodo: 'POST',
        ruta: RUTA_DESCARGAS_MASIVAS,
        cuerpo,
        encabezados: { 'Idempotency-Key': opciones.claveIdempotencia ?? globalThis.crypto.randomUUID() },
        reintentable: true,
        senal: opciones.senal,
    });
    const { comprobantesOmitidos, ...trabajo } = datos;
    return new TrabajoDescargaMasiva(datos.id, transporte, opcionesTrabajo, trabajo, comprobantesOmitidos);
}

export interface FiltroDescargasMasivas extends OpcionesLlamada {
    estado?: EstadoDescargaMasiva;
    /** Trabajos por página, de 1 a 100. */
    porPagina?: number;
}

export async function* listarDescargasMasivas(transporte: Transporte, filtro: FiltroDescargasMasivas = {}): AsyncGenerator<DescargaMasiva> {
    let cursor: string | undefined;
    do {
        const { datos } = await transporte.json<{ datos: DescargaMasiva[]; siguienteCursor: string | null }>({
            ruta: RUTA_DESCARGAS_MASIVAS,
            consulta: { estado: filtro.estado, limite: filtro.porPagina ?? 20, cursor },
            senal: filtro.senal,
        });
        yield* datos.datos;
        cursor = datos.siguienteCursor ?? undefined;
    } while (cursor);
}
