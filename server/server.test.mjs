import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, validateReading, localRecommendation, SOIL_SKILL } from './server.mjs';

test('soil advisor skill loads', () => {
  assert.match(SOIL_SKILL,/moistureRaw/);
});

test('chat grounds on readings sent by the phone', async () => {
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const reading={deviceId:'SoilSphere-ESP32',timestamp:'2026-11-01T12:00:00Z',nitrogenMgKg:12,phosphorusMgKg:7,potassiumMgKg:30,moistureRaw:2100};
    const chat=await fetch(base+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'How is my soil?',history:[],readings:[{bad:true},reading]})});
    const answer=await chat.json();
    assert.equal(chat.status,200);
    assert.match(answer.reply,/N 12, P 7, and K 30/);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

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
