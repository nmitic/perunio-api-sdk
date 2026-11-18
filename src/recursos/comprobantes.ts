/** `/comprobantes`: el listado del periodo y la descarga de un archivo. */

import type { Transporte } from '../transporte';
import type {
    ArchivoDescargado,
    Comprobante,
    ComprobanteFallido,
    OpcionesLlamada,
    Registro,
    TipoArchivo,
} from '../tipos';

export interface OpcionesPeriodo extends OpcionesLlamada {
    registro: Registro;
    /** AAAAMM, por ejemplo `"202610"`. */
    periodo: string;
}

export interface OpcionesFallidos extends OpcionesPeriodo {
    /**
     * Incluir los archivos que SUNAT no tiene (`COMPROBANTE_NO_ENCONTRADO`). Por defecto
     * se dejan fuera: SUNAT responde lo mismo cada vez que se piden.
     */
    incluirNoEncontrados?: boolean;
}

export interface OpcionesArchivo extends OpcionesLlamada {
    registro: Registro;
    rucEmisor: string;
    codTipoCdp: string;
    serie: string;
    numero: string;
    tipoArchivo: TipoArchivo;
    /** Reintentos ante una falla pasajera de SUNAT, de 0 a 3. */
    reintentos?: number;
}

const NO_ENCONTRADO = 'COMPROBANTE_NO_ENCONTRADO';

export async function obtenerComprobantes(transporte: Transporte, opciones: OpcionesPeriodo, soloFallidos = false): Promise<Comprobante[]> {
    const { datos } = await transporte.json<{ datos: Comprobante[] }>({
        ruta: '/comprobantes',
        consulta: { registro: opciones.registro, periodo: opciones.periodo, estadoDescarga: soloFallidos ? 'fallido' : undefined },
        senal: opciones.senal,
    });
    return datos.datos;
}

export async function obtenerComprobantesFallidos(transporte: Transporte, opciones: OpcionesFallidos): Promise<ComprobanteFallido[]> {
    const fallidos: ComprobanteFallido[] = [];
    for (const comprobante of await obtenerComprobantes(transporte, opciones, true)) {
        const tiposFallidos = (Object.entries(comprobante.estadosDescarga) as Array<[TipoArchivo, Comprobante['estadosDescarga']['xml']]>)
            .filter(([, estado]) => estado?.estado === 'fallido' && (opciones.incluirNoEncontrados || estado.codigo !== NO_ENCONTRADO))
            .map(([tipo]) => tipo);
        if (tiposFallidos.length > 0) fallidos.push({ ...comprobante, tiposFallidos });
    }
    return fallidos;
}

export async function descargarArchivo(transporte: Transporte, opciones: OpcionesArchivo): Promise<ArchivoDescargado> {
    const partes = [opciones.registro, opciones.rucEmisor, opciones.codTipoCdp, opciones.serie, opciones.numero, opciones.tipoArchivo];
    const respuesta = await transporte.solicitar({
        ruta: `/comprobantes/${partes.map(encodeURIComponent).join('/')}`,
        consulta: { reintentos: opciones.reintentos },
        senal: opciones.senal,
    });
    const restantes = respuesta.headers.get('x-perunio-descargas-restantes');
    return {
        nombre: nombreDeArchivo(respuesta.headers.get('content-disposition')) ??
            `${opciones.rucEmisor}-${opciones.codTipoCdp}-${opciones.serie}-${opciones.numero}.${opciones.tipoArchivo === 'pdf' ? 'pdf' : 'xml'}`,
        tipoContenido: respuesta.headers.get('content-type') ?? 'application/octet-stream',
        datos: await respuesta.arrayBuffer(),
        descargasRestantes: restantes === null ? null : Number(restantes),
    };
}

/** `attachment; filename="F001-1.xml"` → `F001-1.xml`. */
function nombreDeArchivo(contentDisposition: string | null): string | null {
    const coincidencia = contentDisposition && /filename="([^"]+)"/.exec(contentDisposition);
    return coincidencia ? coincidencia[1]! : null;
}
