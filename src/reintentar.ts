/**
 * `reintentarFallidos`: volver a descargar solo lo que falló, como en Registros de la
 * app (filtrar los fallidos, descargarlos, volver a filtrar), hasta que no quede nada.
 */

import { obtenerComprobantesFallidos } from './recursos/comprobantes';
import { crearDescargaMasiva } from './recursos/descargas-masivas';
import type { OpcionesTrabajo, TrabajoDescargaMasiva } from './trabajo';
import { esperar, type Transporte } from './transporte';
import type { ComprobanteFallido, DescargaMasiva, OpcionesLlamada, Progreso, Registro, TipoArchivo } from './tipos';

export interface OpcionesReintento extends OpcionesLlamada {
    registro: Registro;
    /** AAAAMM, por ejemplo `"202610"`. */
    periodo: string;
    /** Cuántas vueltas como máximo. Cada vuelta vuelve a listar lo que sigue fallando. Por defecto 3. */
    rondas?: number;
    /** Espera entre vueltas, para que una falla pasajera de SUNAT se resuelva. Por defecto 60 s. */
    esperaEntreRondasMs?: number;
    /** Reintentos por archivo dentro de cada descarga masiva, de 0 a 8. */
    reintentosMaximos?: number;
    /** El avance de cada descarga masiva que se crea. */
    alProgresar?: (progreso: Progreso, trabajo: TrabajoDescargaMasiva) => void;
    /**
     * Cuando termina cada descarga masiva, por ejemplo para guardar su ZIP.
     * El SDK espera a que la promesa termine antes de seguir.
     */
    alTerminarTrabajo?: (trabajo: TrabajoDescargaMasiva, final: DescargaMasiva) => void | Promise<void>;
}

export interface ResumenReintento {
    /** Las descargas masivas creadas, en orden. Cada una tiene su propio ZIP. */
    trabajos: TrabajoDescargaMasiva[];
    /** Archivos recuperados en total. */
    archivosDescargados: number;
    /** Lo que seguía fallando al final (sin `COMPROBANTE_NO_ENCONTRADO`). */
    siguenFallando: ComprobanteFallido[];
}

/** Lo que tarda la API en registrar el resultado de un trabajo recién terminado. */
const ASIENTO_MS = 3_000;

export async function reintentarFallidos(
    transporte: Transporte,
    opcionesTrabajo: OpcionesTrabajo,
    opciones: OpcionesReintento,
): Promise<ResumenReintento> {
    const rondas = opciones.rondas ?? 3;
    const espera = opciones.esperaEntreRondasMs ?? 60_000;
    const periodo = { registro: opciones.registro, periodo: opciones.periodo, senal: opciones.senal };
    const trabajos: TrabajoDescargaMasiva[] = [];
    let archivosDescargados = 0;
    let fallidos = await obtenerComprobantesFallidos(transporte, periodo);

    for (let ronda = 1; ronda <= rondas && fallidos.length > 0; ronda++) {
        // `tiposArchivo` vale para todo el trabajo: un trabajo por combinación de archivos
        // fallidos, para no volver a descargar (ni cobrar) lo que ya se descargó.
        for (const [tipos, comprobantes] of agruparPorTipos(fallidos)) {
            const trabajo = await crearDescargaMasiva(transporte, opcionesTrabajo, {
                ...periodo,
                comprobantes,
                tiposArchivo: tipos,
                ...(opciones.reintentosMaximos === undefined ? {} : { reintentosMaximos: opciones.reintentosMaximos }),
            });
            trabajos.push(trabajo);
            const dejar = opciones.alProgresar ? trabajo.alProgresar((p) => opciones.alProgresar!(p, trabajo)) : undefined;
            try {
                // Una descarga masiva a la vez por empresa: los grupos van uno tras otro.
                const final = await trabajo.terminado({ senal: opciones.senal });
                archivosDescargados += final.archivosDescargados;
                await opciones.alTerminarTrabajo?.(trabajo, final);
            } finally {
                dejar?.();
            }
        }
        await esperar(ronda < rondas ? espera : ASIENTO_MS, opciones.senal);
        fallidos = await obtenerComprobantesFallidos(transporte, periodo);
    }

    return { trabajos, archivosDescargados, siguenFallando: fallidos };
}

/** `[['pdf'], [A, B]]`, `[['xml', 'pdf'], [C]]`: los comprobantes según qué archivos les fallaron. */
export function agruparPorTipos(fallidos: ComprobanteFallido[]): Array<[TipoArchivo[], ComprobanteFallido[]]> {
    const grupos = new Map<string, [TipoArchivo[], ComprobanteFallido[]]>();
    for (const comprobante of fallidos) {
        const tipos = [...comprobante.tiposFallidos].sort();
        const clave = tipos.join(',');
        const grupo = grupos.get(clave) ?? [tipos, []];
        grupo[1].push(comprobante);
        grupos.set(clave, grupo);
    }
    return [...grupos.values()];
}
