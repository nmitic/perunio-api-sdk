import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist', 'src/tipos-api.ts'] },
    ...tseslint.configs.recommended,
);
