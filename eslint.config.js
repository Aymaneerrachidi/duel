import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['dist/**', 'node_modules/**', '.data/**', '.wrangler/**', 'test-results/**', 'playwright-report/**', 'contracts/solana/**'] }, js.configs.recommended, ...tseslint.configs.recommended, {
  files: ['**/*.{ts,tsx}'], rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], 'no-undef': 'off' }
});
