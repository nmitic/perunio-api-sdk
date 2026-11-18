import { describe, expect, it } from 'vitest';
import type { Comprobante } from '../src/indice';
import { agruparPorTipos } from '../src/reintentar';
import { ID, apiFalsa, json, trabajo } from './api-falsa';

const estado = (e: 'descargado' | 'fallido', codigo: string | null = null) => ({ estado: e, codigo, intentadoEn: '2026-11-01T00:00:00.000Z' });

function comprobante(numero: string, estadosDescarga: Partial<Comprobante['estadosDescarga']>): Comprobante {
    return {
        id: `car-${numero}`, rucEmisor: '20100070970', codTipoCdp: '01', serie: 'F001', numero, descargable: true,
        fechaEmision: null, fechaVencimiento: null, contraparte: { tipoDocumento: '6', numeroDocumento: '1', nombre: 'X' },
        moneda: 'PEN', tipoCambio: null, montos: { baseImponible: 1, igv: 0.18, total: 1.18 }, estado: '1', documentoModificado: null,
        estadosDescarga: { xml: null, pdf: null, cdr: null, ...estadosDescarga },
    };
}

const lista = (...datos: Comprobante[]) => json({ registro: 'rce', periodo: '202610', total: datos.length, datos });

describe('obtenerComprobantesFallidos', () => {
    it('pide solo los fallidos y dice qué archivos volver a pedir', async () => {
        const api = apiFalsa().en('GET /comprobantes', lista(
            comprobante('1', { xml: estado('descargado'), pdf: estado('fallido', 'SUNAT_NO_DISPONIBLE') }),
            comprobante('2', { xml: estado('fallido', 'COMPROBANTE_NO_ENCONTRADO') }),
        ));
        const fallidos = await api.cliente().obtenerComprobantesFallidos({ registro: 'rce', periodo: '202610' });
        expect(api.llamadas[0]!.url.searchParams.get('estadoDescarga')).toBe('fallido');
        expect(fallidos.map((c) => [c.numero, c.tiposFallidos])).toEqual([['1', ['pdf']]]);
    });

    it('incluye lo que SUNAT no tiene si se pide', async () => {
        const api = apiFalsa().en('GET /comprobantes', lista(comprobante('2', { xml: estado('fallido', 'COMPROBANTE_NO_ENCONTRADO') })));
        const fallidos = await api.cliente().obtenerComprobantesFallidos({ registro: 'rce', periodo: '202610', incluirNoEncontrados: true });
        expect(fallidos[0]!.tiposFallidos).toEqual(['xml']);
    });
});

describe('agruparPorTipos', () => {
    it('agrupa por la combinación de archivos fallidos, sin importar el orden', () => {
        const c = (numero: string, tiposFallidos: Array<'xml' | 'pdf' | 'cdr'>) => ({ ...comprobante(numero, {}), tiposFallidos });
        const grupos = agruparPorTipos([c('1', ['pdf']), c('2', ['pdf', 'xml']), c('3', ['pdf']), c('4', ['xml', 'pdf'])]);
        expect(grupos.map(([tipos, cs]) => [tipos, cs.map((x) => x.numero)])).toEqual([
            [['pdf'], ['1', '3']],
            [['pdf', 'xml'], ['2', '4']],
        ]);
    });
});

describe('reintentarFallidos', () => {
    it('crea un trabajo por grupo, uno tras otro, y repite hasta que no queda nada', async () => {
        const terminado = (archivosDescargados: number) => json(trabajo({ estado: 'completado', archivosDescargados }));
        const api = apiFalsa()
            // Vuelta 1: a 1 le falló el PDF, a 2 el XML y el PDF.
            .en('GET /comprobantes', lista(
                comprobante('1', { pdf: estado('fallido', 'SUNAT_NO_DISPONIBLE') }),
                comprobante('2', { xml: estado('fallido', 'SUNAT_NO_DISPONIBLE'), pdf: estado('fallido', 'SUNAT_NO_DISPONIBLE') }),
            ))
            // Vuelta 2: sigue fallando el PDF de 2.
            .en('GET /comprobantes', lista(comprobante('2', { pdf: estado('fallido', 'SUNAT_NO_DISPONIBLE') })))
            .en('GET /comprobantes', lista())
            .en('POST /descargas-masivas', json({ ...trabajo(), comprobantesOmitidos: [] }, 202))
            .en(`GET /descargas-masivas/${ID}`, terminado(1))
            .en(`GET /descargas-masivas/${ID}`, terminado(1))
            .en(`GET /descargas-masivas/${ID}`, terminado(1));
        const terminados: number[] = [];
        const resumen = await api.cliente().reintentarFallidos({
            registro: 'rce', periodo: '202610', esperaEntreRondasMs: 0,
            alTerminarTrabajo: (_t, final) => { terminados.push(final.archivosDescargados); },
        });

        const creaciones = api.llamadas.filter((l) => l.metodo === 'POST').map((l) => l.cuerpo as { tiposArchivo: string[]; comprobantes: Array<{ numero: string }> });
        expect(creaciones.map((c) => [c.tiposArchivo, c.comprobantes.map((x) => x.numero)])).toEqual([
            [['pdf'], ['1']],
            [['pdf', 'xml'], ['2']],
            [['pdf'], ['2']],
        ]);
        expect(resumen.trabajos).toHaveLength(3);
        expect(resumen.archivosDescargados).toBe(3);
        expect(terminados).toEqual([1, 1, 1]);
        expect(resumen.siguenFallando).toEqual([]);
    });

    it('no crea nada si no hay fallidos', async () => {
        const api = apiFalsa().en('GET /comprobantes', lista());
        const resumen = await api.cliente().reintentarFallidos({ registro: 'rce', periodo: '202610' });
        expect(resumen).toEqual({ trabajos: [], archivosDescargados: 0, siguenFallando: [] });
        expect(api.llamadas).toHaveLength(1);
    });
});

describe('descargarArchivo', () => {
    it('devuelve el archivo con el nombre de SUNAT y las descargas restantes', async () => {
        const api = apiFalsa().en('GET /comprobantes/rce/20100070970/01/F001/123/xml', new Response('<Invoice/>', {
            headers: {
                'Content-Type': 'application/xml',
                'Content-Disposition': 'attachment; filename="20100070970-01-F001-123.xml"',
                'X-Perunio-Descargas-Restantes': '9',
            },
        }));
        const archivo = await api.cliente().descargarArchivo({
            registro: 'rce', rucEmisor: '20100070970', codTipoCdp: '01', serie: 'F001', numero: '123', tipoArchivo: 'xml', reintentos: 2,
        });
        expect(archivo).toMatchObject({ nombre: '20100070970-01-F001-123.xml', tipoContenido: 'application/xml', descargasRestantes: 9 });
        expect(new TextDecoder().decode(archivo.datos)).toBe('<Invoice/>');
        expect(api.llamadas[0]!.url.search).toBe('?reintentos=2');
    });

    it('sin cabecera de restantes, el plan es ilimitado', async () => {
        const api = apiFalsa().en('GET /comprobantes/rce/1/01/F001/1/pdf', new Response('%PDF'));
        const archivo = await api.cliente().descargarArchivo({ registro: 'rce', rucEmisor: '1', codTipoCdp: '01', serie: 'F001', numero: '1', tipoArchivo: 'pdf' });
        expect(archivo.descargasRestantes).toBeNull();
    });
});
