import { defineConfig } from '@playwright/test';
/** An already running isolated lab/table server; never starts or reuses application services. */
export default defineConfig({testDir:'./tests',testMatch:'remote-ui.spec.ts',grep:/field watcher automatic:/,workers:1,retries:0,reporter:'list',outputDir:'../../data/vision/benchmark/field-watcher/e2e',use:{baseURL:process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449',channel:'chromium',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'}});
