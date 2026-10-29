import {test,expect} from '@playwright/test';
test('static pages receive a report-only policy and build metadata is not served',async({request})=>{
  const response=await request.get('/');expect(response.status()).toBe(200);
  const policy=response.headers()['content-security-policy-report-only'];expect(policy).toContain("default-src 'self'");expect(policy).toContain('https://www.youtube.com');
  expect(response.headers()['content-security-policy']).toBeUndefined();
  expect((await request.get('/.vite/manifest.json')).status()).toBe(404);
});
