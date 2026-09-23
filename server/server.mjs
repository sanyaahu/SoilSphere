import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const INGEST_TOKEN = process.env.INGEST_TOKEN;
const AI_PROVIDER = process.env.AI_PROVIDER || 'none';
const liveReadings = [];
const fields = {
  nitrogenMgKg: 2999, phosphorusMgKg: 2999, potassiumMgKg: 2999,
  moisturePercent: 100, lightLux: 100000, co2Ppm: 10000,
  oxygenPercent: 25, batteryPercent: 100,
};
const demoValues = [[41,28,62,30,28000,620,20.4,86],[42,29,60,31,35000,650,20.2,86],[40,31,61,33,42000,690,20.1,85],[39,30,59,32,31000,680,20.1,85],[38,32,58,34,37000,710,19.9,84],[38,32,58,34,39000,720,19.8,84]];
const demoReadings = demoValues.map((v,i)=>({
  deviceId:'soilsphere-demo-01', timestamp:new Date(Date.now()-(5-i)*7200000).toISOString(),
  nitrogenMgKg:v[0], phosphorusMgKg:v[1], potassiumMgKg:v[2],
  moisturePercent:v[3], lightLux:v[4], co2Ppm:v[5], oxygenPercent:v[6], batteryPercent:v[7],
}));
const send = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Ingest-Token','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}); res.end(JSON.stringify(data)); };
async function body(req) {
  let text='';
  for await (const part of req) { text+=part; if(text.length>16000) throw new Error('Request too large'); }
  return JSON.parse(text);
}
export function validateReading(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Reading must be an object');
  if(typeof input.deviceId!=='string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(input.deviceId)) throw new Error('Invalid deviceId');
  if(typeof input.timestamp!=='string' || !Number.isFinite(Date.parse(input.timestamp))) throw new Error('Invalid timestamp');
  const result={deviceId:input.deviceId,timestamp:new Date(input.timestamp).toISOString()};
  for(const [field,max] of Object.entries(fields)) {
    const value=input[field];
    if(value!==null && value!==undefined && (typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)) throw new Error('Invalid '+field);
    result[field]=value ?? null;
  }
  return result;
}
export function localRecommendation(reading) {
  if(!reading) return 'No sensor data has arrived yet. Connect the device to get a soil assessment.';
  const available=['nitrogenMgKg','phosphorusMgKg','potassiumMgKg'].filter(k=>reading[k]!==null);
  if(available.length<3) return 'Some NPK measurements are missing. Check the probe connection before interpreting nutrient levels.';
  return 'Your latest estimated NPK readings are N '+reading.nitrogenMgKg+', P '+reading.phosphorusMgKg+', and K '+reading.potassiumMgKg+' mg/kg. Compare the trend across repeated readings. Soil type, crop, and probe validation are needed before deciding on fertilizer amounts.';
}
async function aiReply(message,history,reading) {
  const grounding = 'You are SoilSphere, a concise soil-sensor assistant for home gardeners. Use only the supplied sensor data. Treat NPK values as unvalidated directional estimates, never lab-grade facts. Do not invent crop-specific thresholds, fertilizer amounts, or automated pump instructions. If data are missing, say so. Explain uncertainty and suggest observation or soil-test confirmation where appropriate. Keep replies under 120 words. Sensor reading JSON: '+JSON.stringify(reading);
  const messages=[...history.filter(x=>x && ['user','assistant'].includes(x.role) && typeof x.content==='string').slice(-8),{role:'user',content:message}];
  if(AI_PROVIDER==='openai' && process.env.OPENAI_API_KEY) {
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-6-astra',instructions:grounding,input:messages,store:false,max_output_tokens:250})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error?.message||'OpenAI request failed');
    return data.output?.flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text).join('\n') || 'No answer returned.';
  }
  if(AI_PROVIDER==='anthropic' && process.env.ANTHROPIC_API_KEY) {
    if(!process.env.ANTHROPIC_MODEL) throw new Error('Set ANTHROPIC_MODEL in the server environment');
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.ANTHROPIC_MODEL,max_tokens:250,system:grounding,messages})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error?.message||'Claude request failed');
    return data.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n') || 'No answer returned.';
  }
  return localRecommendation(reading);
}
export function createServer() {
  return http.createServer(async(req,res)=>{
    if(req.method==='OPTIONS') return send(res,204,{});
    const path=new URL(req.url||'/', 'http://localhost').pathname;
    try {
      if(req.method==='GET' && path==='/health') return send(res,200,{ok:true,mode:liveReadings.length?'live':'demo',aiProvider:AI_PROVIDER});
      if(req.method==='GET' && path==='/readings') return send(res,200,{mode:liveReadings.length?'live':'demo',readings:liveReadings.length?liveReadings:demoReadings});
      if(req.method==='POST' && path==='/readings') {
        if(!INGEST_TOKEN) return send(res,503,{error:'Set INGEST_TOKEN on the server before sensor ingestion'});
        if(req.headers['x-ingest-token']!==INGEST_TOKEN) return send(res,401,{error:'Invalid ingest token'});
        const reading=validateReading(await body(req)); liveReadings.push(reading);
        if(liveReadings.length>100) liveReadings.shift();
        liveReadings.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
        return send(res,201,{ok:true,reading});
      }
      if(req.method==='POST' && path==='/chat') {
        const input=await body(req);
        if(typeof input.message!=='string' || !input.message.trim() || input.message.length>1000) return send(res,400,{error:'Invalid message'});
        const reading=liveReadings.at(-1)||demoReadings.at(-1);
        const reply=await aiReply(input.message,Array.isArray(input.history)?input.history:[],reading);
        return send(res,200,{reply,provider:AI_PROVIDER});
      }
      send(res,404,{error:'Not found'});
    } catch(error) { send(res,error instanceof SyntaxError?400:400,{error:error instanceof Error?error.message:'Request failed'}); }
  });
}
if(process.argv[1] && import.meta.url===new URL('file:///'+process.argv[1].replaceAll('\\','/')).href) {
  createServer().listen(PORT,'0.0.0.0',()=>console.log('SoilSphere API listening on http://0.0.0.0:'+PORT));
}
