import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    server: {
        host: 'localhost',
        port: 8080,
        open: false
    }
});
