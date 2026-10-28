import {expect,it} from 'vitest';
import {resultMessage} from '../src/result-message';
it.each([
  [0,'また一緒にLIVEしよう！'],[499999,'また一緒にLIVEしよう！'],[500000,'レスが届いたLIVE！'],
  [699999,'レスが届いたLIVE！'],[700000,'いい感じのLIVE！'],[849999,'いい感じのLIVE！'],
  [850000,'大盛り上がりのLIVE！'],[949999,'大盛り上がりのLIVE！'],[950000,'最高なLIVE！'],
  [999999,'最高なLIVE！'],[1000000,'伝説のLIVE！'],
])('uses whole-chart base score %s for the result message',(score,message)=>expect(resultMessage(score as number)).toBe(message));
