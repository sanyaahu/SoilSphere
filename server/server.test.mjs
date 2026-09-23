import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, validateReading, localRecommendation } from './server.mjs';

test('sensor contract validates and normalizes a partial reading', () => {
  const reading=validateReading({deviceId:'bed-01',timestamp:'2026-09-23T12:00:00Z',nitrogenMgKg:45});
  assert.equal(reading.nitrogenMgKg,45);
  assert.equal(reading.phosphorusMgKg,null);
  assert.throws(()=>validateReading({...reading,moisturePercent:101}),/moisturePercent/);
});

test('demo API serves readings and local recommendations', async () => {
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base+'/readings');
    const data=await response.json();
    assert.equal(response.status,200);
    assert.equal(data.mode,'demo');
    assert.equal(data.readings.length,6);
    const chat=await fetch(base+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'What does this mean?',history:[]})});
    const answer=await chat.json();
    assert.equal(chat.status,200);
    assert.match(answer.reply,/NPK/);
    assert.match(localRecommendation(data.readings.at(-1)),/mg\/kg/);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
