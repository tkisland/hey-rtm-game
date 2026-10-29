import {test,expect} from '@playwright/test';
const documents='http://127.0.0.1:8080/v1/projects/demo-hey-rtm/databases/(default)/documents';
async function role(uid:string,enabled:boolean){
  const response=await fetch(`${documents}/admins/${uid}`,{method:'PATCH',headers:{'content-type':'application/json',authorization:'Bearer owner'},body:JSON.stringify({fields:{enabled:{booleanValue:enabled}}})});expect(response.ok).toBe(true);
}
test('only administrators see records, send an ID token, and can hide/restore with a reason and inspect history',async({page})=>{
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-hey-rtm/databases/(default)/documents',{method:'DELETE'});
  let hidden=false,revision=0;const history:{hidden:boolean;revision:number;reason:string;actorUid:string;createdAt:number}[]=[];
  const reasons:string[]=[];
  await page.route('**/api/moderation.php',async route=>{
    const data=route.request().postDataJSON();expect(typeof data.idToken).toBe('string');expect(data.idToken.length).toBeGreaterThan(30);
    expect(route.request().url()).not.toContain(data.idToken);
    if(data.action==='list')await route.fulfill({json:{ok:true,entries:[{id:'1',name:'ABC123',score:1100000,maxCombo:500,createdAt:1,hidden,revision,reason:history.at(-1)?.reason ?? '',actorUid:'owner',updatedAt:1,rulesVersion:7,chartHash:'a'.repeat(64)}],nextCursor:null}});
    else if(data.action==='history')await route.fulfill({json:{ok:true,history:[...history].reverse()}});
    else{reasons.push(data.reason);hidden=data.action==='hide';revision++;history.push({hidden,revision,reason:data.reason,actorUid:'owner',createdAt:1});await route.fulfill({json:{ok:true,entryId:'1',hidden,revision}});}
  });
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.goto('/moderation.html');await expect(page.locator('#moderation-panel')).toBeHidden();
  const uid=await page.evaluate(async()=> (await import('/tests/cloud/auth-browser-fixture.ts')).signInGoogle(`moderator-${crypto.randomUUID()}@example.test`));
  await expect(page.locator('#login-status')).toContainText('権限がありません');await expect(page.locator('#moderation-entries')).toBeEmpty();
  await role(uid,true);await expect(page.locator('[data-entry="1"] h2')).toHaveText('ABC123 · 公開中');
  await page.getByRole('button',{name:'非表示にする',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'変更理由を入力'})).toBeVisible();expect(reasons).toEqual([]);
  await page.getByRole('textbox',{name:'記録1の変更理由'}).fill('<img src=x onerror=alert(1)> 確認中');await page.getByRole('button',{name:'非表示にする',exact:true}).click();
  await expect(page.locator('[data-entry="1"] h2')).toHaveText('ABC123 · 非表示');await expect(page.locator('[data-entry="1"] img')).toHaveCount(0);
  await page.getByRole('textbox',{name:'記録1の変更理由'}).fill('確認済み');await page.getByRole('button',{name:'復元する',exact:true}).click();
  await expect(page.locator('[data-entry="1"] h2')).toHaveText('ABC123 · 公開中');
  await page.getByText('変更履歴（最新20件）').click();await expect(page.locator('[data-entry="1"] details li')).toHaveCount(2);
  await role(uid,false);await expect(page.locator('#moderation-panel')).toBeHidden();await expect(page.locator('#moderation-entries')).toBeEmpty();
});
