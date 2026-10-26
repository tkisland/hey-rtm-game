import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./tests/sakura',workers:1,outputDir:'test-results/sakura',
  use:{
    baseURL:'http://127.0.0.1:4185/rhythm/',
    launchOptions:{executablePath:process.env.CHROMIUM_PATH || (process.env.CI ? undefined : '/usr/bin/chromium'),args:['--no-sandbox']},
  },
  webServer:{
    command:'npm run preview -- --host 127.0.0.1 --port 4185 --base /rhythm/ --strictPort',
    url:'http://127.0.0.1:4185/rhythm/',reuseExistingServer:false,
  },
  projects:[
    {name:'desktop',use:{browserName:'chromium',viewport:{width:1280,height:900}}},
    {name:'mobile-touch',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3}},
  ],
});
