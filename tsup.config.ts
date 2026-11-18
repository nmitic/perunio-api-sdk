import { defineConfig } from 'tsup';

// Dos entradas: el SDK universal (sin nada de Node) y los ayudantes de Node.
export default defineConfig([
    {
        entry: { indice: 'src/indice.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        clean: true,
        platform: 'neutral',
        target: 'es2022',
        sourcemap: true,
    },
    {
        entry: { nodo: 'src/nodo.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        platform: 'node',
        target: 'node20',
        sourcemap: true,
    },
]);
