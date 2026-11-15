import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    logLevel: 'warning',
    build: {
        target: 'es2020',
        rollupOptions: {
            output: {
                // Keep the engine in its own long-cacheable chunk.
                manualChunks: {
                    phaser: ['phaser']
                }
            }
        },
        // Phaser alone is ~1.2 MB minified; don't warn about it.
        chunkSizeWarningLimit: 1600,
        minify: 'terser',
        terserOptions: {
            compress: { passes: 2 },
            mangle: true,
            format: { comments: false }
        }
    },
    preview: {
        host: 'localhost',
        port: 8081
    }
});
