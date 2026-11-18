import { afterEach, describe, expect, it } from 'vitest';
import { ClientePerunio, ErrorPerunio } from '../src/indice';
import { apiFalsa, errorApi, json } from './api-falsa';

const comoNavegador = () => {
    Object.assign(globalThis, { window: {}, document: {} });
};

afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
});

describe('ClientePerunio', () => {
    it('envía la clave como Bearer a api.perunio.pe/v1', async () => {
        const api = apiFalsa().en('GET /comprobantes', json({ registro: 'rce', periodo: '202610', total: 0, datos: [] }));
        await api.cliente().obtenerComprobantes({ registro: 'rce', periodo: '202610' });
        const [llamada] = api.llamadas;
        expect(llamada!.url.href).toBe('https://api.perunio.pe/v1/comprobantes?registro=rce&periodo=202610');
        expect(llamada!.encabezados['authorization']).toBe('Bearer prn_live_prueba');
    });

    it('acepta la clave sola', () => {
        expect(new ClientePerunio('prn_live_x')).toBeInstanceOf(ClientePerunio);
    });

    it('pide una clave si no hay un backend propio', () => {
        expect(() => new ClientePerunio({})).toThrow(expect.objectContaining({ codigo: 'SIN_CLAVE' }));
    });

    it('se niega a llevar la clave a un navegador', () => {
        comoNavegador();
        expect(() => new ClientePerunio('prn_live_x')).toThrow(ErrorPerunio);
        expect(() => new ClientePerunio('prn_live_x')).toThrow(expect.objectContaining({ codigo: 'CLAVE_EN_NAVEGADOR' }));
    });

    it('en un navegador funciona a través de un backend propio, sin clave', async () => {
        comoNavegador();
        const llamadas: string[] = [];
        const cliente = new ClientePerunio({
            urlBase: 'https://mi-erp.pe/perunio/',
            fetch: async (entrada, init) => {
                llamadas.push(`${String(entrada)} ${new Headers(init?.headers).get('authorization')}`);
                return json({ registro: 'rce', periodo: '202610', total: 0, datos: [] });
            },
        });
        await cliente.obtenerComprobantes({ registro: 'rce', periodo: '202610' });
        expect(llamadas).toEqual(['https://mi-erp.pe/perunio/comprobantes?registro=rce&periodo=202610 null']);
    });
});

describe('errores', () => {
    it('trae el código, los detalles y el idSolicitud de la API', async () => {
        const api = apiFalsa().en('POST /descargas-masivas', errorApi(409, 'TRABAJO_ACTIVO_EXISTENTE', { idTrabajo: 'otro' }));
        const error = await api.cliente().descargaMasiva({ registro: 'rce', periodo: '202610' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ErrorPerunio);
        expect(error).toMatchObject({ codigo: 'TRABAJO_ACTIVO_EXISTENTE', estadoHttp: 409, idSolicitud: 'req_1', idTrabajo: 'otro' });
    });

    it('reconoce una respuesta que no es de la API', async () => {
        const api = apiFalsa().en('GET /comprobantes', new Response('<html>Bad gateway</html>', { status: 500 }));
        await expect(api.cliente().obtenerComprobantes({ registro: 'rce', periodo: '202610' }))
            .rejects.toMatchObject({ codigo: 'RESPUESTA_INESPERADA', estadoHttp: 500 });
    });
});

describe('reintentos', () => {
    it('repite una lectura ante una falla pasajera, respetando Retry-After', async () => {
        const api = apiFalsa()
            .en('GET /comprobantes', errorApi(503, 'ALMACENAMIENTO_NO_DISPONIBLE', undefined, { 'Retry-After': '0' }))
            .en('GET /comprobantes', json({ registro: 'rce', periodo: '202610', total: 0, datos: [] }));
        await api.cliente({ reintentos: 2 }).obtenerComprobantes({ registro: 'rce', periodo: '202610' });
        expect(api.llamadas).toHaveLength(2);
    });

    it('no repite un error que no es pasajero', async () => {
        const api = apiFalsa().en('GET /comprobantes', errorApi(422, 'SIRE_SIN_CREDENCIALES'));
        await expect(api.cliente({ reintentos: 2 }).obtenerComprobantes({ registro: 'rce', periodo: '202610' }))
            .rejects.toMatchObject({ codigo: 'SIRE_SIN_CREDENCIALES' });
        expect(api.llamadas).toHaveLength(1);
    });

    it('se rinde con ERROR_DE_RED si la red no vuelve', async () => {
        const cliente = new ClientePerunio({
            claveApi: 'prn_live_x',
            reintentos: 0,
            fetch: async () => {
                throw new TypeError('fetch failed');
            },
        });
        await expect(cliente.obtenerComprobantes({ registro: 'rce', periodo: '202610' })).rejects.toMatchObject({ codigo: 'ERROR_DE_RED' });
    });
});
