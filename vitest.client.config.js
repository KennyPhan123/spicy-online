import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/client.test.js'],
        environment: 'jsdom',
        environmentOptions: { jsdom: { url: 'https://spicy.example.test/' } }
    }
});
