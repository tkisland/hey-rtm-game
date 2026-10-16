import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/cloud', testMatch:'**/*.spec.ts', workers:1,
  outputDir:'test-results/cloud',
  use:{baseURL:'http://127.0.0.1:4184',launchOptions:{executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']}},
  webServer:{command:'npm run dev -- --mode cloud-test --host 127.0.0.1 --port 4184 --strictPort',url:'http://127.0.0.1:4184',reuseExistingServer:false},
  projects:[
    {name:'desktop',use:{browserName:'chromium',viewport:{width:1280,height:900}}},
    {name:'mobile-touch',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  ],
});
