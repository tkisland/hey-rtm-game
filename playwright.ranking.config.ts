import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/ranking',workers:1,outputDir:'test-results/ranking',
  use:{baseURL:'http://127.0.0.1:4194/rhythm/',launchOptions:{executablePath:process.env.CHROMIUM_PATH || (process.env.CI?undefined:'/usr/bin/chromium'),args:['--no-sandbox']}},
  projects:[
    {name:'desktop',use:{browserName:'chromium',viewport:{width:1280,height:900}}},
    {name:'mobile-touch',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  ],
});
