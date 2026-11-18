// Copia la especificación de la API desde perunio-backend y regenera src/tipos-api.ts.
//   node scripts/sincronizar-openapi.mjs              copia y regenera
//   node scripts/sincronizar-openapi.mjs --comprobar  falla si los tipos no coinciden con openapi/v1.json
//
// La fuente de verdad es perunio-backend/docs/public-api/openapi.json, generada desde los
// esquemas zod del servidor. Aquí se guarda una copia (openapi/v1.json) para que el SDK
// compile sin el repositorio del backend al lado.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const especificacion = join(raiz, 'openapi/v1.json');
const tipos = join(raiz, 'src/tipos-api.ts');
const backend = resolve(raiz, '../perunio-backend/docs/public-api/openapi.json');
const comprobar = process.argv.includes('--comprobar');

function generar(destino) {
    execFileSync(join(raiz, 'node_modules/.bin/openapi-typescript'), [especificacion, '-o', destino], { stdio: 'pipe' });
}

if (comprobar) {
    const temporal = join(mkdtempSync(join(tmpdir(), 'perunio-sdk-')), 'tipos-api.ts');
    generar(temporal);
    if (readFileSync(temporal, 'utf8') !== readFileSync(tipos, 'utf8')) {
        console.error('src/tipos-api.ts no coincide con openapi/v1.json. Ejecuta `npm run sincronizar:openapi`.');
        process.exit(1);
    }
    console.log('src/tipos-api.ts está al día.');
} else {
    if (existsSync(backend)) {
        copyFileSync(backend, especificacion);
        console.log(`Copiada ${backend}`);
    } else {
        console.warn(`No se encontró ${backend}; se usa la copia de openapi/v1.json.`);
    }
    generar(tipos);
    console.log('Regenerado src/tipos-api.ts');
}
