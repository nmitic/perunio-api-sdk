import { describe, expect, it } from 'vitest';
import type { Progreso } from '../src/indice';
import { ID, apiFalsa, errorApi, json, trabajo } from './api-falsa';

const RUTA = `/descargas-masivas/${ID}`;

describe('descargaMasiva', () => {
    it('pide el periodo completo con XML, PDF y CDR por defecto, con una Idempotency-Key', async () => {
        const api = apiFalsa().en('POST /descargas-masivas', json({ ...trabajo({ estado: 'listando' }), comprobantesOmitidos: [] }, 202));
        const descarga = await api.cliente().descargaMasiva({ registro: 'rce', periodo: '202610' });
        const [llamada] = api.llamadas;
        expect(llamada!.cuerpo).toEqual({ registro: 'rce', periodo: '202610', tiposArchivo: ['xml', 'pdf', 'cdr'] });
        expect(llamada!.encabezados['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
        expect(descarga.id).toBe(ID);
        expect(descarga.estado?.estado).toBe('listando');
    });

    it('envía solo la identidad de cada comprobante, aunque lleguen filas completas', async () => {
        const api = apiFalsa().en('POST /descargas-masivas', json({
            ...trabajo({ modo: 'comprobantes' }),
            comprobantesOmitidos: [{ rucEmisor: '1', codTipoCdp: '50', serie: 'D', numero: '1', motivo: 'NO_DESCARGABLE' }],
        }, 202));
        const fila = { rucEmisor: '20100070970', codTipoCdp: '01', serie: 'F001', numero: '1', moneda: 'PEN', descargable: true };
        const descarga = await api.cliente().descargaMasiva({
            registro: 'rce', periodo: '202610', comprobantes: [fila], tiposArchivo: ['pdf'], reintentosMaximos: 5, claveIdempotencia: 'mia',
        });
        const [llamada] = api.llamadas;
        expect(llamada!.cuerpo).toEqual({
            registro: 'rce', periodo: '202610', tiposArchivo: ['pdf'], reintentosMaximos: 5,
            comprobantes: [{ rucEmisor: '20100070970', codTipoCdp: '01', serie: 'F001', numero: '1' }],
        });
        expect(llamada!.encabezados['idempotency-key']).toBe('mia');
        expect(descarga.comprobantesOmitidos).toHaveLength(1);
    });

    it('repite el POST tras un corte con la misma Idempotency-Key, sin duplicar el trabajo', async () => {
        const api = apiFalsa()
            .en('POST /descargas-masivas', errorApi(503, 'ALMACENAMIENTO_NO_DISPONIBLE', undefined, { 'Retry-After': '0' }))
            .en('POST /descargas-masivas', json({ ...trabajo(), comprobantesOmitidos: [] }, 202));
        await api.cliente({ reintentos: 1 }).descargaMasiva({ registro: 'rce', periodo: '202610' });
        const [primera, segunda] = api.llamadas;
        expect(segunda!.encabezados['idempotency-key']).toBe(primera!.encabezados['idempotency-key']);
    });
});

describe('TrabajoDescargaMasiva', () => {
    it('avisa el progreso hasta que termina, y terminado() devuelve el trabajo', async () => {
        const api = apiFalsa()
            .en(`GET ${RUTA}`, json(trabajo({ estado: 'listando' })))
            .en(`GET ${RUTA}`, json(trabajo({ estado: 'procesando', totalComprobantes: 4, comprobantesProcesados: 1, archivosDescargados: 3 })))
            .en(`GET ${RUTA}`, json(trabajo({ estado: 'procesando', totalComprobantes: 4, comprobantesProcesados: 1, archivosDescargados: 3 })))
            .en(`GET ${RUTA}`, json(trabajo({ estado: 'completado', totalComprobantes: 4, comprobantesProcesados: 4, archivosDescargados: 11, archivosFallidos: 1 })));
        const descarga = api.cliente().trabajo(ID);
        const avances: Array<Pick<Progreso, 'estado' | 'porcentaje' | 'archivosDescargados'>> = [];
        descarga.alProgresar(({ estado, porcentaje, archivosDescargados }) => avances.push({ estado, porcentaje, archivosDescargados }));
        const final = await descarga.terminado();

        expect(final.estado).toBe('completado');
        expect(avances).toEqual([
            { estado: 'listando', porcentaje: null, archivosDescargados: 0 },
            { estado: 'procesando', porcentaje: 25, archivosDescargados: 3 },
            { estado: 'completado', porcentaje: 100, archivosDescargados: 11 },
        ]);
    });

    it('comparte una sola consulta entre todos los que escuchan y esperan', async () => {
        const api = apiFalsa().en(`GET ${RUTA}`, json(trabajo({ estado: 'completado' })));
        const descarga = api.cliente().trabajo(ID);
        descarga.alProgresar(() => undefined);
        descarga.alProgresar(() => undefined);
        await Promise.all([descarga.terminado(), descarga.terminado()]);
        expect(api.llamadas).toHaveLength(1);
    });

    it('deja de consultar cuando nadie escucha ni espera', async () => {
        const api = apiFalsa().en(`GET ${RUTA}`, json(trabajo({ estado: 'procesando', totalComprobantes: 2 })));
        const descarga = api.cliente({ intervaloConsultaMs: 5 }).trabajo(ID);
        const dejar = descarga.alProgresar(() => undefined);
        await new Promise((r) => setTimeout(r, 30));
        dejar();
        await new Promise((r) => setTimeout(r, 30));
        const consultas = api.llamadas.length;
        await new Promise((r) => setTimeout(r, 30));
        expect(api.llamadas.length).toBe(consultas);
    });

    it('lanza el código de la API si el trabajo falla', async () => {
        const api = apiFalsa().en(`GET ${RUTA}`, json(trabajo({ estado: 'fallido', error: { codigo: 'CUOTA_AGOTADA', mensaje: 'Sin descargas' } })));
        const error = await api.cliente().trabajo(ID).terminado().catch((e: unknown) => e);
        expect(error).toMatchObject({ codigo: 'CUOTA_AGOTADA', message: 'Sin descargas', trabajo: { estado: 'fallido' } });
    });

    it('lanza TRABAJO_CANCELADO si el trabajo se cancela', async () => {
        const api = apiFalsa().en(`GET ${RUTA}`, json(trabajo({ estado: 'cancelado' })));
        await expect(api.cliente().trabajo(ID).terminado()).rejects.toMatchObject({ codigo: 'TRABAJO_CANCELADO' });
    });

    it('deja de esperar al abortar la señal', async () => {
        const api = apiFalsa().en(`GET ${RUTA}`, json(trabajo({ estado: 'procesando' })));
        const control = new AbortController();
        const espera = api.cliente({ intervaloConsultaMs: 5 }).trabajo(ID).terminado({ senal: control.signal });
        control.abort(new Error('basta'));
        await expect(espera).rejects.toThrow('basta');
    });

    it('cancelar() envía DELETE y avisa el nuevo estado', async () => {
        const api = apiFalsa()
            .en(`GET ${RUTA}`, json(trabajo({ estado: 'procesando', totalComprobantes: 2 })))
            .en(`DELETE ${RUTA}`, json(trabajo({ estado: 'cancelado' })));
        const descarga = api.cliente({ intervaloConsultaMs: 50 }).trabajo(ID);
        const estados: string[] = [];
        const dejar = descarga.alProgresar(({ estado }) => estados.push(estado));
        await new Promise((r) => setTimeout(r, 10));
        expect((await descarga.cancelar()).estado).toBe('cancelado');
        dejar();
        expect(api.llamadas.map((l) => l.metodo)).toEqual(['GET', 'DELETE']);
        expect(estados).toEqual(['procesando', 'cancelado']);
    });

    it('baja el ZIP siguiendo la redirección sin enviar la clave al enlace', async () => {
        const enlace = 'https://r2.example/zip?firma=1';
        const api = apiFalsa()
            .en(`GET ${RUTA}/archivo`, new Response(null, { status: 302, headers: { Location: enlace } }))
            .en(`GET ${enlace.split('?')[0]}`, new Response(new Uint8Array([80, 75, 3, 4])));
        const zip = await api.cliente().trabajo(ID).descargarZip();
        expect(new Uint8Array(zip)).toEqual(new Uint8Array([80, 75, 3, 4]));
        expect(api.llamadas[1]!.url.href).toBe(enlace);
        expect(api.llamadas[1]!.encabezados['authorization']).toBeUndefined();
    });

    it('acepta el ZIP directo de un backend propio', async () => {
        const api = apiFalsa().en(`GET ${RUTA}/archivo`, new Response(new Uint8Array([1, 2])));
        expect((await api.cliente().trabajo(ID).descargarZip()).byteLength).toBe(2);
    });

    it('recorre los comprobantes del trabajo página por página', async () => {
        const fila = (numero: string) => ({ rucEmisor: '1', codTipoCdp: '01', serie: 'F001', numero, estado: 'fallido', archivosFallidos: [] });
        const api = apiFalsa()
            .en(`GET ${RUTA}/comprobantes`, json({ datos: [fila('1'), fila('2')], siguienteCursor: 'c2' }))
            .en(`GET ${RUTA}/comprobantes`, json({ datos: [fila('3')], siguienteCursor: null }));
        const numeros: string[] = [];
        for await (const c of api.cliente().trabajo(ID).comprobantes({ estado: 'fallido', porPagina: 2 })) numeros.push(c.numero);
        expect(numeros).toEqual(['1', '2', '3']);
        expect(api.llamadas[1]!.url.search).toBe('?estado=fallido&limite=2&cursor=c2');
    });
});

describe('listarDescargasMasivas', () => {
    it('sigue el cursor hasta el final', async () => {
        const api = apiFalsa()
            .en('GET /descargas-masivas', json({ datos: [trabajo({ id: 'a' })], siguienteCursor: 'x' }))
            .en('GET /descargas-masivas', json({ datos: [trabajo({ id: 'b' })], siguienteCursor: null }));
        const ids: string[] = [];
        for await (const t of api.cliente().listarDescargasMasivas({ estado: 'completado' })) ids.push(t.id);
        expect(ids).toEqual(['a', 'b']);
        expect(api.llamadas[0]!.url.search).toBe('?estado=completado&limite=20');
    });
});
