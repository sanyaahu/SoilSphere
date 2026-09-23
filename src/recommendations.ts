import { SensorReading } from './data';
export type Insight = { title: string; detail: string; kind: 'watch' | 'info' };
export function getInsights(readings: SensorReading[]): Insight[] {
  const current=readings[readings.length-1], previous=readings[readings.length-2];
  if(!current) return [{title:'Awaiting readings',detail:'Connect the sensor to start building a soil history.',kind:'info'}];
  const result: Insight[]=[];
  if([current.nitrogenMgKg,current.phosphorusMgKg,current.potassiumMgKg].some(v=>v===null))
    result.push({title:'Complete the NPK panel',detail:'At least one nutrient value is missing. Check the probe connection before interpreting this sample.',kind:'watch'});
  if(previous) {
    const changed=['nitrogenMgKg','phosphorusMgKg','potassiumMgKg'].filter(key=>{
      const now=current[key as keyof SensorReading], old=previous[key as keyof SensorReading];
      return typeof now==='number' && typeof old==='number' && old>0 && Math.abs(now-old)/old>=0.3;
    });
    if(changed.length) result.push({title:'Repeat this nutrient reading',detail:'One or more NPK values changed by at least 30% since the last sample. Confirm probe placement and take another reading before acting.',kind:'watch'});
    if(current.moisturePercent!==null && previous.moisturePercent!==null && current.oxygenPercent!==null && previous.oxygenPercent!==null && current.moisturePercent-previous.moisturePercent>=5 && previous.oxygenPercent-current.oxygenPercent>=2)
      result.push({title:'Watch moisture and aeration',detail:'Moisture rose while oxygen fell. Check drainage and repeat the measurement to see whether the pattern persists.',kind:'watch'});
  }
  if(!result.length) result.push({title:'Build a baseline',detail:'Readings are available. Compare several days of measurements and your plant observations before changing water or fertilizer.',kind:'info'});
  return result;
}
